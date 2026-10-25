"use strict";
/*
 * Map Generation Tool: the app code.
 *
 * The tool builds map-making.app maps of random official Google Street View locations that match what
 * the visitor chooses: no road name shown, the end of the coverage (one arrow), photos from certain years.
 * Everything runs in the visitor's browser; there is no server of our own. The build (src/build.js) puts
 * this file, the styles, the markup and the Vali data (VALI, from src/data/vali.json) into one page. The
 * plan for the next steps is in docs/plan.md.
 *
 * Much of this file is copied from Lookout (github.com/ugerhard-git/osm-tool), whose src/app.js is the
 * place to look for more shared parts. Copy a part over when a feature here needs it, not ahead of time.
 *
 * HOW A SEARCH RUNS (see startSearch)
 *   1. Step 1 sets where: chosen countries, a continent or the whole world, and with more than one
 *      country, which of Vali's maps decides their shares (areaWeights). splitTotal() turns the shares
 *      and the number from step 3 into a number of locations per country (`searchTargets`), shown in the
 *      table of locations per country (renderShares). Step 2 sets what each location must have (`wanted`:
 *      no road name, end of coverage, photo years), step 3 how many and how far to look around each spot.
 *   2. PARALLEL workers (runSearch) repeat attempt() until every country has its number or has given
 *      up, or the visitor stops:
 *      pickCountry() chooses a country that still needs locations, randomPointIn() a random spot inside
 *      it (from the country borders built into the page), lookup() asks Google's script for the nearest
 *      official panorama within the radius. The panorama's arrows (`links`) tell whether a road name is
 *      shown and whether the coverage ends; its date tells the year of the photos.
 *   3. A panorama that matches, lies in that country and is at least MIN_SPACING from every location so
 *      far becomes a Location: counted for its country (`foundBy`), drawn on the map (drawLocation, the
 *      first MAX_DRAWN only) and exported (exportJson). paint() keeps the status line, progress, counters
 *      and the table up to date.
 *   4. A country gives up after giveUpAfter() random spots in a row without a new location (miss). If
 *      countries fell short, showShortfall() offers to fill the gap from the finished countries (fillGap,
 *      which searches on with the same results) or to keep what was found.
 *
 * MAIN SHARED STATE
 *   chosenCountries  the countries chosen in step 1 (codes), used when the area is "countries"
 *   results          the Locations found so far
 *   searchTargets    for the current or last search: locations wanted per country; foundBy: found so
 *                    far; noSpots: countries where no random spots could be made; gaveUp: countries
 *                    that used up their tries; missesInRow: each country's spots in a row without a find
 *   searchSettings   what the current search looks for, kept for going on after "Fill the gap"
 *   stats            counters for the current search (see emptyStats)
 *   running          true while a search runs; stopRequested asks the workers to finish
 *
 * SAVED IN THE BROWSER (localStorage, each name starts with "mapgen.", see `store`)
 *   scope ("countries", "continent" or "world"), countries (codes; the older single "country" is moved
 *   over on load), continent, distribution, noRoadName, deadEnd, yearsOn, yearFrom, yearTo, noBadCamera, useOlder, target,
 *   radius, giveUpAfter, mapName, tagCountry, tagNoRoadName, tagDeadEnd, tagYear (which tags the export
 *   gets; the older single tagFeatures is moved over to both on load), openSections (the open "More options" sections), welcomed (first-visit
 *   dialog seen), history (the last 20 searches' settings, see "history of searches"; never the key) and
 *   historyOn (whether that history is kept).
 *   An unfinished search (settings, locations, progress) is kept in IndexedDB, see "unfinished search".
 *   A visitor's own Google key is only kept in sessionStorage ("mapgen.key"), never on disk.
 *   Saved values can be edited by anyone, so everything read back is checked first.
 *
 * GROUND RULES
 *   - The page's security policy only runs scripts it knows, so events are wired up here in code;
 *     onclick="…" in the HTML would not run.
 *   - Text from outside (Google, saved values) is put on the page with textContent, or passed through
 *     esc() before it goes into innerHTML.
 *   - The sections below follow the page from top to bottom: data, helpers, random spots, step 1, step 2,
 *     step 3, more options and help, locations per country, map, Google Street View, run, time left, shortfalls, export, history of searches,
 *     settings file, unfinished search, dialogs. src/page.html and
 *     src/style.css use the same section names.
 */

/**
 * A Street View spot that made it into the results.
 * @typedef {object} Location
 * @property {number} lat
 * @property {number} lng
 * @property {number} heading    compass direction the camera faces, 0–360
 * @property {string} panoId     Google's panorama id
 * @property {string} date       photo date "YYYY-MM" or "YYYY", or ""
 * @property {string} cc         two-letter country code
 * @property {boolean} noRoadName no road name shown on the arrows
 * @property {boolean} deadEnd   only one arrow: the coverage ends here
 */
/**
 * One arrow of a panorama: the direction to a neighbouring panorama and the road name shown on it.
 * @typedef {object} Arrow
 * @property {number} heading    compass direction, 0–360
 * @property {string} description the road name on the arrow, or "" when none is shown
 * @property {string} pano       the id of the panorama the arrow leads to, or "" if Google did not say
 */
/**
 * Google's answer for one lookup, cleaned by cleanPano().
 * @typedef {object} PanoAnswer
 * @property {string} status     "OK", "ZERO_RESULTS", "UNKNOWN_ERROR", "NETWORK", "MALFORMED", …
 * @property {number} [lat]
 * @property {number} [lng]
 * @property {string} [panoId]
 * @property {string} [copyright] "© 2024 Google" for official coverage, else the uploader's name
 * @property {string} [date]
 * @property {Arrow[]} [links]
 * @property {number} [height]   the full image's height in pixels (8192 now, 6656 for older cameras and the
 *                               bad camera), or 0 when Google did not say
 * @property {{pano: string, date: string}[]} [older] the other photos at the same spot, newest first
 * @property {string} [detail]   what was wrong with the answer, if anything
 */

/* ---------- data ---------- */
const CONFIG = (() => {
  try {
    const c = JSON.parse(document.getElementById("app-config").textContent);
    return c && typeof c === "object" ? c : {};
  } catch {
    console.warn("Map Generation Tool: the settings block is not valid JSON, using defaults.");
    return {};
  }
})();
const GOOGLE_API_KEY =
  typeof CONFIG.googleApiKey === "string" && /^[A-Za-z0-9_-]{20,80}$/.test(CONFIG.googleApiKey.trim())
    ? CONFIG.googleApiKey.trim()
    : "";
/* Countries and territories with official Street View along roads: Lookout's list, plus Lebanon (LB),
   added at the owner's request (October 2026). All of them are in Vali's map distributions. */
const COVERAGE = (
  "AD AE AL AR AS AT AU AX BA BD BE BG BM BO BR BT BW CA CC CH CL CO CR CW CX CY CZ DE DK DO EC EE ES FI FO FR " +
  "GB GE GH GI GL GR GT GU HK HR HU ID IE IL IM IN IS IT JE JO JP KE KG KH KR KZ LA LB LI LK LS LT LU LV MC ME MK " +
  "MN MO MP MT MX MY NA NG NL NO NP NZ OM PA PE PH PL PR PS PT PY QA RE RO RS RU RW SE SG SI SK SM SN ST SZ TH " +
  "TN TR TW UA UG US UY VI VN XK ZA"
).split(" ");
const TARGET_MAX = 130000; // most locations one search may ask for
const TARGET_DEFAULT = 100;
const RADIUS_MIN = 50,
  RADIUS_MAX = 10000,
  RADIUS_DEFAULT = 1000; // metres around a random spot to look for a panorama
const MIN_SPACING = 100; // metres between any two locations, so there are no near-duplicates
const PARALLEL = 6; // lookups running at the same time
const ERROR_LIMIT = 20; // failed lookups in a row (not "nothing found") before the search gives up
const ERROR_WAIT = 3000; // ms to wait after a failed lookup, before trying again
// Locations drawn on the map. Every dot is redrawn when the map moves: measured in October 2026, 20,000
// dots keep zooming and panning smooth even on a slow computer; 50,000 make each zoom wait about half a
// second to a second. The map file always has every location. The welcome dialog states the number.
const MAX_DRAWN = 20000;
/* The bad camera ("badcam"): low-quality photos, 6656 pixels high. Older cameras made images of that
   height too, so as in Vali (github.com/slashP/Vali), only photos from BAD_CAMERA_FROM on count as bad
   camera, and only outside BAD_CAMERA_KEPT, where it is much of the coverage (Vali's India, Nepal and
   Nigeria, plus Lebanon and São Tomé and Príncipe, chosen by the owner). Current photos are 8192 high. */
const BAD_CAMERA_HEIGHT = 6656,
  BAD_CAMERA_FROM = 2020;
const BAD_CAMERA_KEPT = ["IN", "NP", "NG", "LB", "ST"];
const GIVE_UP_MIN = 50,
  GIVE_UP_MAX = 100000,
  GIVE_UP_DEFAULT = 2000; // random spots in a row without a new location before a country gives up

/* ---------- helpers ---------- */
/* The page element with this id. */
const $ = id => document.getElementById(id);
/* A number with thousands separators: 12345 -> "12,345". */
const fmt = n => n.toLocaleString("en");
const sleep = ms => new Promise(r => setTimeout(r, ms));
/* Settings saved in this browser, under "mapgen.<name>". get() returns the default d when nothing
   is saved or storage is blocked (private windows); set() quietly does nothing then. */
const store = {
  get(k, d) {
    try {
      const v = localStorage.getItem("mapgen." + k);
      return v === null ? d : JSON.parse(v);
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem("mapgen." + k, JSON.stringify(v));
    } catch {}
  },
  remove(k) {
    try {
      localStorage.removeItem("mapgen." + k);
    } catch {}
  },
};
/* A visitor's own API key is kept for this browser tab only, never written to disk. */
const keyStore = {
  get() {
    try {
      return sessionStorage.getItem("mapgen.key") || "";
    } catch {
      return "";
    }
  },
  set(v) {
    try {
      sessionStorage.setItem("mapgen.key", v);
    } catch {}
  },
};
let regionNames;
try {
  regionNames = new Intl.DisplayNames(["en"], { type: "region" });
} catch {}
/* English name of a country code, or the code itself when the browser does not know it. */
const countryName = c => {
  try {
    const n = regionNames && regionNames.of(c);
    return n && n !== c ? n : c;
  } catch {
    return c;
  }
};
/* The country or territory at a position, from the country-coder library built into the page (offline,
   with simplified borders). Territory level, so Réunion is RE rather than France. Returns undefined at
   sea far from land, or if the library is missing. */
function countryAt(lat, lng) {
  try {
    const c = window.countryCoder?.iso1A2Code([lng, lat], { level: "territory" });
    return typeof c === "string" && /^[A-Z]{2}$/.test(c) ? c : undefined;
  } catch {
    return undefined;
  }
}
const toRadians = d => (d * Math.PI) / 180;
const toDegrees = r => (r * 180) / Math.PI;
/* Distance in metres between two points on the earth (haversine formula, mean earth radius). */
function distance(aLat, aLng, bLat, bLng) {
  const dLat = toRadians(bLat - aLat),
    dLng = toRadians(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(aLat)) * Math.cos(toRadians(bLat)) * Math.sin(dLng / 2) ** 2;
  return 6371008.8 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}
/* Makes text safe to put inside HTML: & < > " ' ` become entities. */
const esc = s =>
  String(s).replace(
    /[&<>"'`]/g,
    c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "`": "&#96;" })[c],
  );
/* A string from outside, cut to max characters; anything that is not a string becomes "". */
const cleanText = (v, max = 200) => (typeof v === "string" ? v.slice(0, max) : "");
/* True for a real number between lo and hi. */
const inRange = (n, lo, hi) => typeof n === "number" && Number.isFinite(n) && n >= lo && n <= hi;
/* A whole number from a form field, or d when it is empty or outside lo–hi. */
function wholeNumber(value, lo, hi, d) {
  const n = Math.round(Number(value));
  return inRange(n, lo, hi) ? n : d;
}
/* A name made safe for a file name: "Malta: Dead ends" -> "malta-dead-ends" ("map" if nothing is left). */
const fileBase = name =>
  foldAccents(name)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "map";
/* Lower case without accents, for file names: "Château" -> "chateau". */
const foldAccents = s => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
/* A new element with properties and children: makeElement("b", {}, "text"). Copied from Lookout. */
const makeElement = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  n.append(...kids);
  return n;
};

/* ---------- random spots inside a country ---------- */
// The borders come from country-coder (the same library as countryAt). A country can have many parts
// (islands, overseas territories): a part is chosen with a chance that matches its area, then a spot in
// that part, then countryAt() confirms it, since an overseas part of France may count as another
// territory (Réunion is RE). Spots are spread evenly over the earth's surface, not over the flat map.
// The borders reach far out to sea, so only spots on land are kept (isLand, from the land map built into
// the page, see src/land.js): without that, most spots in New Zealand, Japan or Malta landed in the water.

/**
 * One piece of land of a country, ready for picking spots in it.
 * @typedef {object} BorderPart
 * @property {number[][][]} rings  outer ring first, then holes; points are [lng, lat]
 * @property {number} south
 * @property {number} north
 * @property {number} west
 * @property {number} east
 * @property {number} area         rough size, only compared with the other parts
 */
const borderCache = new Map();
/* The parts of a country's borders, largest first, or [] when the borders are not known. */
function borderParts(code) {
  if (borderCache.has(code)) return borderCache.get(code);
  let parts;
  try {
    const g = window.countryCoder?.aggregateFeature(code)?.geometry;
    const polygons = !g
      ? []
      : g.type === "Polygon"
        ? [g.coordinates]
        : g.type === "MultiPolygon"
          ? g.coordinates
          : [];
    parts = polygons
      .filter(rings => Array.isArray(rings) && rings[0]?.length > 3)
      .map(rings => {
        const lngs = rings[0].map(p => p[0]),
          lats = rings[0].map(p => p[1]);
        const south = Math.min(...lats),
          north = Math.max(...lats);
        // Shoelace formula on the flat map, corrected for the narrowing of degrees of longitude.
        let flat = 0;
        for (let i = 0, ring = rings[0]; i < ring.length - 1; i++)
          flat += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
        const area = (Math.abs(flat) / 2) * Math.cos(toRadians((south + north) / 2));
        return { rings, south, north, west: Math.min(...lngs), east: Math.max(...lngs), area };
      })
      .filter(p => p.area > 0)
      .sort((a, b) => b.area - a.area);
  } catch {
    parts = [];
  }
  borderCache.set(code, parts);
  return parts;
}
/* The land map (LAND, see src/land.js) as one byte per cell, 1 for land; decoded when first needed.
   Null if it is missing or broken: then spots are not checked for land. */
let landCells;
function landGrid() {
  if (landCells !== undefined) return landCells;
  landCells = null;
  try {
    const per = LAND.per,
      width = 360 * per,
      height = 180 * per;
    if (!Number.isInteger(per) || per < 1 || per > 100) return null;
    const bytes = Uint8Array.from(atob(LAND.runs), c => c.charCodeAt(0));
    const cells = new Uint8Array(width * height);
    let at = 0;
    const next = () => {
      let n = 0,
        shift = 0,
        b;
      do {
        if (at >= bytes.length) throw new Error("the land map ends early");
        b = bytes[at++];
        n += (b & 127) * 2 ** shift;
        shift += 7;
      } while (b & 128);
      return n;
    };
    for (let row = 0; row < height; row++)
      for (let col = 0, land = 0; col < width; land ^= 1) {
        const run = next();
        if (col + run > width) throw new Error("a row of the land map is too long");
        if (land) cells.fill(1, row * width + col, row * width + col + run);
        col += run;
      }
    landCells = { per, width, height, cells };
  } catch {
    landCells = null;
  }
  return landCells;
}
/* True if there is land at the point, or within the same cell of about 5 km (also true without a land
   map). */
function isLand(lat, lng) {
  const g = landGrid();
  if (!g) return true;
  const row = Math.min(g.height - 1, Math.max(0, Math.floor((90 - lat) * g.per)));
  const col = Math.min(g.width - 1, Math.max(0, Math.floor((lng + 180) * g.per)));
  return g.cells[row * g.width + col] === 1;
}
/* True if the point lies inside a ring of [lng, lat] points (ray casting). */
function insideRing(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i],
      [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
/* A random spot on land inside the country, or null if none was found (borders missing, say).
   Checking for land comes first, as it is the quickest check: some territories are over 99% sea
   (American Samoa, the Northern Mariana Islands), so it can take hundreds of tries to find land. A country
   whose land the land map does not show (none as of October 2026) is searched without the land check. */
const SPOT_TRIES = 20000;
const seaOnly = new Set(); // countries where no land was found, searched without the land check
function randomPointIn(code) {
  const parts = borderParts(code);
  if (!parts.length) return null;
  if (!seaOnly.has(code)) {
    const p = pickSpot(code, parts, true);
    if (p) return p;
    seaOnly.add(code);
  }
  return pickSpot(code, parts, false);
}
/* One try after another at a random spot in the parts of a country; null after SPOT_TRIES. */
function pickSpot(code, parts, landOnly) {
  const total = parts.reduce((n, p) => n + p.area, 0);
  for (let tries = 0; tries < SPOT_TRIES; tries++) {
    let pick = Math.random() * total,
      part = parts[0];
    for (const p of parts) {
      part = p;
      if ((pick -= p.area) <= 0) break;
    }
    // Picking sin(latitude) evenly spreads the spots evenly by area, also far from the equator.
    const s = Math.sin(toRadians(part.south)),
      n = Math.sin(toRadians(part.north));
    const lat = toDegrees(Math.asin(s + Math.random() * (n - s)));
    const lng = part.west + Math.random() * (part.east - part.west);
    if (landOnly && !isLand(lat, lng)) continue;
    if (!insideRing(lng, lat, part.rings[0])) continue;
    if (part.rings.slice(1).some(hole => insideRing(lng, lat, hole))) continue;
    if (countryAt(lat, lng) === code) return { lat, lng };
  }
  return null;
}

/* ---------- step 1: where ----------
   Three ways to say where: chosen countries, a continent, or the whole world. Countries are added as
   chips through a field that suggests countries while typing (the same pattern as Lookout's kind
   picker). With more than one country, one of Vali's maps says how the locations are shared between
   them; see "locations per country". */
/** @type {{code: string, name: string, folded: string}[]} the countries offered, sorted by name */
const COUNTRY_CHOICES = COVERAGE.map(code => {
  const name = countryName(code);
  return { code, name, folded: foldAccents(name) };
}).sort((a, b) => a.name.localeCompare(b.name));
const DEFAULT_MAP = "aaw"; // An Arbitrary World, chosen by the owner
const DEFAULT_CONTINENT = "europe";
/** @type {string[]} codes of the chosen countries, in the order they were added */
let chosenCountries = [],
  countryMatches = [],
  countryActive = -1;
const countryEl = $("country"),
  countryListEl = $("countryList");
/* Where to search: "countries", "continent" or "world". */
const scope = () => document.querySelector("input[name=scope]:checked")?.value || "countries";
/* The countries matching typed text, leaving out those already chosen: the country with that two-letter
   code ("de": Germany) first, then names starting with it, names with a word starting with it, names
   containing it. All for empty text. */
function matchCountries(text) {
  const q = foldAccents(text.trim());
  const open = COUNTRY_CHOICES.filter(c => !chosenCountries.includes(c.code));
  if (!q) return open;
  const byCode = [],
    starts = [],
    wordStarts = [],
    contains = [];
  for (const c of open) {
    if (c.code.toLowerCase() === q) byCode.push(c);
    else if (c.folded.startsWith(q)) starts.push(c);
    else if (c.folded.split(/[\s\-–(]+/).some(w => w.startsWith(q))) wordStarts.push(c);
    else if (c.folded.includes(q)) contains.push(c);
  }
  return [...byCode, ...starts, ...wordStarts, ...contains];
}
/* Shows the list of matching countries under the field. */
function showCountryList() {
  countryMatches = matchCountries(countryEl.value);
  countryListEl.textContent = "";
  if (!countryMatches.length) {
    const li = document.createElement("li");
    li.className = "none";
    li.setAttribute("role", "presentation");
    li.textContent = "No country with official Street View matches";
    countryListEl.append(li);
  }
  countryMatches.forEach((c, i) => {
    const li = document.createElement("li");
    li.id = "country" + i;
    li.dataset.i = i;
    li.setAttribute("role", "option");
    li.setAttribute("aria-selected", "false");
    li.textContent = c.name;
    countryListEl.append(li);
  });
  countryListEl.hidden = false;
  countryEl.setAttribute("aria-expanded", "true");
  setCountryActive(countryMatches.length ? 0 : -1);
}
function setCountryActive(i) {
  countryActive = i;
  countryListEl
    .querySelectorAll("li[role=option]")
    .forEach(li => li.setAttribute("aria-selected", +li.dataset.i === i ? "true" : "false"));
  if (i >= 0) {
    countryEl.setAttribute("aria-activedescendant", "country" + i);
    $("country" + i)?.scrollIntoView({ block: "nearest" });
  } else countryEl.removeAttribute("aria-activedescendant");
}
function closeCountryList() {
  countryListEl.hidden = true;
  countryEl.setAttribute("aria-expanded", "false");
  countryEl.removeAttribute("aria-activedescendant");
  countryActive = -1;
}
/* Adds a country to the chosen ones and empties the field for the next one. */
function addCountry(code) {
  if (COVERAGE.includes(code) && !chosenCountries.includes(code)) chosenCountries.push(code);
  countryEl.value = "";
  closeCountryList();
  whereChanged();
}
function removeCountry(code) {
  chosenCountries = chosenCountries.filter(c => c !== code);
  whereChanged();
  countryEl.focus();
}
/* Draws the chosen countries as chips; a click on one removes it. */
function renderCountryChips() {
  const chips = $("countryChips");
  chips.textContent = "";
  for (const code of chosenCountries) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip";
    b.textContent = countryName(code);
    b.setAttribute("aria-label", `Remove ${countryName(code)}`);
    b.onclick = () => removeCountry(code);
    chips.append(b);
  }
  chips.hidden = !chosenCountries.length;
  countryEl.placeholder = chosenCountries.length ? "Add another country" : "Start typing, for example Malta";
}
countryEl.addEventListener("input", showCountryList);
countryEl.addEventListener("focus", showCountryList);
countryEl.addEventListener("keydown", e => {
  // Backspace in the empty field removes the last chosen country.
  if (e.key === "Backspace" && !countryEl.value && chosenCountries.length) {
    chosenCountries.pop();
    whereChanged();
    return;
  }
  if (countryListEl.hidden) {
    if (e.key === "ArrowDown") showCountryList();
    return;
  }
  if (e.key === "ArrowDown") {
    e.preventDefault();
    setCountryActive(Math.min(countryMatches.length - 1, countryActive + 1));
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    setCountryActive(Math.max(0, countryActive - 1));
  } else if (e.key === "Enter") {
    // Pick the highlighted country instead of starting the search.
    e.preventDefault();
    if (countryActive >= 0) addCountry(countryMatches[countryActive].code);
  } else if (e.key === "Escape") {
    countryEl.value = "";
    closeCountryList();
  }
});
countryListEl.addEventListener("mousedown", e => {
  const li = e.target.closest("li[role=option]");
  if (li) {
    e.preventDefault(); // keep the focus in the field
    addCountry(countryMatches[+li.dataset.i].code);
  }
});
// Leaving the field: text that matches exactly one country (or a country's whole name) adds it;
// anything else is cleared.
countryEl.addEventListener("blur", () =>
  setTimeout(() => {
    if (countryListEl.hidden) return;
    const typed = countryEl.value.trim();
    const matches = matchCountries(typed);
    const exact = matches.find(c => c.folded === foldAccents(typed));
    if (typed && (exact || matches.length === 1)) addCountry((exact || matches[0]).code);
    else {
      countryEl.value = "";
      closeCountryList();
    }
  }, 120),
);

/* The continents, from Vali, and the maps whose share of countries can be used. */
for (const [code, c] of Object.entries(VALI.continents)) {
  const o = document.createElement("option");
  o.value = code;
  o.textContent = c.name;
  $("continent").append(o);
}
/* Fills the "Share the locations like" list for the chosen area: for a continent, Vali's own
   distribution of that continent first; then the maps. Switching to a continent chooses Vali's map of
   it; switching away from it chooses An Arbitrary World; otherwise the choice is kept. */
let lastScope = "";
function renderDistributionChoices() {
  const el = $("distribution"),
    s = scope();
  let before = el.value || store.get("distribution", "");
  if (lastScope && s !== lastScope)
    before = s === "continent" ? "continent" : before === "continent" ? DEFAULT_MAP : before;
  lastScope = s;
  el.textContent = "";
  if (scope() === "continent") {
    const o = document.createElement("option");
    o.value = "continent";
    o.textContent = `Vali's ${VALI.continents[$("continent").value]?.name || "continent"} map`;
    el.append(o);
  }
  for (const [code, m] of Object.entries(VALI.maps).sort((a, b) => a[1].name.localeCompare(b[1].name))) {
    const o = document.createElement("option");
    o.value = code;
    o.textContent = m.name;
    el.append(o);
  }
  const offered = [...el.options].map(o => o.value);
  el.value = offered.includes(before) ? before : scope() === "continent" ? "continent" : DEFAULT_MAP;
}
/* Shows the parts of step 1 that belong to the chosen area. */
function renderWhere() {
  const s = scope();
  $("countriesBox").hidden = s !== "countries";
  $("continentBox").hidden = s !== "continent";
  // A single country gets every location, so the distribution does not apply: greyed out, not hidden
  $("distribution").disabled = !distributionUsed();
  $("distributionNote").hidden = distributionUsed();
  renderCountryChips();
}
/* True when the locations are shared between countries, so the distribution matters. */
const distributionUsed = () => scope() !== "countries" || chosenCountries.length > 1;
/* The distribution chosen when nothing is changed: a continent's own map for a continent, else
   DEFAULT_MAP. */
const defaultDistribution = () => (scope() === "continent" ? "continent" : DEFAULT_MAP);
/* After any change in step 1: save it, and update what depends on it. The table of locations per
   country then shows the new plan instead of the last search. */
function whereChanged() {
  if (!running) {
    searchTargets = new Map();
    hideShortfall();
  }
  store.set("scope", scope());
  store.set("countries", chosenCountries);
  store.set("continent", $("continent").value);
  renderDistributionChoices();
  store.set("distribution", $("distribution").value);
  renderWhere();
  renderShares();
  updateMapName();
  updateMore(); // the distribution's summary depends on the area
}
for (const r of document.querySelectorAll("input[name=scope]")) r.onchange = whereChanged;
$("continent").onchange = whereChanged;
$("distribution").onchange = whereChanged;

/* The countries of the chosen area with their shares (relative numbers, not counts). Only countries
   with official coverage. A chosen country that the chosen map does not include gets 0. */
function areaWeights() {
  const s = scope(),
    dist = $("distribution").value;
  const mapWeights = VALI.maps[dist]?.weights || {};
  const official = code => COVERAGE.includes(code);
  if (s === "countries") {
    if (chosenCountries.length === 1) return { [chosenCountries[0]]: 1 };
    return Object.fromEntries(chosenCountries.filter(official).map(c => [c, mapWeights[c] || 0]));
  }
  if (s === "continent") {
    const members = VALI.continents[$("continent").value]?.weights || {};
    if (dist === "continent") return Object.fromEntries(Object.entries(members).filter(([c]) => official(c)));
    return Object.fromEntries(
      Object.keys(members)
        .filter(official)
        .map(c => [c, mapWeights[c] || 0]),
    );
  }
  return Object.fromEntries(Object.entries(mapWeights).filter(([c]) => official(c)));
}
/* Splits a total between countries in proportion to their shares, in whole numbers that add up to the
   total (largest remainder method: everyone gets the whole part of their exact share, and what is left
   goes one by one to the largest fractions). Only countries that get at least one are listed. */
function splitTotal(weights, total) {
  const entries = Object.entries(weights).filter(([, w]) => w > 0);
  const sum = entries.reduce((n, [, w]) => n + w, 0);
  if (!sum) return {};
  const parts = entries.map(([code, w]) => {
    const exact = (total * w) / sum;
    return { code, w, n: Math.floor(exact), rest: exact - Math.floor(exact) };
  });
  const left = total - parts.reduce((n, p) => n + p.n, 0);
  parts.sort((a, b) => b.rest - a.rest || b.w - a.w || a.code.localeCompare(b.code));
  for (let i = 0; i < left; i++) parts[i].n++;
  return Object.fromEntries(parts.filter(p => p.n > 0).map(p => [p.code, p.n]));
}
/* The area in words, for the map name: "Malta", "Germany, France", "5 countries", "Europe", "World". */
function areaLabel() {
  const s = scope();
  if (s === "world") return "World";
  if (s === "continent") return VALI.continents[$("continent").value]?.name || "Continent";
  if (chosenCountries.length <= 3) return chosenCountries.map(countryName).join(", ");
  return `${chosenCountries.length} countries`;
}
/* The chosen distribution in words, or "" when it does not matter (a single country, a continent's own). */
function distributionLabel() {
  if (!distributionUsed() || $("distribution").value === "continent") return "";
  return VALI.maps[$("distribution").value]?.name || "";
}
{
  // Saved settings. Before several countries could be chosen, one country was saved as "country";
  // it is moved over to "countries" once.
  const old = store.get("country", null);
  if (typeof old === "string" && store.get("countries", null) === null) store.set("countries", [old]);
  try {
    localStorage.removeItem("mapgen.country");
  } catch {}
  const saved = store.get("countries", []);
  chosenCountries = Array.isArray(saved)
    ? [...new Set(saved.filter(c => typeof c === "string" && COVERAGE.includes(c)))]
    : [];
  const savedScope = store.get("scope", "countries");
  const radio = document.querySelector(
    `input[name=scope][value="${["countries", "continent", "world"].includes(savedScope) ? savedScope : "countries"}"]`,
  );
  radio.checked = true;
  const savedContinent = store.get("continent", DEFAULT_CONTINENT);
  $("continent").value =
    typeof savedContinent === "string" && Object.hasOwn(VALI.continents, savedContinent)
      ? savedContinent
      : DEFAULT_CONTINENT;
  renderDistributionChoices();
  renderWhere();
}

/* ---------- step 2: what to look for ---------- */
// Years offered for the photos: from 2009 (as agreed with the owner) to this year.
const YEAR_FIRST = 2009,
  YEAR_LAST = Math.max(YEAR_FIRST, new Date().getFullYear());
for (const id of ["yearFrom", "yearTo"])
  for (let y = YEAR_FIRST; y <= YEAR_LAST; y++) {
    const o = document.createElement("option");
    o.value = o.textContent = String(y);
    $(id).append(o);
  }
/* The chosen years, earliest first, or null when the years are not ticked. */
function years() {
  if (!$("yearsOn").checked) return null;
  const a = wholeNumber($("yearFrom").value, YEAR_FIRST, YEAR_LAST, YEAR_FIRST),
    b = wholeNumber($("yearTo").value, YEAR_FIRST, YEAR_LAST, YEAR_LAST);
  return { from: Math.min(a, b), to: Math.max(a, b) };
}
/* What each location must have: { noRoadName, deadEnd, years: {from, to} | null }. */
const wanted = () => ({
  noRoadName: $("noRoadName").checked,
  deadEnd: $("deadEnd").checked,
  years: years(),
  noBadCamera: $("noBadCamera").checked,
});
for (const id of ["noRoadName", "deadEnd", "yearsOn", "noBadCamera"]) {
  $(id).checked = store.get(id, false) === true;
  $(id).onchange = () => {
    store.set(id, $(id).checked);
    updateYears();
    updateOlder();
    updateMapName();
  };
}
$("yearFrom").value = wholeNumber(store.get("yearFrom", YEAR_FIRST), YEAR_FIRST, YEAR_LAST, YEAR_FIRST);
$("yearTo").value = wholeNumber(store.get("yearTo", YEAR_LAST), YEAR_FIRST, YEAR_LAST, YEAR_LAST);
for (const id of ["yearFrom", "yearTo"])
  $(id).onchange = () => {
    store.set(id, +$(id).value);
    updateMapName();
  };
/* The year choices can only be changed while "Photos taken in certain years" is ticked. */
function updateYears() {
  $("yearFrom").disabled = $("yearTo").disabled = !$("yearsOn").checked;
}
updateYears();
// Removed options: following the road to the end of coverage (walkOn, walkSteps) made finding ends
// slower, not faster, so it was taken out. Their saved values are cleared.
for (const id of ["walkOn", "walkSteps"]) store.remove(id);
// Using an older photo instead of bad camera: only with "No bad camera", and on unless switched off.
$("useOlder").checked = store.get("useOlder", true) !== false;
$("useOlder").onchange = () => store.set("useOlder", $("useOlder").checked);
const useOlder = () => $("noBadCamera").checked && $("useOlder").checked;
/* The older-photo option can only be changed while "No bad camera" is ticked. */
function updateOlder() {
  $("useOlder").disabled = !$("noBadCamera").checked;
}
updateOlder();
/* True if a photo date ("2023-04" or "2023") lies within the chosen years. Unknown dates do not. */
function inYears(date, y) {
  const year = parseInt(date, 10);
  return Number.isFinite(year) && year >= y.from && year <= y.to;
}
/* Short description of what is searched for, for the map name: "No road name, end of coverage, 2010–2014". */
function wantedLabel(w) {
  const parts = [];
  if (w.noRoadName) parts.push("no road name");
  if (w.deadEnd) parts.push("end of coverage");
  if (w.years)
    parts.push(w.years.from === w.years.to ? String(w.years.from) : `${w.years.from}–${w.years.to}`);
  if (w.noBadCamera) parts.push("no bad camera");
  const text = parts.join(", ") || "official coverage";
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/* ---------- step 3: how many, map name and key ----------
   The number fields are plain text fields (with the number keypad on phones), not number fields:
   a number field reads "25.000", as written in Germany, as 25, and silently turns anything out of
   range into nothing. Here the visitor can write 25000, 25,000, 25.000, 25 000 or 25'000; a number
   out of range becomes the nearest one allowed, and the field then shows the number that will be used.
   The arrow keys still step the number. */
/* A whole number as typed, with any thousands separators; NaN if it is not one. */
function typedNumber(text) {
  const digits = String(text)
    .trim()
    .replace(/[\s.,'’_]/g, "");
  return /^\d{1,9}$/.test(digits) ? Number(digits) : NaN;
}
const NUMBER_FIELDS = {
  target: { lo: 1, hi: TARGET_MAX, d: TARGET_DEFAULT, step: 1 },
  radius: { lo: RADIUS_MIN, hi: RADIUS_MAX, d: RADIUS_DEFAULT, step: 50 },
  // how many random spots in a row may bring no new location before a country gives up
  giveUpAfter: { lo: GIVE_UP_MIN, hi: GIVE_UP_MAX, d: GIVE_UP_DEFAULT, step: 50 },
};
/* The number in a field, kept within its range; the saved one (or the default) if none is typed. */
function fieldNumber(id) {
  const f = NUMBER_FIELDS[id],
    n = typedNumber($(id).value);
  if (Number.isNaN(n)) return wholeNumber(store.get(id, f.d), f.lo, f.hi, f.d);
  return Math.min(f.hi, Math.max(f.lo, n));
}
/* Shows a number in its field as the page writes numbers: "25,000". */
const showNumber = (id, n) => ($(id).value = fmt(n));
const target = () => fieldNumber("target");
const radius = () => fieldNumber("radius");
const giveUpAfter = () => fieldNumber("giveUpAfter");
for (const [id, f] of Object.entries(NUMBER_FIELDS)) {
  showNumber(id, wholeNumber(store.get(id, f.d), f.lo, f.hi, f.d));
  // On leaving the field: keep the number and show it as it will be used
  $(id).onchange = () => {
    const n = fieldNumber(id);
    store.set(id, n);
    showNumber(id, n);
    if (id === "target") {
      if (!running) searchTargets = new Map();
      renderShares();
    }
  };
  // While typing: the table of locations per country follows the number
  if (id === "target")
    $(id).oninput = () => {
      if (running || Number.isNaN(typedNumber($(id).value))) return;
      searchTargets = new Map();
      renderShares();
    };
  // The arrow keys step the number, as in a number field
  $(id).onkeydown = e => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    const n = fieldNumber(id) + (e.key === "ArrowUp" ? f.step : -f.step);
    showNumber(id, Math.min(f.hi, Math.max(f.lo, n)));
    $(id).onchange();
  };
}
$("mapName").value = cleanText(store.get("mapName", ""), 100);
$("mapName").oninput = () => store.set("mapName", $("mapName").value.slice(0, 100));
/* The name suggested when the visitor types none: "Malta: No road name",
   "World (An Arbitrary World): End of coverage". */
function suggestedName() {
  const area = areaLabel(),
    dist = distributionLabel();
  return (area ? area + (dist ? ` (${dist})` : "") + ": " : "") + wantedLabel(wanted());
}
/* Shows the suggested name in the empty map name field. */
function updateMapName() {
  $("mapName").placeholder = suggestedName();
}
updateMapName();
/* The map name for the export: what the visitor typed, or the suggestion. */
const mapName = () => $("mapName").value.trim().slice(0, 100) || suggestedName();
/* Which tags the export gets. The country is ticked unless the visitor unticked it; the others are not. */
const TAG_OPTIONS = { tagCountry: true, tagNoRoadName: false, tagDeadEnd: false, tagYear: false };
// "No road name" and "Dead end" used to be one option, tagFeatures: its saved choice becomes both.
const oldFeatures = store.get("tagFeatures", null);
if (typeof oldFeatures === "boolean")
  for (const id of ["tagNoRoadName", "tagDeadEnd"])
    if (store.get(id, null) === null) store.set(id, oldFeatures);
store.remove("tagFeatures");
for (const [id, d] of Object.entries(TAG_OPTIONS)) {
  const saved = store.get(id, d);
  $(id).checked = typeof saved === "boolean" ? saved : d;
  $(id).onchange = () => store.set(id, $(id).checked);
}
/* The tags of a location for the export, from the ticked options: "Malta", "No road name", "2023". */
function tagsFor(l) {
  const tags = [];
  if ($("tagCountry").checked) tags.push(countryName(l.cc));
  if ($("tagNoRoadName").checked && l.noRoadName) tags.push("No road name");
  if ($("tagDeadEnd").checked && l.deadEnd) tags.push("Dead end");
  if ($("tagYear").checked && l.date) tags.push(l.date.slice(0, 4));
  return tags;
}
// The key field is only shown when the site has no key of its own.
$("keyBox").hidden = !!GOOGLE_API_KEY;
$("apiKey").value = keyStore.get();
$("apiKey").onchange = () => keyStore.set($("apiKey").value.trim());

/* ---------- more options and help ----------
   The first screen shows only what most visitors need (CONTRIBUTING.md: "A simple interface"); every
   other setting is in a closed "More options" section for its topic (<details class="more">). A closed
   section shows a one-line summary of what is set and marks it "changed" when it differs from the
   defaults; "Reset to defaults" puts them back. Which sections are open is saved ("openSections").
   Longer explanations are in help dialogs: a "?" button (data-help="x") opens the text in
   <template id="help-x"> of page.html. */
/** @type {Record<string, {summary: () => string, changed: () => boolean, reset: () => void}>} */
const MORE = {
  moreDistribution: {
    summary: () =>
      distributionUsed()
        ? $("distribution").selectedOptions[0]?.textContent || ""
        : "Only used with several countries",
    changed: () => $("distribution").value !== defaultDistribution(),
    reset: () => setControl("distribution", defaultDistribution()),
  },
  morePhotos: {
    summary: () => {
      const bits = [years() ? `${years().from} to ${years().to}` : "Any year"];
      if ($("noBadCamera").checked)
        bits.push($("useOlder").checked ? "no bad camera, older photos instead" : "no bad camera");
      return bits.join(", ");
    },
    changed: () =>
      $("yearsOn").checked ||
      +$("yearFrom").value !== YEAR_FIRST ||
      +$("yearTo").value !== YEAR_LAST ||
      $("noBadCamera").checked ||
      !$("useOlder").checked,
    reset: () => {
      setControl("yearFrom", String(YEAR_FIRST));
      setControl("yearTo", String(YEAR_LAST));
      setControl("yearsOn", false);
      setControl("noBadCamera", false);
      setControl("useOlder", true);
    },
  },
  moreSearch: {
    summary: () => `${fmt(radius())} m around each spot, give up after ${fmt(giveUpAfter())} spots`,
    changed: () => radius() !== RADIUS_DEFAULT || giveUpAfter() !== GIVE_UP_DEFAULT,
    reset: () => {
      setControl("radius", fmt(RADIUS_DEFAULT));
      setControl("giveUpAfter", fmt(GIVE_UP_DEFAULT));
    },
  },
  moreMapFile: {
    summary: () => {
      const name = $("mapName").value.trim() ? `"${$("mapName").value.trim()}"` : "Suggested name";
      const tags = [
        ["tagCountry", "country"],
        ["tagNoRoadName", "no road name"],
        ["tagDeadEnd", "dead end"],
        ["tagYear", "year"],
      ]
        .filter(([id]) => $(id).checked)
        .map(([, word]) => word);
      return `${name}, ${tags.length ? "tags: " + tags.join(", ") : "no tags"}`;
    },
    changed: () =>
      $("mapName").value.trim() !== "" || Object.entries(TAG_OPTIONS).some(([id, d]) => $(id).checked !== d),
    reset: () => {
      setControl("mapName", "");
      for (const [id, d] of Object.entries(TAG_OPTIONS)) setControl(id, d);
    },
  },
};
/* Sets a control as if the visitor had changed it, so its own handlers save it and update the page. */
function setControl(id, value) {
  const el = $(id);
  if (el.type === "checkbox") el.checked = value;
  else el.value = value;
  el.dispatchEvent(new Event(el.tagName === "SELECT" || el.type === "checkbox" ? "change" : "input"));
  if (el.type === "text") el.dispatchEvent(new Event("change"));
}
/* Updates the summary line and the "changed" mark of every section. */
function updateMore() {
  for (const [id, m] of Object.entries(MORE)) {
    const sum = $("sum" + id.slice(4));
    sum.textContent = m.summary();
    const changed = m.changed();
    $(id).classList.toggle("changed", changed);
    let mark = $(id).querySelector(".more-changed");
    if (!mark) {
      mark = makeElement("span", { className: "more-changed" }, "changed");
      sum.before(mark);
    }
    mark.hidden = !changed;
  }
}
// Any change in the settings updates the summaries
$("fields").addEventListener("input", updateMore);
$("fields").addEventListener("change", updateMore);
for (const btn of document.querySelectorAll("[data-reset]"))
  btn.onclick = () => {
    MORE[btn.dataset.reset].reset();
    updateMore();
  };
// The sections the visitor opened stay open on the next visit
{
  const saved = store.get("openSections", []);
  for (const id of Array.isArray(saved) ? saved : []) if (Object.hasOwn(MORE, id)) $(id).open = true;
  for (const id of Object.keys(MORE))
    $(id).addEventListener("toggle", () =>
      store.set(
        "openSections",
        Object.keys(MORE).filter(k => $(k).open),
      ),
    );
}
updateMore();
// Help: a "?" button opens its text in the help dialog
for (const btn of document.querySelectorAll("button.help")) btn.onclick = () => openHelp(btn.dataset.help);
/* Opens the help dialog with the text of <template id="help-…">: its first heading is the title. */
function openHelp(topic) {
  const t = document.getElementById("help-" + topic);
  if (!(t instanceof HTMLTemplateElement)) return;
  const body = t.content.cloneNode(true);
  const title = body.querySelector("h2");
  $("helpTitle").textContent = title ? title.textContent : "Help";
  if (title) title.remove();
  $("helpBody").replaceChildren(body);
  openDialog("help");
}

/* ---------- locations per country ----------
   Before a search: how many locations each country of the area will get (splitTotal of areaWeights).
   During and after a search: also how many were found. Not shown for a single country. */
/* Draws the table under the steps. */
function renderShares() {
  const box = $("sharesBox"),
    rows = $("shares"),
    note = $("sharesNote");
  const searched = running || searchTargets.size > 0;
  const weights = searched ? null : areaWeights();
  const wantedBy = searched ? Object.fromEntries(searchTargets) : splitTotal(weights, target());
  const codes = Object.keys(wantedBy);
  box.hidden = scope() === "countries" && chosenCountries.length < 2 && !(searched && searchTargets.size > 1);
  if (box.hidden) return;
  const order = codes.sort(
    (a, b) => wantedBy[b] - wantedBy[a] || countryName(a).localeCompare(countryName(b)),
  );
  rows.textContent = "";
  let done = 0,
    short = 0;
  for (const code of order) {
    const tr = document.createElement("tr"),
      found = foundBy.get(code) || 0;
    const full = searched && found >= wantedBy[code] && !gaveUp.has(code);
    if (full) done++;
    let foundText = searched ? fmt(found) : "";
    if (full) tr.className = "done";
    else if (searched && noSpots.has(code)) {
      tr.className = "none";
      foundText = "no spots";
    } else if (searched && gaveUp.has(code)) {
      tr.className = "short";
      foundText = `${fmt(found)}, gave up`;
      short++;
    }
    for (const text of [countryName(code), fmt(wantedBy[code]), foundText]) {
      const td = document.createElement("td");
      td.textContent = text;
      tr.append(td);
    }
    rows.append(tr);
  }
  $("sharesSummary").textContent = searched
    ? `Locations per country: ${done} of ${codes.length} countries done${short ? `, ${short} gave up` : ""}`
    : `Locations per country: ${fmt(codes.length)} ${codes.length === 1 ? "country" : "countries"}`;
  // Before a search, say which countries get nothing, and why.
  let why = "";
  if (!searched) {
    const left = Object.keys(weights).filter(c => !wantedBy[c] || wantedBy[c] === 0);
    const notInMap = left.filter(c => !weights[c]),
      tooFew = left.filter(c => weights[c] > 0);
    if (!codes.length && notInMap.length)
      why = `None of these countries is in ${VALI.maps[$("distribution").value]?.name || "this map"}. Choose another map.`;
    else {
      if (notInMap.length)
        why += `Not in ${VALI.maps[$("distribution").value]?.name || "this map"}, so they get none: ${notInMap.map(countryName).join(", ")}. `;
      if (tooFew.length)
        why += `${fmt(tooFew.length)} more ${tooFew.length === 1 ? "country gets" : "countries get"} none: their share of ${fmt(target())} locations rounds down to 0.`;
    }
  }
  note.textContent = why.trim();
  note.hidden = !why;
}

/* ---------- map ---------- */
let map = null,
  layer = null;
function initMap() {
  if (FRAMED || map) return;
  // Canvas drawing keeps thousands of dots fast.
  map = L.map("map", { worldCopyJump: true, preferCanvas: true }).setView([25, 10], 2);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);
  layer = L.layerGroup().addTo(map);
}
window.addEventListener("load", initMap);
/* Zooms the map to the countries searched: to the largest part of each (France without its overseas
   parts, say), or to the whole world when that is wider than a hemisphere. */
function showArea(codes) {
  if (!map) return;
  const parts = codes.map(c => borderParts(c)[0]).filter(Boolean);
  if (!parts.length) return;
  const south = Math.min(...parts.map(p => p.south)),
    north = Math.max(...parts.map(p => p.north)),
    west = Math.min(...parts.map(p => p.west)),
    east = Math.max(...parts.map(p => p.east));
  if (east - west > 180) map.setView([25, 10], 2);
  else
    map.fitBounds(
      [
        [south, west],
        [north, east],
      ],
      { padding: [20, 20] },
    );
}
/* Street View at a location, facing its heading. */
const streetViewLink = l =>
  `https://www.google.com/maps/@?api=1&map_action=pano&pano=${encodeURIComponent(l.panoId)}&heading=${Math.round(l.heading)}`;
/* Draws a found location as a dot with a popup: country, what it has, photo date, Street View button. */
function drawLocation(l) {
  if (!map) return;
  const has = [l.noRoadName && "No road name", l.deadEnd && "End of coverage"].filter(Boolean).join(", ");
  L.circleMarker([l.lat, l.lng], {
    radius: 5,
    weight: 1.5,
    color: "#14213d",
    fillColor: "#f2a900",
    fillOpacity: 1,
  })
    .bindPopup(
      `<div class="pop"><b>${esc(countryName(l.cc))}</b>${has ? esc(has) + "<br />" : ""}${l.date ? "Photo from " + esc(l.date) : ""}<a class="sv" href="${esc(streetViewLink(l))}" target="_blank" rel="noopener">Open in Street View</a></div>`,
      { minWidth: 200 },
    )
    .addTo(layer);
}

/* ---------- Google Street View ---------- */
// Google's Maps JavaScript API: unlike the free metadata web service, it can search official coverage
// only, and it returns a panorama's arrows with their road names. Copied from Lookout and extended.
let googleScript = null,
  keyRefused = false;
/* Loads Google's Maps JavaScript API once and resolves to its StreetViewService. Fails ("denied" or
   "unreachable") if the key is refused or nothing usable loads within 12 seconds. Google may also
   refuse the key later, on the first lookup: gm_authFailure then sets keyRefused. */
function loadGoogleScript(key) {
  return (googleScript ??= new Promise((resolve, reject) => {
    const giveUp = setTimeout(() => reject(new Error("unreachable")), 12000); // loaded nothing usable
    window.gm_authFailure = () => {
      keyRefused = true;
      reject(new Error("denied"));
    };
    window.__mapgenReady = () =>
      google.maps.importLibrary("streetView").then(lib => {
        clearTimeout(giveUp);
        resolve(new lib.StreetViewService());
      }, reject);
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&loading=async&callback=__mapgenReady`;
    s.onerror = () => reject(new Error("unreachable"));
    document.head.append(s);
  }));
}
/* Keep only well-formed values from a Street View answer. */
function cleanPano(r) {
  const status = cleanText(r.status, 40) || "NO_STATUS";
  if (status !== "OK") return { status, detail: cleanText(r.detail, 300) };
  if (!inRange(r.lat, -90, 90) || !inRange(r.lng, -180, 180))
    return { status: "MALFORMED", detail: "the answer had no usable position" };
  if (typeof r.panoId !== "string" || !/^[^\s<>"'`\\]{4,300}$/.test(r.panoId))
    return {
      status: "MALFORMED",
      detail: `the panorama ID had an unexpected form (${cleanText(String(r.panoId), 40)})`,
    };
  if (!Array.isArray(r.links)) return { status: "MALFORMED", detail: "the answer had no arrows" };
  const links = r.links
    .filter(l => l && inRange(l.heading, -360, 720))
    .slice(0, 20)
    .map(l => ({
      heading: ((l.heading % 360) + 360) % 360,
      description: cleanText(l.description, 120).trim(),
      pano: typeof l.pano === "string" && /^[^\s<>"'`\\]{4,300}$/.test(l.pano) ? l.pano : "",
    }));
  const date = cleanText(r.date, 10);
  return {
    status,
    lat: r.lat,
    lng: r.lng,
    panoId: r.panoId,
    copyright: cleanText(r.copyright),
    date: /^\d{4}(-\d{2})?$/.test(date) ? date : "",
    links,
    // the full image's height in pixels, which tells the camera (see BAD_CAMERA_HEIGHT); 0 if not given
    height: inRange(r.height, 1, 100000) ? Math.round(r.height) : 0,
    older: olderPhotos(r.time, r.panoId),
  };
}
/* The other photos at the same spot, newest first: [{ pano, date: "YYYY-MM" }]. They come from the list
   Google's answers carry as `time`, which Google does not document (checked with the owner, October 2026),
   so it is read with care: an entry needs a panorama id and a date, and the date is found by its type,
   not by its name, which is a shortened name ("gD") that can change with any update of Google's script.
   Without the list, there are simply no other photos. */
function olderPhotos(time, current) {
  if (!Array.isArray(time)) return [];
  const out = [];
  for (const t of time.slice(0, 50)) {
    if (!t || typeof t !== "object") continue;
    const pano = t.pano;
    if (typeof pano !== "string" || pano === current || !/^[^\s<>"'`\\]{4,300}$/.test(pano)) continue;
    const when = Object.values(t).find(v => v instanceof Date && !isNaN(v));
    if (!when) continue;
    // Google gives the first day of the month, at midnight in the visitor's time zone, so the year and
    // month are read in local time.
    const date = `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, "0")}`;
    out.push({ pano, date });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}
/* Asks Google's script once; resolves to its raw answer and status, or status "NETWORK" after 15 s. */
function askGoogle(sv, request) {
  return new Promise(resolve => {
    const t = setTimeout(() => resolve({ status: "NETWORK" }), 15000); // never wait forever
    sv.getPanorama(request, (data, status) => {
      clearTimeout(t);
      resolve({ data, status: cleanText(status, 40) || "NO_STATUS" });
    });
  });
}
/* The nearest official outdoor panorama within radius metres of a point, with its arrows. @returns {Promise<PanoAnswer>} */
async function lookup(p, radius, key) {
  const sv = await loadGoogleScript(key);
  const near = await askGoogle(sv, {
    location: { lat: p.lat, lng: p.lng },
    radius,
    // Official Google coverage that is also outdoor coverage: without "outdoor", Google's own indoor
    // panoramas (a museum, say) could be found too. Several sources mean all of them must hold.
    sources: ["google", "outdoor"],
    preference: "nearest",
  });
  if (near.status !== "OK" || !near.data?.location) return { status: near.status };
  let d = near.data;
  // The arrows normally come with the answer; if not, ask for that panorama by its id.
  if (!Array.isArray(d.links) && typeof d.location.pano === "string") {
    const byId = await askGoogle(sv, { pano: d.location.pano });
    if (byId.status === "OK" && byId.data) d = byId.data;
  }
  return cleanPano({
    status: "OK",
    lat: d.location?.latLng?.lat(),
    lng: d.location?.latLng?.lng(),
    panoId: d.location?.pano,
    copyright: d.copyright,
    date: d.imageDate,
    height: d.tiles?.worldSize?.height,
    time: d.time,
    links: d.links,
  });
}
/* One panorama by its id, with its arrows; used for older photos at a spot. @returns {Promise<PanoAnswer>} */
async function lookupPano(panoId, key) {
  const sv = await loadGoogleScript(key);
  const a = await askGoogle(sv, { pano: panoId });
  if (a.status !== "OK" || !a.data?.location) return { status: a.status };
  const d = a.data;
  return cleanPano({
    status: "OK",
    lat: d.location.latLng?.lat(),
    lng: d.location.latLng?.lng(),
    panoId: d.location.pano,
    copyright: d.copyright,
    date: d.imageDate,
    height: d.tiles?.worldSize?.height,
    time: d.time,
    links: d.links,
  });
}
/* Official Google coverage says "© 2024 Google" (or "Google LLC"); photos from others name the uploader. */
const isOfficial = c =>
  c
    .replace(/[©\d\s]/g, "")
    .replace(/LLC|Inc\.?/gi, "")
    .replace(/[,.]/g, "") === "Google";
/* Whether a panorama in a country is bad camera: 6656 pixels high, photos from BAD_CAMERA_FROM on, and not
   in a country where bad camera is kept. Without a known height or year, it is not counted as bad camera. */
function isBadCamera(r, code) {
  const year = parseInt(r.date, 10);
  return (
    r.height === BAD_CAMERA_HEIGHT &&
    Number.isFinite(year) &&
    year >= BAD_CAMERA_FROM &&
    !BAD_CAMERA_KEPT.includes(code)
  );
}
/* What a panorama's arrows say: whether a road name is shown and whether the coverage ends here. */
function arrowFacts(links) {
  return {
    noRoadName: links.every(l => !l.description),
    deadEnd: links.length === 1,
  };
}

/* ---------- run ---------- */
/** @type {Location[]} */
let results = [],
  running = false,
  stopRequested = false;
/* For the current or last search: how many locations each country should get, how many it has, and the
   countries where no random spots could be made (their borders are missing from the page). */
let searchTargets = new Map(),
  foundBy = new Map(),
  noSpots = new Set();
/* Countries that used up their tries (see giveUpAfter), and each country's random spots in a row that
   brought no new location. */
let gaveUp = new Set(),
  missesInRow = new Map();
let stats = emptyStats();
/* Counters for one search. */
function emptyStats() {
  return {
    tries: 0, // random spots looked up
    empty: 0, // no official Street View within the radius
    notMatching: 0, // found, but without what was asked for
    tooClose: 0, // already found, or too close to a location found before
    outside: 0, // the panorama lies in a neighbouring country
    failed: 0, // lookups that failed (network, Google errors)
    badCamera: 0, // left out as bad camera
    olderLookups: 0, // older photos looked up instead of bad camera
    olderUsed: 0, // locations that are an older photo used instead of bad camera
    searchedMs: 0, // time spent searching in the runs that have ended (see searchedFor)
    failedInRow: 0,
  };
}
// Where the locations found so far are, in cells of about MIN_SPACING, so that the spacing check only
// compares a few neighbours instead of every location. Cells are MIN_SPACING tall; their width in
// degrees grows towards the poles, so they stay at least MIN_SPACING wide.
const CELL = MIN_SPACING / 111320; // degrees of latitude
let cells = new Map(),
  seenPanos = new Set();
const cellKey = (row, col) => row + "," + col;
const cellCol = (lat, lng) => Math.floor((lng * Math.max(0.01, Math.cos(toRadians(lat)))) / CELL);
/* True if a location at this point would be closer than MIN_SPACING to one found before. */
function tooClose(lat, lng) {
  const row = Math.floor(lat / CELL);
  for (let r = row - 1; r <= row + 1; r++) {
    const col = cellCol(r * CELL, lng);
    for (let c = col - 2; c <= col + 2; c++)
      for (const l of cells.get(cellKey(r, c)) || [])
        if (distance(lat, lng, l.lat, l.lng) < MIN_SPACING) return true;
  }
  return false;
}
function remember(l) {
  const row = Math.floor(l.lat / CELL),
    key = cellKey(row, cellCol(row * CELL, l.lng));
  if (!cells.has(key)) cells.set(key, []);
  cells.get(key).push(l);
  seenPanos.add(l.panoId);
}
/* Shows an error under the form, or hides it when text is empty. */
/* Shows a note under the form (not an error), or hides it when text is empty. */
function showNote(text) {
  $("note").textContent = text;
  $("note").hidden = !text;
}
function showError(text) {
  $("error").textContent = text;
  $("error").hidden = !text;
}
/* Keeps the status line, progress, counters and buttons up to date. */
function paint(status) {
  if (status) $("now").textContent = status;
  const goal = running || stats.tries ? currentTarget : 0;
  $("fill").style.width = goal ? Math.min(100, (100 * results.length) / goal).toFixed(1) + "%" : "0";
  $("count").textContent = fmt(results.length);
  for (const id of ["download", "copy", "clear"]) $(id).disabled = !results.length || running;
  const t = $("tally");
  t.textContent = "";
  if (!stats.tries) return;
  const add = (n, label) => {
    const s = document.createElement("span"),
      b = document.createElement("b");
    b.textContent = typeof n === "number" ? fmt(n) : n;
    s.append(b, " " + label);
    t.append(s);
  };
  add(clockTime(searchedFor()), "spent searching");
  add(stats.tries, "random spots tried");
  add(stats.empty, "without official Street View nearby");
  if (stats.notMatching) add(stats.notMatching, "not matching");
  if (stats.tooClose) add(stats.tooClose, "too close to another");
  if (stats.outside) add(stats.outside, "across the border");
  if (stats.failed) add(stats.failed, "failed lookups");
  if (stats.badCamera) add(stats.badCamera, "bad camera");
  if (stats.olderUsed) add(stats.olderUsed, "older photos used instead");
  if (results.length > MAX_DRAWN) add(MAX_DRAWN, "shown on the map");
  renderShares();
}
/* How long the search has been running, in ms: the runs that have ended (a search goes on after "Fill
   the gap" or when a saved one is continued), plus the one running now. Waiting for the visitor, between
   runs or with the tab closed, does not count. */
let runStartedAt = 0;
const searchedFor = () => stats.searchedMs + (running && runStartedAt ? Date.now() - runStartedAt : 0);
/* A time as a clock: "0:42", "12:05", "1:12:05" (hours go on past 24). */
function clockTime(ms) {
  const all = Math.floor(Math.max(0, ms) / 1000),
    h = Math.floor(all / 3600),
    m = Math.floor(all / 60) % 60,
    sec = String(all % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}
/* Locks or unlocks the form while a search runs. */
function setRunning(on) {
  running = on;
  $("fields").disabled = on;
  $("go").hidden = on;
  $("stop").hidden = !on;
  $("stop").disabled = false;
}
let currentTarget = 0,
  lastPaint = 0;
/* Paints at most a few times a second, so a fast search does not slow the page down. */
function paintSoon() {
  const now = Date.now();
  if (now - lastPaint < 250) return;
  lastPaint = now;
  paint(`Searching ${searchArea}: ${fmt(results.length)} of ${fmt(currentTarget)} found, ${timeLeftText()}`);
}
let searchArea = "",
  fatal = "";
/* The country for the next random spot: one that still needs locations, chosen with a chance in
   proportion to how many it still needs, so all countries fill up at about the same pace. Null when no
   country needs more. */
function pickCountry() {
  const needs = [];
  let total = 0;
  for (const [code, wanted] of searchTargets) {
    const need = wanted - (foundBy.get(code) || 0);
    if (need > 0 && !noSpots.has(code) && !gaveUp.has(code)) {
      needs.push([code, need]);
      total += need;
    }
  }
  let pick = Math.random() * total;
  for (const [code, need] of needs) if ((pick -= need) < 0) return code;
  return needs.length ? needs[needs.length - 1][0] : null;
}
/* Counts a random spot that brought no new location for a country; after giveUpAfter() of them in a
   row, the country gives up. Failed lookups do not count: they say nothing about the country. */
function miss(code) {
  const n = (missesInRow.get(code) || 0) + 1;
  missesInRow.set(code, n);
  // (a country that is already full, through another worker's lookup, does not give up)
  if (n >= searchSettings.giveUpAfter && (foundBy.get(code) || 0) < searchTargets.get(code)) gaveUp.add(code);
}
/* An older photo at the same spot that is not bad camera, for a panorama that is: the newest of up to
   OLDER_TRIES other photos that Google confirms as official and not bad camera. One lookup each.
   @returns {Promise<PanoAnswer|null>} */
const OLDER_TRIES = 3;
async function olderPhoto(r, code, key) {
  for (const o of r.older.slice(0, OLDER_TRIES)) {
    if (stopRequested || fatal) return null;
    stats.olderLookups++;
    const a = await lookupPano(o.pano, key);
    if (a.status === "OK" && isOfficial(a.copyright) && !isBadCamera(a, code)) return a;
  }
  return null;
}
/* One random spot in a country: look it up and keep the panorama if it matches. */
async function attempt(code, want, rad, key) {
  const p = randomPointIn(code);
  if (!p) {
    noSpots.add(code); // the other countries go on
    return;
  }
  stats.tries++;
  countPace(code);
  let r = await lookup(p, rad, key);
  if (keyRefused) {
    fatal = "Google refused the API key. Check that it is right and has the Maps JavaScript API enabled.";
    return;
  }
  if (r.status === "ZERO_RESULTS") {
    stats.empty++;
    stats.failedInRow = 0;
    miss(code);
    return;
  }
  if (r.status !== "OK") {
    stats.failed++;
    if (++stats.failedInRow >= ERROR_LIMIT)
      fatal =
        r.status === "NETWORK"
          ? "Google's Street View service stopped answering. Check your connection, then search again."
          : `Google kept answering "${cleanText(r.status, 40)}". Wait a few minutes, or check the key's quota, then search again.`;
    else await sleep(ERROR_WAIT);
    return;
  }
  stats.failedInRow = 0;
  let facts = arrowFacts(r.links);
  let fromOlder = false;
  // Bad camera, with an older photo allowed: use the newest older photo that is not bad camera. It then
  // goes through every check below, as its arrows and date can differ.
  if (want.noBadCamera && searchSettings.useOlder && isOfficial(r.copyright) && isBadCamera(r, code)) {
    const older = await olderPhoto(r, code, key);
    if (keyRefused) {
      fatal = "Google refused the API key. Check that it is right and has the Maps JavaScript API enabled.";
      return;
    }
    if (older) {
      fromOlder = true;
      r = older;
      facts = arrowFacts(r.links);
    }
  }
  if (
    !isOfficial(r.copyright) ||
    (want.noRoadName && !facts.noRoadName) ||
    (want.deadEnd && !facts.deadEnd) ||
    (want.years && !inYears(r.date, want.years))
  ) {
    stats.notMatching++;
    miss(code);
    return;
  }
  if (countryAt(r.lat, r.lng) !== code) {
    stats.outside++;
    miss(code);
    return;
  }
  if (want.noBadCamera && isBadCamera(r, code)) {
    stats.badCamera++;
    miss(code);
    return;
  }
  if (seenPanos.has(r.panoId) || tooClose(r.lat, r.lng)) {
    stats.tooClose++;
    miss(code);
    return;
  }
  // another worker may have filled this country's last place meanwhile
  if ((foundBy.get(code) || 0) >= searchTargets.get(code)) return;
  /** @type {Location} */
  const l = {
    lat: r.lat,
    lng: r.lng,
    heading: cameraHeading(r.links, facts),
    panoId: r.panoId,
    date: r.date,
    cc: code,
    noRoadName: facts.noRoadName,
    deadEnd: facts.deadEnd,
  };
  results.push(l);
  if (fromOlder) stats.olderUsed++; // counted only when it became a location
  foundBy.set(code, (foundBy.get(code) || 0) + 1);
  countPace(code, true);
  missesInRow.set(code, 0);
  remember(l);
  if (results.length <= MAX_DRAWN) drawLocation(l);
}
/* Where the camera faces. At the end of the coverage: away from the one arrow, towards where it stops.
   Elsewhere: along the road, in the direction of a random arrow (any direction if there is none). */
function cameraHeading(links, facts) {
  if (facts.deadEnd) return (links[0].heading + 180) % 360;
  if (links.length) return links[Math.floor(Math.random() * links.length)].heading;
  return Math.random() * 360;
}
/* Starts a search with the settings in the form. */
async function startSearch() {
  if (running) return;
  showError("");
  if (scope() === "countries" && !chosenCountries.length) {
    showError("Choose a country in step 1.");
    countryEl.focus();
    return;
  }
  const targets = splitTotal(areaWeights(), target());
  if (!Object.keys(targets).length) {
    showError(
      `None of the chosen countries is in ${distributionLabel() || "this map"}. Choose another map in step 1.`,
    );
    return;
  }
  const key = GOOGLE_API_KEY || $("apiKey").value.trim();
  if (!key) {
    showError("Enter your Google API key in step 3 first.");
    $("apiKey").focus();
    return;
  }
  if (!GOOGLE_API_KEY) keyStore.set(key);
  searchSettings = {
    want: wanted(),
    rad: radius(),
    key,
    giveUpAfter: giveUpAfter(),
    useOlder: useOlder(),
  };
  showNote("");
  historyId = recordSearch();
  showNumber("target", target());
  showNumber("giveUpAfter", searchSettings.giveUpAfter);
  hideShortfall();
  searchTargets = new Map(Object.entries(targets).filter(([, n]) => n > 0));
  currentTarget = [...searchTargets.values()].reduce((a, b) => a + b, 0);
  foundBy = new Map();
  noSpots = new Set();
  gaveUp = new Set();
  missesInRow = new Map();
  results = [];
  cells = new Map();
  seenPanos = new Set();
  stats = emptyStats();
  fatal = "";
  stopRequested = false;
  const codes = [...searchTargets.keys()];
  searchArea =
    codes.length === 1
      ? countryName(codes[0])
      : scope() === "world"
        ? "the world"
        : scope() === "continent"
          ? areaLabel()
          : `${codes.length} countries`;
  if (layer) layer.clearLayers();
  showArea(codes);
  hideResume();
  clearSavedSearch(); // a new search replaces an unfinished one
  if (!(await googleReady(key))) {
    searchTargets = new Map();
    paint("Ready.");
    return;
  }
  await runSearch();
}
/* Loads Google's script for a search. On failure, says why (and notes it in the history) and returns
   false. */
async function googleReady(key) {
  setRunning(true);
  paint("Loading Google's Street View service…");
  try {
    await loadGoogleScript(key);
    return true;
  } catch (e) {
    setRunning(false);
    finishSearch(
      historyId,
      e.message === "denied" ? "Google refused the key" : "Google could not be reached",
    );
    showError(
      e.message === "denied"
        ? "Google refused the API key. Check that it is right and has the Maps JavaScript API enabled."
        : "Google's Street View service could not be loaded. Check your connection, or switch off a blocker for this page.",
    );
    return false;
  }
}
/* Runs the workers until every country has its number, has given up, or the visitor stops; then says
   how it went, and offers to fill the gap when countries fell short. Used for a new search and to go on
   after "Fill the gap". */
async function runSearch() {
  const { want, rad, key } = searchSettings;
  setRunning(true);
  stopRequested = false;
  startPace();
  runStartedAt = Date.now();
  const tick = setInterval(() => paint(), 1000); // the time spent searching goes on between finds too
  lastPaint = 0;
  paintSoon();
  keepSaving();
  const worker = async () => {
    while (!stopRequested && !fatal) {
      const code = pickCountry();
      if (!code) break; // every country has what it needs, has given up, or no spots can be made there
      await attempt(code, want, rad, key);
      paintSoon();
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, worker));
  clearInterval(tick);
  stats.searchedMs += Date.now() - runStartedAt;
  runStartedAt = 0;
  setRunning(false);
  if (fatal) showError(fatal);
  else if (noSpots.size)
    showError(
      `No random spots could be made in ${[...noSpots].map(countryName).join(", ")}: the borders are missing from the page.`,
    );
  const where = searchArea === "the world" ? "around the world" : "in " + searchArea;
  paint(
    results.length >= currentTarget
      ? `Done: ${fmt(results.length)} locations found ${where}.`
      : `${stopRequested ? "Stopped" : "Search ended"}: ${fmt(results.length)} of ${fmt(currentTarget)} locations found ${where}.`,
  );
  finishSearch(
    historyId,
    results.length >= currentTarget
      ? `${fmt(results.length)} locations`
      : `${stopRequested ? "Stopped after" : "Ended with"} ${fmt(results.length)} of ${fmt(currentTarget)} locations${gaveUp.size ? `; ${gaveUp.size === 1 ? "1 country" : fmt(gaveUp.size) + " countries"} gave up` : ""}`,
  );
  // A finished search needs no resuming; any other end is kept, so it can be continued later.
  if (results.length >= currentTarget) clearSavedSearch();
  else saveSearch();
  if (!stopRequested && !fatal) showShortfall();
}
/** The settings of the current search, kept for going on after "Fill the gap".
 *  @type {{want: object, rad: number, key: string, giveUpAfter: number, useOlder: boolean}} */
let searchSettings = {
  want: {},
  rad: RADIUS_DEFAULT,
  key: "",
  giveUpAfter: GIVE_UP_DEFAULT,
  useOlder: false,
};
$("form").onsubmit = e => {
  e.preventDefault();
  startSearch();
};
$("stop").onclick = () => {
  stopRequested = true;
  $("stop").disabled = true;
  paint("Stopping after the lookups that are under way…");
};

/* ---------- time left ----------
   A forecast of how long the running search still takes, learnt while it runs: for each country, how
   many random spots one new location has cost so far, and overall, how many spots per second the
   search gets through. Time left = the spots still needed in all countries / spots per second.
   Where locations are rare, a country is likely to give up (see giveUpAfter) long before it is full, so
   each country counts with the spots it can be expected to take until it is full or gives up
   (spotsStillNeeded); one that has found nothing yet counts with the spots it has left before giving
   up. The forecast is for the search to end: with countries that give up, it may end short. The
   countries that are hard to fill decide most of the result, as they also keep a search running at
   the end. Shown only after PACE_WAIT and PACE_SPOTS, as
   the first numbers jump around, and smoothed, so it does not jump with every location found.
   Learning starts again with every run (a new search, "Fill the gap", or continuing a saved one). */
const PACE_WAIT = 20000, // ms of searching before a forecast is shown
  PACE_SPOTS = 50, // random spots tried before a forecast is shown
  PACE_SMOOTH = 0.2; // how much a new forecast moves the one shown (0–1)
/** @type {{since: number, spots: number, tries: Map<string, number>, found: Map<string, number>, finishAt: number}} */
let pace = null;
/* Starts learning for a run. */
function startPace() {
  pace = { since: Date.now(), spots: 0, tries: new Map(), found: new Map(), finishAt: 0 };
}
/* Counts a random spot tried in a country, or (found = true) a new location there. */
function countPace(code, found = false) {
  if (!pace) return;
  const m = found ? pace.found : pace.tries;
  m.set(code, (m.get(code) || 0) + 1);
  if (!found) pace.spots++;
}
/* Seconds the search still needs, or null while there is too little to go on. */
function secondsLeft(now = Date.now()) {
  if (!pace || now - pace.since < PACE_WAIT || pace.spots < PACE_SPOTS) return null;
  const perSecond = pace.spots / ((now - pace.since) / 1000);
  let spots = 0;
  for (const [code, wanted] of searchTargets) {
    const need = wanted - (foundBy.get(code) || 0);
    if (need <= 0 || gaveUp.has(code) || noSpots.has(code)) continue;
    const tries = pace.tries.get(code) || 0,
      found = pace.found.get(code) || 0;
    spots += spotsStillNeeded(
      need,
      tries ? found / tries : 0,
      searchSettings.giveUpAfter,
      missesInRow.get(code) || 0,
    );
  }
  return spots / perSecond;
}
/* How many more random spots a country can be expected to take, until it has `need` more locations or
   gives up: each spot finds a location with chance `chance`, and the country gives up after `giveUp`
   spots in a row without one (it has `misses` of them already).
   The spots until the next location or giving up, whichever comes first, are on average
   (1 - (1 - chance)^giveUp) / chance; the country gets to the next location with chance
   1 - (1 - chance)^giveUp. Where locations are common, this is simply need / chance. Where they are rare,
   giving up soon is likely, and that is what the country costs: New Zealand at 1 location in 1,346 spots
   would need 2.6 million spots for 1,916 locations, but gives up after about 4,600 on average. */
function spotsStillNeeded(need, chance, giveUp, misses) {
  const first = Math.max(0, giveUp - misses); // spots left in the current run of misses
  if (chance <= 0) return first;
  if (chance >= 1) return need;
  const logMiss = Math.log1p(-chance);
  const missRun = Math.exp(giveUp * logMiss); // chance of giveUp misses in a row
  const missFirst = Math.exp(first * logMiss);
  const spotsFirst = (1 - missFirst) / chance; // to the next location, or giving up
  const spotsEach = (1 - missRun) / chance; // the same for each location after that
  // Locations after the next one, counted with the chance of getting that far: 1 + s + s² + … (s = the
  // chance of finding each), at most need - 1.
  const rest = need - 1;
  const later = rest <= 0 ? 0 : missRun < 1e-12 ? rest : -Math.expm1(rest * Math.log1p(-missRun)) / missRun;
  return spotsFirst + (1 - missFirst) * spotsEach * later;
}
/* The forecast for the status line: "about 4 minutes left", or "estimating time left…" at first. The
   finish time shown moves only part of the way towards each new forecast. */
function timeLeftText(now = Date.now()) {
  const left = secondsLeft(now);
  if (left === null) return "estimating time left…";
  const finish = now + left * 1000;
  pace.finishAt = pace.finishAt ? pace.finishAt + (finish - pace.finishAt) * PACE_SMOOTH : finish;
  return describeTimeLeft(Math.max(0, (pace.finishAt - now) / 1000));
}
/* Seconds as a rough time: "less than a minute left", "about 25 minutes left", "about 3 hours left". */
function describeTimeLeft(seconds) {
  const minutes = seconds / 60;
  if (minutes < 1) return "less than a minute left";
  if (minutes < 90) {
    const m = minutes < 10 ? Math.round(minutes) : Math.round(minutes / 5) * 5;
    return `about ${m} ${m === 1 ? "minute" : "minutes"} left`;
  }
  const hours = minutes / 60;
  if (hours < 48) return `about ${Math.round(hours)} hours left`;
  return `about ${fmt(Math.round(hours / 24))} days left`;
}

/* ---------- shortfalls ----------
   When countries gave up (or no spots could be made in them), the search ends short. The offer under the
   buttons then lets the visitor share the missing locations between the countries that finished, in
   their proportions, and search on; or keep what was found. */
/* The countries that fell short, with how many each is missing. */
function shortfalls() {
  return [...searchTargets]
    .map(([c, wanted]) => ({ code: c, missing: wanted - (foundBy.get(c) || 0) }))
    .filter(s => s.missing > 0 && (gaveUp.has(s.code) || noSpots.has(s.code)));
}
/* The countries that have all they wanted and did not give up: they can take more. */
const finishedCountries = () =>
  [...searchTargets]
    .filter(([c, wanted]) => (foundBy.get(c) || 0) >= wanted && !gaveUp.has(c))
    .map(([c]) => c);
/* Shows the offer when countries fell short; does nothing otherwise. */
function showShortfall() {
  const short = shortfalls();
  if (!short.length) return hideShortfall();
  const gap = short.reduce((n, s) => n + s.missing, 0),
    donors = finishedCountries();
  const names = short
    .sort((a, b) => b.missing - a.missing)
    .map(
      s => `${countryName(s.code)} (${fmt(foundBy.get(s.code) || 0)} of ${fmt(searchTargets.get(s.code))})`,
    );
  const list =
    names.length > 8 ? names.slice(0, 8).join(", ") + ` and ${names.length - 8} more` : names.join(", ");
  $("shortfallTitle").textContent =
    `${short.length === 1 ? "1 country" : fmt(short.length) + " countries"} fell short: ${fmt(gap)} ${gap === 1 ? "location" : "locations"} missing.`;
  $("shortfallText").textContent =
    `Matching locations were too rare in ${list}. ` +
    (donors.length
      ? `"Fill the gap" shares the missing locations between the other ${donors.length === 1 ? "country" : fmt(donors.length) + " countries"}, in their proportions, and searches on.`
      : "No other country in this search can take them.");
  $("fillGap").hidden = !donors.length;
  $("shortfall").hidden = false;
}
function hideShortfall() {
  $("shortfall").hidden = true;
}
/* Shares the missing locations between the finished countries and searches on. */
async function fillGap() {
  const gap = shortfalls().reduce((n, s) => n + s.missing, 0),
    donors = finishedCountries();
  if (!gap || !donors.length || running) return;
  const extra = splitTotal(Object.fromEntries(donors.map(c => [c, searchTargets.get(c)])), gap);
  for (const [c, n] of Object.entries(extra)) searchTargets.set(c, searchTargets.get(c) + n);
  // The countries that gave up keep only what they found, so the total stays the number asked for.
  for (const { code: c } of shortfalls()) searchTargets.set(c, foundBy.get(c) || 0);
  hideShortfall();
  showError("");
  await runSearch();
}
$("fillGap").onclick = fillGap;
$("keepFound").onclick = () => {
  hideShortfall();
  clearSavedSearch();
  paint(`Kept ${fmt(results.length)} locations. Download the map file when you are ready.`);
};

/* ---------- export ---------- */
/* The results in map-making.app's format: { name, customCoordinates: [{ lat, lng, heading, pitch, zoom,
   panoId, countryCode, extra?: { tags } }] }. The tags follow the options ticked at the time of export. */
function exportJson() {
  return JSON.stringify({
    name: mapName(),
    customCoordinates: results.map(l => {
      const o = {
        lat: +l.lat.toFixed(7),
        lng: +l.lng.toFixed(7),
        heading: +l.heading.toFixed(1),
        pitch: 0,
        zoom: 0,
        panoId: l.panoId,
        countryCode: l.cc,
      };
      const tags = tagsFor(l);
      if (tags.length) o.extra = { tags };
      return o;
    }),
  });
}
$("download").onclick = () => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([exportJson()], { type: "application/json" }));
  a.download = fileBase(mapName()) + ".json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
$("copy").onclick = async () => {
  try {
    await navigator.clipboard.writeText(exportJson());
    $("copy").textContent = "Copied";
  } catch {
    $("copy").textContent = "Copy failed";
  }
  setTimeout(() => ($("copy").textContent = "Copy"), 1500);
};
$("clear").onclick = () => {
  hideShortfall();
  clearSavedSearch();
  results = [];
  stats = emptyStats();
  searchTargets = new Map();
  foundBy = new Map();
  if (layer) layer.clearLayers();
  paint("Ready.");
};
paint();

/* ---------- history of searches ----------
   Every search started with "Find locations" is kept in this browser ("mapgen.history", newest first,
   at most HISTORY_MAX), so it can be run again or its settings used again. Copied from Lookout and
   adapted: without shareable links, an entry holds the search settings themselves (see SearchSettings).
   An entry never holds the Google key, and the results are not kept. */
const HISTORY_MAX = 20;
/**
 * The settings of a search, as kept in the history.
 * @typedef {object} SearchSettings
 * @property {"countries"|"continent"|"world"} scope
 * @property {string[]} countries   country codes, for scope "countries"
 * @property {string} continent     Vali's continent code ("europe")
 * @property {string} distribution  Vali's map code ("aaw"), or "continent" for a continent's own map
 * @property {boolean} noRoadName
 * @property {boolean} deadEnd
 * @property {boolean} yearsOn
 * @property {boolean} noBadCamera  leave out bad camera coverage
 * @property {boolean} useOlder     use an older photo at the spot instead of bad camera, if there is one
 * @property {number} yearFrom
 * @property {number} yearTo
 * @property {number} target
 * @property {number} radius
 * @property {number} giveUpAfter
 * @property {string} mapName       the name typed in step 3, or "" for the suggested one
 * @property {boolean} tagCountry    the tags the map file gets (see TAG_OPTIONS)
 * @property {boolean} tagNoRoadName
 * @property {boolean} tagDeadEnd
 * @property {boolean} tagYear
 */
/**
 * @typedef {object} HistoryEntry
 * @property {string} id
 * @property {number} at            when the search started (milliseconds since 1970)
 * @property {string} title         the map name
 * @property {SearchSettings} settings
 * @property {string} [outcome]     "87 locations", "Stopped after 12 of 100 locations", …
 */
let historyId = null; // the history entry of the current search, to note how it ended
const historyOn = () => store.get("historyOn", true) !== false;
/* The settings in the form now. @returns {SearchSettings} */
function currentSettings() {
  return {
    scope: scope(),
    countries: [...chosenCountries],
    continent: $("continent").value,
    distribution: $("distribution").value,
    noRoadName: $("noRoadName").checked,
    deadEnd: $("deadEnd").checked,
    yearsOn: $("yearsOn").checked,
    noBadCamera: $("noBadCamera").checked,
    useOlder: $("useOlder").checked,
    yearFrom: wholeNumber($("yearFrom").value, YEAR_FIRST, YEAR_LAST, YEAR_FIRST),
    yearTo: wholeNumber($("yearTo").value, YEAR_FIRST, YEAR_LAST, YEAR_LAST),
    target: target(),
    radius: radius(),
    giveUpAfter: giveUpAfter(),
    mapName: $("mapName").value.trim().slice(0, 100),
    ...Object.fromEntries(Object.keys(TAG_OPTIONS).map(id => [id, $(id).checked])),
  };
}
/* Settings read back from the history, an unfinished search or a settings file, checked like
   everything from outside: anything not well-formed becomes the default. This and currentSettings are
   the one description of the settings: a new setting is added to both (and to applySettings), and the
   history, the unfinished search and the settings file then all keep it. @returns {SearchSettings} */
function cleanSettings(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const known = (obj, k) => typeof k === "string" && Object.hasOwn(obj, k);
  return {
    scope: ["countries", "continent", "world"].includes(r.scope) ? r.scope : "countries",
    countries: Array.isArray(r.countries)
      ? [...new Set(r.countries.filter(c => typeof c === "string" && COVERAGE.includes(c)))]
      : [],
    continent: known(VALI.continents, r.continent) ? r.continent : DEFAULT_CONTINENT,
    distribution:
      r.distribution === "continent" || known(VALI.maps, r.distribution) ? r.distribution : DEFAULT_MAP,
    noRoadName: r.noRoadName === true,
    deadEnd: r.deadEnd === true,
    yearsOn: r.yearsOn === true,
    noBadCamera: r.noBadCamera === true,
    useOlder: r.useOlder !== false,
    yearFrom: wholeNumber(r.yearFrom, YEAR_FIRST, YEAR_LAST, YEAR_FIRST),
    yearTo: wholeNumber(r.yearTo, YEAR_FIRST, YEAR_LAST, YEAR_LAST),
    target: wholeNumber(r.target, 1, TARGET_MAX, TARGET_DEFAULT),
    radius: wholeNumber(r.radius, RADIUS_MIN, RADIUS_MAX, RADIUS_DEFAULT),
    giveUpAfter: wholeNumber(r.giveUpAfter, GIVE_UP_MIN, GIVE_UP_MAX, GIVE_UP_DEFAULT),
    mapName: cleanText(r.mapName, 100).trim(),
    // (entries from before the tags were kept get the defaults)
    ...Object.fromEntries(
      Object.entries(TAG_OPTIONS).map(([id, d]) => [id, typeof r[id] === "boolean" ? r[id] : d]),
    ),
  };
}
/* The saved history. Saved values can be edited by anyone, so entries that are not well-formed are
   dropped and their settings checked. @returns {HistoryEntry[]} */
function loadHistory() {
  const raw = store.get("history", []);
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const e of raw.slice(0, HISTORY_MAX)) {
    if (
      !e ||
      typeof e !== "object" ||
      !inRange(e.at, 0, 1e14) ||
      !e.settings ||
      typeof e.settings !== "object"
    )
      continue;
    out.push({
      id: cleanText(e.id, 40) || String(e.at),
      at: e.at,
      title: cleanText(e.title, 200) || "Search",
      settings: cleanSettings(e.settings),
      outcome: cleanText(e.outcome, 200) || undefined,
    });
  }
  return out;
}
const saveHistory = list => store.set("history", list.slice(0, HISTORY_MAX));
/* Adds the search that is starting to the history. The same settings again move to the top instead of
   being added twice. Returns the entry's id, or null when the history is switched off. */
function recordSearch() {
  if (!historyOn()) return null;
  const settings = currentSettings(),
    same = JSON.stringify(settings);
  const list = loadHistory().filter(e => JSON.stringify(e.settings) !== same);
  const entry = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    at: Date.now(),
    title: mapName(),
    settings,
  };
  saveHistory([entry, ...list]);
  return entry.id;
}
/* Notes how a search ended on its history entry. */
function finishSearch(id, outcome) {
  if (!id) return;
  const list = loadHistory(),
    e = list.find(x => x.id === id);
  if (!e) return;
  e.outcome = outcome;
  saveHistory(list);
  if (!$("history").hidden) renderHistory();
}
/* One line about an entry's settings: "Whole world · An Arbitrary World · No road name · 1,000 locations · 1,000 m". */
function historyDetails(s) {
  const bits = [];
  if (s.scope === "world") bits.push("Whole world");
  else if (s.scope === "continent") bits.push(VALI.continents[s.continent]?.name || "A continent");
  else if (s.countries.length <= 2) bits.push(s.countries.map(countryName).join(" and ") || "No countries");
  else bits.push(`${s.countries.length} countries`);
  if (s.scope !== "countries" || s.countries.length > 1)
    bits.push(
      s.distribution === "continent"
        ? `Vali's ${VALI.continents[s.continent]?.name || "continent"} map`
        : VALI.maps[s.distribution]?.name || s.distribution,
    );
  bits.push(
    wantedLabel({
      noRoadName: s.noRoadName,
      deadEnd: s.deadEnd,
      years: s.yearsOn ? { from: Math.min(s.yearFrom, s.yearTo), to: Math.max(s.yearFrom, s.yearTo) } : null,
      noBadCamera: s.noBadCamera,
    }),
  );
  if (s.noBadCamera && s.useOlder) bits.push("older photos instead");
  bits.push(`${fmt(s.target)} ${s.target === 1 ? "location" : "locations"}`, `${fmt(s.radius)} m`);
  return bits.join(" · ");
}
/* "Today, 14:03", "12 Oct, 09:41", or with the year when it is not this year. */
function historyWhen(at) {
  const d = new Date(at),
    now = new Date();
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === now.toDateString()) return `Today, ${time}`;
  const opts = { day: "numeric", month: "short" };
  if (d.getFullYear() !== now.getFullYear()) opts.year = "numeric";
  return `${d.toLocaleDateString("en-GB", opts)}, ${time}`;
}
/* Fills the History dialog. Everything from the saved history is put on the page as text. */
function renderHistory() {
  const list = $("historyList"),
    entries = historyOn() ? loadHistory() : [];
  list.textContent = "";
  $("historyEmpty").hidden = entries.length > 0;
  $("historyEmpty").textContent = historyOn()
    ? 'No searches yet. Each search you start with "Find locations" appears here.'
    : "The history is switched off. Tick the box below to keep one.";
  $("historyClear").hidden = !entries.length;
  for (const e of entries) {
    const run = makeElement("button", { type: "button", className: "btn primary" }, "Run again");
    run.onclick = () => useHistory(e, true);
    const use = makeElement("button", { type: "button", className: "btn" }, "Use these settings");
    use.onclick = () => useHistory(e, false);
    const remove = makeElement("button", { type: "button", className: "linkbtn rm" }, "Remove");
    remove.setAttribute("aria-label", `Remove "${e.title}" from the history`);
    remove.onclick = () => {
      saveHistory(loadHistory().filter(x => x.id !== e.id));
      renderHistory();
    };
    list.append(
      makeElement(
        "li",
        {},
        makeElement("b", {}, e.title),
        makeElement("span", { className: "hint" }, historyDetails(e.settings)),
        makeElement("span", { className: "hint" }, historyWhen(e.at) + (e.outcome ? " · " + e.outcome : "")),
        makeElement("div", { className: "hist-acts" }, run, use, remove),
      ),
    );
  }
}
/* Puts settings from the history into the form and saves them, as if the visitor had chosen them. */
function applySettings(s) {
  document.querySelector(`input[name=scope][value="${s.scope}"]`).checked = true;
  chosenCountries = [...s.countries];
  $("continent").value = s.continent;
  whereChanged(); // fills the list of maps for this area
  if ([...$("distribution").options].some(o => o.value === s.distribution))
    $("distribution").value = s.distribution;
  whereChanged();
  for (const id of [
    "noRoadName",
    "deadEnd",
    "yearsOn",
    "noBadCamera",
    "useOlder",
    ...Object.keys(TAG_OPTIONS),
  ]) {
    $(id).checked = s[id];
    store.set(id, s[id]);
  }
  for (const id of ["yearFrom", "yearTo", "target", "radius", "giveUpAfter", "mapName"]) {
    if (NUMBER_FIELDS[id]) showNumber(id, s[id]);
    else $(id).value = String(s[id]);
    store.set(id, s[id]);
  }
  updateYears();
  updateOlder();
  updateMapName();
  updateMore();
  renderShares();
}
/* "Run again" (run = true) or "Use these settings" (run = false) on a history entry. */
function useHistory(e, run) {
  if (running) return;
  closeDialog();
  applySettings(e.settings);
  if (run) startSearch();
  else
    showNote(
      'These settings come from your history. Check them, then select "Find locations". The locations will be a new random selection.',
    );
}
$("historyBtn").onclick = () => {
  renderHistory();
  openDialog("history");
};
$("historyX").onclick = closeDialog;
$("historyClear").onclick = () => {
  saveHistory([]);
  renderHistory();
};
$("historyOn").checked = historyOn();
$("historyOn").onchange = () => {
  store.set("historyOn", $("historyOn").checked);
  if (!$("historyOn").checked) saveHistory([]); // switching it off also clears it
  renderHistory();
};

/* ---------- settings file ----------
   Every search setting saved as a file and loaded again, for later or for someone else: JSON, readable
   in any text editor, like
     { "format": "map-generation-tool settings", "version": 1, "saved": "2026-10-25T19:30:00.000Z",
       "settings": { …SearchSettings… } }
   The settings are the shared description (currentSettings, cleanSettings, applySettings), so a new
   setting is in the file without changes here. Never the Google key. A loaded file is untrusted: it is
   read with size and format checks, and every setting goes through cleanSettings. SETTINGS_VERSION goes
   up only when a setting changes its meaning; cleanSettings then moves the old shape over. */
const SETTINGS_FORMAT = "map-generation-tool settings",
  SETTINGS_VERSION = 1,
  SETTINGS_MAX_BYTES = 100000; // a settings file is about 1 KB
/* The settings in the form as the text of a settings file. */
function settingsFileText() {
  const file = {
    format: SETTINGS_FORMAT,
    version: SETTINGS_VERSION,
    saved: new Date().toISOString(),
    settings: currentSettings(),
  };
  return JSON.stringify(file, null, 2) + "\n";
}
/* Reads the text of a settings file: { settings, notes } with the checked settings and what to tell
   the visitor about it, or { error } when it is not a usable settings file. */
function readSettingsFile(text) {
  if (typeof text !== "string" || text.length > SETTINGS_MAX_BYTES)
    return { error: "This file is too large to be a settings file." };
  let file;
  try {
    file = JSON.parse(text);
  } catch {
    return { error: "This is not a settings file: its contents could not be read." };
  }
  if (!file || typeof file !== "object" || Array.isArray(file))
    return { error: "This is not a settings file of the Map Generation Tool." };
  if (Array.isArray(file.customCoordinates))
    return { error: "This is a map file, not a settings file. Settings files end in .settings.json." };
  if (file.format !== SETTINGS_FORMAT || !Number.isInteger(file.version) || file.version < 1)
    return { error: "This is not a settings file of the Map Generation Tool." };
  const raw = file.settings;
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    return { error: "This settings file has no settings in it." };
  const settings = cleanSettings(raw);
  const notes = [];
  if (file.version > SETTINGS_VERSION)
    notes.push("It was saved by a newer version of this tool, so some settings may not have come across.");
  const unknown = Object.keys(raw).filter(k => !Object.hasOwn(settings, k));
  if (unknown.length)
    notes.push(
      `Not used, as this tool does not know ${unknown.length === 1 ? "it" : "them"}: ` +
        unknown
          .slice(0, 8)
          .map(k => cleanText(k, 40))
          .join(", ") +
        (unknown.length > 8 ? ` and ${unknown.length - 8} more` : "") +
        ".",
    );
  const dropped = Array.isArray(raw.countries) ? raw.countries.length - settings.countries.length : 0;
  if (dropped > 0)
    notes.push(
      `${dropped === 1 ? "1 country was" : fmt(dropped) + " countries were"} left out: not known, or without official Street View.`,
    );
  return { settings, notes };
}
/* Says something in the settings file dialog: an error, or (error = false) that it worked; "" clears it. */
function settingsMessage(text, error = true) {
  $("settingsMsg").textContent = text;
  $("settingsMsg").className = "msg " + (error ? "error" : "note");
  $("settingsMsg").hidden = !text;
}
$("settingsBtn").onclick = () => {
  settingsMessage("");
  openDialog("settingsFile");
};
$("settingsX").onclick = closeDialog;
$("settingsSave").onclick = () => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([settingsFileText()], { type: "application/json" }));
  a.download = fileBase(mapName()) + ".settings.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  settingsMessage(`Saved as ${a.download}.`, false);
};
$("settingsLoad").onclick = () => {
  if (running) return settingsMessage("Stop the search first, then load the settings.");
  $("settingsPick").click();
};
$("settingsPick").onchange = async () => {
  const f = $("settingsPick").files[0];
  $("settingsPick").value = ""; // so the same file can be chosen again
  if (!f) return;
  if (f.size > SETTINGS_MAX_BYTES) return settingsMessage("This file is too large to be a settings file.");
  let text;
  try {
    text = await f.text();
  } catch {
    return settingsMessage("The file could not be read.");
  }
  const r = readSettingsFile(text);
  if (r.error) return settingsMessage(r.error);
  if (running) return settingsMessage("Stop the search first, then load the settings.");
  applySettings(r.settings);
  closeDialog();
  showNote([`Settings loaded from ${cleanText(f.name, 100)}.`, ...r.notes].join(" "));
};

/* ---------- unfinished search ----------
   While a search runs, its state is saved in this browser every SAVE_EVERY ms, and again when it stops
   or ends short, so that it can be continued after the tab was closed. It goes into IndexedDB, the
   browser's built-in database, because 130,000 locations are more than localStorage holds (about 5 MB).
   Only one search is kept: a new search replaces it, and a finished search, "Keep what was found",
   "Clear" and "Discard" remove it. It holds the settings, the locations and each country's progress,
   never the Google key: a visitor's own key has to be entered again in a new tab. Like every saved
   value, it is checked when read back (cleanSaved). */
const SAVE_EVERY = 5000;
const DB_NAME = "mapgen",
  DB_STORE = "search",
  DB_KEY = "unfinished";
/* Runs one request on the database; resolves to its result, or null if the browser has no IndexedDB
   or refuses it (some private windows). */
function dbRequest(mode, makeRequest) {
  return new Promise(resolve => {
    let open;
    try {
      open = indexedDB.open(DB_NAME, 1);
    } catch {
      return resolve(null);
    }
    open.onupgradeneeded = () => open.result.createObjectStore(DB_STORE);
    open.onerror = () => resolve(null);
    open.onsuccess = () => {
      const db = open.result;
      try {
        const req = makeRequest(db.transaction(DB_STORE, mode).objectStore(DB_STORE));
        req.onsuccess = () => {
          db.close();
          resolve(req.result ?? null);
        };
        req.onerror = () => {
          db.close();
          resolve(null);
        };
      } catch {
        db.close();
        resolve(null);
      }
    };
  });
}
let saving = false,
  saveAgain = false,
  saveTimer = 0;
/* Saves the current search as it is now. A save asked for while one is being written follows right
   after it, so the last state is never lost. */
async function saveSearch() {
  if (saving) {
    saveAgain = true;
    return;
  }
  if (!searchTargets.size) return;
  saving = true;
  await dbRequest("readwrite", store =>
    store.put(
      {
        version: 1,
        savedAt: Date.now(),
        title: mapName(),
        settings: currentSettings(),
        area: searchArea,
        historyId,
        total: currentTarget,
        targets: [...searchTargets],
        found: [...foundBy],
        gaveUp: [...gaveUp],
        noSpots: [...noSpots],
        misses: [...missesInRow],
        stats: { ...stats, searchedMs: searchedFor() }, // with the time of the run going on now
        results: results.map(l => ({ ...l })),
      },
      DB_KEY,
    ),
  );
  saving = false;
  if (saveAgain) {
    saveAgain = false;
    await saveSearch();
  }
}
/* Saves every SAVE_EVERY ms while the search runs. */
function keepSaving() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (!running) return;
    saveSearch();
    keepSaving();
  }, SAVE_EVERY);
}
function clearSavedSearch() {
  clearTimeout(saveTimer);
  saveAgain = false;
  return dbRequest("readwrite", store => store.delete(DB_KEY));
}
/* A location read back from the database, checked; null if it is not well-formed. @returns {Location|null} */
function cleanLocation(l) {
  if (!l || typeof l !== "object") return null;
  if (!inRange(l.lat, -90, 90) || !inRange(l.lng, -180, 180) || !inRange(l.heading, 0, 360)) return null;
  if (typeof l.panoId !== "string" || !/^[^\s<>"'`\\]{4,300}$/.test(l.panoId) || !COVERAGE.includes(l.cc))
    return null;
  const date = cleanText(l.date, 10);
  return {
    lat: l.lat,
    lng: l.lng,
    heading: l.heading,
    panoId: l.panoId,
    date: /^\d{4}(-\d{2})?$/.test(date) ? date : "",
    cc: l.cc,
    noRoadName: l.noRoadName === true,
    deadEnd: l.deadEnd === true,
  };
}
/* The saved search, checked like every saved value, or null if there is none or it is broken. */
function cleanSaved(raw) {
  if (!raw || typeof raw !== "object" || raw.version !== 1 || !inRange(raw.savedAt, 0, 1e14)) return null;
  const count = n => (Number.isInteger(n) && n >= 0 && n <= TARGET_MAX ? n : 0);
  const pairs = list =>
    Array.isArray(list)
      ? list.filter(x => Array.isArray(x) && COVERAGE.includes(x[0])).map(([c, n]) => [c, count(n)])
      : [];
  const codes = list => (Array.isArray(list) ? list.filter(c => COVERAGE.includes(c)) : []);
  const targets = pairs(raw.targets).filter(([, n]) => n > 0);
  if (!targets.length) return null;
  const results = Array.isArray(raw.results)
    ? raw.results.slice(0, TARGET_MAX).map(cleanLocation).filter(Boolean)
    : [];
  const stats = emptyStats();
  for (const k of Object.keys(stats))
    if (Number.isInteger(raw.stats?.[k]) && raw.stats[k] >= 0 && raw.stats[k] <= 1e12)
      stats[k] = raw.stats[k];
  return {
    savedAt: raw.savedAt,
    title: cleanText(raw.title, 200) || "Search",
    settings: cleanSettings(raw.settings),
    area: cleanText(raw.area, 200) || "your search",
    historyId: cleanText(raw.historyId, 40) || null,
    total: count(raw.total) || targets.reduce((n, [, t]) => n + t, 0),
    targets,
    found: pairs(raw.found),
    gaveUp: codes(raw.gaveUp),
    noSpots: codes(raw.noSpots),
    misses: pairs(raw.misses),
    stats,
    results,
  };
}
let savedSearch = null;
/* On opening the page: offers to continue an unfinished search, if there is one. */
async function offerSavedSearch() {
  savedSearch = cleanSaved(await dbRequest("readonly", store => store.get(DB_KEY)));
  if (!savedSearch || running) return;
  const s = savedSearch;
  $("resumeTitle").textContent = `An unfinished search: ${s.title}`;
  $("resumeText").textContent =
    `${historyWhen(s.savedAt)} · ${historyDetails(s.settings)}. ` +
    `${fmt(s.results.length)} of ${fmt(s.total)} locations found so far` +
    // (searches saved before the time was kept have none)
    (s.stats.searchedMs ? `, in ${clockTime(s.stats.searchedMs)} of searching.` : ".");
  $("resume").hidden = false;
}
function hideResume() {
  $("resume").hidden = true;
}
/* Puts the saved search back: its settings in the form, its locations on the map and in the table. */
function restoreSearch(s) {
  applySettings(s.settings);
  $("mapName").value = s.settings.mapName;
  searchTargets = new Map(s.targets);
  foundBy = new Map();
  noSpots = new Set(s.noSpots);
  gaveUp = new Set(s.gaveUp);
  missesInRow = new Map(s.misses);
  currentTarget = s.total;
  searchArea = s.area;
  historyId = s.historyId;
  stats = s.stats;
  stats.failedInRow = 0;
  results = [];
  cells = new Map();
  seenPanos = new Set();
  fatal = "";
  stopRequested = false;
  if (layer) layer.clearLayers();
  for (const l of s.results) {
    // Only locations that fit the saved targets, and never the same panorama twice.
    if (seenPanos.has(l.panoId) || (foundBy.get(l.cc) || 0) >= (searchTargets.get(l.cc) || 0)) continue;
    results.push(l);
    foundBy.set(l.cc, (foundBy.get(l.cc) || 0) + 1);
    remember(l);
    if (results.length <= MAX_DRAWN) drawLocation(l);
  }
  showArea([...searchTargets.keys()]);
}
/* "Continue": puts the search back and runs it on. */
async function continueSearch() {
  if (running || !savedSearch) return;
  showError("");
  const key = GOOGLE_API_KEY || $("apiKey").value.trim();
  if (!key) {
    showError(
      'Enter your Google API key in step 3, then select "Continue" again. Your own key is not kept after the tab is closed.',
    );
    $("apiKey").focus();
    return;
  }
  if (!GOOGLE_API_KEY) keyStore.set(key);
  hideResume();
  restoreSearch(savedSearch);
  searchSettings = {
    want: wanted(),
    rad: radius(),
    key,
    giveUpAfter: giveUpAfter(),
    useOlder: useOlder(),
  };
  if (!(await googleReady(key))) {
    offerSavedSearch(); // still there, for another try
    return;
  }
  await runSearch();
}
$("resumeGo").onclick = continueSearch;
$("resumeShow").onclick = () => {
  if (running || !savedSearch) return;
  hideResume();
  showError("");
  restoreSearch(savedSearch);
  paint(`${fmt(results.length)} locations from your unfinished search. Download them, or search again.`);
};
$("resumeDrop").onclick = () => {
  hideResume();
  savedSearch = null;
  clearSavedSearch();
};
offerSavedSearch();

/* ---------- dialogs: welcome (shown once per browser) ---------- */
/* Opens a dialog (an element with class "dialog" around a "dialog-box"). While it is open, Escape and a
   click outside the box close it, and Tab keeps the keyboard inside the box. When it closes, the focus
   goes back to where it was. */
let openDialogEl = null,
  dialogBack = null;
function openDialog(id) {
  if (openDialogEl) closeDialog();
  dialogBack = document.activeElement;
  openDialogEl = $(id);
  openDialogEl.hidden = false;
  const box = openDialogEl.querySelector(".dialog-box");
  box.focus({ preventScroll: true });
  box.scrollTop = 0; // start reading at the top
}
function closeDialog() {
  if (!openDialogEl) return;
  openDialogEl.hidden = true;
  openDialogEl = null;
  if (dialogBack && dialogBack.focus && dialogBack !== document.body) dialogBack.focus();
}
document.addEventListener("click", e => {
  if (openDialogEl && e.target === openDialogEl) closeDialog(); // a click outside the box
});
document.addEventListener("keydown", e => {
  if (!openDialogEl) return;
  if (e.key === "Escape") closeDialog();
  if (e.key === "Tab") {
    // keep the keyboard inside the box: cycle through what can take the focus there
    const f = [...openDialogEl.querySelectorAll("button, input, select, textarea, a[href]")].filter(
      x => !x.disabled && !x.hidden && x.offsetParent !== null,
    );
    if (!f.length) return;
    const i = f.indexOf(document.activeElement);
    e.preventDefault();
    f[(i + (e.shiftKey ? f.length - 1 : 1) + f.length) % f.length].focus();
  }
});
$("maxDrawn").textContent = fmt(MAX_DRAWN); // the number in the welcome dialog
function openWelcome() {
  openDialog("welcome");
  store.set("welcomed", true);
}
$("welcomeX").onclick = closeDialog;
$("helpX").onclick = closeDialog;
$("helpOk").onclick = closeDialog;
$("welcomeOk").onclick = closeDialog;
$("howBtn").onclick = openWelcome;
if (!store.get("welcomed", false) && !FRAMED) openWelcome();
