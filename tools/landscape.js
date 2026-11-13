// Imports the landscape of the world, from ESA WorldCover 2021 (10 m, CC BY 4.0), into
// src/data/landscape/<tile>.bin and src/data/landscape.json, for the setting "Landscape" and its tag in both
// tools (plan step 47). WorldCover is 124 GB, so this runs on GitHub, not on a laptop: the workflow
// "Update the landscape map" (.github/workflows/landscape.yml) runs "read" in four jobs at once, then
// "pack" once, and opens a pull request with the result.
//
//   node tools/landscape.js read --part <i>/<n> --out <folder> [--source <url>] [--only <tile,…>]
//   node tools/landscape.js pack <folder> [--out <folder>] [--summary <file>] [--min-tiles <n>]
//
// read: WorldCover comes in tiles of 3° × 3° (named by their south-west corner, as N51E009), as Cloud
// Optimized GeoTIFFs on Amazon (--source, for the tests: another address). Part i of n tries every n-th
// of the possible tiles (the sea has none) and reads each from one of its smaller copies inside the file
// (an "overview"), so it fetches only a small part of it. For every square of 1/120° (about 1 km; 360 ×
// 360 to a tile) it counts the classes and keeps the main one of these (water does not count, so a road
// along a coast gets the land beside it):
//   1 forest (WorldCover's tree cover and mangroves)
//   2 farmland (cropland)
//   3 grassland or shrubland (grassland, shrubland)
//   4 bare ground or desert (bare or sparse vegetation)
//   5 built-up (towns are what "Town or countryside" is for, so no landscape of their own)
//   6 other (snow and ice, wetland, moss and lichen)
//   0 nothing known (all water, or no data)
// It writes <folder>/<tile>.bin (the 360 × 360 squares, one byte each, gzip) and <folder>/part-<i>.json
// (which tiles, and from which copy). If a copy holds values WorldCover does not have (made by averaging,
// say), it reads a larger one.
//
// pack: puts the squares together into tiles of 10° × 10° (1,200 × 1,200 squares; a page loads only the
// tiles where it looks), each a file of its own: for each row from north to south, stretches of the same
// class, each as one unsigned LEB128 number (length × 8 + class); the whole compressed with zlib
// (deflate). Tiles without land are left out. It writes them to src/data/landscape/ (replacing all
// there), and src/data/landscape.json: the grid, the classes, the tiles and their sizes, and where the
// data comes from. --summary writes what was found, for the pull request: the share of each class and a
// few known places (a forest in the Amazon, farmland in Iowa, the Sahara, the steppe of Mongolia), which
// someone should look at.
//
// Before writing, both check what they read (the tiles' size and place, the classes, enough tiles) and
// stop with an error instead of writing a broken result.
const fs = require("fs"),
  path = require("path"),
  zlib = require("zlib");

const SOURCE = {
  name: "ESA WorldCover 10 m 2021 v200 (European Space Agency)",
  url: "https://esa-worldcover.org/",
  data: "https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/",
  licence: "CC BY 4.0",
  citation:
    "Zanaga, D., Van De Kerchove, R., Daems, D., De Keersmaecker, W., Brockmann, C., Kirches, G., Wevers, J., Cartus, O., Santoro, M., Fritz, S., Lesiv, M., Herold, M., Tsendbazar, N.E., Xu, P., Ramoino, F., Arino, O. (2022). ESA WorldCover 10 m 2021 v200. https://doi.org/10.5281/zenodo.7254221",
};
const OUT = path.join(__dirname, "../src/data");
const CELLS = 120; // squares per degree
const SOURCE_TILE = 3; // degrees, WorldCover
const TILE = 10; // degrees, written
const SOUTH = -60, // WorldCover covers 60° S to 84° N
  NORTH = 84;
const CLASSES = ["", "forest", "farmland", "grassland", "bare", "built-up", "other"];
/* WorldCover's classes, as ours: 0 to 6; IGNORE for water and no data; anything else is not WorldCover. */
const IGNORE = 254,
  ODD = 255;
const OURS = new Uint8Array(256).fill(ODD);
for (const [theirs, ours] of [
  [0, IGNORE], // no data
  [80, IGNORE], // permanent water
  [10, 1], // tree cover
  [95, 1], // mangroves
  [40, 2], // cropland
  [20, 3], // shrubland
  [30, 3], // grassland
  [60, 4], // bare or sparse vegetation
  [50, 5], // built-up
  [70, 6], // snow and ice
  [90, 6], // herbaceous wetland
  [100, 6], // moss and lichen
])
  OURS[theirs] = ours;
/* At least this many pixels across a square when choosing the copy to read (so 16 or more to count). */
const PIXELS_PER_SQUARE = 4;

function fail(message) {
  console.error("tools/landscape.js: " + message + " Nothing was written.");
  process.exit(1);
}
function option(args, name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 ? args.splice(i, 2)[1] : fallback;
}

/* "N51E009" for the tile whose south-west corner is 51° N, 9° E; "S10W080" for 10° S, 80° W. */
function tileName(lat, lng) {
  const ns = lat < 0 ? "S" : "N",
    ew = lng < 0 ? "W" : "E";
  return ns + String(Math.abs(lat)).padStart(2, "0") + ew + String(Math.abs(lng)).padStart(3, "0");
}
function tileCorner(name) {
  const m = /^([NS])(\d\d)([EW])(\d\d\d)$/.exec(name);
  if (!m) return null;
  return { lat: (m[1] === "S" ? -1 : 1) * +m[2], lng: (m[3] === "W" ? -1 : 1) * +m[4] };
}
/* Every WorldCover tile there could be, in order. */
function allSourceTiles() {
  const names = [];
  for (let lat = SOUTH; lat < NORTH; lat += SOURCE_TILE)
    for (let lng = -180; lng < 180; lng += SOURCE_TILE) names.push(tileName(lat, lng));
  return names;
}
const sourceUrl = (source, name) =>
  source.replace(/\/?$/, "/") + `ESA_WorldCover_10m_2021_v200_${name}_Map.tif`;

/* Runs fn on every item, `at once` at a time. */
async function each(items, atOnce, fn) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(atOnce, items.length) }, async () => {
      while (next < items.length) await fn(items[next++]);
    }),
  );
}
/* Whether a tile exists: a missing one is 404 (or 403, as Amazon answers when it may not list). */
async function exists(url) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { method: "HEAD" });
      if (res.ok) return true;
      if (res.status === 404 || res.status === 403) return false;
      throw new Error(`answered ${res.status}`);
    } catch (e) {
      if (attempt >= 4) throw new Error(`${url}: ${e.message}`, { cause: e });
      await new Promise(r => setTimeout(r, 2000 * attempt));
    }
  }
}

/* Reads one WorldCover tile: the main class of each of its 360 × 360 squares. */
async function readTile(fromUrl, url, name) {
  const corner = tileCorner(name);
  const tiff = await fromUrl(url);
  const count = await tiff.getImageCount();
  const base = await tiff.getImage(0);
  const [west, south, east, north] = base.getBoundingBox();
  const near = (a, b) => Math.abs(a - b) < 1e-6;
  if (
    !near(west, corner.lng) ||
    !near(south, corner.lat) ||
    !near(east, corner.lng + SOURCE_TILE) ||
    !near(north, corner.lat + SOURCE_TILE)
  )
    throw new Error(`${name} covers ${west}, ${south} to ${east}, ${north}, not its 3° tile.`);
  // The copies, largest first; try the smallest with enough pixels, then larger ones if needed
  const images = [];
  for (let i = 0; i < count; i++) images.push(await tiff.getImage(i));
  images.sort((a, b) => b.getWidth() - a.getWidth());
  const side = SOURCE_TILE * CELLS;
  const usable = images.filter(im => im.getWidth() >= side * PIXELS_PER_SQUARE);
  if (!usable.length) throw new Error(`${name} has only ${base.getWidth()} pixels across.`);
  for (let k = usable.length - 1; k >= 0; k--) {
    const im = usable[k];
    const result = await countSquares(im, side);
    if (result.odd / result.pixels <= 0.001) return { ...result, width: im.getWidth() };
    if (k === 0)
      throw new Error(`${name} holds values WorldCover does not have (${result.odd} of ${result.pixels}).`);
  }
}
async function countSquares(image, side) {
  const W = image.getWidth(),
    H = image.getHeight();
  const counts = new Uint16Array(side * side * 7);
  let odd = 0,
    pixels = 0;
  // pixel column → square column, by the pixel's centre
  const colOf = new Uint16Array(W);
  for (let x = 0; x < W; x++) colOf[x] = Math.floor(((x + 0.5) * side) / W);
  // in bands of rows, so a large copy never has to fit in memory at once
  const band = Math.max(1, Math.floor(4e7 / W));
  for (let top = 0; top < H; top += band) {
    const bottom = Math.min(H, top + band);
    const [data] = await image.readRasters({ window: [0, top, W, bottom], samples: [0] });
    for (let y = top; y < bottom; y++) {
      const row = Math.floor(((y + 0.5) * side) / H) * side;
      const offset = (y - top) * W;
      for (let x = 0; x < W; x++) {
        const c = OURS[data[offset + x]];
        pixels++;
        if (c === IGNORE) continue;
        if (c === ODD) {
          odd++;
          continue;
        }
        const i = (row + colOf[x]) * 7 + c;
        if (counts[i] < 65535) counts[i]++;
      }
    }
  }
  const squares = new Uint8Array(side * side);
  for (let s = 0; s < side * side; s++) {
    let best = 0,
      most = 0;
    for (let c = 1; c <= 6; c++)
      if (counts[s * 7 + c] > most) {
        most = counts[s * 7 + c];
        best = c;
      }
    squares[s] = best;
  }
  return { squares, odd, pixels };
}

async function read(args) {
  const part = option(args, "--part", "0/1"),
    out = option(args, "--out", null),
    source = option(args, "--source", SOURCE.data),
    only = option(args, "--only", null);
  const m = /^(\d+)\/(\d+)$/.exec(part);
  if (!m || +m[1] >= +m[2]) fail(`--part should be like 0/8, not ${part}.`);
  if (!out) fail("give --out <folder>.");
  const [i, n] = [+m[1], +m[2]];
  const names = (only ? only.split(",") : allSourceTiles()).filter((_, k) => k % n === i);
  if (names.some(t => !tileCorner(t))) fail(`not a tile name: ${names.find(t => !tileCorner(t))}.`);
  const { fromUrl } = await import("geotiff");
  fs.mkdirSync(out, { recursive: true });
  const found = [];
  await each(names, 16, async name => {
    if (await exists(sourceUrl(source, name))) found.push(name);
  });
  found.sort();
  console.log(`tools/landscape.js: part ${i}/${n}: ${found.length} of ${names.length} tiles exist.`);
  const done = [];
  const started = Date.now();
  await each(found, 3, async name => {
    const t = Date.now();
    let r;
    for (let attempt = 1; ; attempt++) {
      try {
        r = await readTile(fromUrl, sourceUrl(source, name), name);
        break;
      } catch (e) {
        // a wrong tile stops at once; a network error is tried again
        if (/covers|values|pixels across/.test(e.message) || attempt >= 4) fail(e.message);
        console.log(`  ${name}: ${e.message}; trying again`);
        await new Promise(res => setTimeout(res, 5000 * attempt));
      }
    }
    fs.writeFileSync(path.join(out, name + ".bin"), zlib.gzipSync(r.squares));
    done.push({ name, width: r.width, seconds: Math.round((Date.now() - t) / 100) / 10 });
    console.log(
      `  ${name}: read at ${r.width} pixels across in ${((Date.now() - t) / 1000).toFixed(1)} s (${done.length} of ${found.length})`,
    );
  });
  done.sort((a, b) => (a.name < b.name ? -1 : 1));
  fs.writeFileSync(
    path.join(out, `part-${i}.json`),
    JSON.stringify({ part: i, of: n, tried: names.length, tiles: done }, null, 1) + "\n",
  );
  console.log(
    `tools/landscape.js: part ${i}/${n} done, ${done.length} tiles in ${Math.round((Date.now() - started) / 60000)} min.`,
  );
}

/* Unsigned LEB128, as the page reads it. */
function varint(out, v) {
  while (v > 127) {
    out.push((v & 127) | 128);
    v = Math.floor(v / 128);
  }
  out.push(v);
}
/* A written tile's squares as stretches, compressed (see the top). */
function encodeTile(squares, side) {
  const bytes = [];
  for (let r = 0; r < side; r++) {
    let start = 0;
    for (let c = 1; c <= side; c++)
      if (c === side || squares[r * side + c] !== squares[r * side + start]) {
        varint(bytes, (c - start) * 8 + squares[r * side + start]);
        start = c;
      }
  }
  return zlib.deflateSync(Buffer.from(bytes), { level: 9 });
}
/* Reads a written tile back (as the page does), for the check below. */
function decodeTile(data, side) {
  const bytes = zlib.inflateSync(data);
  const squares = new Uint8Array(side * side);
  let at = 0,
    s = 0;
  while (at < bytes.length) {
    let v = 0,
      shift = 1,
      b;
    do {
      b = bytes[at++];
      v += (b & 127) * shift;
      shift *= 128;
    } while (b & 128);
    squares.fill(v % 8, s, s + Math.floor(v / 8));
    s += Math.floor(v / 8);
  }
  if (s !== side * side) throw new Error("a tile does not read back to its size");
  return squares;
}

function pack(args) {
  const out = option(args, "--out", OUT),
    summary = option(args, "--summary", null),
    minTiles = +option(args, "--min-tiles", 2000);
  const folder = args[0];
  if (!folder || !fs.existsSync(folder)) fail("give the folder that read wrote to.");
  // What the parts read
  const parts = fs.readdirSync(folder).filter(f => /^part-\d+\.json$/.test(f));
  const read = parts.flatMap(f => JSON.parse(fs.readFileSync(path.join(folder, f), "utf8")).tiles);
  const n = parts.length && JSON.parse(fs.readFileSync(path.join(folder, parts[0]), "utf8")).of;
  if (!parts.length || parts.length !== n) fail(`found ${parts.length} parts, expected ${n || "some"}.`);
  if (read.length < minTiles) fail(`only ${read.length} WorldCover tiles were read (about 2,650 expected).`);
  const side = SOURCE_TILE * CELLS;
  const source = new Map();
  for (const t of read) {
    const file = path.join(folder, t.name + ".bin");
    if (!fs.existsSync(file)) fail(`${t.name}.bin is missing.`);
    source.set(t.name, file);
  }
  const squaresOf = name => {
    const s = zlib.gunzipSync(fs.readFileSync(source.get(name)));
    if (s.length !== side * side || s.some(v => v > 6)) fail(`${name}.bin is not a tile of squares.`);
    return s;
  };

  // The written tiles
  const big = TILE * CELLS;
  const tiles = {};
  const written = [];
  const counts = new Array(7).fill(0);
  for (let lat = Math.floor(SOUTH / TILE) * TILE; lat < NORTH; lat += TILE)
    for (let lng = -180; lng < 180; lng += TILE) {
      const squares = new Uint8Array(big * big);
      let any = false;
      // the WorldCover tiles inside it (3° tiles overlap the 10° ones)
      for (let la = lat - (lat % SOURCE_TILE) - SOURCE_TILE; la < lat + TILE; la += SOURCE_TILE)
        for (let lo = lng - (((lng % 3) + 3) % 3); lo < lng + TILE; lo += SOURCE_TILE) {
          const name = tileName(la, lo);
          if (!source.has(name)) continue;
          const s = squaresOf(name);
          // copy the overlap: rows from the north edge down
          for (let r = 0; r < side; r++) {
            const R = Math.round((lat + TILE - (la + SOURCE_TILE)) * CELLS) + r;
            if (R < 0 || R >= big) continue;
            for (let c = 0; c < side; c++) {
              const C = Math.round((lo - lng) * CELLS) + c;
              if (C < 0 || C >= big) continue;
              squares[R * big + C] = s[r * side + c];
              if (s[r * side + c]) any = true;
            }
          }
        }
      if (!any) continue;
      for (const v of squares) counts[v]++;
      const key = tileName(lat, lng);
      const data = encodeTile(squares, big);
      const back = decodeTile(data, big);
      if (back.some((v, k) => v !== squares[k])) fail(`${key} does not read back as written.`);
      tiles[key] = data.length;
      written.push([key, data]);
    }

  // Known places, for the summary
  const tileOf = new Map(written);
  const at = (lat, lng) => {
    const key = tileName(Math.floor(lat / TILE) * TILE, Math.floor(lng / TILE) * TILE);
    if (!tileOf.has(key)) return 0;
    const s = decodeTile(tileOf.get(key), big);
    const R = Math.floor((Math.floor(lat / TILE) * TILE + TILE - lat) * CELLS),
      C = Math.floor((lng - Math.floor(lng / TILE) * TILE) * CELLS);
    return s[R * big + C];
  };
  const places = [
    ["the Amazon rainforest", -5.0, -65.0, "forest"],
    ["farmland in Iowa", 42.3, -94.5, "farmland"],
    ["the Sahara", 23.0, 12.0, "bare"],
    ["the steppe of Mongolia", 46.5, 105.0, "grassland"],
  ].map(([name, lat, lng, want]) => ({ name, lat, lng, want, got: CLASSES[at(lat, lng)] || "nothing" }));

  // Write
  const dir = path.join(out, "landscape");
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  for (const [key, data] of written) fs.writeFileSync(path.join(dir, key + ".bin"), data);
  const land = counts.slice(1).reduce((a, b) => a + b, 0);
  const shares = Object.fromEntries(
    CLASSES.slice(1).map((c, k) => [c, Math.round((counts[k + 1] / land) * 1000) / 10]),
  );
  const bytes = written.reduce((a, [, d]) => a + d.length, 0);
  fs.writeFileSync(
    path.join(out, "landscape.json"),
    JSON.stringify(
      {
        source: SOURCE,
        about:
          "The main landscape of every square of 1/120° (about 1 km), in tiles of 10° × 10° (landscape/<tile>.bin, named by their south-west corner). Made by tools/landscape.js; never edit by hand.",
        grid: { cellsPerDegree: CELLS, tileDegrees: TILE },
        classes: CLASSES,
        sourceTiles: read.length,
        shares,
        bytes,
        tiles,
      },
      null,
      2,
    ) + "\n",
  );
  const mb = (bytes / 1e6).toFixed(1);
  console.log(
    `tools/landscape.js: ${written.length} tiles from ${read.length} WorldCover tiles, ${mb} MB, written to ${out}.`,
  );
  if (summary) {
    const sizes = Object.values(tiles).sort((a, b) => a - b);
    const lines = [
      `- ${read.length.toLocaleString("en")} WorldCover tiles read, ${written.length} tiles of 10° written, ${mb} MB in all (largest ${(sizes.at(-1) / 1e6).toFixed(2)} MB, median ${(sizes[Math.floor(sizes.length / 2)] / 1e3).toFixed(0)} KB).`,
      `- Land squares: ${CLASSES.slice(1)
        .map(c => `${c} ${shares[c]}%`)
        .join(", ")}.`,
      `- Copies read: ${[...new Set(read.map(t => t.width))].join(", ")} pixels across a 3° tile.`,
      "- Known places (please look at any that differ):",
      ...places.map(
        p => `  - ${p.name} (${p.lat}, ${p.lng}): ${p.got}${p.got === p.want ? "" : ` (expected ${p.want})`}`,
      ),
    ];
    fs.writeFileSync(summary, lines.join("\n") + "\n");
  }
}

const [command, ...args] = process.argv.slice(2);
if (command === "read") read(args).catch(e => fail(e.message || String(e)));
else if (command === "pack") pack(args);
else fail('use "read" or "pack" (see the top of tools/landscape.js).');
