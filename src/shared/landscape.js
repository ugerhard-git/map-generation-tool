// Shared code: landscape. Used by both tools; the build puts it into a page where that page's app.js says
// /*SHARED landscape.js*/ (see src/assemble.js). It uses names that app.js defines, as if it were written
// there.
/* ---------- landscape ----------
   "Landscape" (plan step 47, agreed with the owner in November 2026): keep only locations in a forest, on
   farmland, in grassland or shrubland, or on bare ground or in a desert, and the tag "Forest", "Farmland",
   "Grassland" or "Bare ground". It goes by ESA WorldCover 2021 (10 m, CC BY 4.0), made by
   tools/landscape.js into the main landscape of every square of 1/120° (about 1 km), so a location gets
   what its road runs through; water does not count. The map is in tiles of 10° (made on GitHub, see
   .github/workflows/landscape.yml), files next to the page (LANDSCAPE: where, their integrity values and
   the grid), and a page loads a tile only when it looks at a place in it, with the setting or the tag on;
   the page's policy allows these fetches ('self'), as for the settlement map. While tiles load, a line
   under the choice says so, with a spinner; if one cannot be loaded, the line says that, and a search
   that needs it stops with that message. Built-up squares are left to "Town or countryside"; they, the
   rest (ice, wetland, tundra) and the sea get no landscape. */
const LANDSCAPE_CHOICES = ["any", "forest", "farmland", "grassland", "bare"];
/** The tiles asked for: a promise of the tile, or of null when it could not be loaded (and is then
 *  forgotten, so the next look tries again). @type {Map<string, Promise<{rowStart: Uint32Array, ends: Uint16Array, classes: Uint8Array} | null>>} */
const landscapeTiles = new Map();
let landscapeLoading = 0, // tiles loading now
  landscapeLoaded = 0, // tiles loaded
  landscapeBytes = 0;
/* The choice in the form: "any" or one of the landscapes. */
function landscapeChosen() {
  return document.querySelector("input[name=landscape]:checked")?.value || "any";
}
setRadio("landscape", LANDSCAPE_CHOICES.includes(store.get("landscape")) ? store.get("landscape") : "any");
for (const r of document.querySelectorAll("input[name=landscape]"))
  r.addEventListener("change", () => {
    store.set("landscape", landscapeChosen());
    landscapeNote();
  });
/* The line under the choice: loading (with a spinner), what is loaded, or why something is not. */
function landscapeStatus(state, text = "") {
  const el = $("landscapeStatus");
  el.hidden = state === "hidden";
  el.className = "settlement-status " + state;
  el.textContent = text;
}
/* When nothing is loading: what is loaded so far, or, before anything is, how it is loaded. */
function landscapeNote() {
  if (landscapeLoading) return;
  if (landscapeLoaded)
    landscapeStatus(
      "done",
      `The landscape map is loaded for ${landscapeLoaded} ${landscapeLoaded === 1 ? "area" : "areas"} (${(landscapeBytes / 1e6).toFixed(1)} MB).`,
    );
  // (the tag's box is restored after this file runs, so at first its saved value counts)
  else if (
    landscapeChosen() !== "any" ||
    $("tagLandscape").checked ||
    store.get("tagLandscape", false) === true
  )
    landscapeStatus(
      "done",
      "The landscape map is loaded in pieces during the search, only for the areas searched (usually a few hundred KB).",
    );
  else landscapeStatus("hidden");
}
/* The tile a place falls in ("N50E010": its south-west corner), and the square in it. */
function landscapeSquare(lat, lng) {
  const g = LANDSCAPE.grid;
  lng = ((((lng + 180) % 360) + 360) % 360) - 180;
  const south = Math.floor(lat / g.tileDegrees) * g.tileDegrees,
    west = Math.floor(lng / g.tileDegrees) * g.tileDegrees;
  const key =
    (south < 0 ? "S" : "N") +
    String(Math.abs(south)).padStart(2, "0") +
    (west < 0 ? "W" : "E") +
    String(Math.abs(west)).padStart(3, "0");
  const side = g.tileDegrees * g.cellsPerDegree;
  return {
    key,
    row: Math.min(side - 1, Math.floor((south + g.tileDegrees - lat) * g.cellsPerDegree)),
    col: Math.min(side - 1, Math.floor((lng - west) * g.cellsPerDegree)),
  };
}
/* Loads a tile once; resolves to it, or to null when it could not be loaded. */
function loadLandscapeTile(key) {
  if (landscapeTiles.has(key)) return landscapeTiles.get(key);
  const file = LANDSCAPE.files[key];
  landscapeLoading++;
  landscapeStatus("loading", "Loading the landscape map for this area…");
  const tile = (async () => {
    const res = await fetch(LANDSCAPE.base + key + "." + file[0] + ".bin", { integrity: file[1] });
    if (!res.ok) throw new Error(`the server answered ${res.status}`);
    const bytes = new Uint8Array(
      await new Response(res.body.pipeThrough(new DecompressionStream("deflate"))).arrayBuffer(),
    );
    const read = readLandscapeTile(bytes, LANDSCAPE.grid.tileDegrees * LANDSCAPE.grid.cellsPerDegree);
    landscapeLoaded++;
    landscapeBytes += file[2];
    landscapeLoading--;
    landscapeNote();
    return read;
  })().catch(e => {
    landscapeTiles.delete(key);
    landscapeLoading--;
    landscapeStatus(
      "error",
      "The landscape map for an area could not be loaded" +
        (e && e.message ? ` (${cleanText(e.message, 80)})` : "") +
        ". Check your connection, then search again.",
    );
    return null;
  });
  landscapeTiles.set(key, tile);
  return tile;
}
/* Reads an unpacked tile: for each row, stretches of one class, each an unsigned LEB128 number (length ×
   8 + class; see tools/landscape.js). Kept as the end of each stretch in its row, and its class. */
function readLandscapeTile(bytes, side) {
  const rowStart = new Uint32Array(side + 1),
    ends = [],
    classes = [];
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
    classes.push(v % 8);
    if (col === side) {
      row++;
      rowStart[row] = ends.length;
      col = 0;
    }
  }
  if (row !== side || col) throw new Error("the file is not a whole tile");
  return { rowStart, ends: Uint16Array.from(ends), classes: Uint8Array.from(classes) };
}
/* The landscape of a place: "forest", "farmland", "grassland", "bare", "built-up", "other" or "" (the sea,
   or nothing known); null when its tile could not be loaded. Loads the tile first if needed. */
async function landscapeOf(lat, lng) {
  const { key, row, col } = landscapeSquare(lat, lng);
  if (!LANDSCAPE.files[key]) return ""; // no land in this tile
  const tile = await loadLandscapeTile(key);
  if (!tile) return null;
  // the stretches of a row are in order: find the first that ends after the column
  let lo = tile.rowStart[row],
    hi = tile.rowStart[row + 1] - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (tile.ends[mid] > col) hi = mid;
    else lo = mid + 1;
  }
  return LANDSCAPE.classes[tile.classes[lo]] || "";
}
/* In words, for the map name, summaries and the history: "" for any. */
const landscapeWords = choice =>
  ({
    forest: "in a forest",
    farmland: "on farmland",
    grassland: "in grassland or shrubland",
    bare: "on bare ground or in a desert",
  })[choice] || "";
/* The tag of a location with the tag on: "Forest", "Farmland", "Grassland", "Bare ground", or none. */
const landscapeTag = l =>
  ({ forest: "Forest", farmland: "Farmland", grassland: "Grassland", bare: "Bare ground" })[l.landscape] ||
  "";
/* For the popup: what the landscape is, or "". */
const landscapeFact = l =>
  ({
    forest: "Forest",
    farmland: "Farmland",
    grassland: "Grassland or shrubland",
    bare: "Bare ground or desert",
  })[l.landscape] || "";
/* For the search (see checkPanorama): the landscape of a panorama when the setting or the tag needs it
   (undefined when neither does), and whether it is the one asked for. landscape is null when its tile
   could not be loaded. */
async function landscapeWanted(lat, lng, choice) {
  const needed = (choice && choice !== "any") || $("tagLandscape").checked;
  if (!needed) return { wanted: true };
  const landscape = await landscapeOf(lat, lng);
  return { landscape, wanted: !choice || choice === "any" || landscape === choice };
}
$("tagLandscape").addEventListener("change", landscapeNote);
landscapeNote();
