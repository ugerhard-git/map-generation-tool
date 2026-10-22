// Imports the country distributions of well-known GeoGuessr maps, and the continent lists, from Vali
// (https://github.com/slashP/Vali, by slashP, GPL-3.0) into src/data/vali.json, which the build puts
// into the page.
//
//   node tools/vali.js <folder with a copy of the Vali repository> [--summary <file>] [--out <file>]
//
// It reads two of Vali's files:
//   src/Vali.Core/Weights.cs                the distributions: lists of ("DE", 1234) pairs per map
//   src/Vali.Core/MapDefinitionDefaults.cs  which short code ("acw") belongs to which list, and which
//                                           list is which continent
// Before writing, it checks that everything looks right (known maps present, two-letter codes, whole
// numbers) and stops with an error instead of writing a broken file. If the distributions are the same
// as in the file already there, it leaves that file alone, so a Vali change elsewhere starts no update.
// With --summary it writes what changed, in Markdown, for the update pull request
// (.github/workflows/vali.yml). --out writes somewhere else than src/data/vali.json (for the tests).
// Run by hand with a fresh `git clone https://github.com/slashP/Vali`.
const fs = require("fs"),
  path = require("path"),
  { execFileSync } = require("child_process");

const DATA_FILE = path.join(__dirname, "../src/data/vali.json");
/* Readable names for Vali's short codes. A map Vali adds later gets a name made from its list's name in
   Weights.cs ("LessExtremeRegionGuessing" -> "Less Extreme Region Guessing") until it is added here. */
const MAP_NAMES = {
  acw: "A Community World",
  abw: "A Balanced World",
  aiw: "An Improved World",
  aaw: "An Arbitrary World",
  aarw: "An Arbitrary Rural World",
  aow: "An Official World",
  proworld: "Pro World",
  rainboltworld: "Rainbolt World",
  geotime: "GeoTime",
  lerg: "Less Extreme Region Guessing",
  amw: "A Moving World",
  yellowbelly: "Yellow Belly",
  "5kable": "A 5Kable World",
};
/* Maps that must be in Vali's data: if one disappears, something is wrong and nothing is written. */
const REQUIRED_MAPS = ["acw", "abw", "aiw", "aaw"];
const CONTINENT_NAMES = {
  europe: "Europe",
  asia: "Asia",
  africa: "Africa",
  northamerica: "North America",
  southamerica: "South America",
  oceania: "Oceania",
};

/* Stops the script with a message that says what to look at. */
function fail(message) {
  console.error("tools/vali.js: " + message);
  process.exit(1);
}

/* Slips found in Vali's data that do not stop the import; they are shown in the update pull request. */
const warnings = [];

/* Every list in Weights.cs: { ListName: { DE: 1234, … } }. */
function readWeights(text) {
  const lists = {};
  const listRe = /public\s+static\s+readonly\s+\(\s*string\s*,\s*int\s*\)\[\]\s+(\w+)\s*=\s*\[([\s\S]*?)\];/g;
  for (const [, name, body] of text.matchAll(listRe)) {
    const weights = {};
    // Everything in the list must be a ("XX", 123) pair; comments are allowed.
    const rest = body
      .replace(/\/\/[^\n]*/g, "")
      .replace(/\(\s*"([A-Za-z]{2})"\s*,\s*(\d+)\s*\)\s*,?/g, (all, code, n) => {
        const c = code.toUpperCase(),
          value = Number(n);
        // A country listed twice: Vali drops zero shares first (An Arbitrary Rural World lists Bermuda as
        // 0 and as 1), and where it picks countries from a list it keeps the first share. As of August
        // 2026, An Improved World lists Costa Rica as 200 and as 20, so 200 is kept. Such a conflict is
        // a slip in Vali, so it is reported rather than stopping every update.
        if (c in weights && weights[c] > 0 && value > 0 && weights[c] !== value)
          warnings.push(
            `${name} lists ${c} twice, as ${weights[c]} and ${value}; ${weights[c]} is used, as Vali does.`,
          );
        if (!(c in weights) || weights[c] === 0) weights[c] = value;
        return "";
      });
    if (rest.trim())
      fail(`${name} has something that is not a ("XX", 123) pair: ${rest.trim().slice(0, 80)}`);
    lists[name] = weights;
  }
  return lists;
}

/* Short codes and continents from MapDefinitionDefaults.cs: { maps: {acw: "CommunityWorld"}, continents: {europe: "Europe"} }. */
function readCodes(text) {
  const maps = {},
    continents = {};
  for (const [, code, list] of text.matchAll(/"([a-z0-9]+)"\s*=>\s*Weights\.(\w+)\s*,/g)) maps[code] = list;
  for (const [, code, list] of text.matchAll(/"([a-z]+)"\s*=>\s*CodesFromWeights\(\s*Weights\.(\w+)\s*\)/g))
    if (code in CONTINENT_NAMES) continents[code] = list;
  return { maps, continents };
}

/* "LessExtremeRegionGuessing" -> "Less Extreme Region Guessing". */
const wordsOf = name => name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/^A(\d)/, "A $1");

/* Only the countries with a share above 0, sorted by code, so the file is easy to compare. */
const positive = weights =>
  Object.fromEntries(
    Object.entries(weights)
      .filter(([, n]) => n > 0)
      .sort(([a], [b]) => a.localeCompare(b)),
  );

/* Which Vali commit the copy is at, if it is a git copy. */
function sourceOf(dir) {
  try {
    const [commit, date] = execFileSync("git", ["-C", dir, "log", "-1", "--format=%H %cs"], {
      encoding: "utf8",
    })
      .trim()
      .split(" ");
    return { commit, date };
  } catch {
    return { commit: "unknown", date: "unknown" };
  }
}

/* What changed between two data files, in Markdown, for the pull request. */
function summarize(before, after) {
  const lines = [];
  const name = (d, code) => d.maps[code]?.name || code;
  const oldMaps = before ? Object.keys(before.maps) : [],
    newMaps = Object.keys(after.maps);
  for (const code of newMaps.filter(c => !oldMaps.includes(c)))
    lines.push(
      `- **New map:** ${name(after, code)} (\`${code}\`)${MAP_NAMES[code] ? "" : ", named from Vali's list name; add a proper name to MAP_NAMES in tools/vali.js"}.`,
    );
  for (const code of oldMaps.filter(c => !newMaps.includes(c)))
    lines.push(`- **Removed map:** ${name(before, code)} (\`${code}\`).`);
  const compare = (label, a, b) => {
    const added = Object.keys(b).filter(c => !(c in a)),
      removed = Object.keys(a).filter(c => !(c in b));
    const totalA = Object.values(a).reduce((s, n) => s + n, 0) || 1,
      totalB = Object.values(b).reduce((s, n) => s + n, 0) || 1;
    const moved = Object.keys(b)
      .filter(c => c in a)
      .map(c => ({ c, d: (100 * b[c]) / totalB - (100 * a[c]) / totalA }))
      .filter(x => Math.abs(x.d) >= 0.1)
      .sort((x, y) => Math.abs(y.d) - Math.abs(x.d))
      .slice(0, 5);
    if (!added.length && !removed.length && !moved.length) return;
    const parts = [];
    if (added.length) parts.push(`added ${added.join(", ")}`);
    if (removed.length) parts.push(`removed ${removed.join(", ")}`);
    if (moved.length)
      parts.push(
        "largest share changes " +
          moved.map(x => `${x.c} ${x.d > 0 ? "+" : ""}${x.d.toFixed(1)} points`).join(", "),
      );
    lines.push(`- **${label}:** ${parts.join("; ")}.`);
  };
  if (before) {
    for (const code of newMaps.filter(c => oldMaps.includes(c)))
      compare(name(after, code), before.maps[code].weights, after.maps[code].weights);
    for (const code of Object.keys(after.continents))
      if (before.continents[code])
        compare(after.continents[code].name, before.continents[code].weights, after.continents[code].weights);
  }
  return lines.join("\n") || "- Only the list order or zero shares changed.";
}

function main() {
  const args = process.argv.slice(2);
  const dir = args[0];
  const option = name => (args.indexOf(name) >= 0 ? args[args.indexOf(name) + 1] || "" : "");
  const summaryAt = option("--summary"),
    OUT = option("--out") || DATA_FILE;
  if (!dir)
    fail("give the folder with a copy of the Vali repository, for example: node tools/vali.js ../Vali");
  const read = file => {
    const p = path.join(dir, "src/Vali.Core", file);
    if (!fs.existsSync(p)) fail(`${p} is missing; has Vali moved its files?`);
    return fs.readFileSync(p, "utf8");
  };
  const lists = readWeights(read("Weights.cs"));
  const codes = readCodes(read("MapDefinitionDefaults.cs"));

  const maps = {};
  for (const [code, list] of Object.entries(codes.maps)) {
    if (!lists[list]) fail(`map ${code} points to Weights.${list}, which is not in Weights.cs`);
    const weights = positive(lists[list]);
    if (Object.keys(weights).length < 20)
      fail(`map ${code} has only ${Object.keys(weights).length} countries`);
    maps[code] = { name: MAP_NAMES[code] || wordsOf(list), weights };
  }
  for (const code of REQUIRED_MAPS) if (!maps[code]) fail(`the map ${code} is missing from Vali's data`);
  const continents = {};
  for (const [code, name] of Object.entries(CONTINENT_NAMES)) {
    const list = codes.continents[code];
    if (!list || !lists[list]) fail(`the continent ${code} is missing from Vali's data`);
    const weights = positive(lists[list]);
    if (Object.keys(weights).length < 5)
      fail(`the continent ${code} has only ${Object.keys(weights).length} countries`);
    continents[code] = { name, weights };
  }

  for (const w of warnings) console.warn("Warning: " + w);
  const before = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : null;
  const unchanged =
    before &&
    JSON.stringify({ maps: before.maps, continents: before.continents }) ===
      JSON.stringify({ maps, continents });
  if (unchanged) {
    console.log("Vali's distributions have not changed; src/data/vali.json left as it is.");
    if (summaryAt) fs.writeFileSync(summaryAt, "");
    return;
  }
  const data = {
    about:
      "Country distributions of well-known GeoGuessr maps and continent lists, from Vali by slashP (https://github.com/slashP/Vali, GPL-3.0). Made by tools/vali.js; do not edit by hand.",
    source: { repository: "https://github.com/slashP/Vali", ...sourceOf(dir) },
    maps,
    continents,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(data, null, 2) + "\n");
  const summary =
    summarize(before, data) +
    (warnings.length
      ? "\n\n**Slips in Vali's data** (handled as Vali does):\n" + warnings.map(w => "- " + w).join("\n")
      : "");
  if (summaryAt) fs.writeFileSync(summaryAt, summary + "\n");
  console.log(
    `src/data/vali.json written: ${Object.keys(maps).length} maps, ${Object.keys(continents).length} continents, Vali ${data.source.commit.slice(0, 7)} (${data.source.date}).`,
  );
  console.log(summary);
}

main();
