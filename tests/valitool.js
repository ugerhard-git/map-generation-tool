// The Vali import (tools/vali.js), run against made-up copies of Vali's two files: a good import, an
// unchanged second run, a change with its summary, Vali's known slips (a country listed twice), and
// broken input, which must stop without touching the data file. Needs no browser and no network.
const { spawnSync } = require("child_process");
const fs = require("fs"),
  os = require("os"),
  path = require("path");

let fail = 0;
const ok = (c, m) => {
  console.log((c ? "PASS " : "FAIL ") + m);
  if (!c) fail++;
};
const tool = path.join(__dirname, "../tools/vali.js");
const work = fs.mkdtempSync(path.join(os.tmpdir(), "vali-test-"));
const out = path.join(work, "vali.json"),
  summary = path.join(work, "summary.md");

// 30 made-up two-letter codes, AA to BD, enough for the import's "at least 20 countries" check.
const codes = Array.from({ length: 30 }, (_, i) =>
  String.fromCharCode(65 + Math.floor(i / 26), 65 + (i % 26)),
);
const list = (name, entries) =>
  `    public static readonly (string, int)[] ${name} =\n    [\n${entries.map(([c, n]) => `        ("${c}", ${n}),`).join("\n")}\n    ];\n`;
const world = (extra = 0) => codes.map((c, i) => [c, i === 0 ? 100 + extra : 10]);
/* Writes a made-up Vali copy; `change` adjusts the lists. */
function makeVali(dir, change = {}) {
  const lists = {
    CommunityWorld: change.CommunityWorld || world(),
    BalancedWorld: world(),
    ImprovedWorld: change.ImprovedWorld || world(),
    World: world(),
    SuperWorld: change.SuperWorld || world(),
    Europe: codes.slice(0, 6).map(c => [c, 5]),
    Asia: codes.slice(6, 12).map(c => [c, 5]),
    Africa: codes.slice(12, 18).map(c => [c, 5]),
    NorthAmerica: codes.slice(18, 24).map(c => [c, 5]),
    SouthAmerica: codes.slice(24, 30).map(c => [c, 5]),
    Oceania: codes.slice(0, 5).map(c => [c, 5]),
  };
  const core = path.join(dir, "src/Vali.Core");
  fs.mkdirSync(core, { recursive: true });
  fs.writeFileSync(
    path.join(core, "Weights.cs"),
    "namespace Vali.Core;\n\npublic static class Weights\n{\n" +
      Object.entries(lists)
        .map(([n, e]) => list(n, e))
        .join("\n") +
      (change.raw || "") +
      "}\n",
  );
  const maps = {
    acw: "CommunityWorld",
    abw: "BalancedWorld",
    aiw: "ImprovedWorld",
    aaw: "World",
    superw: "SuperWorld",
  };
  for (const c of change.dropMaps || []) delete maps[c];
  fs.writeFileSync(
    path.join(core, "MapDefinitionDefaults.cs"),
    `return countryCode switch {\n` +
      [
        "europe:Europe",
        "asia:Asia",
        "africa:Africa",
        "northamerica:NorthAmerica",
        "southamerica:SouthAmerica",
        "oceania:Oceania",
      ]
        .map(x => `    "${x.split(":")[0]}" => CodesFromWeights(Weights.${x.split(":")[1]}),`)
        .join("\n") +
      `\n};\nreturn strategy switch {\n` +
      Object.entries(maps)
        .map(([c, n]) => `    "${c}" => Weights.${n},`)
        .join("\n") +
      `\n};\n`,
  );
  return dir;
}
const run = dir =>
  spawnSync(process.execPath, [tool, dir, "--out", out, "--summary", summary], { encoding: "utf8" });

// 1. A good import, with Vali's known slips: a country listed as 0 and as 1, and one listed twice
const good = makeVali(path.join(work, "good"), {
  CommunityWorld: [...world(), ["ZZ", 0], ["AB", 0]],
  ImprovedWorld: [...world(), ["AC", 99]],
});
let r = run(good);
let data = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, "utf8")) : null;
ok(r.status === 0 && data, "a good copy is imported: " + r.stdout.split("\n")[0]);
ok(
  data.maps.acw.name === "A Community World" && data.maps.superw.name === "Super World",
  "known maps get their names, a new one a name from its list: " + data.maps.superw.name,
);
ok(
  !("ZZ" in data.maps.acw.weights) && data.maps.acw.weights.AB === 10,
  "zero shares are dropped; a 0 next to a share keeps the share",
);
ok(
  data.maps.aiw.weights.AC === 10 && /ImprovedWorld lists AC twice, as 10 and 99; 10 is used/.test(r.stderr),
  "a country listed twice with two shares: the first is kept, with a warning",
);
ok(
  Object.keys(data.continents).length === 6 && data.continents.europe.name === "Europe",
  "the six continents",
);
ok(
  /slashP\/Vali/.test(data.about) && data.source.repository === "https://github.com/slashP/Vali",
  "the file credits Vali",
);
const s1 = fs.readFileSync(summary, "utf8");
ok(
  /New map:\*\* Super World \(`superw`\), named from Vali's list name/.test(s1) &&
    /Slips in Vali's data/.test(s1),
  "the summary lists new maps and slips",
);

// 2. Nothing changed: the file is left alone, the summary is empty
const before = fs.readFileSync(out, "utf8");
r = run(good);
ok(
  r.status === 0 && /have not changed/.test(r.stdout) && fs.readFileSync(out, "utf8") === before,
  "unchanged: the file is left alone",
);
ok(fs.readFileSync(summary, "utf8") === "", "unchanged: empty summary, so no pull request");

// 3. A change: the summary says what moved
const changed = makeVali(path.join(work, "changed"), {
  CommunityWorld: [...world(300), ["ZY", 50]],
  dropMaps: ["superw"],
});
r = run(changed);
const s3 = fs.readFileSync(summary, "utf8");
ok(
  r.status === 0 && /A Community World:\*\* added ZY/.test(s3) && /AA \+/.test(s3),
  "a change is summarised: " + s3.split("\n")[0],
);
ok(/Removed map:\*\* Super World/.test(s3), "a removed map is named");

// 4. Broken copies stop the import and leave the file as it was
const kept = fs.readFileSync(out, "utf8");
const broken = [
  [
    "something that is not a pair",
    { raw: list("Bad", [["AA", 1]]).replace('("AA", 1),', '("AA", 1), oops') },
  ],
  ["a required map missing", { dropMaps: ["acw"] }],
  ["a map with too few countries", { SuperWorld: codes.slice(0, 5).map(c => [c, 1]) }],
];
for (const [what, change] of broken) {
  r = run(makeVali(path.join(work, what.replace(/\W+/g, "-")), change));
  ok(
    r.status === 1 && fs.readFileSync(out, "utf8") === kept,
    `${what}: stops, file unchanged: ${r.stderr.trim()}`,
  );
}
fs.rmSync(path.join(work, "good/src/Vali.Core/Weights.cs"));
r = run(good);
ok(r.status === 1 && /missing; has Vali moved its files/.test(r.stderr), "a missing file is explained");

// 5. The data file in the repository is a good import
const real = JSON.parse(fs.readFileSync(path.join(__dirname, "../src/data/vali.json"), "utf8"));
ok(
  ["acw", "abw", "aiw", "aaw"].every(c => Object.keys(real.maps[c].weights).length > 50) &&
    Object.keys(real.continents).length === 6,
  `src/data/vali.json: ${Object.keys(real.maps).length} maps from Vali ${real.source.commit.slice(0, 7)} (${real.source.date})`,
);

fs.rmSync(work, { recursive: true, force: true });
console.log(fail ? `${fail} FAILED` : "ALL PASS");
