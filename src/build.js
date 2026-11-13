// Builds the three published pages from the files in src/: the Map Generation Tool (dist/index.html, from
// src/page.html, src/style.css and src/app.js), Unofficial (dist/unofficial/index.html, from the same
// files in src/unofficial/) and Distribution (dist/distribution/index.html, from src/distribution/; it has
// no map and no Google, see buildPage). Each page's files get the shared parts from src/shared/ put in (see
// src/assemble.js). Then the placeholders in the page (such as /*APP_JS*/) are filled with the styles, the
// app code, the data, Leaflet, country-coder, the land map, the font and the icon, and the scripts are
// fingerprinted for the Content Security Policy. The Google key comes from the GOOGLE_API_KEY environment
// variable; index.nokey.html next to each page is the same page without it, for the tests. Run with
// `npm run build`.
//
// A second build, in dist/split/, is for hosting both tools on one server of one's own (agreed with the
// owner, November 2026): the same two pages, but with the scripts and styles in files of their own under
// dist/split/assets/, where both pages load the same files for what they share (Leaflet, country-coder,
// the land map, the font and the shared styles), so a browser that opens both downloads them once. Each
// tool's data and app code is one file of its own (it still holds its copy of the shared code: see "Two
// tools, one code"). The file names carry a fingerprint, so a server may let browsers keep them for long.
// Its security policy allows scripts from the page's own server ('self') and Google's, and each script
// tag carries its file's fingerprint (integrity), so a changed file does not run.
const fs = require("fs"),
  path = require("path"),
  crypto = require("crypto");
const { assemble } = require("./assemble.js");
const pkg = name => path.dirname(require.resolve(name + "/package.json"));
const dist = path.join(__dirname, "../dist");

// Data made into script text: "<" is escaped so the data can never close the script it sits in.
const asScript = data =>
  JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/[\u2028\u2029]/g, "");

// ---------- what both pages get ----------

// The icon, as data: addresses (the security policy allows images from data:). The PNG versions are
// made from icon.svg by `npm run icons`.
const dataUrl = (file, type) =>
  `data:${type};base64,${fs.readFileSync(path.join(__dirname, file)).toString("base64")}`;
const icons = {
  ICON_SVG: dataUrl("icon.svg", "image/svg+xml"),
  ICON_PNG: dataUrl("icon-32.png", "image/png"),
  ICON_TOUCH: dataUrl("icon-180.png", "image/png"),
};

// The country tags, from the owner's list (src/data/country-tags.json): a code and a tag per country,
// checked here, so a mistake in the file stops the build instead of reaching the page. Only the tags go
// into the page.
const countryTags = JSON.parse(fs.readFileSync(path.join(__dirname, "data/country-tags.json"), "utf8")).tags;
const tagsByCode = {};
for (const [code, entry] of Object.entries(countryTags)) {
  if (!/^[A-Z]{2}$/.test(code))
    throw new Error(`country-tags.json: "${code}" is not a two-letter country code`);
  const tag = entry && entry.tag;
  if (typeof tag !== "string" || !tag.trim() || tag.length > 60 || [...tag].some(ch => ch < " "))
    throw new Error(`country-tags.json: the tag for ${code} must be text of 1 to 60 characters`);
  tagsByCode[code] = tag.trim();
}

// The land map, so random spots are only made on land: from Natural Earth's land outlines in the
// world-atlas package (see src/land.js). Base64 text only, so it cannot close the script it sits in.
const land = require("./land.js").landMap(path.join(pkg("world-atlas"), "land-10m.json"));
if (!/^[A-Za-z0-9+/]*={0,2}$/.test(land.runs)) throw new Error("the land map is not plain base64");

// Leaflet 1.9.4, from the npm package (no CDN at runtime)
const leafletJs = fs
  .readFileSync(pkg("leaflet") + "/dist/leaflet.js", "utf8")
  .replace(/\/\/# sourceMappingURL=.*$/m, "");
if (/<\/script/i.test(leafletJs)) throw new Error("leaflet contains a closing script tag");
// country-coder 5, from the npm package: finds the country of a position offline, for the country code
// in the export. It sets window.countryCoder.
const countryCoderJs = fs
  // (Its package does not expose package.json, so its folder is found from its main file, in dist/.)
  .readFileSync(
    path.join(path.dirname(require.resolve("@rapideditor/country-coder")), "country-coder.iife.js"),
    "utf8",
  )
  .replace(/^\/\/# (sourceMappingURL|debugId)=.*$/gm, "");
if (/<\/script/i.test(countryCoderJs)) throw new Error("country-coder contains a closing script tag");
// Drop rules that would fetch image files the page does not use.
const leafletCss = fs
  .readFileSync(pkg("leaflet") + "/dist/leaflet.css", "utf8")
  .replace(/behavior:\s*url\([^)]*\);?/g, "")
  .replace(/background-image:\s*url\(images\/[^)]*\);?/g, "");
if (/url\(/.test(leafletCss)) throw new Error("leaflet css still references a url");

// Overpass typeface, embedded (no request to Google Fonts)
let fontCss = "";
for (const w of [400, 600, 800]) {
  const css = fs.readFileSync(`${pkg("@fontsource/overpass")}/${w}.css`, "utf8");
  for (const block of css.match(/@font-face\s*\{[^}]*\}/g) || []) {
    const m = /url\(\.\/files\/(overpass-(latin|latin-ext)-\d+-normal\.woff2)\)/.exec(block);
    if (!m) continue;
    const range = /unicode-range:\s*([^;]+);/.exec(block);
    const data = fs.readFileSync(`${pkg("@fontsource/overpass")}/files/${m[1]}`).toString("base64");
    fontCss += `@font-face{font-family:"Overpass";font-style:normal;font-display:swap;font-weight:${w};src:url(data:font/woff2;base64,${data}) format("woff2");${range ? "unicode-range:" + range[1] + ";" : ""}}\n`;
  }
}
if ((fontCss.match(/@font-face/g) || []).length !== 6) throw new Error("expected 6 font faces");

// The site key comes from the environment (a GitHub secret when deploying), never from the repository.
const key = (process.env.GOOGLE_API_KEY || "").trim();
if (key && !/^[A-Za-z0-9_-]{20,80}$/.test(key))
  throw new Error("GOOGLE_API_KEY does not look like a Google API key");

// ---------- the settlement map (dist/data/) ----------

// Where the towns and villages are, for "Town or countryside" (made by tools/settlements.js from the
// GHSL's degree of urbanisation): too big to build into the pages (2 MB), so it is published as a file
// of its own, dist/data/settlements.<fingerprint>.bin (and the same under dist/split/data/), which a page
// loads only when the setting or its tag is used, and checks against its integrity value. The page gets
// where it is, that value and how to read it (SETTLEMENTS). This is the one file a page may fetch from
// its own site: its policy allows 'self' for it (agreed with the owner, November 2026).
const settlementsInfo = JSON.parse(fs.readFileSync(path.join(__dirname, "data/settlements.json"), "utf8"));
const settlementsBin = fs.readFileSync(path.join(__dirname, "data/settlements.bin"));
if (settlementsBin.length !== settlementsInfo.bytes)
  throw new Error("src/data/settlements.bin does not match settlements.json: run tools/settlements.js again");
const settlementsDigest = crypto.createHash("sha384").update(settlementsBin);
const settlementsFile = `settlements.${settlementsDigest.copy().digest("hex").slice(0, 10)}.bin`;
const settlementsIntegrity = "sha384-" + settlementsDigest.digest("base64");
/* Writes the settlement map into a folder data/ (of dist/ or dist/split/), replacing older ones. */
function writeSettlements(root) {
  const folder = path.join(root, "data");
  fs.rmSync(folder, { recursive: true, force: true });
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, settlementsFile), settlementsBin);
}
writeSettlements(dist);
/* What a page needs to load and read the settlement map: its address from the page (out: the page's
   folder under dist/ or dist/split/), its integrity value and the grid. */
const settlementsFor = out =>
  asScript({
    href: (out ? "../".repeat(out.split("/").length) : "") + "data/" + settlementsFile,
    integrity: settlementsIntegrity,
    bytes: settlementsInfo.bytes,
    grid: settlementsInfo.grid,
  });

// ---------- the split build (dist/split/) ----------

const splitDir = path.join(dist, "split");
fs.rmSync(splitDir, { recursive: true, force: true });
fs.mkdirSync(path.join(splitDir, "assets"), { recursive: true });
writeSettlements(splitDir);
const sharedStyles = fs.readFileSync(path.join(__dirname, "shared/style.css"), "utf8");
/* Writes one file into dist/split/assets/ under a name with its fingerprint ("leaflet.1a2b3c4d.js"), once
   even when both pages ask for it. Returns its path from the site's root and its integrity value. */
function asset(name, ext, text) {
  const digest = crypto.createHash("sha384").update(text, "utf8");
  const integrity = "sha384-" + digest.copy().digest("base64");
  const file = `${name}.${digest.digest("hex").slice(0, 10)}.${ext}`;
  fs.writeFileSync(path.join(splitDir, "assets", file), text);
  return { href: "assets/" + file, integrity };
}
/* Turns a finished one-file page (tpl, with its policy and placeholders filled in) into the split page
   for dist/split/<out>/: its three script blocks and two style blocks become files under assets/. A page
   without the map (map false: Distribution) has no Leaflet, land map or Google. */
function splitPage(tpl, dir, out, appJs, where, map) {
  const up = out ? "../".repeat(out.split("/").length) : "";
  const scriptTag = a => `<script src="${up}${a.href}" integrity="${a.integrity}"></script>`;
  const styleTag = a => `<link rel="stylesheet" href="${up}${a.href}" integrity="${a.integrity}" />`;
  const blocks = [];
  tpl.replace(/<script>([\s\S]*?)<\/script>/g, (all, body) => blocks.push(body));
  if (blocks.length !== 3) throw new Error(`split build: expected 3 script blocks in ${where}`);
  // 1. the libraries, the same for every page
  const leaflet = map ? asset("leaflet", "js", leafletJs) : null,
    coder = asset("country-coder", "js", countryCoderJs);
  // 2. the data and the framing check: the land map, the same for both map pages, in a file of its own
  const landLine = map ? `const LAND = ${JSON.stringify({ per: land.per, runs: land.runs })};` : "";
  if (map && blocks[1].split(landLine).length !== 2)
    throw new Error(`split build: the land map not found in ${where}`);
  const landFile = map ? asset("land", "js", landLine + "\n") : null;
  // 2 and 3. this tool's data, the framing check and its app code, in one file and in that order
  const tool = asset(
    out ? out.replace(/\//g, "-") : "mapgen",
    "js",
    (map ? blocks[1].replace(landLine, "") : blocks[1]) + "\n" + appJs,
  );
  // The styles: what both share (the font, Leaflet's, src/shared/style.css), then the tool's own, if any
  const shared = asset("shared", "css", fontCss + "\n" + leafletCss + "\n" + sharedStyles);
  const toolCss = fs.readFileSync(path.join(dir, "style.css"), "utf8");
  const [before, after = null] = toolCss.split(/^\s*\/\*SHARED style\.css\*\/\s*$/m);
  if (after === null) throw new Error(`split build: ${where}/style.css does not put in src/shared/style.css`);
  const rules = css => css.replace(/\/\*[\s\S]*?\*\//g, "").trim();
  if (rules(before))
    throw new Error(
      `split build: ${where}/style.css has rules before the shared styles; they would come after them in the split build`,
    );
  const ownCss = rules(after) ? styleTag(asset(out || "mapgen", "css", after)) : "";

  let page = tpl;
  let i = 0;
  page = page.replace(/<script>([\s\S]*?)<\/script>/g, () => {
    i++;
    if (i === 1) return map ? scriptTag(leaflet) + "\n    " + scriptTag(coder) : scriptTag(coder);
    if (i === 2) return map ? scriptTag(landFile) + "\n    " + scriptTag(tool) : scriptTag(tool);
    return "";
  });
  const styles = page.match(/<style>[\s\S]*?<\/style>\s*<style>[\s\S]*?<\/style>/);
  if (!styles) throw new Error(`split build: the two style blocks not found in ${where}`);
  page = page.replace(styles[0], () => styleTag(shared) + (ownCss ? "\n" + ownCss : ""));
  // The policy: scripts and style sheets from this server; the rest as in the one-file page.
  page = page.replace(
    /script-src [^;]*;/,
    map ? `script-src 'self' https://maps.googleapis.com https://*.gstatic.com;` : "script-src 'self';",
  );
  page = page.replace(/style-src [^;]*;/, "style-src 'self' 'unsafe-inline';");
  if (/<script>|<style>/.test(page)) throw new Error(`split build: inline code left in ${where}`);
  const folder = path.join(splitDir, out);
  fs.mkdirSync(folder, { recursive: true });
  const withKey = page.replace(/("googleApiKey": )"[^"]*"/, (all, k) => k + JSON.stringify(key));
  fs.writeFileSync(path.join(folder, "index.html"), withKey);
  fs.writeFileSync(path.join(folder, "index.nokey.html"), page.replace(/("googleApiKey": )"[^"]*"/, '$1""'));
  console.log(
    path.join("dist/split", out, "index.html"),
    (withKey.length / 1024).toFixed(0) + " KB, with its scripts and styles in assets/",
  );
}

// ---------- each page ----------

// Builds one page from the page.html, style.css and app.js in folder `dir` into dist/<out>/, with the
// data placeholders in `data` (name: script text) on top of what every page gets. A page with `map: false`
// (Distribution) gets no Leaflet, no land map and no Google: its policy allows no outside host at all.
function buildPage(dir, out, data, { map = true } = {}) {
  let tpl = assemble(path.join(dir, "page.html")).code;
  const where = path.relative(__dirname, dir) || "src";
  // Fills in one placeholder. Each must appear exactly once in page.html: a second copy (in a comment,
  // say) would get the content instead of the real spot, and the page would break.
  const put = (mark, text) => {
    const n = tpl.split(mark).length - 1;
    if (n !== 1)
      throw new Error(`placeholder ${mark} appears ${n} times in ${where}/page.html; it must appear once`);
    tpl = tpl.replace(mark, () => text);
  };
  // The page is published as one file: the app's styles and code are written into it.
  const appCss = assemble(path.join(dir, "style.css")).code,
    appJs = assemble(path.join(dir, "app.js")).code;
  if (/<\/style/i.test(appCss)) throw new Error(`${where}/style.css contains a closing style tag`);
  if (/<\/script/i.test(appJs)) throw new Error(`${where}/app.js contains a closing script tag`);
  if (/\/\*[A-Z][A-Z_]*\*\//.test(appCss + appJs))
    throw new Error(`a build placeholder appears in ${where}/style.css or app.js`);
  put("/*APP_CSS*/", appCss);
  put("/*APP_JS*/", appJs);
  for (const [mark, text] of Object.entries(icons)) put(`/*${mark}*/`, text);
  for (const [mark, text] of Object.entries(data)) put(`/*${mark}*/`, text);
  if (map) {
    put("/*LAND*/", JSON.stringify({ per: land.per, runs: land.runs }));
    put("/*SETTLEMENTS*/", settlementsFor(out));
    put("/*LEAFLET_JS*/", leafletJs);
    put("/*LEAFLET_CSS*/", leafletCss);
  }
  put("/*COUNTRY_CODER_JS*/", countryCoderJs);
  put("/*FONT_CSS*/", fontCss);

  // Content Security Policy: only the inline scripts shipped in this file may run.
  const hashes = [];
  tpl.replace(/<script>([\s\S]*?)<\/script>/g, (all, body) => {
    hashes.push(`'sha256-${crypto.createHash("sha256").update(body, "utf8").digest("base64")}'`);
    return all;
  });
  if (hashes.length !== 3) throw new Error(`expected 3 inline scripts in ${where}, found ${hashes.length}`);
  // Google's script for Street View. Only Google's own hosts: no wildcard over googleapis.com, whose
  // subdomains include storage.googleapis.com, where anyone can host files. gstatic.com holds only Google's own files.
  const google = "https://maps.googleapis.com https://*.gstatic.com";
  const csp = [
    "default-src 'none'",
    map ? `script-src ${hashes.join(" ")} ${google}` : `script-src ${hashes.join(" ")}`,
    "style-src 'unsafe-inline'",
    map ? "img-src https://tile.openstreetmap.org data:" : "img-src data:",
    "font-src data:",
    // Only Google's Street View service, and the settlement map from the page's own site ('self', the
    // one exception, agreed with the owner in November 2026: the page fetches nothing else from there,
    // and checks the file's integrity). A feature that needs another service (an Overpass server, say)
    // adds its host here, in the same pull request. A page without the map talks to nobody.
    map ? "connect-src 'self' https://maps.googleapis.com" : "connect-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "object-src 'none'",
  ].join("; ");
  put("/*CSP*/", csp);
  if (/https:\/\/(cdnjs|fonts\.g)/.test(tpl)) throw new Error("third-party asset reference left in page");
  const left = tpl.match(/\/\*[A-Z][A-Z_]*\*\//);
  if (left) throw new Error(`placeholder ${left[0]} in ${where}/page.html was not filled in`);
  const folder = path.join(dist, out);
  fs.mkdirSync(folder, { recursive: true });
  splitPage(tpl, dir, out, appJs, where, map);
  const withKey = tpl.replace(/("googleApiKey": )"[^"]*"/, (all, k) => k + JSON.stringify(key));
  fs.writeFileSync(path.join(folder, "index.html"), withKey);
  // Same page without a key, for the automated tests (they enter a key of their own).
  const noKey = tpl.replace(/("googleApiKey": )"[^"]*"/, '$1""');
  fs.writeFileSync(path.join(folder, "index.nokey.html"), noKey);
  console.log(
    path.join("dist", out, "index.html"),
    (withKey.length / 1024).toFixed(0) + " KB;",
    hashes.length,
    "script fingerprints;",
    !map ? "no Google key needed" : key ? "site key included" : "no site key (visitors enter their own)",
  );
}

// The Map Generation Tool, at the site's main address. Its country distributions and continents come
// from Vali, made by tools/vali.js.
const vali = JSON.parse(fs.readFileSync(path.join(__dirname, "data/vali.json"), "utf8"));
// Major roads by the names Google shows, for "Not on a major road" (src/data/major-roads.json, written by
// hand): checked here, every pattern against its examples, so a mistake stops the build. Only the
// patterns, words and "partly" go into the page.
const majorRoads = {};
for (const [code, c] of Object.entries(
  JSON.parse(fs.readFileSync(path.join(__dirname, "data/major-roads.json"), "utf8")).countries,
)) {
  const where = `major-roads.json, ${code}`;
  if (!/^[A-Z]{2}$/.test(code)) throw new Error(`${where}: not a two-letter country code`);
  if (typeof c.roads !== "string" || !c.roads) throw new Error(`${where}: "roads" must say what counts`);
  const re = new RegExp(c.major, "u");
  for (const n of c.examples?.major || [])
    if (!re.test(n)) throw new Error(`${where}: the pattern does not find the major road "${n}"`);
  for (const n of c.examples?.other || [])
    if (re.test(n)) throw new Error(`${where}: the pattern finds "${n}", which is not a major road`);
  if (!c.examples?.major?.length || !c.examples?.other?.length)
    throw new Error(`${where}: needs examples of major roads and of others`);
  majorRoads[code] = { major: c.major, roads: c.roads, partly: c.partly === true };
}
buildPage(__dirname, "", {
  VALI: asScript({ source: vali.source, maps: vali.maps, continents: vali.continents }),
  COUNTRY_TAGS: asScript(tagsByCode),
  MAJOR_ROADS: asScript(majorRoads),
});

// Unofficial, at unofficial/: every country and territory, with its land area, population, continent and
// parent country, worked out from country-coder, the land map and Natural Earth's populations (made by
// tools/population.js; checked here, so a broken file stops the build instead of reaching the page).
const population = JSON.parse(
  fs.readFileSync(path.join(__dirname, "data/population.json"), "utf8"),
).population;
for (const [code, n] of Object.entries(population))
  if (!/^[A-Z]{2}$/.test(code) || !Number.isInteger(n) || n < 0 || n > 2e9)
    throw new Error(`population.json: ${code} must be a two-letter code with a whole number of people`);
const facts = require("./countries.js").countryFacts(
  land.cells,
  land.per,
  require("@rapideditor/country-coder"),
  population,
);
buildPage(path.join(__dirname, "unofficial"), "unofficial", {
  COUNTRY_FACTS: asScript(facts),
  COUNTRY_TAGS: asScript(tagsByCode),
});

// Distribution, at distribution/: how the locations of a map file are spread over countries and
// continents. No map, no Google: only country-coder, each place's name, continent and country
// (src/countries.js), and the owner's country names (country-tags.json).
const tagNames = Object.fromEntries(
  Object.entries(countryTags)
    .filter(([, entry]) => typeof entry.name === "string" && entry.name.trim())
    .map(([code, entry]) => [code, entry.name.trim()]),
);
buildPage(
  path.join(__dirname, "distribution"),
  "distribution",
  {
    PLACES: asScript(
      require("./countries.js").distributionFacts(require("@rapideditor/country-coder"), tagNames),
    ),
  },
  { map: false },
);
