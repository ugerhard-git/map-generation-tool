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
 * Most sections are shared with this repository's second tool, Unofficial (see docs/plan.md): they are
 * in src/shared/, and the build puts each in where a line below says "SHARED <file>" (src/assemble.js).
 * Read them as part of this file; a change there changes both tools. This file holds only what is this
 * tool's own: its identity and countries ("data: this tool"), Vali's maps ("step 1: distributions"), its
 * filters, tags and "More options" sections, its checks of a panorama ("what a location must have") and
 * its settings. docs/how-the-code-works.md lists the names the shared code asks each tool for.
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
 *   4. A country gives up after giveUpAfter() random spots in a row without a new location (miss), unless
 *      giving up is switched off (giveUpOn). If countries fell short, showShortfall() offers to fill the gap from the finished countries (fillGap,
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
 *   over on load), continent, distribution (a Vali map, "continent", "own" or "preset:<id>"), own (the distribution of one's own being
 *   edited), presets (saved distributions of one's own), noRoadName, arrows ("any", "end", "intersection" or "none"; the older tick box "deadEnd" is moved over on load), yearsOn, yearFrom, monthFrom, yearTo (a year or "now"), monthTo, camGen4, camGen23, camBad, noBadCamera, useOlder, target,
 *   radius, giveUpAfter, giveUpOn, viewDirection, carAngle, dirFrom, dirTo, tiltMode, tilt, tiltMin, tiltMax, zoomMode, zoom, zoomMin, zoomMax (camera view), mapName, tagCountry, tagNoRoadName, tagDeadEnd, tagIntersection, tagNoArrows, tagYear, tagDate, sizeLimitOn, sizeLimit (the largest map file), territoryTag (how territories are tagged: "both", "own" or "parent"), tagCamera (which tags the export
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
 * @property {number} [pitch]    how far the camera looks up (+) or down (−), −90 to 90; 0 is level
 * @property {number} [zoom]     how far the camera is zoomed in, 0 (widest) to 4, one decimal
 * @property {string} panoId     Google's panorama id
 * @property {string} date       photo date "YYYY-MM" or "YYYY", or ""
 * @property {string} cc         two-letter country code
 * @property {boolean} noRoadName no road name shown on the arrows
 * @property {boolean} deadEnd   only one arrow: the coverage ends here
 * @property {boolean} [intersection] three or more arrows
 * @property {boolean} [noArrows] no arrows at all: a photo on its own
 * @property {string} [camera]   "gen4", "gen23", "badcam", or "" when not known (see cameraOf)
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
 * @property {number|null} [carHeading] the direction the car faced when the photo was taken, 0–360
 *                               (Google's tiles.centerHeading), or null when Google did not say
 * @property {string} [detail]   what was wrong with the answer, if anything
 */
/* ---------- data: this tool ----------
   What sets this tool apart from the other one in this repository, Unofficial (see docs/plan.md). The
   shared code uses these names; Unofficial's app.js has its own. */
const TOOL_NAME = "Map Generation Tool";
/* Settings saved in the browser are named STORE_PREFIX + name (see store); the unfinished search is kept
   in the IndexedDB database DB_NAME. Never changed, so visitors keep what they saved. */
const STORE_PREFIX = "mapgen.",
  DB_NAME = "mapgen";
/* Countries and territories with official Street View along roads: Lookout's list, plus Lebanon (LB),
   added at the owner's request (October 2026). All of them are in Vali's map distributions. */
const COVERAGE = (
  "AD AE AL AR AS AT AU AX BA BD BE BG BM BO BR BT BW CA CC CH CL CO CR CW CX CY CZ DE DK DO EC EE ES FI FO FR " +
  "GB GE GH GI GL GR GT GU HK HR HU ID IE IL IM IN IS IT JE JO JP KE KG KH KR KZ LA LB LI LK LS LT LU LV MC ME MK " +
  "MN MO MP MT MX MY NA NG NL NO NP NZ OM PA PE PH PL PR PS PT PY QA RE RO RS RU RW SE SG SI SK SM SN ST SZ TH " +
  "TN TR TW UA UG US UY VI VN XK ZA"
).split(" ");
/* The countries offered: those with official coverage. */
const COUNTRIES = COVERAGE;
/* Countries left out of a settings file, in words. */
const DROPPED_COUNTRY_WORDS = "not known, or without official Street View";
/* The settings file (see "settings file"): its format name, the tool in its messages, and settings that
   older versions saved under another name, which cleanSettings moves over. */
const SETTINGS_FORMAT = "map-generation-tool settings",
  TOOL_TITLE = "the Map Generation Tool",
  // (indoor and tagIndoor: the indoor filter and tag, published from 6 to 9 November 2026 and removed, as
  // Google's answer cannot tell indoor panoramas apart; files from then load without a note)
  // (lookAlongSpacing and lookAlongMax: "Follow the coverage", published on 11 November 2026 and taken out
  // the same day, see src/shared/walk.js)
  OLDER_SETTING_NAMES = ["deadEnd", "indoor", "tagIndoor", "lookAlongSpacing", "lookAlongMax"];
/* The other tool in this repository: linked in the header, and named when its settings file is loaded here. */
const OTHER_TOOL = {
  name: "Unofficial",
  address: "unofficial/", // relative, so the link works wherever the two pages are published together
  settingsFormat: "unofficial settings",
};
const RADIUS_DEFAULT = 1000; // metres around a random spot to look for a panorama
const GIVE_UP_DEFAULT = 2000; // random spots in a row without a new location before a country gives up
/* Google's sources for a lookup (see lookup): official coverage that Google counts as outdoor coverage.
   Several sources mean all of them must hold. This leaves out some indoor panoramas, but not all of
   Google's own: the owner's test (November 2026) found five of its indoor panoramas (stations, museums)
   that Google gives for "outdoor" too, and nothing in Google's answer tells them apart. They are rare in
   the results, as a random spot almost always has the street outside nearer. */
const LOOKUP_SOURCES = ["google", "outdoor"];
/* Words for the camera view (see "camera view"): what "Along the road" is called, what the camera's
   angle is measured from, and the drawings. */
const VIEW_WORDS = {
  road: "Along the road",
  front: "the car",
  above: "The car from above",
  side: "The car from the side",
};
/* The bad camera ("badcam"): low-quality photos, 6656 pixels high. Older cameras made images of that
   height too, so as in Vali (github.com/slashP/Vali), only photos from BAD_CAMERA_FROM on count as bad
   camera, and only outside BAD_CAMERA_KEPT, where it is much of the coverage (Vali's India, Nepal and
   Nigeria, plus Lebanon and São Tomé and Príncipe, chosen by the owner). Current photos are 8192 high. */
const BAD_CAMERA_HEIGHT = 6656,
  BAD_CAMERA_FROM = 2020;
const BAD_CAMERA_KEPT = ["IN", "NP", "NG", "LB", "ST"];
/* The cameras, told apart by the image height Google gives (checked on real panoramas with the owner,
   October 2026: San Francisco and Sydney, 2007–2026): 8192 is Gen 4; 6656 is Gen 2 or 3 (they cannot be
   told apart), or bad camera (see above); 1664 (3328 × 1664, 2007–2008) is Gen 1, which is left out of
   every search (agreed with the owner). Other sizes exist (Sydney has 12000 × 6000 photos from 2017–2018,
   not ordinary car coverage): their camera is unknown, as for a panorama without a size. */
const GEN4_HEIGHT = 8192,
  GEN1_MAX_HEIGHT = 3328; // Gen 1 is 1664 high; anything up to twice that counts as Gen 1
const CAMERAS = { gen4: "Gen 4", gen23: "Gen 2/3", badcam: "Bad camera" };
const CAMERA_BOXES = { camGen4: "gen4", camGen23: "gen23", camBad: "badcam" };
/* The country each territory with official coverage belongs to, for its country tag (see countryTags).
   Copied from Lookout's TERRITORY_OF (October 2026), only the territories in COVERAGE. Hong Kong keeps
   its own tag only, as in Lookout. */
// prettier-ignore
const TERRITORY_OF = {
  AS: "US", AX: "FI", BM: "GB", CC: "AU", CW: "NL", CX: "AU", FO: "DK", GI: "GB", GL: "DK", GU: "US",
  IM: "GB", JE: "GB", MO: "CN", MP: "US", PR: "US", RE: "FR", VI: "US",
};
/*SHARED data.js*/

/*SHARED helpers.js*/

/*SHARED random-spots.js*/

/*SHARED own-distributions.js*/

/* ---------- step 1: distributions ----------
   This tool's part of step 1 (the rest is in src/shared/where.js): the continents and Vali's maps, which
   share the locations between the countries of the area. */
const DEFAULT_MAP = "aaw"; // An Arbitrary World, chosen by the owner
const DEFAULT_CONTINENT = "europe";
/* Shown in the country field's list when no country matches what was typed. */
const NO_COUNTRY_MATCHES = "No country with official Street View matches";
/* A continent's name ("Europe"), or "" for a code that is not one. */
const continentName = code => (isContinent(code) ? VALI.continents[code].name : "");
/* True for the code of one of Vali's continents. */
const isContinent = code => typeof code === "string" && Object.hasOwn(VALI.continents, code);
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
  const option = (value, text) => makeElement("option", { value, textContent: text });
  // Your own first: the one being edited, then the presets
  const mine = makeElement("optgroup", { label: "Your maps" });
  if (own) mine.append(option("own", own.name ? `Your own: ${own.name}` : "Your own"));
  for (const p of loadPresets()) mine.append(option("preset:" + p.id, p.name));
  if (mine.children.length) el.append(mine);
  const vali = makeElement("optgroup", { label: "Vali's maps" });
  if (s === "continent")
    vali.append(
      option("continent", `Vali's ${VALI.continents[$("continent").value]?.name || "continent"} map`),
    );
  for (const [code, m] of Object.entries(VALI.maps).sort((a, b) => a[1].name.localeCompare(b[1].name)))
    vali.append(option(code, m.name));
  el.append(vali);
  const offered = [...el.options].map(o => o.value);
  el.value = offered.includes(before) ? before : s === "continent" ? "continent" : DEFAULT_MAP;
}
/* The distribution chosen when nothing is changed: a continent's own map for a continent, else
   DEFAULT_MAP. */
const defaultDistribution = () => (scope() === "continent" ? "continent" : DEFAULT_MAP);
/* The countries of the chosen area with their shares in the chosen Vali map (see areaWeights). Only
   countries with official coverage. A chosen country that the chosen map does not include gets 0. */
function builtInWeights() {
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
/* Countries with official coverage that none of Vali's continent lists has (October 2026), and the
   continent they belong to, so they can get a share of one's own there too. */
const OUTSIDE_VALI_CONTINENTS = { PS: "asia" };
/* The countries of the area that can get a share of one's own: the chosen countries, the continent's
   countries, or every country with official coverage. */
function ownAreaCodes() {
  const s = scope(),
    official = code => COVERAGE.includes(code);
  if (s === "countries") return chosenCountries.filter(official);
  if (s === "continent") {
    const code = $("continent").value;
    const members = Object.keys(VALI.continents[code]?.weights || {});
    for (const [c, continent] of Object.entries(OUTSIDE_VALI_CONTINENTS))
      if (continent === code && !members.includes(c)) members.push(c);
    return members.filter(official);
  }
  return [...COVERAGE];
}
/* The chosen distribution in words, or "" when it does not matter (a single country, a continent's own). */
function distributionLabel() {
  if (!distributionUsed() || $("distribution").value === "continent") return "";
  const mine = ownChosen();
  if (mine) return mine.name || "your own distribution";
  return VALI.maps[$("distribution").value]?.name || "";
}

/*SHARED where.js*/

/*SHARED period.js*/

/* ---------- step 2: filters ----------
   This tool's filters: roads and arrows, cameras and older photos (the period is shared, src/shared/period.js). */
/* The chosen cameras ("gen4", "gen23", "badcam"), or null when none is ticked (any camera but Gen 1). */
function cameras() {
  const chosen = Object.entries(CAMERA_BOXES)
    .filter(([id]) => $(id).checked)
    .map(([, cam]) => cam);
  return chosen.length ? chosen : null;
}
/* The arrows asked for: "any", "end" (one arrow: the end of the coverage), "intersection" (three or
   more) or "none" (no arrows at all: a photo on its own; added at the owner's request, November 2026).
   One choice, as they exclude each other (CONTRIBUTING.md: "A simple interface"). */
const ARROWS = ["any", "end", "intersection", "none"];
const arrows = () => document.querySelector("input[name=arrows]:checked")?.value || "any";
// Before intersections, "End of coverage" was a tick box, saved as "deadEnd": it is moved over once.
{
  let saved = store.get("arrows", null);
  if (!ARROWS.includes(saved)) saved = store.get("deadEnd", false) === true ? "end" : "any";
  store.set("arrows", saved);
  store.remove("deadEnd");
  document.querySelector(`input[name=arrows][value="${saved}"]`).checked = true;
  for (const r of document.querySelectorAll("input[name=arrows]"))
    r.onchange = () => {
      store.set("arrows", arrows());
      updateMapName();
    };
}
/* What each location must have: { noRoadName, arrows, years: {from, to} | null, cameras, noBadCamera }.
   "No bad camera" does not apply when cameras are chosen: the choice already says. */
const wanted = () => ({
  noRoadName: $("noRoadName").checked,
  arrows: arrows(),
  years: years(),
  cameras: cameras(),
  noBadCamera: $("noBadCamera").checked && !cameras(),
});
for (const id of ["noRoadName", "noBadCamera", ...Object.keys(CAMERA_BOXES)]) {
  $(id).checked = store.get(id, false) === true;
  $(id).onchange = () => {
    store.set(id, $(id).checked);
    updateOlder();
    updateMapName();
  };
}
// Removed options: following the road to the end of coverage (walkOn, walkSteps) made finding ends
// slower, not faster, so it was taken out. Their saved values are cleared.
for (const id of ["walkOn", "walkSteps"]) store.remove(id);
// Using an older photo when the newest is not the camera asked for: only with chosen cameras or "No bad
// camera", and off unless ticked (on by default until October 2026, when the owner chose off; a saved
// choice is kept).
$("useOlder").checked = store.get("useOlder", false) === true;
$("useOlder").onchange = () => store.set("useOlder", $("useOlder").checked);
const useOlder = () => (!!cameras() || $("noBadCamera").checked) && $("useOlder").checked;
/* "No bad camera" does not apply while cameras are chosen, and the older-photo option only with one of
   the two: greyed out otherwise. */
function updateOlder() {
  $("noBadCamera").disabled = !!cameras();
  $("useOlder").disabled = !cameras() && !$("noBadCamera").checked;
}
updateOlder();
/* Short description of what is searched for, for the map name: "No road name, end of coverage, May 2015 – now". */
function wantedLabel(w) {
  const parts = [];
  if (w.noRoadName) parts.push("no road name");
  if (w.arrows === "end") parts.push("end of coverage");
  if (w.arrows === "intersection") parts.push("intersection");
  if (w.arrows === "none") parts.push("no arrows");
  if (w.years) parts.push(periodLabel(w.years, " – "));
  if (w.cameras) parts.push(w.cameras.map(c => CAMERAS[c]).join(" and "));
  else if (w.noBadCamera) parts.push("no bad camera");
  const text = parts.join(", ") || "official coverage";
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/* The number field of "Look along the coverage" (see src/shared/walk.js), handled with the shared ones
   (see "step 3"). */
const TOOL_NUMBER_FIELDS = {
  lookAlongDepth: { lo: 1, hi: 10, d: 3, step: 1 }, // panoramas in a row without a match
};

/*SHARED how-many.js*/

/* ---------- map file tags: this tool ----------
   The tag options of this tool, and the tags of a location. The rest is in src/shared/tags.js. */
/* Which tags the export gets. The country is ticked unless the visitor unticked it; the others are not. */
const TAG_OPTIONS = {
  tagCountry: true,
  tagNoRoadName: false,
  tagDeadEnd: false,
  tagIntersection: false,
  tagNoArrows: false,
  tagYear: false,
  tagCamera: false,
};
// "No road name" and "Dead end" used to be one option, tagFeatures: its saved choice becomes both.
const oldFeatures = store.get("tagFeatures", null);
if (typeof oldFeatures === "boolean")
  for (const id of ["tagNoRoadName", "tagDeadEnd"])
    if (store.get(id, null) === null) store.set(id, oldFeatures);
store.remove("tagFeatures");
// The indoor filter and tag were published for a few days (November 2026) and removed again
for (const id of ["indoor", "tagIndoor"]) store.remove(id);
/* The tags of a location for the export, from the ticked options: "Malta", "No road name", "2023" or
   "04-2023". */
function tagsFor(l) {
  const tags = [];
  if ($("tagCountry").checked) tags.push(...countryTagsOf(l));
  if ($("tagNoRoadName").checked && l.noRoadName) tags.push("No road name");
  if ($("tagDeadEnd").checked && l.deadEnd) tags.push("Dead end");
  if ($("tagIntersection").checked && l.intersection) tags.push("Intersection");
  if ($("tagNoArrows").checked && l.noArrows) tags.push("No arrows");
  if ($("tagYear").checked && l.date) tags.push(dateTagOf(l));
  if ($("tagCamera").checked && l.camera) tags.push(CAMERAS[l.camera]);
  return tags;
} /* This tool's tag options in words, for the summary of "Map file" (the country and date are shared). */
const TAG_WORDS = {
  tagNoRoadName: "no road name",
  tagDeadEnd: "dead end",
  tagIntersection: "intersection",
  tagNoArrows: "no arrows",
  tagCamera: "camera",
};

/*SHARED tags.js*/

/*SHARED camera-view.js*/

/* ---------- more options: this tool ----------
   This tool's "More options" sections for its filters (see src/shared/more-options.js), and the line
   under step 2 that says what is looked for. */
/* True when anything is asked of a location, besides official coverage. */
const anythingWanted = w => w.noRoadName || w.arrows !== "any" || !!w.years || !!w.cameras || w.noBadCamera;
/* The line under step 2 when nothing is asked. */
const ANY_LOCATION_WORDS = "Any official location. Choose more in the sections below.";
/** @type {Record<string, {summary: () => string, changed: () => boolean, reset: () => void}>} */
const MORE_TOOL = {
  moreRoads: {
    summary: () => {
      const bits = [];
      if ($("noRoadName").checked) bits.push("no road name");
      if (arrows() === "end") bits.push("end of coverage");
      if (arrows() === "intersection") bits.push("intersection");
      if (arrows() === "none") bits.push("no arrows");
      const text = bits.join(", ") || "any road names, any arrows";
      return text.charAt(0).toUpperCase() + text.slice(1);
    },
    changed: () => $("noRoadName").checked || arrows() !== "any",
    reset: () => {
      setControl("noRoadName", false);
      setRadio("arrows", "any");
      store.set("arrows", "any");
      updateMapName();
    },
  },
  morePhotos: {
    summary: () => {
      const bits = [years() ? periodLabel(years()) : "Any time"];
      const older = $("useOlder").checked ? ", older photos instead" : "";
      if (cameras())
        bits.push(
          cameras()
            .map(c => CAMERAS[c])
            .join(" and ") +
            " only" +
            older,
        );
      else if ($("noBadCamera").checked) bits.push("no bad camera" + older);
      return bits.join(", ");
    },
    changed: () =>
      $("yearsOn").checked ||
      +$("yearFrom").value !== YEAR_FIRST ||
      +$("monthFrom").value !== 1 ||
      $("yearTo").value !== "now" ||
      +$("monthTo").value !== 12 ||
      $("noBadCamera").checked ||
      !!cameras() ||
      $("useOlder").checked,
    reset: () => {
      setControl("yearFrom", String(YEAR_FIRST));
      setControl("monthFrom", "1");
      setControl("yearTo", "now");
      setControl("monthTo", "12");
      setControl("yearsOn", false);
      for (const id of Object.keys(CAMERA_BOXES)) setControl(id, false);
      setControl("noBadCamera", false);
      setControl("useOlder", false);
    },
  },
};

/*SHARED walk.js*/

/*SHARED more-options.js*/

/*SHARED locations-per-country.js*/

/*SHARED map.js*/

/*SHARED google.js*/

/* ---------- what a location must have ----------
   This tool's checks of a panorama, which the search (src/shared/run.js) asks: official coverage, the
   roads and arrows asked for, the period, the camera; with an older photo at the spot instead where that
   is allowed. Also what is kept about a location, and the counters and words of this tool. */
/* This tool's counters, added to the shared ones (see emptyStats). */
const TOOL_STATS = {
  badCamera: 0, // left out as bad camera
  gen1: 0, // left out as Gen 1, in every search
  otherCamera: 0, // left out as not one of the chosen cameras
  olderLookups: 0, // older photos looked up instead of bad camera
  olderUsed: 0, // locations that are an older photo used instead of bad camera
  walked: 0, // panoramas looked at along the coverage (see src/shared/walk.js)
};
/* The counter of random spots with nothing found nearby, in the counters under the progress bar. */
const EMPTY_WORDS = "without official Street View nearby";
/* This tool's counters under the progress bar, after the shared ones. */
function toolTally(add) {
  if (stats.badCamera) add(stats.badCamera, "bad camera");
  if (stats.otherCamera) add(stats.otherCamera, "other cameras");
  if (stats.gen1) add(stats.gen1, "Gen 1");
  if (stats.olderUsed) add(stats.olderUsed, "older photos used instead");
  if (stats.walked) add(stats.walked, "panoramas looked at along the coverage");
}
/* This tool's settings for a search, besides the shared ones (see searchSettingsNow). */
const toolSearchSettings = () => ({ useOlder: useOlder(), lookAlong: COVERAGE_WALK.search() });
/* Google's sources for a lookup: always official outdoor coverage here. */
const lookupSources = () => LOOKUP_SOURCES;
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
    width: d.tiles?.worldSize?.width,
    carHeading: d.tiles?.centerHeading,
    time: d.time,
    links: d.links,
  });
}
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
/* A panorama's camera in a country: "gen4", "gen23", "badcam", "gen1", or "" when it is not known (no
   size given, or a size none of these cameras makes). */
function cameraOf(r, code) {
  if (!r.height) return "";
  if (r.height === GEN4_HEIGHT) return "gen4";
  if (r.height === BAD_CAMERA_HEIGHT) return isBadCamera(r, code) ? "badcam" : "gen23";
  if (r.height <= GEN1_MAX_HEIGHT) return "gen1";
  return "";
}
/* Whether a panorama has the camera asked for: never Gen 1; one of the chosen cameras when some are
   chosen (an unknown camera then does not count); not bad camera with "No bad camera". */
function cameraWanted(r, code, want) {
  const cam = cameraOf(r, code);
  if (cam === "gen1") return false;
  if (want.cameras) return want.cameras.includes(cam);
  return !(want.noBadCamera && cam === "badcam");
}
/* An older photo at the same spot with the camera asked for, for a panorama without it: the newest of
   up to OLDER_TRIES other photos that Google confirms as official, with a wanted camera and, if a period
   is chosen, from that period (an older photo outside it would be left out anyway). One lookup each.
   @returns {Promise<PanoAnswer|null>} */
const OLDER_TRIES = 3;
async function olderPhoto(r, code, key, want) {
  const candidates = r.older.filter(o => !want.years || inYears(o.date, want.years));
  for (const o of candidates.slice(0, OLDER_TRIES)) {
    if (stopRequested || fatal) return null;
    stats.olderLookups++;
    const a = await lookupPano(o.pano, key);
    if (a.status === "OK" && isOfficial(a.copyright) && cameraWanted(a, code, want)) return a;
  }
  return null;
}
/* Whether a panorama found for a country matches what is asked (want): it is official, has the roads and
   arrows and is from the period asked for. Where the camera is not one asked for and an older photo is
   allowed, the newest older photo at the spot with it is used instead, and checked the same way, as its
   arrows and date can differ. (Gen 1 is never asked for and is the oldest, so it is not looked for.)
   Resolves to { pano, facts, fromOlder }, or null when it does not match. */
async function panoramaWanted(r, code, key, want) {
  let facts = arrowFacts(r.links);
  let fromOlder = false;
  if (
    searchSettings.useOlder &&
    isOfficial(r.copyright) &&
    cameraOf(r, code) !== "gen1" &&
    !cameraWanted(r, code, want)
  ) {
    const older = await olderPhoto(r, code, key, want);
    if (keyRefused) {
      fatal = "Google refused the API key. Check that it is right and has the Maps JavaScript API enabled.";
      return null;
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
    (want.arrows === "end" && !facts.deadEnd) ||
    (want.arrows === "intersection" && !facts.intersection) ||
    (want.arrows === "none" && r.links.length > 0) ||
    (want.years && !inYears(r.date, want.years))
  )
    return null;
  return { pano: r, facts, fromOlder };
}
/* The checks after the one that the panorama lies in the country: never Gen 1, and the camera asked for.
   Counts why a panorama was left out. */
function laterChecks(r, code, want) {
  if (cameraOf(r, code) === "gen1") {
    stats.gen1++;
    return false;
  }
  if (!cameraWanted(r, code, want)) {
    if (cameraOf(r, code) === "badcam" && !want.cameras) stats.badCamera++;
    else stats.otherCamera++;
    return false;
  }
  return true;
}
/* What this tool keeps about a location, besides the shared fields (see Location). */
const locationFields = (r, code, facts) => ({
  noRoadName: facts.noRoadName,
  deadEnd: facts.deadEnd,
  intersection: facts.intersection,
  noArrows: r.links.length === 0,
  camera: cameraOf(r, code),
});
/* What a location has, in words, for its popup on the map. */
const locationFacts = l =>
  [
    l.noRoadName && "No road name",
    l.deadEnd && "End of coverage",
    l.intersection && "Intersection",
    l.noArrows && "No arrows",
  ].filter(Boolean);
/* Where the camera faces with "Along the road" (see locationView). */
const roadHeading = (r, facts) => cameraHeading(r.links, facts);
/* Where the camera faces along the road. At the end of the coverage: away from the one arrow, towards
   where it stops. Elsewhere: in the direction of a random arrow (any direction if there is none). */
function cameraHeading(links, facts) {
  if (facts.deadEnd) return (links[0].heading + 180) % 360;
  if (links.length) return links[Math.floor(Math.random() * links.length)].heading;
  return Math.random() * 360;
}

/*SHARED run.js*/

/*SHARED search-log.js*/

/*SHARED continuing.js*/

/*SHARED time-left.js*/

/*SHARED shortfalls.js*/

/*SHARED export.js*/
/*SHARED map-file-size.js*/

/* ---------- settings: this tool ----------
   This tool's settings in the shared description of the settings (see "history of searches"): what the
   filters add to currentSettings, cleanSettings and applySettings, how the history describes them, and
   what an unfinished search keeps about each location. */
/* This tool's filter settings in the form now (see currentSettings). */
const toolSettings = () => ({
  noRoadName: $("noRoadName").checked,
  arrows: arrows(),
  ...Object.fromEntries(Object.keys(CAMERA_BOXES).map(id => [id, $(id).checked])),
  noBadCamera: $("noBadCamera").checked,
  useOlder: $("useOlder").checked,
  ...COVERAGE_WALK.settings(),
});
/* This tool's filter settings read back from outside, checked (see cleanSettings). */
const cleanToolSettings = r => ({
  noRoadName: r.noRoadName === true,
  // (settings from before intersections have deadEnd instead)
  arrows: ARROWS.includes(r.arrows) ? r.arrows : r.deadEnd === true ? "end" : "any",
  ...Object.fromEntries(Object.keys(CAMERA_BOXES).map(id => [id, r[id] === true])),
  noBadCamera: r.noBadCamera === true,
  useOlder: r.useOlder === true,
  ...COVERAGE_WALK.clean(r),
});
/* Puts this tool's filter settings into the form and saves them (see applySettings). */
function applyToolSettings(s) {
  document.querySelector(`input[name=arrows][value="${s.arrows}"]`).checked = true;
  store.set("arrows", s.arrows);
  for (const id of ["noRoadName", ...Object.keys(CAMERA_BOXES), "noBadCamera", "useOlder"]) {
    $(id).checked = s[id];
    store.set(id, s[id]);
  }
  updateOlder();
  COVERAGE_WALK.apply(s);
}
/* A distribution read back from outside that is not one of your own: one of Vali's maps, or a continent's
   own map; else the default map. */
const cleanBuiltIn = d =>
  d === "continent" || (typeof d === "string" && Object.hasOwn(VALI.maps, d)) ? d : DEFAULT_MAP;
/* The built-in distribution of settings in words, for the history: "Vali's Europe map", "An Arbitrary World". */
const builtInWords = s =>
  s.distribution === "continent"
    ? `Vali's ${continentName(s.continent) || "continent"} map`
    : VALI.maps[s.distribution]?.name || s.distribution;
/* The chosen built-in distribution's name, for the table of locations per country. */
const builtInName = () => VALI.maps[$("distribution").value]?.name || "this map";
/* What settings ask of each location, as wanted() gives it for the form. */
const wantedOf = s => ({
  noRoadName: s.noRoadName,
  arrows: s.arrows,
  years: s.yearsOn ? periodOf(s) : null,
  cameras: Object.entries(CAMERA_BOXES).some(([id]) => s[id])
    ? Object.entries(CAMERA_BOXES)
        .filter(([id]) => s[id])
        .map(([, cam]) => cam)
    : null,
  noBadCamera: s.noBadCamera && !Object.keys(CAMERA_BOXES).some(id => s[id]),
});
/* More about settings in words, for the history, after what each location must have. */
const toolDetails = s => [
  ...((s.noBadCamera || Object.keys(CAMERA_BOXES).some(id => s[id])) && s.useOlder
    ? ["older photos instead"]
    : []),
  ...COVERAGE_WALK.details(s),
];
/* This tool's fields of a location read back from an unfinished search, checked (see cleanLocation). */
const cleanLocationFields = l => ({
  noRoadName: l.noRoadName === true,
  deadEnd: l.deadEnd === true,
  intersection: l.intersection === true,
  noArrows: l.noArrows === true,
  camera: typeof l.camera === "string" && Object.hasOwn(CAMERAS, l.camera) ? l.camera : "",
});

/*SHARED history.js*/

/*SHARED settings-file.js*/

/*SHARED unfinished-search.js*/

/*SHARED dialogs.js*/
