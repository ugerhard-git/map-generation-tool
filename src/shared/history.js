// Shared code: the history of searches. Used by both tools in this repository; the build puts it into a page
// where that page's app.js says /*SHARED history.js*/ (see src/assemble.js). It uses names that
// app.js defines, as if it were written there.
/* ---------- history of searches ----------
   Every search started with "Find locations" is kept in this browser ("mapgen.history", newest first,
   at most HISTORY_MAX), so it can be run again or its settings used again. Copied from Lookout and
   adapted: without shareable links, an entry holds the search settings themselves (see SearchSettings).
   An entry never holds the Google key, and the results are not kept. */
const HISTORY_MAX = 20;
/**
 * The settings of a search, as kept in the history. Each tool adds its filters (toolSettings): the Map
 * Generation Tool noRoadName, arrows, camGen4, camGen23, camBad, noBadCamera and useOlder; Unofficial
 * full360, minHeight, uploaderMode and uploaderNames.
 * @typedef {object} SearchSettings
 * @property {"countries"|"continent"|"world"} scope
 * @property {string[]} countries   country codes, for scope "countries"
 * @property {string} continent     the continent's code ("europe")
 * @property {string} distribution  a built-in distribution (Vali's map code, "aaw", or "continent" for a
 *                                  continent's own map; Unofficial: "land" or "equal"), or "own"
 * @property {{mode: string, values: Record<string, number>, name: string}|null} own  with distribution
 *                                  "own": the values themselves (a preset is kept as its values, too)
 * @property {boolean} noRoadName   (Map Generation Tool)
 * @property {"any"|"end"|"intersection"|"none"} arrows  the arrows asked for (before intersections: deadEnd)
 * @property {boolean} camGen4      the chosen cameras (none ticked: any camera but Gen 1)
 * @property {boolean} camGen23
 * @property {boolean} camBad
 * @property {boolean} noBadCamera  leave out bad camera coverage (only without chosen cameras)
 * @property {boolean} useOlder     use an older photo at the spot instead of bad camera, if there is one
 * @property {boolean} full360      (Unofficial) whole 360° photos only
 * @property {number} minHeight     (Unofficial) the smallest image height, in pixels; 0 for any
 * @property {"any"|"exclude"|"only"} uploaderMode  (Unofficial) whose photos
 * @property {string} uploaderNames (Unofficial) the uploaders, separated by commas
 * @property {boolean} yearsOn
 * @property {number} yearFrom
 * @property {number} monthFrom      1–12 (settings from before months were kept have none: January)
 * @property {number|"now"} yearTo  a year, or "now" for the current month
 * @property {number} monthTo        1–12 (none before months were kept: December)
 * @property {"road"|"car"|"random"} viewDirection  where the camera faces (see "camera view")
 * @property {number} carAngle      0–359, the angle to the car with viewDirection "car"
 * @property {number} dirFrom       0–359, and dirTo 0–360: the range of a random direction, clockwise
 *                                  from the front of the car (0 to 360, the default, is any direction)
 * @property {number} dirTo
 * @property {"fixed"|"random"} tiltMode
 * @property {number} tilt          −90 to 90, with tiltMode "fixed"
 * @property {number} tiltMin       −90 to 90, the range with tiltMode "random"
 * @property {number} tiltMax
 * @property {"fixed"|"random"} zoomMode
 * @property {number} zoom          0 to 4, with zoomMode "fixed"
 * @property {number} zoomMin       0 to 4, the range with zoomMode "random"
 * @property {number} zoomMax
 * @property {"any"|"town"|"country"} settlement  "Town or countryside" (settings from before: "any")
 * @property {"any"|"forest"|"farmland"|"grassland"|"bare"} landscape  "Landscape" (settings from before: "any")
 * @property {number} target
 * @property {number} radius
 * @property {number} parallel     lookups at the same time (settings from before: PARALLEL)
 * @property {number} giveUpAfter
 * @property {boolean} giveUpOn     false: a country never gives up
 * @property {boolean} sizeLimitOn  offer to make the map file smaller when it is over sizeLimit
 * @property {number} sizeLimit     the largest map file, in MB
 * @property {"both"|"own"|"parent"} territoryTag  how a territory's country tag reads
 * @property {string} mapName       the name typed in step 3, or "" for the suggested one
 * @property {boolean} tagCountry    the tags the map file gets (see TAG_OPTIONS)
 * @property {boolean} tagNoRoadName
 * @property {boolean} tagDeadEnd
 * @property {boolean} tagYear
 * @property {boolean} tagCamera
 * @property {"year"|"month"} tagDate  the date in the tag: "2023" or "04-2023"
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
    distribution: ownChosen() ? "own" : $("distribution").value,
    own: ownChosen()
      ? { mode: ownChosen().mode, values: { ...ownChosen().values }, name: ownChosen().name }
      : null,
    ...toolSettings(),
    yearsOn: $("yearsOn").checked,
    yearFrom: wholeNumber($("yearFrom").value, YEAR_FIRST, YEAR_LAST, YEAR_FIRST),
    monthFrom: wholeNumber($("monthFrom").value, 1, 12, 1),
    yearTo: cleanYearTo($("yearTo").value),
    monthTo: wholeNumber($("monthTo").value, 1, 12, 12),
    settlement: settlementChosen(),
    landscape: landscapeChosen(),
    ...(CAMERA_VIEW ? CAMERA_VIEW.settings() : {}),
    target: target(),
    radius: radius(),
    parallel: parallel(),
    giveUpAfter: giveUpAfter(),
    giveUpOn: $("giveUpOn").checked,
    sizeLimitOn: $("sizeLimitOn").checked,
    sizeLimit: sizeLimit(),
    mapName: $("mapName").value.trim().slice(0, 100),
    ...Object.fromEntries(Object.keys(TAG_OPTIONS).map(id => [id, $(id).checked])),
    tagDate: TAG_DATES.includes($("tagDate").value) ? $("tagDate").value : "year",
    territoryTag: territoryValue($("territoryTag").value),
  };
}
/* Settings read back from the history, an unfinished search or a settings file, checked like
   everything from outside: anything not well-formed becomes the default. This and currentSettings are
   the one description of the settings: a new setting is added to both (and to applySettings), and the
   history, the unfinished search and the settings file then all keep it. @returns {SearchSettings} */
function cleanSettings(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  return {
    scope: ["countries", "continent", "world"].includes(r.scope) ? r.scope : "countries",
    countries: Array.isArray(r.countries)
      ? [...new Set(r.countries.filter(c => typeof c === "string" && COUNTRIES.includes(c)))]
      : [],
    continent: isContinent(r.continent) ? r.continent : DEFAULT_CONTINENT,
    distribution: r.distribution === "own" && cleanOwn(r.own) ? "own" : cleanBuiltIn(r.distribution),
    own: r.distribution === "own" ? cleanOwn(r.own) : null,
    ...cleanToolSettings(r),
    yearsOn: r.yearsOn === true,
    yearFrom: wholeNumber(r.yearFrom, YEAR_FIRST, YEAR_LAST, YEAR_FIRST),
    // (settings from before months were kept have only years: January to December)
    monthFrom: wholeNumber(r.monthFrom, 1, 12, 1),
    yearTo: cleanYearTo(r.yearTo),
    monthTo: wholeNumber(r.monthTo, 1, 12, 12),
    // (settings from before "Town or countryside": anywhere)
    settlement: SETTLEMENT_CHOICES.includes(r.settlement) ? r.settlement : "any",
    // (settings from before "Landscape": any)
    landscape: LANDSCAPE_CHOICES.includes(r.landscape) ? r.landscape : "any",
    ...(CAMERA_VIEW ? CAMERA_VIEW.clean(r) : {}),
    target: wholeNumber(r.target, 1, TARGET_MAX, TARGET_DEFAULT),
    radius: wholeNumber(r.radius, RADIUS_MIN, RADIUS_MAX, RADIUS_DEFAULT),
    parallel: wholeNumber(r.parallel, 1, PARALLEL_MAX, PARALLEL),
    giveUpAfter: wholeNumber(r.giveUpAfter, GIVE_UP_MIN, GIVE_UP_MAX, GIVE_UP_DEFAULT),
    // (settings from before it was optional give up, as searches did then)
    giveUpOn: r.giveUpOn !== false,
    // (settings from before the size limit get the default: under 20 MB)
    sizeLimitOn: r.sizeLimitOn !== false,
    sizeLimit: wholeNumber(r.sizeLimit, 1, 1000, SIZE_LIMIT_DEFAULT),
    mapName: cleanText(r.mapName, 100).trim(),
    // (entries from before the tags were kept get the defaults)
    ...Object.fromEntries(
      Object.entries(TAG_OPTIONS).map(([id, d]) => [id, typeof r[id] === "boolean" ? r[id] : d]),
    ),
    tagDate: TAG_DATES.includes(r.tagDate) ? r.tagDate : "year",
    // (settings from before get both names for a territory, the default)
    territoryTag: territoryValue(r.territoryTag),
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
  // (compared after cleanSettings, as the history keeps them, so the order of the settings does not matter)
  const settings = currentSettings(),
    same = JSON.stringify(cleanSettings(settings));
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
/* Puts the settings a search goes on with on its history entry (after continuing with a changed number). */
function updateHistorySettings(id, settings) {
  if (!id) return;
  const list = loadHistory(),
    e = list.find(x => x.id === id);
  if (!e) return;
  e.settings = settings;
  e.title = mapName();
  saveHistory(list);
  if (!$("history").hidden) renderHistory();
}
/* One line about an entry's settings: "Whole world · An Arbitrary World · No road name · 1,000 locations · 1,000 m". */
function historyDetails(s) {
  const bits = [];
  if (s.scope === "world") bits.push("Whole world");
  else if (s.scope === "continent") bits.push(continentName(s.continent) || "A continent");
  else if (s.countries.length <= 2) bits.push(s.countries.map(countryName).join(" and ") || "No countries");
  else bits.push(`${s.countries.length} countries`);
  if (s.scope !== "countries" || s.countries.length > 1)
    bits.push(s.distribution === "own" ? s.own?.name || "your own distribution" : builtInWords(s));
  bits.push(wantedLabel(wantedOf(s)), ...toolDetails(s));
  if (CAMERA_VIEW) bits.push(...CAMERA_VIEW.details(s));
  bits.push(`${fmt(s.target)} ${s.target === 1 ? "location" : "locations"}`, `${fmt(s.radius)} m`);
  if (s.parallel !== PARALLEL) bits.push(`${fmt(s.parallel)} lookups at once`);
  if (!s.giveUpOn) bits.push("never give up");
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
  // a distribution of one's own comes back as "Your own" (replacing the one being edited)
  if (s.distribution === "own" && s.own) {
    own = { ...s.own, values: { ...s.own.values } };
    saveOwn();
  }
  whereChanged(); // fills the list of maps for this area
  if ([...$("distribution").options].some(o => o.value === s.distribution))
    $("distribution").value = s.distribution;
  whereChanged();
  applyToolSettings(s);
  setRadio("settlement", s.settlement);
  store.set("settlement", s.settlement);
  if (s.settlement !== "any") loadSettlements();
  setRadio("landscape", s.landscape);
  store.set("landscape", s.landscape);
  landscapeNote();
  for (const id of ["yearsOn", "giveUpOn", "sizeLimitOn", ...Object.keys(TAG_OPTIONS)]) {
    $(id).checked = s[id];
    store.set(id, s[id]);
  }
  for (const id of [
    "yearFrom",
    "monthFrom",
    "yearTo",
    "monthTo",
    "tagDate",
    "territoryTag",
    "target",
    "radius",
    "parallel",
    "giveUpAfter",
    "sizeLimit",
    "mapName",
  ]) {
    if (NUMBER_FIELDS[id]) showNumber(id, s[id]);
    else $(id).value = String(s[id]);
    store.set(id, s[id]);
  }
  if (CAMERA_VIEW) CAMERA_VIEW.apply(s);
  updateSizeLimit();
  updateGiveUp();
  updateYears();
  updateTagDate();
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
