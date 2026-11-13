// Shared code: the search. Used by both tools in this repository; the build puts it into a page
// where that page's app.js says /*SHARED run.js*/ (see src/assemble.js). It uses names that
// app.js defines, as if it were written there.
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
/* Counters for one search; each tool adds its own (TOOL_STATS). */
function emptyStats() {
  return {
    tries: 0, // random spots looked up
    empty: 0, // no Street View the tool looks for within the radius
    notMatching: 0, // found, but without what was asked for
    tooClose: 0, // already found, or too close to a location found before
    outside: 0, // the panorama lies in a neighbouring country
    failed: 0, // lookups that failed (network, Google errors)
    ...TOOL_STATS,
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
/* The widest each counter's number has been in this search, in characters: the numbers keep that room,
   so they do not jump left and right, or make the counters wrap to another line and back, as they grow
   (asked by the owner, November 2026; the bar also uses digits of one width, see style.css). */
let tallyWidths = new Map();
/* Keeps the status line, progress, counters and buttons up to date. */
function paint(status) {
  if (status) $("now").textContent = status;
  const goal = running || stats.tries ? currentTarget : 0;
  $("fill").style.width = goal ? Math.min(100, (100 * results.length) / goal).toFixed(1) + "%" : "0";
  $("count").textContent = fmt(results.length);
  // (room for the number asked for, so the count does not move the buttons as it grows)
  $("count").style.minWidth = goal ? fmt(goal).length + "ch" : "";
  for (const id of ["download", "copy", "clear"]) $(id).disabled = !results.length || running;
  if (running) showSize();
  else sizeSoon();
  const t = $("tally");
  t.textContent = "";
  if (!stats.tries) return;
  const add = (n, label) => {
    const s = document.createElement("span"),
      b = document.createElement("b");
    b.textContent = typeof n === "number" ? fmt(n) : n;
    const w = Math.max(tallyWidths.get(label) || 0, b.textContent.length);
    tallyWidths.set(label, w);
    b.style.minWidth = w + "ch";
    s.append(b, " " + label);
    t.append(s);
  };
  add(clockTime(searchedFor()), "spent searching");
  add(stats.tries, "random spots tried");
  add(stats.empty, EMPTY_WORDS);
  if (stats.notMatching) add(stats.notMatching, "not matching");
  if (stats.tooClose) add(stats.tooClose, "too close to another");
  if (stats.outside) add(stats.outside, "across the border");
  if (stats.failed) add(stats.failed, "failed lookups");
  toolTally(add);
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
  if (on) {
    $("continueGo").hidden = true;
    $("continueNote").hidden = true;
    $("go").classList.remove("second");
  }
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
  if (
    n >= searchSettings.giveUpAfter &&
    (foundBy.get(code) || 0) < searchTargets.get(code) &&
    !gaveUp.has(code)
  ) {
    gaveUp.add(code);
    logEvent("gave up", { cc: code, spots: n });
  }
}
/* One random spot in a country: look it up and keep the panorama if it matches (keepPanorama). */
async function attempt(code, want, rad, key) {
  const p = randomPointIn(code);
  if (!p) {
    noSpots.add(code); // the other countries go on
    return;
  }
  stats.tries++;
  countPace(code);
  logEvent("spot", { cc: code, lat: Math.round(p.lat * 1e5) / 1e5, lng: Math.round(p.lng * 1e5) / 1e5 });
  const r = await lookup(p, rad, key, lookupSources(want));
  if (keyRefused) {
    fatal = "Google refused the API key. Check that it is right and has the Maps JavaScript API enabled.";
    return;
  }
  if (r.status === "ZERO_RESULTS") {
    logEvent("nothing");
    stats.empty++;
    stats.failedInRow = 0;
    miss(code);
    return;
  }
  if (r.status !== "OK") {
    logEvent("failed", { status: r.status });
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
  logEvent("pano", { cc: code, ...logPano(r) });
  const kept = await keepPanorama(r, code, key, want);
  if (fatal) return;
  if (kept) countPace(code, true);
  else miss(code);
}
/* Checks a panorama found for a country and keeps it as a location if it matches; true when kept. What a
   panorama must have is each tool's own (see "what a location must have" in its app.js): panoramaWanted()
   and laterChecks() decide, locationFields() adds what the tool keeps about a location. Counts why a
   panorama was left out, and in the search log, whether it was kept or why not (the counters it added to;
   none when the country was full meanwhile). */
async function keepPanorama(r, code, key, want) {
  const before = searchLog ? { ...stats } : null;
  const l = await checkPanorama(r, code, key, want);
  if (before)
    logEvent(
      l ? "kept" : "left",
      l
        ? { pano: l.panoId, ...(l.panoId !== r.panoId ? { instead: r.panoId } : {}) }
        : { pano: r.panoId, why: Object.keys(stats).filter(k => stats[k] > before[k]) },
    );
  return !!l;
}
/* The checks of keepPanorama: the location kept, or null. */
async function checkPanorama(r, code, key, want) {
  // The panorama to use (it can be another photo at the same spot) and what its arrows say; or the name
  // of the counter for why it does not match.
  const checked = await panoramaWanted(r, code, key, want);
  if (fatal) return null;
  if (!checked || typeof checked === "string") {
    stats[checked || "notMatching"]++;
    return null;
  }
  const { pano, facts } = checked;
  if (countryAt(pano.lat, pano.lng) !== code) {
    stats.outside++;
    return null;
  }
  if (!laterChecks(pano, code, want)) return null;
  if (seenPanos.has(pano.panoId) || tooClose(pano.lat, pano.lng)) {
    stats.tooClose++;
    return null;
  }
  // another worker may have filled this country's last place meanwhile
  if ((foundBy.get(code) || 0) >= searchTargets.get(code)) return null;
  /** @type {Location} */
  const l = {
    lat: pano.lat,
    lng: pano.lng,
    ...locationView(pano, facts, searchSettings.view),
    panoId: pano.panoId,
    date: pano.date,
    cc: code,
    ...locationFields(pano, code, facts),
  };
  results.push(l);
  if (checked.fromOlder) stats.olderUsed++; // counted only when it became a location
  foundBy.set(code, (foundBy.get(code) || 0) + 1);
  missesInRow.set(code, 0);
  remember(l);
  if (results.length <= MAX_DRAWN) drawLocation(l);
  return l;
}
/* Where the camera faces and how far it tilts, from the camera view settings of the search (see
   "camera view"): along the road (each tool's roadHeading), at an angle to the car, or random; level, at a set
   tilt, or a random tilt within a range; the zoom set, or random within a range. "The car" is the
   direction it faced when the photo was taken (carHeading); when Google does not say, the road direction
   stands in for it. @returns {{heading: number, pitch: number, zoom: number}} */
function locationView(r, facts, view) {
  let heading;
  const front = r.carHeading ?? (r.links.length ? r.links[0].heading : 0);
  if (view.direction === "random")
    // within the range, clockwise from dirFrom (the whole way round by default)
    heading = (front + view.dirFrom + Math.random() * directionSpan(view)) % 360;
  else if (view.direction === "car") heading = (front + view.carAngle) % 360;
  else heading = roadHeading(r, facts);
  const pitch =
    view.tiltMode === "random"
      ? Math.min(view.tiltMin, view.tiltMax) + Math.random() * Math.abs(view.tiltMax - view.tiltMin)
      : view.tilt;
  const zoom =
    view.zoomMode === "random"
      ? Math.min(view.zoomMin, view.zoomMax) + Math.random() * Math.abs(view.zoomMax - view.zoomMin)
      : view.zoom;
  return {
    heading: Math.round(heading * 10) / 10,
    pitch: Math.round(pitch * 10) / 10,
    zoom: Math.round(zoom * 10) / 10,
  };
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
  const targets = planTargets();
  if (Object.values(targets).reduce((n, v) => n + v, 0) > TARGET_MAX) {
    showError(`Your numbers add up to more than ${fmt(TARGET_MAX)} locations, the most one search can find.`);
    return;
  }
  if (!Object.keys(targets).length) {
    showError(
      ownChosen()
        ? 'No country has a share in your distribution. Enter some under "Locations per country".'
        : `None of the chosen countries is in ${distributionLabel() || "this map"}. Choose another map in step 1.`,
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
  searchSettings = searchSettingsNow(key);
  showNote("");
  forgetPrune();
  runKey = searchKey(currentSettings());
  stoppedKey = "";
  ranSettings = null;
  historyId = recordSearch();
  showNumber("target", target());
  showNumber("giveUpAfter", giveUpAfter());
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
  tallyWidths = new Map();
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
  await runSearch(true);
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
async function runSearch(isNew = false) {
  const { want, rad, key } = searchSettings;
  setRunning(true);
  stopRequested = false;
  startPace();
  startLog(isNew);
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
  await Promise.all(Array.from({ length: searchSettings.parallel || PARALLEL }, worker));
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
  const outcome =
    results.length >= currentTarget
      ? `${fmt(results.length)} locations`
      : `${stopRequested ? "Stopped after" : "Ended with"} ${fmt(results.length)} of ${fmt(currentTarget)} locations${gaveUp.size ? `; ${gaveUp.size === 1 ? "1 country" : fmt(gaveUp.size) + " countries"} gave up` : ""}`;
  endLog(outcome);
  finishSearch(historyId, outcome);
  // A finished search needs no resuming; any other end is kept, so it can be continued later.
  if (results.length >= currentTarget) clearSavedSearch();
  else saveSearch();
  if (!stopRequested && !fatal) showShortfall();
  // Stopped by hand before it was done: it can be continued
  stoppedKey = stopRequested && !fatal && results.length < currentTarget ? runKey : "";
  // the settings these locations were found with, for continuing with a changed number
  ranSettings = !fatal && results.length ? currentSettings() : null;
  updateContinue();
}
/* The degrees a random direction's range spans, clockwise from dirFrom to dirTo; 360 for the whole way
   round. A function declaration, so "camera view", earlier in the page, can use it too. */
function directionSpan(v) {
  return (((v.dirTo - v.dirFrom) % 360) + 360) % 360 || 360;
}
/* The camera view without settings: along the road (each tool's roadHeading), level, zoom 0. It is the
   default of "Camera view", and the view in a tool without it (CAMERA_VIEW null). */
const DEFAULT_VIEW = Object.freeze({
  direction: "road",
  carAngle: 0,
  dirFrom: 0,
  dirTo: 360,
  tiltMode: "fixed",
  tilt: 0,
  tiltMin: -20,
  tiltMax: 20,
  zoomMode: "fixed",
  zoom: 0,
  zoomMin: 0,
  zoomMax: 2,
});
/* The settings a search runs with, from the form now; each tool adds its own (toolSearchSettings). */
function searchSettingsNow(key) {
  return {
    want: wanted(),
    rad: radius(),
    key,
    parallel: parallel(),
    giveUpAfter: giveUpLimit(),
    ...toolSearchSettings(),
    view: CAMERA_VIEW ? CAMERA_VIEW.view() : DEFAULT_VIEW,
  };
}
/** The settings of the current search, kept for going on after "Fill the gap".
 *  @type {{want: object, rad: number, key: string, parallel: number, giveUpAfter: number, useOlder: boolean,
 *          view: object}} */
let searchSettings = {
  want: {},
  rad: RADIUS_DEFAULT,
  key: "",
  parallel: PARALLEL,
  giveUpAfter: GIVE_UP_DEFAULT,
  useOlder: false,
  view: DEFAULT_VIEW,
};
$("form").onsubmit = e => {
  e.preventDefault();
  // (with a stopped search that cannot be continued, it asks first: see "continuing a stopped search")
  if (!confirmNewSearch()) startSearch();
};
$("stop").onclick = () => {
  stopRequested = true;
  $("stop").disabled = true;
  paint("Stopping after the lookups that are under way…");
};
