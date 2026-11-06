// Shared code: the unfinished search, kept in the browser. Used by both tools in this repository; the build puts it into a page
// where that page's app.js says /*SHARED unfinished-search.js*/ (see src/assemble.js). It uses names that
// app.js defines, as if it were written there.
/* ---------- unfinished search ----------
   While a search runs, its state is saved in this browser every SAVE_EVERY ms, and again when it stops
   or ends short, so that it can be continued after the tab was closed. It goes into IndexedDB, the
   browser's built-in database, because 130,000 locations are more than localStorage holds (about 5 MB).
   Only one search is kept: a new search replaces it, and a finished search, "Keep what was found",
   "Clear" and "Discard" remove it. It holds the settings, the locations and each country's progress,
   never the Google key: a visitor's own key has to be entered again in a new tab. Like every saved
   value, it is checked when read back (cleanSaved). */
const SAVE_EVERY = 5000;
const DB_STORE = "search",
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
  if (typeof l.panoId !== "string" || !/^[^\s<>"'`\\]{4,300}$/.test(l.panoId) || !COUNTRIES.includes(l.cc))
    return null;
  const date = cleanText(l.date, 10);
  return {
    lat: l.lat,
    lng: l.lng,
    heading: l.heading,
    pitch: inRange(l.pitch, -90, 90) ? l.pitch : 0,
    zoom: inRange(l.zoom, 0, ZOOM_MAX) ? l.zoom : 0,
    panoId: l.panoId,
    date: /^\d{4}(-\d{2})?$/.test(date) ? date : "",
    cc: l.cc,
    ...cleanLocationFields(l),
  };
}
/* The saved search, checked like every saved value, or null if there is none or it is broken. */
function cleanSaved(raw) {
  if (!raw || typeof raw !== "object" || raw.version !== 1 || !inRange(raw.savedAt, 0, 1e14)) return null;
  const count = n => (Number.isInteger(n) && n >= 0 && n <= TARGET_MAX ? n : 0);
  const pairs = list =>
    Array.isArray(list)
      ? list.filter(x => Array.isArray(x) && COUNTRIES.includes(x[0])).map(([c, n]) => [c, count(n)])
      : [];
  const codes = list => (Array.isArray(list) ? list.filter(c => COUNTRIES.includes(c)) : []);
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
  forgetPrune();
  applySettings(s.settings);
  runKey = searchKey(s.settings);
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
  searchSettings = searchSettingsNow(key);
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
  stoppedKey = runKey; // it can be continued from here too
  paint(
    `${fmt(results.length)} locations from your unfinished search. Download them, or continue the search.`,
  );
  updateContinue();
};
$("resumeDrop").onclick = () => {
  hideResume();
  savedSearch = null;
  clearSavedSearch();
};
offerSavedSearch();
