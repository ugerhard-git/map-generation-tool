// Builds the two published pages from the files in src/: the Map Generation Tool (dist/index.html, from
// src/page.html, src/style.css and src/app.js) and Unofficial (dist/unofficial/index.html, from the same
// files in src/unofficial/). Each page's files get the shared parts from src/shared/ put in (see
// src/assemble.js). Then the placeholders in the page (such as /*APP_JS*/) are filled with the styles, the
// app code, the data, Leaflet, country-coder, the land map, the font and the icon, and the scripts are
// fingerprinted for the Content Security Policy. The Google key comes from the GOOGLE_API_KEY environment
// variable; index.nokey.html next to each page is the same page without it, for the tests. Run with
// `npm run build`.
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

// ---------- each page ----------

// Builds one page from the page.html, style.css and app.js in folder `dir` into dist/<out>/, with the
// data placeholders in `data` (name: script text) on top of what every page gets.
function buildPage(dir, out, data) {
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
  put("/*LAND*/", JSON.stringify({ per: land.per, runs: land.runs }));
  put("/*LEAFLET_JS*/", leafletJs);
  put("/*COUNTRY_CODER_JS*/", countryCoderJs);
  put("/*LEAFLET_CSS*/", leafletCss);
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
    `script-src ${hashes.join(" ")} ${google}`,
    "style-src 'unsafe-inline'",
    "img-src https://tile.openstreetmap.org data:",
    "font-src data:",
    // Only Google's Street View service for now. A feature that needs another service (an Overpass
    // server, say) adds its host here, in the same pull request.
    "connect-src https://maps.googleapis.com",
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
    key ? "site key included" : "no site key (visitors enter their own)",
  );
}

// The Map Generation Tool, at the site's main address. Its country distributions and continents come
// from Vali, made by tools/vali.js.
const vali = JSON.parse(fs.readFileSync(path.join(__dirname, "data/vali.json"), "utf8"));
buildPage(__dirname, "", {
  VALI: asScript({ source: vali.source, maps: vali.maps, continents: vali.continents }),
  COUNTRY_TAGS: asScript(tagsByCode),
});

// Unofficial, at unofficial/: every country and territory, with its land area, continent and parent
// country, worked out from country-coder and the land map (src/countries.js).
const facts = require("./countries.js").countryFacts(
  land.cells,
  land.per,
  require("@rapideditor/country-coder"),
);
buildPage(path.join(__dirname, "unofficial"), "unofficial", {
  COUNTRY_FACTS: asScript(facts),
  COUNTRY_TAGS: asScript(tagsByCode),
});
