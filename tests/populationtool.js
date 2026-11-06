// The population import (tools/population.js), run against made-up copies of Natural Earth's table of
// map units: a good import (units with the same code added up, units without a code counted with their
// country or left out), and broken input, which must stop without writing anything. Needs no browser and
// no network.
const { spawnSync } = require("child_process");
const fs = require("fs"),
  os = require("os"),
  path = require("path");

let fail = 0;
const ok = (c, m) => {
  console.log((c ? "PASS " : "FAIL ") + m);
  if (!c) fail++;
};
const tool = path.join(__dirname, "../tools/population.js");
const work = fs.mkdtempSync(path.join(os.tmpdir(), "population-test-"));
const out = path.join(work, "population.json");

/* A dBASE table (.dbf) with these rows, shaped like Natural Earth's: text fields padded with spaces. */
function dbf(rows) {
  const fields = [
    ["NAME", 40],
    ["ISO_A2_EH", 3],
    ["POP_EST", 20],
    ["POP_YEAR", 4],
  ];
  const rowLength = 1 + fields.reduce((n, [, l]) => n + l, 0);
  const headerLength = 32 + 32 * fields.length + 1;
  const b = Buffer.alloc(headerLength + rows.length * rowLength + 1, 0);
  b[0] = 3;
  b.writeUInt32LE(rows.length, 4);
  b.writeUInt16LE(headerLength, 8);
  b.writeUInt16LE(rowLength, 10);
  fields.forEach(([name, length], i) => {
    b.write(name, 32 + 32 * i, "latin1");
    b[32 + 32 * i + 11] = 67; // "C": text
    b[32 + 32 * i + 16] = length;
  });
  b[headerLength - 1] = 0x0d;
  rows.forEach((r, i) => {
    let at = headerLength + i * rowLength;
    b[at++] = 0x20;
    for (const [name, length] of fields) {
      b.write(String(r[name] ?? "").padEnd(length, " "), at, "utf8");
      at += length;
    }
  });
  b[b.length - 1] = 0x1a;
  return b;
}
/* 210 made-up places, 35 million people each, with codes whose first letter is none of those of the real
   codes below (AA, AB, …, BZ, EA, …), plus the real codes the import requires. */
const LETTERS = "ABEHJKLNOPQTVWXYZ";
const filler = Array.from({ length: 210 }, (_, i) => ({
  NAME: "Place " + i,
  ISO_A2_EH: LETTERS[Math.floor(i / 26)] + String.fromCharCode(65 + (i % 26)),
  POP_EST: "35000000.0",
  POP_YEAR: "2019",
}));
const real = ["CN", "IN", "US", "DE", "FR", "GF", "RE", "MT"].map(c => ({
  NAME: "Real " + c,
  ISO_A2_EH: c,
  POP_EST: "1000000.0",
  POP_YEAR: "2019",
}));
const run = (rows, ...args) => {
  const file = path.join(work, "units.dbf");
  fs.writeFileSync(file, dbf(rows));
  fs.rmSync(out, { force: true });
  return spawnSync(process.execPath, [tool, file, "--out", out, ...args], { encoding: "utf8" });
};

// 1. A good import
const commit = "ca96624a56bd078437bca8184e78163e5039ad19";
let r = run(
  [
    ...filler,
    ...real,
    { NAME: "England", ISO_A2_EH: "GB", POP_EST: "56000000.0", POP_YEAR: "2019" },
    { NAME: "Scotland", ISO_A2_EH: "GB", POP_EST: "5000000.0", POP_YEAR: "2017" },
    { NAME: "Somalia", ISO_A2_EH: "SO", POP_EST: "10000000.0", POP_YEAR: "2019" },
    { NAME: "Somaliland", ISO_A2_EH: "-99", POP_EST: "5000000.0", POP_YEAR: "2014" },
    { NAME: "Bir Tawil", ISO_A2_EH: "-99", POP_EST: "0.0", POP_YEAR: "2019" },
    { NAME: "Siachen Glacier", ISO_A2_EH: "-99", POP_EST: "6000.0", POP_YEAR: "2013" },
  ],
  "--commit",
  commit,
);
const data = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, "utf8")) : {};
ok(r.status === 0 && data.population, "imports a good table: " + (r.stderr || "").trim());
ok(data.population?.GB === 61000000, "adds up units with the same code (England and Scotland)");
ok(data.population?.SO === 15000000, "counts Somaliland with Somalia, as country-coder places it");
ok(!("-99" in (data.population || {})), "leaves out units without a code");
ok(/Siachen Glacier \(6,000\)/.test(r.stdout) && !/Bir Tawil/.test(r.stdout), "lists what it left out");
ok(
  data.source?.commit === commit &&
    data.source.url.endsWith(commit) &&
    data.source.years.join() === "2014,2019",
  "notes the source, the commit and the years: " + JSON.stringify(data.source),
);

// 2. Broken input stops without writing
r = run(filler.slice(0, 50).concat(real));
ok(r.status !== 0 && !fs.existsSync(out) && /expected over 200/.test(r.stderr), "too few places");
r = run(filler.concat(real.slice(1)));
ok(
  r.status !== 0 && !fs.existsSync(out) && /no population for CN/.test(r.stderr),
  "a required place missing",
);
r = run(filler.map(f => ({ ...f, POP_EST: "200000000.0" })).concat(real));
ok(
  r.status !== 0 && !fs.existsSync(out) && /cannot be right/.test(r.stderr),
  "a world population that is wrong",
);
r = run([...filler, ...real, { NAME: "Bad", ISO_A2_EH: "BD", POP_EST: "many", POP_YEAR: "2019" }]);
ok(
  r.status !== 0 && !fs.existsSync(out) && /no usable population/.test(r.stderr),
  "a population that is not a number",
);
fs.writeFileSync(path.join(work, "not.dbf"), "hello");
r = spawnSync(process.execPath, [tool, path.join(work, "not.dbf"), "--out", out], { encoding: "utf8" });
ok(r.status !== 0 && !fs.existsSync(out), "a file that is not a table");

fs.rmSync(work, { recursive: true, force: true });
console.log(fail ? `${fail} FAILED` : "ALL PASS");
process.exitCode = fail ? 1 : 0;
