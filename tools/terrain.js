// Imports how hilly the world is, from the Copernicus DEM GLO-90 (90 m elevation), into
// src/data/terrain/<tile>.bin and src/data/terrain.json, for a setting "Terrain" (flat, hilly or
// mountainous) and its tag in both tools (plan step 48). The DEM is about 26,000 files on Amazon, so this
// runs on GitHub, as tools/landscape.js does: the workflow "Update the terrain map"
// (.github/workflows/terrain.yml) runs "read" in eight jobs at once, then "pack" once, and opens a pull
// request with the result.
//
//   node tools/terrain.js read --part <i>/<n> --out <folder> [--source <url>] [--only <tile,…>]
//   node tools/terrain.js pack <folder> [--out <folder>] [--summary <file>] [--min-tiles <n>]
//
// What it measures, for every square of 1/120° (about 1 km, as the landscape map): the relief, the height
// of the highest point minus that of the lowest within about RADIUS_KM of the square (agreed with the
// owner: what you see, so a road on the floor of an Alpine valley is in the mountains). The sea counts as
// 0 m, so a road on a cliff above it counts too. The relief is kept in bands, not as flat, hilly and
// mountainous, so where those lie can still be changed in the pages without making the map again:
//   1 under 15 m, 2 15–30 m, 3 30–50 m, 4 50–100 m, 5 100–200 m, 6 200–300 m, 7 300 m or more
//   0 the sea (no DEM tile there)
// The DEM is of the surface, trees and buildings included, which can add 20–30 m to the relief at the
// edge of a forest or a town; so the smallest bands are kept apart, for choosing where flat ends.
//
// read: the DEM comes in tiles of 1° (named in tileList.txt next to them, as
// Copernicus_DSM_COG_30_N50_00_E010_00_DEM), Cloud Optimized GeoTIFFs with smaller copies inside
// (overviews). Part i of n reads every n-th tile from the smallest copy with pixels of at most 6″ (about
// 180 m) north to south, so only a part of each file is fetched, and keeps the lowest and highest height
// of each square: <folder>/<tile>.bin (120 × 120 lowest heights, then 120 × 120 highest, in whole metres,
// 16-bit, gzip; a square without data has 32767, −32768) and <folder>/part-<i>.json.
//
// pack: works out the relief of each square from those of the squares around it, and writes tiles of 10°
// × 10° (1,200 × 1,200 squares; a page loads only the tiles where it looks) in the landscape map's format:
// for each row from north to south, stretches of the same band, each one unsigned LEB128 number (length ×
// 8 + band), compressed with zlib (deflate). Tiles without land are left out. It writes them to
// src/data/terrain/ (replacing all there) and src/data/terrain.json: the grid, the bands, the tiles and
// their sizes, and where the data comes from. --summary writes the share of each band and a few known
// places, for the pull request.
//
// Before writing, both check what they read (the tiles' place, the heights, enough tiles) and stop with
// an error instead of writing a broken result.
const fs = require("fs"),
  path = require("path"),
  zlib = require("zlib");

const SOURCE = {
  name: "Copernicus DEM GLO-90 (European Space Agency, Copernicus programme)",
  url: "https://registry.opendata.aws/copernicus-dem/",
  data: "https://copernicus-dem-90m.s3.amazonaws.com/",
  licence: "Copernicus DEM licence: free of charge, with attribution",
  citation:
    "© DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved.",
};
const OUT = path.join(__dirname, "../src/data");
const CELLS = 120; // squares per degree
const TILE = 10; // degrees, written
const RADIUS_KM = 1.5; // around a square, for its relief
const KM_PER_DEGREE = 111.2;
/* The bands: the lowest relief (m) of each, from band 1. */
const BANDS = [0, 15, 30, 50, 100, 200, 300];
const NONE_LOW = 32767,
  NONE_HIGH = -32768;
/* Pixels of the copy read: at most this many degrees north to south (6″). */
const MAX_PIXEL = 1 / 600;

function fail(message) {
  console.error("tools/terrain.js: " + message + " Nothing was written.");
  process.exit(1);
}
function option(args, name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 ? args.splice(i, 2)[1] : fallback;
}
/* "N50E010" for 50° N, 10° E; "S10W080" for 10° S, 80° W. */
function tileName(lat, lng) {
  return (
    (lat < 0 ? "S" : "N") +
    String(Math.abs(lat)).padStart(2, "0") +
    (lng < 0 ? "W" : "E") +
    String(Math.abs(lng)).padStart(3, "0")
  );
}
function tileCorner(name) {
  const m = /^([NS])(\d\d)([EW])(\d\d\d)$/.exec(name);
  return m && { lat: (m[1] === "S" ? -1 : 1) * +m[2], lng: (m[3] === "W" ? -1 : 1) * +m[4] };
}
/* The DEM's name of a tile, and back: Copernicus_DSM_COG_30_N50_00_E010_00_DEM ↔ N50E010. */
const demName = key => {
  const m = /^([NS]\d\d)([EW]\d\d\d)$/.exec(key);
  return `Copernicus_DSM_COG_30_${m[1]}_00_${m[2]}_00_DEM`;
};
const demKey = name => {
  const m = /^Copernicus_DSM_COG_30_([NS]\d\d)_00_([EW]\d\d\d)_00_DEM$/.exec(name);
  return m && m[1] + m[2];
};
const sourceUrl = (source, key) => source.replace(/\/?$/, "/") + `${demName(key)}/${demName(key)}.tif`;

async function each(items, atOnce, fn) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(atOnce, items.length) }, async () => {
      while (next < items.length) await fn(items[next++]);
    }),
  );
}

/* Reads one DEM tile: the lowest and highest height of each of its 120 × 120 squares. */
async function readTile(open, url, key) {
  const corner = tileCorner(key);
  const tiff = await open(url);
  const base = await tiff.getImage(0);
  const [x0, y0] = base.getOrigin(),
    [rx, ry] = base.getResolution();
  const W0 = base.getWidth(),
    H0 = base.getHeight();
  // its place: about 1° from its corner (the DEM gives pixel centres, so allow a pixel)
  const near = (a, b) => Math.abs(a - b) < 0.01;
  if (!near(x0, corner.lng) || !near(y0, corner.lat + 1) || !near(y0 + H0 * ry, corner.lat))
    throw new Error(`${key} is at ${x0}, ${y0} to ${x0 + W0 * rx}, ${y0 + H0 * ry}, not its 1° tile.`);
  const images = [];
  for (let i = 0, n = await tiff.getImageCount(); i < n; i++) images.push(await tiff.getImage(i));
  // the smallest copy whose pixels are small enough north to south
  const fine = images.filter(im => Math.abs((ry * H0) / im.getHeight()) <= MAX_PIXEL + 1e-12);
  if (!fine.length) throw new Error(`${key} has pixels of ${Math.abs(ry) * 3600}″, too coarse.`);
  const im = fine.reduce((a, b) => (b.getHeight() < a.getHeight() ? b : a));
  const W = im.getWidth(),
    H = im.getHeight();
  const px = (rx * W0) / W,
    py = (ry * H0) / H;
  const [data] = await im.readRasters({ samples: [0] });
  const low = new Int16Array(CELLS * CELLS).fill(NONE_LOW),
    high = new Int16Array(CELLS * CELLS).fill(NONE_HIGH);
  let odd = 0;
  for (let y = 0; y < H; y++) {
    const r = Math.floor((corner.lat + 1 - (y0 + (y + 0.5) * py)) * CELLS);
    if (r < 0 || r >= CELLS) continue;
    for (let x = 0; x < W; x++) {
      const c = Math.floor((x0 + (x + 0.5) * px - corner.lng) * CELLS);
      if (c < 0 || c >= CELLS) continue;
      const v = data[y * W + x];
      if (!(v > -500 && v < 9000)) {
        odd++;
        continue;
      }
      const s = r * CELLS + c;
      if (Math.floor(v) < low[s]) low[s] = Math.floor(v);
      if (Math.ceil(v) > high[s]) high[s] = Math.ceil(v);
    }
  }
  if (odd > W * H * 0.01) throw new Error(`${key} has ${odd} heights that cannot be right.`);
  return { low, high, height: H };
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
  // The tiles there are: the DEM's own list
  const res = await fetch(source.replace(/\/?$/, "/") + "tileList.txt");
  if (!res.ok) fail(`the list of tiles could not be read (${res.status}).`);
  let keys = (await res.text())
    .split(/\s+/)
    .filter(Boolean)
    .map(name => demKey(name.replace(/\/$/, "")));
  if (keys.includes(null)) fail("the list of tiles has names this script does not know.");
  if (only) keys = keys.filter(k => only.split(",").includes(k));
  keys = keys.sort().filter((_, k) => k % n === i);
  const { fromUrl, fromArrayBuffer } = await import("geotiff");
  // A tile is read first in parts (only the copy needed); if that fails, as geotiff 2.1.3 can when a part
  // ends exactly at the end of one of its blocks ("Cannot read properties of undefined (reading
  // 'offset')"), the whole file is fetched and read from memory instead.
  const wholeFile = async url => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`the server answered ${res.status}`);
    return fromArrayBuffer(await res.arrayBuffer());
  };
  fs.mkdirSync(out, { recursive: true });
  const done = [];
  const started = Date.now();
  await each(keys, 6, async key => {
    let r, whole;
    for (let attempt = 1; ; attempt++) {
      whole = attempt > 1;
      try {
        r = await readTile(attempt === 1 ? fromUrl : wholeFile, sourceUrl(source, key), key);
        break;
      } catch (e) {
        // a wrong tile stops at once; a network error is tried again
        if (/not its 1° tile|too coarse|cannot be right/.test(e.message) || attempt >= 4) fail(e.message);
        console.log(`  ${key}: ${e.message}; trying again, with the whole file`);
        if (attempt > 1) await new Promise(resolve => setTimeout(resolve, 5000 * attempt));
      }
    }
    const both = new Int16Array(2 * CELLS * CELLS);
    both.set(r.low);
    both.set(r.high, CELLS * CELLS);
    fs.writeFileSync(path.join(out, key + ".bin"), zlib.gzipSync(Buffer.from(both.buffer)));
    done.push({ key, height: r.height, ...(whole ? { whole } : {}) });
    if (done.length % 500 === 0) console.log(`  ${done.length} of ${keys.length}`);
  });
  done.sort((a, b) => (a.key < b.key ? -1 : 1));
  fs.writeFileSync(
    path.join(out, `part-${i}.json`),
    JSON.stringify({ part: i, of: n, tiles: done }, null, 1) + "\n",
  );
  console.log(
    `tools/terrain.js: part ${i}/${n}: ${done.length} tiles in ${Math.round((Date.now() - started) / 60000)} min.`,
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
function encodeTile(bands, side) {
  const bytes = [];
  for (let r = 0; r < side; r++) {
    let start = 0;
    for (let c = 1; c <= side; c++)
      if (c === side || bands[r * side + c] !== bands[r * side + start]) {
        varint(bytes, (c - start) * 8 + bands[r * side + start]);
        start = c;
      }
  }
  return zlib.deflateSync(Buffer.from(bytes), { level: 9 });
}
function decodeTile(data, side) {
  const bytes = zlib.inflateSync(data);
  const bands = new Uint8Array(side * side);
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
    bands.fill(v % 8, s, s + Math.floor(v / 8));
    s += Math.floor(v / 8);
  }
  if (s !== side * side) throw new Error("a tile does not read back to its size");
  return bands;
}
const bandOf = relief => {
  let b = 1;
  while (b < BANDS.length && relief >= BANDS[b]) b++;
  return b;
};

function pack(args) {
  const out = option(args, "--out", OUT),
    summary = option(args, "--summary", null),
    minTiles = +option(args, "--min-tiles", 20000);
  const folder = args[0];
  if (!folder || !fs.existsSync(folder)) fail("give the folder that read wrote to.");
  const parts = fs.readdirSync(folder).filter(f => /^part-\d+\.json$/.test(f));
  const read = parts.flatMap(f => JSON.parse(fs.readFileSync(path.join(folder, f), "utf8")).tiles);
  const n = parts.length && JSON.parse(fs.readFileSync(path.join(folder, parts[0]), "utf8")).of;
  if (!parts.length || parts.length !== n) fail(`found ${parts.length} parts, expected ${n || "some"}.`);
  if (read.length < minTiles) fail(`only ${read.length} DEM tiles were read (about 26,000 expected).`);
  const have = new Set(read.map(t => t.key));
  for (const k of have) if (!fs.existsSync(path.join(folder, k + ".bin"))) fail(`${k}.bin is missing.`);
  const cache = new Map();
  /* A DEM tile's lowest and highest heights, or null for the sea. */
  const heights = (lat, lng) => {
    const key = tileName(lat, lng);
    if (!have.has(key)) return null;
    if (!cache.has(key)) {
      const buf = zlib.gunzipSync(fs.readFileSync(path.join(folder, key + ".bin")));
      if (buf.length !== 4 * CELLS * CELLS) fail(`${key}.bin is not a tile of heights.`);
      const both = new Int16Array(buf.buffer, buf.byteOffset, 2 * CELLS * CELLS);
      cache.set(key, { low: both.subarray(0, CELLS * CELLS), high: both.subarray(CELLS * CELLS) });
      if (cache.size > 400) cache.delete(cache.keys().next().value);
    }
    return cache.get(key);
  };

  const big = TILE * CELLS;
  const rowsAround = Math.round(RADIUS_KM / (KM_PER_DEGREE / CELLS));
  const tiles = {};
  const written = [];
  const counts = new Array(BANDS.length + 1).fill(0);
  for (let lat = -90; lat < 90; lat += TILE)
    for (let lng = -180; lng < 180; lng += TILE) {
      // any land in it?
      let any = false;
      for (let la = lat; la < lat + TILE && !any; la++)
        for (let lo = lng; lo < lng + TILE && !any; lo++) if (have.has(tileName(la, lo))) any = true;
      if (!any) continue;
      // squares around it too, as far as the widest row needs (towards the poles a degree is narrower)
      const widest = Math.max(Math.abs(lat), Math.abs(lat + TILE)) - 0.5 / CELLS;
      const colsAround = Math.min(
        6 * CELLS,
        Math.round(
          RADIUS_KM / ((KM_PER_DEGREE / CELLS) * Math.cos((Math.min(widest, 89.9) * Math.PI) / 180)),
        ),
      );
      const H = big + 2 * rowsAround,
        W = big + 2 * colsAround;
      const low = new Int16Array(H * W),
        high = new Int16Array(H * W),
        land = new Uint8Array(H * W);
      // fill: heights from the DEM, the sea 0 m; rows from the north edge (+ rowsAround) down
      const firstLat = lat - Math.ceil(rowsAround / CELLS),
        lastLat = lat + TILE + Math.ceil(rowsAround / CELLS);
      const firstLng = lng - Math.ceil(colsAround / CELLS),
        lastLng = lng + TILE + Math.ceil(colsAround / CELLS);
      for (let la = firstLat; la < lastLat; la++)
        for (let lo = firstLng; lo < lastLng; lo++) {
          const loW = ((((lo + 180) % 360) + 360) % 360) - 180; // across 180°
          const h = la >= -90 && la < 90 ? heights(la, loW) : null;
          if (!h) continue;
          for (let r = 0; r < CELLS; r++) {
            const R = Math.round((lat + TILE - (la + 1)) * CELLS) + r + rowsAround;
            if (R < 0 || R >= H) continue;
            for (let c = 0; c < CELLS; c++) {
              const C = Math.round((lo - lng) * CELLS) + c + colsAround;
              if (C < 0 || C >= W) continue;
              const s = r * CELLS + c;
              if (h.low[s] === NONE_LOW) continue;
              low[R * W + C] = h.low[s];
              high[R * W + C] = h.high[s];
              land[R * W + C] = 1;
            }
          }
        }
      // the highest and lowest around each square: first along the rows (as wide as the row's
      // latitude needs), then up and down
      const rowHigh = new Int16Array(H * W),
        rowLow = new Int16Array(H * W);
      for (let R = 0; R < H; R++) {
        const rowLat = lat + TILE - (R - rowsAround + 0.5) / CELLS;
        const k = Math.min(
          colsAround,
          Math.max(
            1,
            Math.round(
              RADIUS_KM /
                ((KM_PER_DEGREE / CELLS) * Math.cos((Math.min(Math.abs(rowLat), 89.9) * Math.PI) / 180)),
            ),
          ),
        );
        slidingWindow(high, R * W, W, k, colsAround, big, rowHigh, (a, b) => a >= b);
        slidingWindow(low, R * W, W, k, colsAround, big, rowLow, (a, b) => a <= b);
      }
      const bands = new Uint8Array(big * big);
      for (let r = 0; r < big; r++)
        for (let c = 0; c < big; c++) {
          const R = r + rowsAround,
            C = c + colsAround;
          if (!land[R * W + C]) continue; // the sea: band 0
          let hi = -32768,
            lo = 32767;
          for (let d = -rowsAround; d <= rowsAround; d++) {
            const s = (R + d) * W + C;
            if (rowHigh[s] > hi) hi = rowHigh[s];
            if (rowLow[s] < lo) lo = rowLow[s];
          }
          bands[r * big + c] = bandOf(hi - lo);
        }
      for (const v of bands) counts[v]++;
      const key = tileName(lat, lng);
      const data = encodeTile(bands, big);
      const back = decodeTile(data, big);
      if (back.some((v, k) => v !== bands[k])) fail(`${key} does not read back as written.`);
      tiles[key] = data.length;
      written.push([key, data]);
    }

  // Known places, for the summary
  const tileOf = new Map(written);
  const words = b => (b === 0 ? "the sea" : bandWords(b));
  const at = (lat, lng) => {
    const south = Math.floor(lat / TILE) * TILE,
      west = Math.floor(lng / TILE) * TILE;
    const data = tileOf.get(tileName(south, west));
    if (!data) return 0;
    const s = decodeTile(data, big);
    return s[Math.floor((south + TILE - lat) * CELLS) * big + Math.floor((lng - west) * CELLS)];
  };
  const places = [
    ["the polder near Amsterdam", 52.3, 5.0, "under 50 m"],
    ["farmland in Iowa", 42.3, -94.5, "under 50 m"],
    ["the steppe of Kazakhstan", 50.5, 70.0, "under 50 m"],
    ["the hills of Tuscany", 43.4, 11.3, "50–300 m"],
    ["the valley floor at Zermatt", 46.02, 7.75, "300 m or more"],
    ["the Himalaya near Namche Bazaar", 27.8, 86.71, "300 m or more"],
  ].map(([name, lat, lng, want]) => ({ name, lat, lng, want, got: words(at(lat, lng)) }));

  // Write
  const dir = path.join(out, "terrain");
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  for (const [key, data] of written) fs.writeFileSync(path.join(dir, key + ".bin"), data);
  const land = counts.slice(1).reduce((a, b) => a + b, 0);
  const bands = BANDS.map((from, k) => ({ from, to: BANDS[k + 1] ?? null }));
  const shares = Object.fromEntries(
    bands.map((b, k) => [bandWords(k + 1), Math.round((counts[k + 1] / land) * 1000) / 10]),
  );
  const bytes = written.reduce((a, [, d]) => a + d.length, 0);
  fs.writeFileSync(
    path.join(out, "terrain.json"),
    JSON.stringify(
      {
        source: SOURCE,
        about:
          "The relief around every square of 1/120° (about 1 km): the highest point minus the lowest within about radiusKm, in bands (band 1 is bands[0], …; 0 is the sea), in tiles of 10° × 10° (terrain/<tile>.bin, named by their south-west corner). Made by tools/terrain.js; never edit by hand.",
        grid: { cellsPerDegree: CELLS, tileDegrees: TILE },
        radiusKm: RADIUS_KM,
        bands,
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
    `tools/terrain.js: ${written.length} tiles from ${read.length} DEM tiles, ${mb} MB, written to ${out}.`,
  );
  if (summary) {
    const sizes = Object.values(tiles).sort((a, b) => a - b);
    const values = Object.values(shares);
    const inBand = (from, to) => Math.round(values.slice(from - 1, to).reduce((a, b) => a + b, 0) * 10) / 10;
    const lines = [
      `- ${read.length.toLocaleString("en")} DEM tiles read, ${written.length} tiles of 10° written, ${mb} MB in all (largest ${(sizes.at(-1) / 1e6).toFixed(2)} MB, median ${(sizes[Math.floor(sizes.length / 2)] / 1e3).toFixed(0)} KB).`,
      `- Relief within about ${RADIUS_KM} km, share of land squares: ${Object.entries(shares)
        .map(([w, s]) => `${w} ${s}%`)
        .join(", ")}.`,
      `- So: under 50 m ${inBand(1, 3)}%, 50–300 m ${inBand(4, 6)}%, 300 m or more ${inBand(7, 7)}%.`,
      `- Copies read: ${[...new Set(read.map(t => t.height))].join(", ")} pixels north to south in a 1° tile; ${read.filter(t => t.whole).length} tiles fetched whole, after reading them in parts failed.`,
      "- Known places (please look at any that differ):",
      ...places.map(p => {
        const ok =
          p.want === "under 50 m"
            ? /^(under 15|15–30|30–50) m$/.test(p.got)
            : p.want === "50–300 m"
              ? /^(50–100|100–200|200–300) m$/.test(p.got)
              : p.got === p.want;
        return `  - ${p.name} (${p.lat}, ${p.lng}): ${p.got}${ok ? "" : ` (expected ${p.want})`}`;
      }),
    ];
    fs.writeFileSync(summary, lines.join("\n") + "\n");
  }
}
/* For the squares first … first + count - 1 of a row (starting at `start` in `values`, `width` long): the
   highest (or lowest, by `keeps`) of the values within k of each, into `out`; with a queue, so the time
   does not grow with k (near the poles k is large). */
function slidingWindow(values, start, width, k, first, count, out, keeps) {
  const queue = new Int32Array(width);
  let head = 0,
    tail = 0;
  const from = Math.max(0, first - k),
    to = Math.min(width - 1, first + count - 1 + k);
  let next = from;
  for (let C = first; C < first + count; C++) {
    // take in everything up to C + k
    for (; next <= Math.min(to, C + k); next++) {
      while (tail > head && keeps(values[start + next], values[start + queue[tail - 1]])) tail--;
      queue[tail++] = next;
    }
    // drop what is left of C - k
    while (queue[head] < C - k) head++;
    out[start + C] = values[start + queue[head]];
  }
}
/* A band in words: "under 15 m", "15–30 m", …, "300 m or more". */
function bandWords(b) {
  const from = BANDS[b - 1],
    to = BANDS[b];
  return from === 0 ? `under ${to} m` : to === undefined ? `${from} m or more` : `${from}–${to} m`;
}

const [command, ...args] = process.argv.slice(2);
if (command === "read") read(args).catch(e => fail(e.message || String(e)));
else if (command === "pack") pack(args);
else fail('use "read" or "pack" (see the top of tools/terrain.js).');
