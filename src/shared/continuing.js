// Shared code: continuing a stopped search. Used by both tools in this repository; the build puts it into a page
// where that page's app.js says /*SHARED continuing.js*/ (see src/assemble.js). It uses names that
// app.js defines, as if it were written there.
/* ---------- continuing a stopped search ----------
   After the visitor stopped a search before it was done, it can be continued from where it stopped, as
   long as the settings that decide which locations are found are those it ran with (agreed with the owner,
   October 2026); "Start a new search" starts afresh instead. Settings that only shape the map file (name,
   tags, size limit) can change freely: they do not change which locations are found.
   Since November 2026 (at the owner's request) the settings that only say how many locations and how the
   search runs (RUN_SETTINGS: the number, the radius, the lookups at the same time, giving up) can change
   too: continuing keeps what was found. A higher number looks for more; a lower one keeps that many,
   chosen at random, each country its share (planTargets). This also works after a search that ended, so a
   finished map can be made larger or smaller.
   When a setting that decides which locations are found has changed (where, the filters, the
   distribution, the camera view), the locations found may not fit the new settings, and the page cannot
   tell which do: only a new search is possible. A note says so, and "Start a new search" asks first, in a
   dialog that names the sections that changed. (Keeping the locations that still fit is in the plan, to be
   discussed later.) Across a closed tab, the unfinished search is offered at the top of the page instead
   (see "unfinished search"). */
const MAP_FILE_SETTINGS = [
  "mapName",
  ...Object.keys(TAG_OPTIONS),
  "tagDate",
  "territoryTag",
  "sizeLimitOn",
  "sizeLimit",
];
const RUN_SETTINGS = ["target", "radius", "parallel", "giveUpAfter", "giveUpOn"];
/* The settings that decide which locations are found, as text to compare. */
function searchKey(s) {
  return JSON.stringify(
    Object.fromEntries(Object.entries(cleanSettings(s)).filter(([k]) => !MAP_FILE_SETTINGS.includes(k))),
  );
}
/* The settings that decide whether a location fits, as text to compare: searchKey without RUN_SETTINGS. */
function fitKey(s) {
  const c = cleanSettings(s);
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(c).filter(([k]) => !MAP_FILE_SETTINGS.includes(k) && !RUN_SETTINGS.includes(k)),
    ),
  );
}
/* True while a stopped search could be continued (with these settings or the ones it ran with).
   (A function declaration, as the summaries ask before this part of the file has run.) */
function stoppedSearch() {
  return !!stoppedKey && !!ranSettings && !running && results.length > 0 && results.length < currentTarget;
}
/* The locations each country gets with the settings in the form; only those with at least one. */
const plannedTargets = () => Object.fromEntries(Object.entries(planTargets()).filter(([, n]) => n > 0));
/* What continuing with the settings in the form would do, or null when it cannot: the search must have
   results from settings that still fit (ranSettings), and, unless it was stopped, a changed number. */
function continuePlan() {
  if (!ranSettings || running || !results.length || fitKey(currentSettings()) !== fitKey(ranSettings))
    return null;
  const targets = plannedTargets(),
    total = Object.values(targets).reduce((a, b) => a + b, 0);
  const kept = Object.entries(targets).reduce((n, [c, t]) => n + Math.min(t, foundBy.get(c) || 0), 0);
  if (!stoppedSearch() && total === currentTarget) return null;
  return { targets, total, kept, changed: searchKey(currentSettings()) !== searchKey(ranSettings) };
}
/* The sections of the form whose settings differ from those the search ran with, and that decide which
   locations are found: "Roads and arrows", "Photos", … (from where each setting is on the page). */
function changedSections() {
  const now = cleanSettings(currentSettings()),
    then = cleanSettings(ranSettings);
  const fieldOf = { countries: "country", own: "distribution" };
  const names = [];
  for (const k of Object.keys(now)) {
    if (MAP_FILE_SETTINGS.includes(k) || RUN_SETTINGS.includes(k)) continue;
    if (JSON.stringify(now[k]) === JSON.stringify(then[k])) continue;
    const id = fieldOf[k] || k;
    const el = document.getElementById(id) || document.querySelector(`[name="${id}"]`);
    const more = el?.closest("details.more"),
      step = el?.closest(".step");
    const name = more
      ? more.querySelector(".more-title")?.textContent
      : step?.querySelector("h2")?.textContent.replace(/^\d+/, "");
    const label = (name || "Other settings").trim();
    if (!names.includes(label)) names.push(label);
  }
  return names;
}
/* Shows "Continue the search" when it can go on, and says what it and "Start a new search" do. */
function updateContinue() {
  // (stoppedSearch looks at stoppedKey first, so this also works while the page is starting up)
  const stopped = stoppedSearch(),
    plan = stopped || ranSettings ? continuePlan() : null;
  $("continueGo").hidden = !plan;
  $("go").textContent = stopped || plan ? "Start a new search" : "Find locations";
  $("go").classList.toggle("second", !!plan);
  $("continueNote").hidden = !stopped && !plan;
  $("continueNote").className = "msg " + (plan ? "note" : "error");
  if ($("continueNote").hidden) return;
  const n = results.length,
    where = stopped ? `You stopped the search at ${fmt(n)} of ${fmt(currentTarget)} locations.` : "";
  let text;
  if (!plan)
    text = `You changed settings that decide which locations are found, so the ${fmt(n)} locations found cannot be kept: a new search starts from scratch and replaces them. Change them back to continue the stopped search instead.`;
  else if (!plan.changed) text = `${where} Continue it, or start a new search, which replaces them.`;
  else if (plan.kept < n)
    text = `${where} Continuing keeps ${fmt(plan.kept)} of the ${fmt(n)} locations, chosen at random (each country keeps its share)${plan.total > plan.kept ? `, and looks for ${fmt(plan.total - plan.kept)} more` : ""}. A new search replaces them all.`;
  else
    text = `${where} Continuing keeps the ${fmt(n)} locations found and looks for ${fmt(plan.total - n)} more, with your changed settings. A new search replaces them.`;
  $("continueNote").textContent = text.trim();
}
/* "Continue the search": runs the search on with the results found. With a changed number, each country
   gets its new share first: a lower one keeps that many of its locations, chosen at random. */
$("continueGo").onclick = async () => {
  const plan = continuePlan();
  if (!plan) return;
  showError("");
  const key = GOOGLE_API_KEY || $("apiKey").value.trim();
  if (!key) {
    showError("Enter your Google API key in step 3 first.");
    $("apiKey").focus();
    return;
  }
  if (!GOOGLE_API_KEY) keyStore.set(key);
  const before = results.length;
  if (plan.changed) {
    // each country keeps at most its new number, at random, in the order they were found
    const byCountry = new Map();
    for (const l of results) {
      if (!byCountry.has(l.cc)) byCountry.set(l.cc, []);
      byCountry.get(l.cc).push(l);
    }
    const keep = new Set();
    for (const [c, list] of byCountry) for (const l of randomPick(list, plan.targets[c] || 0)) keep.add(l);
    if (keep.size < results.length) replaceResults(results.filter(l => keep.has(l)));
    searchTargets = new Map(Object.entries(plan.targets));
    currentTarget = plan.total;
    // a country that gave up tries again if it may now try longer
    for (const c of [...gaveUp]) if ((missesInRow.get(c) || 0) < giveUpLimit()) gaveUp.delete(c);
    runKey = searchKey(currentSettings());
    ranSettings = currentSettings();
    updateHistorySettings(historyId, ranSettings);
  }
  searchSettings = searchSettingsNow(key);
  stoppedKey = "";
  forgetPrune();
  hideShortfall();
  if (results.length >= currentTarget) {
    // a lower number: nothing more to look for
    const outcome = `${fmt(results.length)} locations`;
    finishSearch(historyId, outcome);
    clearSavedSearch();
    paint(
      `Done: kept ${fmt(results.length)} of the ${fmt(before)} locations, chosen at random; each country kept its share.`,
    );
    updateContinue();
    return;
  }
  updateContinue();
  if (!(await googleReady(key))) {
    stoppedKey = runKey; // (still there, for another try)
    updateContinue();
    return;
  }
  await runSearch();
};
/* "Start a new search" while a stopped search cannot be continued, as settings that decide which
   locations are found changed: asks first, and says why (see the dialog "newSearch"). */
function confirmNewSearch() {
  if (!stoppedSearch() || fitKey(currentSettings()) === fitKey(ranSettings)) return false;
  const list = $("newSearchChanged");
  list.replaceChildren(...changedSections().map(n => makeElement("li", {}, n)));
  $("newSearchCount").textContent = fmt(results.length);
  openDialog("newSearch");
  return true;
}
$("newSearchGo").onclick = () => {
  closeDialog();
  startSearch();
};
$("newSearchCancel").onclick = closeDialog;
$("newSearchX").onclick = closeDialog;
