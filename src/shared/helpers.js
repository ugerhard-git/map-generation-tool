// Shared code: small tools both tools use. Used by both tools in this repository; the build puts it into a page
// where that page's app.js says /*SHARED helpers.js*/ (see src/assemble.js). It uses names that
// app.js defines, as if it were written there.
/* ---------- helpers ---------- */
/* The page element with this id. */
const $ = id => document.getElementById(id);
/* A number with thousands separators: 12345 -> "12,345". */
const fmt = n => n.toLocaleString("en");
const sleep = ms => new Promise(r => setTimeout(r, ms));
/* Settings saved in this browser, under STORE_PREFIX + name ("mapgen.<name>" in the Map Generation Tool). get() returns the default d when nothing
   is saved or storage is blocked (private windows); set() quietly does nothing then. */
const store = {
  get(k, d) {
    try {
      const v = localStorage.getItem(STORE_PREFIX + k);
      return v === null ? d : JSON.parse(v);
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(STORE_PREFIX + k, JSON.stringify(v));
    } catch {}
  },
  remove(k) {
    try {
      localStorage.removeItem(STORE_PREFIX + k);
    } catch {}
  },
};
/* A visitor's own API key is kept for this browser tab only, never written to disk. */
const keyStore = {
  get() {
    try {
      return sessionStorage.getItem(STORE_PREFIX + "key") || "";
    } catch {
      return "";
    }
  },
  set(v) {
    try {
      sessionStorage.setItem(STORE_PREFIX + "key", v);
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
/* How territories are tagged ("Tag territories with"): "both" (the default), "own" or "parent";
   anything else (an old or edited value) counts as "both". Copied from Lookout. */
const TERRITORY_TAGS = ["both", "own", "parent"];
const territoryValue = v => (TERRITORY_TAGS.includes(v) ? v : "both");
/* The country tags for a location's country code: a territory (Puerto Rico) gets its own name, its
   country's tag (USA), or both, as chosen. Copied from Lookout. */
function countryTags(c, territories = "both") {
  const parent = Object.hasOwn(TERRITORY_OF, c) ? TERRITORY_OF[c] : "";
  if (!parent || territories === "own") return [countryTag(c)];
  if (territories === "parent") return [countryTag(parent)];
  return [countryTag(c), countryTag(parent)];
}
/* The country's tag in the map file: the tag from the owner's list (src/data/country-tags.json, built into
   the page as COUNTRY_TAGS), such as "USA" for the United States; the English name for a country or
   territory not on the list (Gibraltar, say). */
const countryTag = c => (Object.hasOwn(COUNTRY_TAGS, c) ? COUNTRY_TAGS[c] : countryName(c));
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
/* The closest zoom a location's view can have (see "camera view"): 4, as in map-making.app and GeoGuessr,
   where 4 was only a little closer than 3 (checked with the owner, October 2026). Here, as a saved
   location's zoom is checked with it in every tool (see "unfinished search"). */
const ZOOM_MAX = 4;
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

/*SHARED random-spots.js*/
/* The value of a radio group, if it is one of those allowed. */
const radioValue = (name, allowed, d) => {
  const v = document.querySelector(`input[name=${name}]:checked`)?.value;
  return allowed.includes(v) ? v : d;
};
/* Ticks the radio button with this value. */
const setRadio = (name, value) => {
  const r = document.querySelector(`input[name=${name}][value="${value}"]`);
  if (r) r.checked = true;
};
