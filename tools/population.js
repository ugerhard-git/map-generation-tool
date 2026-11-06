// Imports the population of every country and territory from Natural Earth (public domain) into
// src/data/population.json, which the build puts into Unofficial's page (src/countries.js) for its
// "Population" and "Population density" distributions.
//
//   node tools/population.js <ne_10m_admin_0_map_units.dbf> [--out <file>]
//
// It reads the table of Natural Earth's 1:10m "admin 0 map units" (the .dbf file of the shapefile): one
// row per map unit, with its two-letter code (ISO_A2_EH) and its population estimate (POP_EST, mostly
// from the World Bank, for the year in POP_YEAR). Map units rather than countries, as they list France's
// overseas departments (French Guiana, Réunion, …) on their own, as country-coder does. Units with the
// same code (England, Scotland, Wales and Northern Ireland; Belgium's three regions; Gaza and the West
// Bank) are added up. A few units without a code are counted with the country country-coder puts them
// in (FOLD_INTO); the rest without a code are tiny zones and are left out, and listed.
//
// Before writing, it checks that the numbers look right (enough places, a world population between 6 and
// 12 billion, whole numbers) and stops with an error instead of writing a broken file. --out writes
// somewhere else than src/data/population.json (for the tests).
//
// Run by hand: download the file of a fixed Natural Earth commit, so the import can be repeated, as in
// the "source" written to the data file. For example:
//   curl -O https://raw.githubusercontent.com/nvkelso/natural-earth-vector/<commit>/10m_cultural/ne_10m_admin_0_map_units.dbf
//   node tools/population.js ne_10m_admin_0_map_units.dbf --commit <commit>
const fs = require("fs"),
  path = require("path");

const DATA_FILE = path.join(__dirname, "../src/data/population.json");
const REPOSITORY = "https://github.com/nvkelso/natural-earth-vector";
/* Map units without a code that belong to a country with one, as country-coder places them. */
const FOLD_INTO = { Somaliland: "SO", "N. Cyprus": "CY" };
/* Places that must be in the data: if one is missing, something is wrong and nothing is written. */
const REQUIRED = ["CN", "IN", "US", "DE", "FR", "GF", "RE", "MT"];

function fail(message) {
  console.error("tools/population.js: " + message + " Nothing was written.");
  process.exit(1);
}

/** The rows of a dBASE table (.dbf), as { field: text }. Only what Natural Earth's tables use. */
function readDbf(bytes) {
  if (bytes.length < 32) fail("the file is too short to be a .dbf table.");
  const rows = bytes.readUInt32LE(4),
    headerLength = bytes.readUInt16LE(8),
    rowLength = bytes.readUInt16LE(10);
  if (headerLength < 33 || rowLength < 1 || headerLength + rows * rowLength > bytes.length)
    fail("the file is not a .dbf table, or it ends early.");
  const fields = [];
  for (let at = 32; bytes[at] !== 0x0d; at += 32) {
    if (at + 32 > headerLength) fail("the table's list of fields does not end.");
    fields.push({
      name: bytes
        .subarray(at, at + 11)
        .toString("latin1")
        .replace(/\0.*$/s, ""),
      length: bytes[at + 16],
    });
  }
  const out = [];
  for (let r = 0; r < rows; r++) {
    const start = headerLength + r * rowLength;
    if (bytes[start] === 0x2a) continue; // a deleted row
    const row = {};
    let at = start + 1;
    for (const f of fields) {
      row[f.name] = bytes
        .subarray(at, at + f.length)
        .toString("utf8")
        .replace(/\0/g, "")
        .trim();
      at += f.length;
    }
    out.push(row);
  }
  return out;
}

function main() {
  const args = process.argv.slice(2);
  const option = name => {
    const i = args.indexOf(name);
    return i >= 0 ? args.splice(i, 2)[1] : null;
  };
  const out = option("--out") || DATA_FILE,
    commit = option("--commit") || "";
  const file = args[0];
  if (!file) fail("give the path of ne_10m_admin_0_map_units.dbf.");
  if (commit && !/^[0-9a-f]{40}$/.test(commit)) fail("--commit must be a full commit id (40 characters).");
  const rows = readDbf(fs.readFileSync(file));
  if (!rows.length || !("ISO_A2_EH" in rows[0]) || !("POP_EST" in rows[0]))
    fail("the table has no ISO_A2_EH and POP_EST columns: is it Natural Earth's admin 0 map units?");

  const population = {},
    years = [],
    leftOut = [];
  for (const r of rows) {
    const pop = Number(r.POP_EST);
    if (!Number.isFinite(pop) || pop < 0 || pop > 2e9)
      fail(`${r.NAME} has no usable population (${r.POP_EST}).`);
    const code = /^[A-Z]{2}$/.test(r.ISO_A2_EH) ? r.ISO_A2_EH : FOLD_INTO[r.NAME];
    if (!code) {
      if (pop > 0) leftOut.push(`${r.NAME} (${Math.round(pop).toLocaleString("en")})`);
      continue;
    }
    population[code] = (population[code] || 0) + Math.round(pop);
    if (/^\d{4}$/.test(r.POP_YEAR) && pop > 0) years.push(+r.POP_YEAR);
  }
  const codes = Object.keys(population).sort();
  const world = codes.reduce((n, c) => n + population[c], 0);
  if (codes.length < 200) fail(`only ${codes.length} places have a code; expected over 200.`);
  const missing = REQUIRED.filter(c => !population[c]);
  if (missing.length) fail(`no population for ${missing.join(", ")}.`);
  if (world < 6e9 || world > 12e9) fail(`the world's population adds up to ${world}, which cannot be right.`);

  const data = {
    source: {
      name: "Natural Earth, 1:10m admin 0 map units (public domain)",
      url: commit ? `${REPOSITORY}/tree/${commit}` : REPOSITORY,
      commit,
      years: [Math.min(...years), Math.max(...years)],
    },
    population: Object.fromEntries(codes.map(c => [c, population[c]])),
  };
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(data, null, 2) + "\n");
  console.log(
    `Wrote ${path.relative(process.cwd(), out)}: ${codes.length} places, ${(world / 1e9).toFixed(2)} billion people, ` +
      `estimates from ${data.source.years[0]} to ${data.source.years[1]}.` +
      (leftOut.length ? `\nLeft out, without a code: ${leftOut.join(", ")}.` : ""),
  );
}

main();
