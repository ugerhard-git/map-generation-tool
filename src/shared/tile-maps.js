// Shared code: maps in tiles of 10°, loaded tile by tile. Used by both tools; the build puts it into a page
// where that page's app.js says /*SHARED tile-maps.js*/ (see src/assemble.js). It uses names that app.js
// defines, as if it were written there.
/* ---------- maps in tiles ----------
   The landscape map (landscape.js, plan step 47) and the terrain map (terrain.js, step 48) are made the
   same way (tools/landscape.js, tools/terrain.js): for every square of 1/120° (about 1 km) a number from
   0 to 7, in tiles of 10° published next to the page; the build gives the page, for each map, where they
   are, each tile's fingerprint, integrity value and size, and the grid (LANDSCAPE, TERRAIN). A page loads a
   tile the first time a search looks at a place in it, with the setting or the tag on; its policy allows
   these fetches ('self'), as for the settlement map, and each tile is checked against its integrity
   value. While tiles load, a line under the setting says so, with a spinner; if one cannot be loaded, the
   line says that. */

/** A map in tiles, with its line under the setting.
 *  info: the build's LANDSCAPE or TERRAIN; words: what to call it ("landscape map"); statusId: its line;
 *  inUse(): whether its setting or tag is on (for the line before anything is loaded).
 *  Returns valueAt(lat, lng): a promise of the number at that place (0 where there is no tile, the sea),
 *  or of null when its tile could not be loaded; and note(), which updates the line. */
function tileMap(info, words, statusId, inUse) {
  /** The tiles asked for: a promise of the tile, or of null when it could not be loaded (and is then
   *  forgotten, so the next look tries again). @type {Map<string, Promise<{rowStart: Uint32Array, ends: Uint16Array, values: Uint8Array} | null>>} */
  const tiles = new Map();
  let loading = 0, // tiles loading now
    loaded = 0, // tiles loaded
    bytes = 0;
  const side = info.grid.tileDegrees * info.grid.cellsPerDegree;
  /* The line under the setting: loading (with a spinner), what is loaded, or why something is not. */
  const status = (state, text = "") => {
    const el = $(statusId);
    el.hidden = state === "hidden";
    el.className = "settlement-status " + state;
    el.textContent = text;
  };
  /* When nothing is loading: what is loaded so far, or, before anything is, how it is loaded. */
  const note = () => {
    if (loading) return;
    if (loaded)
      status(
        "done",
        `The ${words} is loaded for ${loaded} ${loaded === 1 ? "area" : "areas"} (${(bytes / 1e6).toFixed(1)} MB).`,
      );
    else if (inUse())
      status(
        "done",
        `The ${words} is loaded in pieces during the search, only for the areas searched (usually a few hundred KB).`,
      );
    else status("hidden");
  };
  /* The tile a place falls in ("N50E010": its south-west corner), and the square in it. */
  const square = (lat, lng) => {
    const g = info.grid;
    lng = ((((lng + 180) % 360) + 360) % 360) - 180;
    const south = Math.floor(lat / g.tileDegrees) * g.tileDegrees,
      west = Math.floor(lng / g.tileDegrees) * g.tileDegrees;
    const key =
      (south < 0 ? "S" : "N") +
      String(Math.abs(south)).padStart(2, "0") +
      (west < 0 ? "W" : "E") +
      String(Math.abs(west)).padStart(3, "0");
    return {
      key,
      row: Math.min(side - 1, Math.floor((south + g.tileDegrees - lat) * g.cellsPerDegree)),
      col: Math.min(side - 1, Math.floor((lng - west) * g.cellsPerDegree)),
    };
  };
  /* Loads a tile once; resolves to it, or to null when it could not be loaded. */
  const load = key => {
    if (tiles.has(key)) return tiles.get(key);
    const file = info.files[key];
    loading++;
    status("loading", `Loading the ${words} for this area…`);
    const tile = (async () => {
      const res = await fetch(info.base + key + "." + file[0] + ".bin", { integrity: file[1] });
      if (!res.ok) throw new Error(`the server answered ${res.status}`);
      const unpacked = new Uint8Array(
        await new Response(res.body.pipeThrough(new DecompressionStream("deflate"))).arrayBuffer(),
      );
      const read = readTile(unpacked, side);
      loaded++;
      bytes += file[2];
      loading--;
      note();
      return read;
    })().catch(e => {
      tiles.delete(key);
      loading--;
      status(
        "error",
        `The ${words} for an area could not be loaded` +
          (e && e.message ? ` (${cleanText(e.message, 80)})` : "") +
          ". Check your connection, then search again.",
      );
      return null;
    });
    tiles.set(key, tile);
    return tile;
  };
  const valueAt = async (lat, lng) => {
    const { key, row, col } = square(lat, lng);
    if (!info.files[key]) return 0; // no land in this tile
    const tile = await load(key);
    if (!tile) return null;
    // the stretches of a row are in order: find the first that ends after the column
    let lo = tile.rowStart[row],
      hi = tile.rowStart[row + 1] - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (tile.ends[mid] > col) hi = mid;
      else lo = mid + 1;
    }
    return tile.values[lo];
  };
  return { valueAt, note };
}
/* Reads an unpacked tile: for each row, stretches of one value, each an unsigned LEB128 number (length ×
   8 + value; see tools/landscape.js). Kept as the end of each stretch in its row, and its value. */
function readTile(bytes, side) {
  const rowStart = new Uint32Array(side + 1),
    ends = [],
    values = [];
  let at = 0,
    row = 0,
    col = 0;
  while (at < bytes.length) {
    let v = 0,
      shift = 1,
      b;
    do {
      if (at >= bytes.length) throw new Error("the file ends early");
      b = bytes[at++];
      v += (b & 127) * shift;
      shift *= 128;
    } while (b & 128);
    col += Math.floor(v / 8);
    if (col > side) throw new Error("a row is too long");
    ends.push(col);
    values.push(v % 8);
    if (col === side) {
      row++;
      rowStart[row] = ends.length;
      col = 0;
    }
  }
  if (row !== side || col) throw new Error("the file is not a whole tile");
  return { rowStart, ends: Uint16Array.from(ends), values: Uint8Array.from(values) };
}
