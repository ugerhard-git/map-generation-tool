// Shared code: the data both tools use. Used by both tools in this repository; the build puts it into a page
// where that page's app.js says /*SHARED data.js*/ (see src/assemble.js). It uses names that
// app.js defines, as if it were written there.
/* ---------- data: both tools ---------- */
const CONFIG = (() => {
  try {
    const c = JSON.parse(document.getElementById("app-config").textContent);
    return c && typeof c === "object" ? c : {};
  } catch {
    console.warn(TOOL_NAME + ": the settings block is not valid JSON, using defaults.");
    return {};
  }
})();
const GOOGLE_API_KEY =
  typeof CONFIG.googleApiKey === "string" && /^[A-Za-z0-9_-]{20,80}$/.test(CONFIG.googleApiKey.trim())
    ? CONFIG.googleApiKey.trim()
    : "";
const TARGET_MAX = 130000; // most locations one search may ask for
/* The settings of the running or last search, as compared for continuing it (see "continuing a stopped
   search"); stoppedKey is set while a stopped search can be continued, "" otherwise. Here at the top, as
   the summaries (updateMore) look at them from the start. */
let runKey = "",
  stoppedKey = "";
const TARGET_DEFAULT = 300;
const RADIUS_MIN = 50,
  RADIUS_MAX = 10000; // metres around a random spot to look for a panorama (default: RADIUS_DEFAULT)
const MIN_SPACING = 100; // metres between any two locations, so there are no near-duplicates
const PARALLEL = 6; // lookups running at the same time
const ERROR_LIMIT = 20; // failed lookups in a row (not "nothing found") before the search gives up
const ERROR_WAIT = 3000; // ms to wait after a failed lookup, before trying again
// Locations drawn on the map. Every dot is redrawn when the map moves: measured in October 2026, 20,000
// dots keep zooming and panning smooth even on a slow computer; 50,000 make each zoom wait about half a
// second to a second. The map file always has every location. The welcome dialog states the number.
const MAX_DRAWN = 20000;
const SIZE_LIMIT_DEFAULT = 20; // MB: the largest map file before the page offers to make it smaller
const GIVE_UP_MIN = 50,
  GIVE_UP_MAX = 100000; // random spots in a row without a new location before a country gives up (default: GIVE_UP_DEFAULT)
