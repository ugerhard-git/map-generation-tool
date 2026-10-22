"use strict";
/*
 * Map Generation Tool: the app code.
 *
 * The tool will build map-making.app maps of Street View locations from criteria the visitor chooses.
 * Everything runs in the visitor's browser; there is no server of our own. The build (src/build.js) puts
 * this file, the styles and the markup into one page.
 *
 * Much of this file is copied from Lookout (github.com/ugerhard-git/osm-tool), whose src/app.js is the
 * place to look for more shared parts (Overpass queries, the official-coverage check, street names,
 * shareable links, history). Copy a part over when a feature here needs it, rather than ahead of time.
 *
 * HOW IT WORKS FOR NOW (the criteria are not built yet)
 *   1. The visitor clicks the map. addAt() asks Google for the nearest outdoor panorama within the
 *      chosen radius (lookup).
 *   2. An accepted panorama becomes a Location: drawn on the map (drawLocation) and exported
 *      (exportJson). paint() keeps the counter and buttons up to date.
 *
 * MAIN SHARED STATE
 *   results      the Locations found so far
 *   busy         true while a lookup runs, so clicks do not pile up
 *
 * SAVED IN THE BROWSER (localStorage, each name starts with "mapgen.", see `store`)
 *   radius, mapName, welcomed (first-visit dialog seen).
 *   A visitor's own Google key is only kept in sessionStorage ("mapgen.key"), never on disk.
 *   Saved values can be edited by anyone, so everything read back is checked first.
 *
 * GROUND RULES
 *   - The page's security policy only runs scripts it knows, so events are wired up here in code;
 *     onclick="…" in the HTML would not run.
 *   - Text from outside (Google, saved values) is put on the page with textContent, or passed through
 *     esc() before it goes into innerHTML.
 *   - The sections below follow the page from top to bottom: data, helpers, step 1, step 2, map,
 *     Google Street View, run, export, dialogs. src/page.html and src/style.css use the same names.
 */

/**
 * A Street View spot that made it into the results.
 * @typedef {object} Location
 * @property {number} lat
 * @property {number} lng
 * @property {number} heading    compass direction the camera faces, 0–360
 * @property {string} panoId     Google's panorama id
 * @property {string} date       photo date "YYYY-MM" or "YYYY", or ""
 * @property {string} [cc]       two-letter country code, if known
 * @property {string[]} tags     tags for the export
 * @property {object} [marker]   its marker on the map (Leaflet layer)
 */
/**
 * Google's answer for one lookup, cleaned by cleanPano().
 * @typedef {object} PanoAnswer
 * @property {string} status     "OK", "ZERO_RESULTS", "REQUEST_DENIED", "NETWORK", "MALFORMED", …
 * @property {number} [lat]
 * @property {number} [lng]
 * @property {string} [panoId]
 * @property {string} [copyright] "© Google" for official coverage, else the uploader's name
 * @property {string} [date]
 * @property {string} [detail]   Google's error message, if any
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
const RADIUS_MIN = 10,
  RADIUS_MAX = 1000,
  RADIUS_DEFAULT = 50; // metres around a click to look for a panorama

/* ---------- helpers ---------- */
/* The page element with this id. */
const $ = id => document.getElementById(id);
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
/* Distance in metres between two points on the earth (haversine formula, mean earth radius). */
function distance(aLat, aLng, bLat, bLng) {
  const dLat = toRadians(bLat - aLat),
    dLng = toRadians(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(aLat)) * Math.cos(toRadians(bLat)) * Math.sin(dLng / 2) ** 2;
  return 6371008.8 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}
/* Compass direction from point a to point b, in degrees: 0 north, 90 east. Used as the camera heading. */
function bearing(aLat, aLng, bLat, bLng) {
  const y = Math.sin(toRadians(bLng - aLng)) * Math.cos(toRadians(bLat));
  const x =
    Math.cos(toRadians(aLat)) * Math.sin(toRadians(bLat)) -
    Math.sin(toRadians(aLat)) * Math.cos(toRadians(bLat)) * Math.cos(toRadians(bLng - aLng));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
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
/* Lower case without accents, for file names: "Château" -> "chateau". */
const foldAccents = s => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/* ---------- step 1: choose locations ---------- */
/* The search radius in metres, kept within RADIUS_MIN and RADIUS_MAX. */
function radius() {
  const r = Math.round(Number($("radius").value));
  return inRange(r, RADIUS_MIN, RADIUS_MAX) ? r : RADIUS_DEFAULT;
}
{
  const saved = store.get("radius", RADIUS_DEFAULT);
  $("radius").value = inRange(saved, RADIUS_MIN, RADIUS_MAX) ? saved : RADIUS_DEFAULT;
  $("radius").onchange = () => store.set("radius", radius());
}

/* ---------- step 2: name and download ---------- */
$("mapName").value = cleanText(store.get("mapName", ""), 100);
$("mapName").oninput = () => store.set("mapName", $("mapName").value.slice(0, 100));
/* The map name for the export: what the visitor typed, or a default. */
const mapName = () => $("mapName").value.trim().slice(0, 100) || "My map";
// The key field is only shown when the site has no key of its own.
$("keyBox").hidden = !!GOOGLE_API_KEY;
$("apiKey").value = keyStore.get();
$("apiKey").onchange = () => keyStore.set($("apiKey").value.trim());
// The form has no submit action; pressing Enter in a field must not reload the page.
$("form").onsubmit = e => e.preventDefault();

/* ---------- map ---------- */
let map = null,
  layer = null;
function initMap() {
  if (FRAMED || map) return;
  map = L.map("map", { worldCopyJump: true }).setView([25, 10], 2);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);
  layer = L.layerGroup().addTo(map);
  map.on("click", e => addAt(e.latlng.lat, L.Util.wrapNum(e.latlng.lng, [-180, 180], true)));
}
window.addEventListener("load", initMap);
/* Street View at a location, facing its heading. */
const streetViewLink = l =>
  `https://www.google.com/maps/@?api=1&map_action=pano&pano=${encodeURIComponent(l.panoId)}&heading=${Math.round(l.heading)}`;
/* Draws a found location as a dot with a popup. */
function drawLocation(l) {
  if (!map) return;
  l.marker = L.circleMarker([l.lat, l.lng], {
    radius: 6,
    weight: 2,
    color: "#14213d",
    fillColor: "#f2a900",
    fillOpacity: 1,
  })
    .bindPopup(
      `<b>${esc(l.cc || "Location")}</b>${l.date ? esc(l.date) + "<br />" : ""}<a href="${esc(streetViewLink(l))}" target="_blank" rel="noopener">Open in Street View</a>`,
    )
    .addTo(layer);
}

/* ---------- Google Street View ---------- */
// The Street View metadata web service, which is free of charge. Lookout (osm-tool) also has the
// Maps JavaScript API route for official-only searches and street names; copy it when needed.
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
  const date = cleanText(r.date, 10);
  return {
    status,
    lat: r.lat,
    lng: r.lng,
    panoId: r.panoId,
    copyright: cleanText(r.copyright),
    date: /^\d{4}(-\d{2})?$/.test(date) ? date : "",
  };
}
/* Nearest outdoor panorama within radius metres of a point. @returns {Promise<PanoAnswer>} */
async function lookup(p, radius, key) {
  const u = `https://maps.googleapis.com/maps/api/streetview/metadata?location=${p.lat},${p.lng}&radius=${radius}&source=outdoor&key=${encodeURIComponent(key)}`;
  try {
    const r = await fetch(u);
    const j = await r.json();
    return cleanPano({
      status: j.status,
      lat: j.location?.lat,
      lng: j.location?.lng,
      panoId: j.pano_id,
      copyright: j.copyright,
      date: j.date,
      detail: j.error_message,
    });
  } catch {
    return { status: "NETWORK" };
  }
}
/* Why a lookup failed, in plain words. Never includes the key. */
function failReason(r) {
  switch (r.status) {
    case "ZERO_RESULTS":
      return "No Street View near this spot. Click closer to a road, or raise the distance in step 1.";
    case "REQUEST_DENIED":
      return "Google refused the API key. Check that it is right and has the Street View Static API enabled.";
    case "OVER_QUERY_LIMIT":
      return "Google's request limit was reached. Wait a minute and try again.";
    case "NETWORK":
      return "The request did not reach Google. Check your connection, or switch off a blocker for this page.";
    case "MALFORMED":
      return `Google's answer could not be used: ${r.detail || "it had an unexpected form"}.`;
    default:
      return `Google answered "${cleanText(r.status, 40)}". Try again in a moment.`;
  }
}

/* ---------- run ---------- */
/** @type {Location[]} */
let results = [],
  busy = false;
/* Shows an error under the form, or hides it when text is empty. */
function showError(text) {
  $("error").textContent = text;
  $("error").hidden = !text;
}
/* Keeps the status line, the counter and the export buttons up to date. */
function paint(status) {
  if (status) $("now").textContent = status;
  $("count").textContent = results.length;
  for (const id of ["download", "copy", "clear"]) $(id).disabled = !results.length;
}
/* Adds the nearest Street View location to a clicked point. */
async function addAt(lat, lng) {
  if (busy) return;
  const key = GOOGLE_API_KEY || $("apiKey").value.trim();
  if (!key) {
    showError("Enter your Google API key in step 2 first.");
    $("apiKey").focus();
    return;
  }
  if (!GOOGLE_API_KEY) keyStore.set(key);
  showError("");
  busy = true;
  paint("Looking for Street View near that spot…");
  const r = await lookup({ lat, lng }, radius(), key);
  busy = false;
  if (r.status !== "OK") return paint(failReason(r));
  if (results.some(l => l.panoId === r.panoId)) return paint("That location is already on the map.");
  // Face the clicked spot, unless the panorama is right on it.
  const heading = distance(r.lat, r.lng, lat, lng) > 3 ? bearing(r.lat, r.lng, lat, lng) : 0;
  /** @type {Location} */
  const l = {
    lat: r.lat,
    lng: r.lng,
    heading,
    panoId: r.panoId,
    date: r.date,
    cc: countryAt(r.lat, r.lng),
    tags: [],
  };
  if (l.cc) l.tags.push(l.cc);
  results.push(l);
  drawLocation(l);
  paint("Location added.");
}

/* ---------- export ---------- */
/* The results in map-making.app's format: { name, customCoordinates: [{ lat, lng, heading, pitch, zoom,
   panoId, countryCode?, extra: { tags } }] }. */
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
      };
      if (l.cc) o.countryCode = l.cc;
      if (l.tags.length) o.extra = { tags: l.tags };
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
  if (layer) layer.clearLayers();
  paint("Cleared. Click the map to add a location.");
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
