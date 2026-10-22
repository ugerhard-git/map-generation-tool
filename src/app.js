"use strict";
/*
 * Map Generation Tool: the app code.
 *
 * The tool builds map-making.app maps of random official Google Street View locations that match what
 * the visitor chooses: no road name shown, the end of the coverage (one arrow), or both. Everything runs
 * in the visitor's browser; there is no server of our own. The build (src/build.js) puts this file, the
 * styles and the markup into one page. The plan for the next steps is in docs/plan.md.
 *
 * Much of this file is copied from Lookout (github.com/ugerhard-git/osm-tool), whose src/app.js is the
 * place to look for more shared parts. Copy a part over when a feature here needs it, not ahead of time.
 *
 * HOW A SEARCH RUNS (see startSearch)
 *   1. Step 1 sets the country, step 2 what each location must have (`wanted`), step 3 how many and how
 *      far to look around each random spot.
 *   2. PARALLEL workers repeat attempt() until enough locations are found or the visitor stops:
 *      randomPointIn() picks a random spot inside the country (from the country borders built into the
 *      page), lookup() asks Google's script for the nearest official panorama within the radius, and
 *      the panorama's arrows (`links`) tell whether a road name is shown and whether the coverage ends.
 *   3. A panorama that matches, lies in the country and is at least MIN_SPACING from every location so
 *      far becomes a Location: drawn on the map (drawLocation, the first MAX_DRAWN only) and exported
 *      (exportJson). paint() keeps the status line, progress and counters up to date.
 *
 * MAIN SHARED STATE
 *   results      the Locations found so far
 *   stats        counters for the current search (see emptyStats)
 *   running      true while a search runs; stopRequested asks the workers to finish
 *
 * SAVED IN THE BROWSER (localStorage, each name starts with "mapgen.", see `store`)
 *   country (a country code), noRoadName, deadEnd, target, radius, mapName, tagCountry, tagFeatures,
 *   tagYear (which tags the export gets), welcomed (first-visit dialog seen).
 *   A visitor's own Google key is only kept in sessionStorage ("mapgen.key"), never on disk.
 *   Saved values can be edited by anyone, so everything read back is checked first.
 *
 * GROUND RULES
 *   - The page's security policy only runs scripts it knows, so events are wired up here in code;
 *     onclick="…" in the HTML would not run.
 *   - Text from outside (Google, saved values) is put on the page with textContent, or passed through
 *     esc() before it goes into innerHTML.
 *   - The sections below follow the page from top to bottom: data, helpers, random spots, step 1, step 2,
 *     step 3, map, Google Street View, run, export, dialogs. src/page.html and src/style.css use the same
 *     section names.
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
/* Countries and territories with official Street View along roads (the same list as Lookout's). In step 2
   of the plan this list is matched against the countries in Vali's map distributions. */
const COVERAGE = (
  "AD AE AL AR AS AT AU AX BA BD BE BG BM BO BR BT BW CA CC CH CL CO CR CW CX CY CZ DE DK DO EC EE ES FI FO FR " +
  "GB GE GH GI GL GR GT GU HK HR HU ID IE IL IM IN IS IT JE JO JP KE KG KH KR KZ LA LI LK LS LT LU LV MC ME MK " +
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
const MAX_DRAWN = 5000; // locations drawn on the map; more would make the map slow

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
/* Lower case without accents, for file names: "Château" -> "chateau". */
const foldAccents = s => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/* ---------- random spots inside a country ---------- */
// The borders come from country-coder (the same library as countryAt). A country can have many parts
// (islands, overseas territories): a part is chosen with a chance that matches its area, then a spot in
// that part, then countryAt() confirms it, since an overseas part of France may count as another
// territory (Réunion is RE). Spots are spread evenly over the earth's surface, not over the flat map.

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
/* A random spot inside the country, or null if none was found in 1000 tries (borders missing, say). */
function randomPointIn(code) {
  const parts = borderParts(code);
  if (!parts.length) return null;
  const total = parts.reduce((n, p) => n + p.area, 0);
  for (let tries = 0; tries < 1000; tries++) {
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
    if (!insideRing(lng, lat, part.rings[0])) continue;
    if (part.rings.slice(1).some(hole => insideRing(lng, lat, hole))) continue;
    if (countryAt(lat, lng) === code) return { lat, lng };
  }
  return null;
}

/* ---------- step 1: where ----------
   The country field suggests matching countries while typing (the same pattern as Lookout's kind picker).
   The field shows the country's name; `chosenCountry` holds its code, or "" while none is chosen. */
/** @type {{code: string, name: string, folded: string}[]} the countries offered, sorted by name */
const COUNTRY_CHOICES = COVERAGE.map(code => {
  const name = countryName(code);
  return { code, name, folded: foldAccents(name) };
}).sort((a, b) => a.name.localeCompare(b.name));
let chosenCountry = "",
  countryMatches = [],
  countryActive = -1;
const countryEl = $("country"),
  countryListEl = $("countryList");
/* The countries matching typed text: the country with that two-letter code ("de": Germany) first, then
   names starting with it, names with a word starting with it, names containing it. All for empty text. */
function matchCountries(text) {
  const q = foldAccents(text.trim());
  if (!q) return COUNTRY_CHOICES;
  const byCode = [],
    starts = [],
    wordStarts = [],
    contains = [];
  for (const c of COUNTRY_CHOICES) {
    if (c.code.toLowerCase() === q) byCode.push(c);
    else if (c.folded.startsWith(q)) starts.push(c);
    else if (c.folded.split(/[\s\-–(]+/).some(w => w.startsWith(q))) wordStarts.push(c);
    else if (c.folded.includes(q)) contains.push(c);
  }
  return [...byCode, ...starts, ...wordStarts, ...contains];
}
/* Shows the list of matching countries under the field. */
function showCountryList() {
  countryMatches = matchCountries(countryEl.value === countryName(chosenCountry) ? "" : countryEl.value);
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
  setCountryActive(
    countryMatches.length
      ? Math.max(
          0,
          countryMatches.findIndex(c => c.code === chosenCountry),
        )
      : -1,
  );
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
/* Makes a country the chosen one, shows its name in the field and saves it. */
function chooseCountry(code) {
  chosenCountry = COVERAGE.includes(code) ? code : "";
  countryEl.value = chosenCountry ? countryName(chosenCountry) : "";
  store.set("country", chosenCountry);
  closeCountryList();
  updateMapName();
}
countryEl.addEventListener("input", showCountryList);
countryEl.addEventListener("focus", () => {
  countryEl.select(); // typing replaces the name shown
  showCountryList();
});
countryEl.addEventListener("keydown", e => {
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
    if (countryActive >= 0) chooseCountry(countryMatches[countryActive].code);
  } else if (e.key === "Escape") {
    countryEl.value = chosenCountry ? countryName(chosenCountry) : "";
    closeCountryList();
  }
});
countryListEl.addEventListener("mousedown", e => {
  const li = e.target.closest("li[role=option]");
  if (li) {
    e.preventDefault(); // keep the focus in the field
    chooseCountry(countryMatches[+li.dataset.i].code);
  }
});
// Leaving the field: text that matches exactly one country (or a country's whole name) chooses it;
// anything else puts back the country chosen before.
countryEl.addEventListener("blur", () =>
  setTimeout(() => {
    if (countryListEl.hidden) return;
    const typed = countryEl.value.trim();
    const matches = matchCountries(typed);
    const exact = matches.find(c => c.folded === foldAccents(typed));
    if (typed && (exact || matches.length === 1)) chooseCountry((exact || matches[0]).code);
    else {
      countryEl.value = chosenCountry ? countryName(chosenCountry) : "";
      closeCountryList();
    }
  }, 120),
);
{
  const saved = store.get("country", "");
  chosenCountry = COVERAGE.includes(saved) ? saved : "";
  countryEl.value = chosenCountry ? countryName(chosenCountry) : "";
}

/* ---------- step 2: what to look for ---------- */
/* What each location must have: { noRoadName, deadEnd }. */
const wanted = () => ({ noRoadName: $("noRoadName").checked, deadEnd: $("deadEnd").checked });
for (const id of ["noRoadName", "deadEnd"]) {
  $(id).checked = store.get(id, false) === true;
  $(id).onchange = () => {
    store.set(id, $(id).checked);
    updateMapName();
  };
}
/* Short description of what is searched for, for the map name: "No road name, end of coverage". */
function wantedLabel(w) {
  const parts = [];
  if (w.noRoadName) parts.push("no road name");
  if (w.deadEnd) parts.push("end of coverage");
  const text = parts.join(", ") || "official coverage";
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/* ---------- step 3: how many, map name and key ---------- */
const target = () => wholeNumber($("target").value, 1, TARGET_MAX, TARGET_DEFAULT);
const radius = () => wholeNumber($("radius").value, RADIUS_MIN, RADIUS_MAX, RADIUS_DEFAULT);
$("target").value = wholeNumber(store.get("target", TARGET_DEFAULT), 1, TARGET_MAX, TARGET_DEFAULT);
$("target").onchange = () => store.set("target", target());
$("radius").value = wholeNumber(store.get("radius", RADIUS_DEFAULT), RADIUS_MIN, RADIUS_MAX, RADIUS_DEFAULT);
$("radius").onchange = () => store.set("radius", radius());
$("mapName").value = cleanText(store.get("mapName", ""), 100);
$("mapName").oninput = () => store.set("mapName", $("mapName").value.slice(0, 100));
/* The name suggested when the visitor types none: "Malta: No road name". */
function suggestedName() {
  return (chosenCountry ? countryName(chosenCountry) + ": " : "") + wantedLabel(wanted());
}
/* Shows the suggested name in the empty map name field. */
function updateMapName() {
  $("mapName").placeholder = suggestedName();
}
updateMapName();
/* The map name for the export: what the visitor typed, or the suggestion. */
const mapName = () => $("mapName").value.trim().slice(0, 100) || suggestedName();
/* Which tags the export gets. The country is ticked unless the visitor unticked it; the others are not. */
const TAG_OPTIONS = { tagCountry: true, tagFeatures: false, tagYear: false };
for (const [id, d] of Object.entries(TAG_OPTIONS)) {
  const saved = store.get(id, d);
  $(id).checked = typeof saved === "boolean" ? saved : d;
  $(id).onchange = () => store.set(id, $(id).checked);
}
/* The tags of a location for the export, from the ticked options: "Malta", "No road name", "2023". */
function tagsFor(l) {
  const tags = [];
  if ($("tagCountry").checked) tags.push(countryName(l.cc));
  if ($("tagFeatures").checked) {
    if (l.noRoadName) tags.push("No road name");
    if (l.deadEnd) tags.push("Dead end");
  }
  if ($("tagYear").checked && l.date) tags.push(l.date.slice(0, 4));
  return tags;
}
// The key field is only shown when the site has no key of its own.
$("keyBox").hidden = !!GOOGLE_API_KEY;
$("apiKey").value = keyStore.get();
$("apiKey").onchange = () => keyStore.set($("apiKey").value.trim());

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
/* Zooms the map to the largest part of a country (France without its overseas parts, say). */
function showCountry(code) {
  const part = borderParts(code)[0];
  if (map && part)
    map.fitBounds(
      [
        [part.south, part.west],
        [part.north, part.east],
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
  };
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
/* The nearest official panorama within radius metres of a point, with its arrows. @returns {Promise<PanoAnswer>} */
async function lookup(p, radius, key) {
  const sv = await loadGoogleScript(key);
  const near = await askGoogle(sv, {
    location: { lat: p.lat, lng: p.lng },
    radius,
    sources: ["google"],
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
    links: d.links,
  });
}
/* Official Google coverage says "© 2024 Google" (or "Google LLC"); photos from others name the uploader. */
const isOfficial = c =>
  c
    .replace(/[©\d\s]/g, "")
    .replace(/LLC|Inc\.?/gi, "")
    .replace(/[,.]/g, "") === "Google";
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
    b.textContent = fmt(n);
    s.append(b, " " + label);
    t.append(s);
  };
  add(stats.tries, "random spots tried");
  add(stats.empty, "without official Street View nearby");
  if (stats.notMatching) add(stats.notMatching, "not matching");
  if (stats.tooClose) add(stats.tooClose, "too close to another");
  if (stats.outside) add(stats.outside, "across the border");
  if (stats.failed) add(stats.failed, "failed lookups");
  if (results.length > MAX_DRAWN) add(MAX_DRAWN, "shown on the map");
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
  paint(`Searching ${countryName(searchCountry)}: ${fmt(results.length)} of ${fmt(currentTarget)} found…`);
}
let searchCountry = "",
  fatal = "";
/* One random spot: look it up and keep the panorama if it matches. */
async function attempt(code, want, rad, key) {
  const p = randomPointIn(code);
  if (!p) {
    fatal = `No random spots could be made inside ${countryName(code)}: its borders are missing from the page.`;
    return;
  }
  stats.tries++;
  const r = await lookup(p, rad, key);
  if (keyRefused) {
    fatal = "Google refused the API key. Check that it is right and has the Maps JavaScript API enabled.";
    return;
  }
  if (r.status === "ZERO_RESULTS") {
    stats.empty++;
    stats.failedInRow = 0;
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
  const facts = arrowFacts(r.links);
  if (
    !isOfficial(r.copyright) ||
    (want.noRoadName && !facts.noRoadName) ||
    (want.deadEnd && !facts.deadEnd)
  ) {
    stats.notMatching++;
    return;
  }
  if (countryAt(r.lat, r.lng) !== code) {
    stats.outside++;
    return;
  }
  if (seenPanos.has(r.panoId) || tooClose(r.lat, r.lng)) {
    stats.tooClose++;
    return;
  }
  if (results.length >= currentTarget) return; // another worker filled the last place meanwhile
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
  const code = chosenCountry;
  if (!COVERAGE.includes(code)) {
    showError("Choose a country in step 1.");
    countryEl.focus();
    return;
  }
  const key = GOOGLE_API_KEY || $("apiKey").value.trim();
  if (!key) {
    showError("Enter your Google API key in step 3 first.");
    $("apiKey").focus();
    return;
  }
  if (!GOOGLE_API_KEY) keyStore.set(key);
  const want = wanted(),
    rad = radius();
  currentTarget = target();
  $("target").value = currentTarget;
  results = [];
  cells = new Map();
  seenPanos = new Set();
  stats = emptyStats();
  fatal = "";
  stopRequested = false;
  searchCountry = code;
  if (layer) layer.clearLayers();
  showCountry(code);
  setRunning(true);
  paint("Loading Google's Street View service…");
  try {
    await loadGoogleScript(key);
  } catch (e) {
    setRunning(false);
    paint("Ready.");
    return showError(
      e.message === "denied"
        ? "Google refused the API key. Check that it is right and has the Maps JavaScript API enabled."
        : "Google's Street View service could not be loaded. Check your connection, or switch off a blocker for this page.",
    );
  }
  paintSoon();
  const worker = async () => {
    while (!stopRequested && !fatal && results.length < currentTarget) {
      await attempt(code, want, rad, key);
      paintSoon();
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, worker));
  setRunning(false);
  if (fatal) showError(fatal);
  const where = countryName(code);
  paint(
    results.length >= currentTarget
      ? `Done: ${fmt(results.length)} locations found in ${where}.`
      : `${stopRequested ? "Stopped" : "Search ended"}: ${fmt(results.length)} of ${fmt(currentTarget)} locations found in ${where}.`,
  );
}
$("form").onsubmit = e => {
  e.preventDefault();
  startSearch();
};
$("stop").onclick = () => {
  stopRequested = true;
  $("stop").disabled = true;
  paint("Stopping after the lookups that are under way…");
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
  a.download =
    (foldAccents(mapName())
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "map") + ".json";
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
  results = [];
  stats = emptyStats();
  if (layer) layer.clearLayers();
  paint("Ready.");
};
paint();

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
function openWelcome() {
  openDialog("welcome");
  store.set("welcomed", true);
}
$("welcomeX").onclick = closeDialog;
$("welcomeOk").onclick = closeDialog;
$("howBtn").onclick = openWelcome;
if (!store.get("welcomed", false) && !FRAMED) openWelcome();
