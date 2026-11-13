// Imports where the towns and villages are, from the European Commission's Global Human Settlement Layer
// (GHS-SMOD R2023A, degree of urbanisation, CC BY 4.0), into src/data/settlements.bin and
// src/data/settlements.json, for the setting "Town or countryside" in both tools (plan step 46). The
// build publishes the .bin file next to the pages; a page loads it only when the setting or its tag is
// used (src/shared/settlements.js).
//
//   node tools/settlements.js <GHS_SMOD_E2020_GLOBE_R2023A_54009_1000_V2_0.tif> [--out <folder>]
//
// The map is a grid of 1 km squares in the World Mollweide projection (36,082 × 18,000), each with a
// class: 30 urban centre, 23 dense urban cluster, 22 semi-dense urban cluster, 21 suburban or peri-urban,
// 13 rural cluster (a village: at least 300 people per km² and 500 in all), 12 low density rural, 11
// very low density rural, 10 water, -200 no data. A square of class 13 or more is "in a town or
// village" (the owner's definition: a settlement of 500 or more people); the rest is countryside.
//
// The file written: for each row of squares from north to south, the number of stretches of town
// squares in it, then for each stretch the squares since the end of the one before (or the row's start)
// and its length, all as unsigned LEB128 numbers ("varints"); the whole compressed with zlib (deflate),
// which browsers unpack themselves (DecompressionStream). The .json file says how to read it: the
// grid's size and corners, and where the data comes from.
//
// Before writing, it checks the map (its size, projection grid and classes) and the result (enough town
// squares, Berlin a town, the Sahara countryside), and stops with an error instead of writing a broken
// file. --out writes into another folder than src/data (for the tests).
//
// Run by hand, with the file downloaded from the GHSL site (the URL is in the "source" of the .json):
// the data is from 2020 and is not updated.
const fs = require("fs"),
  path = require("path"),
  zlib = require("zlib");

const OUT = path.join(__dirname, "../src/data");
const SOURCE = {
  name: "GHS-SMOD R2023A, degree of urbanisation, epoch 2020, 1 km (European Commission, Joint Research Centre)",
  url: "https://jeodpp.jrc.ec.europa.eu/ftp/jrc-opendata/GHSL/GHS_SMOD_GLOBE_R2023A/GHS_SMOD_E2020_GLOBE_R2023A_54009_1000/V2-0/GHS_SMOD_E2020_GLOBE_R2023A_54009_1000_V2_0.zip",
  licence: "CC BY 4.0",
  citation:
    "Schiavina M., Melchiorri M., Pesaresi M. (2023): GHS-SMOD R2023A - GHS settlement layers, application of the Degree of Urbanisation methodology (stage I) to GHS-POP R2023A and GHS-BUILT-S R2023A, multitemporal (1975-2030). European Commission, Joint Research Centre (JRC).",
};
/* The grid this script expects (World Mollweide, 1 km): checked against the file. */
const GRID = { width: 36082, height: 18000, cell: 1000, x0: -18041000, y0: 9000000, radius: 6378137 };
const TOWN = 13; // classes from this up are towns and villages
const ROWS_AT_ONCE = 512;

function fail(message) {
  console.error("tools/settlements.js: " + message + " Nothing was written.");
  process.exit(1);
}

/* Unsigned LEB128, as the page reads it. */
function varint(out, n) {
  while (n > 127) {
    out.push((n & 127) | 128);
    n = Math.floor(n / 128);
  }
  out.push(n);
}

/* The square of the grid a point falls in, as the page works it out (src/shared/settlements.js). */
function squareOf(lat, lng) {
  const phi = (lat * Math.PI) / 180,
    lambda = (lng * Math.PI) / 180;
  let theta = phi;
  for (let i = 0; i < 50; i++) {
    const f = 2 * theta + Math.sin(2 * theta) - Math.PI * Math.sin(phi);
    const d = 2 + 2 * Math.cos(2 * theta);
    if (Math.abs(d) < 1e-12) break;
    const next = theta - f / d;
    if (Math.abs(next - theta) < 1e-12) break;
    theta = next;
  }
  const x = ((GRID.radius * 2 * Math.SQRT2) / Math.PI) * lambda * Math.cos(theta),
    y = GRID.radius * Math.SQRT2 * Math.sin(theta);
  return { row: Math.floor((GRID.y0 - y) / GRID.cell), col: Math.floor((x - GRID.x0) / GRID.cell) };
}

async function main() {
  const args = process.argv.slice(2);
  const i = args.indexOf("--out");
  const out = i >= 0 ? args.splice(i, 2)[1] : OUT;
  const file = args[0];
  if (!file) fail("give the path of GHS_SMOD_E2020_GLOBE_R2023A_54009_1000_V2_0.tif.");
  const { fromFile } = await import("geotiff");
  const tiff = await fromFile(file);
  const image = await tiff.getImage();
  const [x0, y0] = image.getOrigin(),
    [cellX, cellY] = image.getResolution();
  if (
    image.getWidth() !== GRID.width ||
    image.getHeight() !== GRID.height ||
    x0 !== GRID.x0 ||
    y0 !== GRID.y0 ||
    cellX !== GRID.cell ||
    cellY !== -GRID.cell
  )
    fail(
      `the map is not the 1 km World Mollweide grid expected (${image.getWidth()} × ${image.getHeight()}, from ${x0}, ${y0}, ${cellX} m).`,
    );

  const bytes = [],
    counts = new Map(),
    rows = []; // (kept for the checks: the stretches of each row)
  let squares = 0,
    stretches = 0;
  for (let top = 0; top < GRID.height; top += ROWS_AT_ONCE) {
    const bottom = Math.min(GRID.height, top + ROWS_AT_ONCE);
    const [band] = await image.readRasters({ window: [0, top, GRID.width, bottom] });
    for (let r = 0; r < bottom - top; r++) {
      const row = band.subarray(r * GRID.width, (r + 1) * GRID.width);
      const runs = [];
      let start = -1;
      for (let c = 0; c <= GRID.width; c++) {
        const v = c < GRID.width ? row[c] : -200;
        if (c < GRID.width) counts.set(v, (counts.get(v) || 0) + 1);
        const town = v >= TOWN;
        if (town && start < 0) start = c;
        else if (!town && start >= 0) {
          runs.push(start, c);
          squares += c - start;
          start = -1;
        }
      }
      rows.push(runs);
      varint(bytes, runs.length / 2);
      let end = 0;
      for (let k = 0; k < runs.length; k += 2) {
        varint(bytes, runs[k] - end);
        varint(bytes, runs[k + 1] - runs[k]);
        end = runs[k + 1];
      }
      stretches += runs.length / 2;
    }
  }

  const known = [-200, 10, 11, 12, 13, 21, 22, 23, 30];
  const odd = [...counts.keys()].filter(v => !known.includes(v));
  if (odd.length) fail(`the map has classes this script does not know: ${odd.join(", ")}.`);
  if (squares < 1e6 || squares > 2e7)
    fail(`${squares} town squares cannot be right (about 4 million expected).`);
  const isTown = (lat, lng) => {
    const { row, col } = squareOf(lat, lng);
    const runs = rows[row] || [];
    for (let k = 0; k < runs.length; k += 2) if (col >= runs[k] && col < runs[k + 1]) return true;
    return false;
  };
  const checks = [
    ["Berlin", 52.52, 13.405, true],
    ["Tokyo", 35.68, 139.76, true],
    ["São Paulo", -23.55, -46.63, true],
    ["the Sahara", 23.0, 12.0, false],
    ["the Pacific", 0, -150, false],
    ["central Australia", -25.0, 133.0, false],
  ];
  for (const [name, lat, lng, town] of checks)
    if (isTown(lat, lng) !== town) fail(`${name} should ${town ? "" : "not "}be a town.`);

  const data = zlib.deflateSync(Buffer.from(bytes), { level: 9 });
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, "settlements.bin"), data);
  fs.writeFileSync(
    path.join(out, "settlements.json"),
    JSON.stringify(
      {
        source: SOURCE,
        about:
          "Where the towns and villages are (classes 13 to 30), as stretches of 1 km squares per row of the World Mollweide grid, in settlements.bin (see tools/settlements.js). Made by tools/settlements.js; never edit by hand.",
        grid: { ...GRID, rows: GRID.height },
        townFrom: TOWN,
        squares,
        stretches,
        bytes: data.length,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    `tools/settlements.js: ${squares.toLocaleString("en")} town and village squares in ${stretches.toLocaleString("en")} stretches; ${(data.length / 1e6).toFixed(2)} MB written to ${out}.`,
  );
}
main().catch(e => fail(e.message || String(e)));
