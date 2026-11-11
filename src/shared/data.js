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
   search"); stoppedKey is set while a stopped search can be continued, "" otherwise; ranSettings are the
   settings the locations on the map were found with, while they can be continued from (null otherwise:
   during a search, after "Clear" or "Make it smaller", or after an error). Here at the top, as the
   summaries (updateMore) look at them from the start. */
let runKey = "",
  stoppedKey = "",
  ranSettings = null;
const TARGET_DEFAULT = 300;
const RADIUS_MIN = 50,
  RADIUS_MAX = 10000; // metres around a random spot to look for a panorama (default: RADIUS_DEFAULT)
const MIN_SPACING = 100; // metres between any two locations, so there are no near-duplicates
// Lookups running at the same time: PARALLEL unless "Lookups at the same time" under "Search" says otherwise
// (a setting since November 2026, at the owner's request; up to PARALLEL_MAX). 25 since the owner's tests
// in Kazakhstan (November 2026, 300 locations: 2:29 at 6, 1:09 at 12, 0:36 at 25, 0:30 at 50, and one
// failed lookup in all four); 6 before.
const PARALLEL = 25,
  PARALLEL_MAX = 50;
const ERROR_LIMIT = 20; // failed lookups in a row (not "nothing found") before the search gives up
const ERROR_WAIT = 3000; // ms to wait after a failed lookup, before trying again
// Locations drawn on the map. Every dot is redrawn when the map moves: measured in October 2026, 20,000
// dots keep zooming and panning smooth even on a slow computer; 50,000 make each zoom wait about half a
// second to a second. The map file always has every location. The welcome dialog states the number.
const MAX_DRAWN = 20000;
const SIZE_LIMIT_DEFAULT = 20; // MB: the largest map file before the page offers to make it smaller
const GIVE_UP_MIN = 50,
  GIVE_UP_MAX = 100000; // random spots in a row without a new location before a country gives up (default: GIVE_UP_DEFAULT)
