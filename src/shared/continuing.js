// Shared code: continuing a stopped search. Used by both tools in this repository; the build puts it into a page
// where that page's app.js says /*SHARED continuing.js*/ (see src/assemble.js). It uses names that
// app.js defines, as if it were written there.
/* ---------- continuing a stopped search ----------
   After the visitor stopped a search before it was done, it can be continued from where it stopped, as
   long as the settings are those it ran with (agreed with the owner, October 2026); "Start a new search"
   starts afresh instead. With changed settings, only a new search is possible, and a warning says that
   it starts from scratch and replaces what was found. Settings that only shape the map file (name, tags,
   size limit) can change freely: they do not change which locations are found. Across a closed tab, the
   unfinished search is offered at the top of the page instead (see "unfinished search"). */
const MAP_FILE_SETTINGS = [
  "mapName",
  ...Object.keys(TAG_OPTIONS),
  "tagDate",
  "territoryTag",
  "sizeLimitOn",
  "sizeLimit",
];
/* The settings that decide which locations are found, as text to compare. */
function searchKey(s) {
  return JSON.stringify(
    Object.fromEntries(Object.entries(cleanSettings(s)).filter(([k]) => !MAP_FILE_SETTINGS.includes(k))),
  );
}
/* True while a stopped search could be continued (with these settings or the ones it ran with).
   (A function declaration, as the summaries ask before this part of the file has run.) */
function stoppedSearch() {
  return !!stoppedKey && !running && results.length > 0 && results.length < currentTarget;
}
/* Shows "Continue the search" while the settings are unchanged, and says what "Start a new search" does. */
function updateContinue() {
  // (stoppedSearch looks at stoppedKey first, so this also works while the page is starting up)
  const can = stoppedSearch(),
    same = can && searchKey(currentSettings()) === stoppedKey;
  $("continueGo").hidden = !same;
  $("go").textContent = can ? "Start a new search" : "Find locations";
  $("go").classList.toggle("second", same);
  $("continueNote").hidden = !can;
  $("continueNote").className = "msg " + (same ? "note" : "error");
  if (can)
    $("continueNote").textContent = same
      ? `You stopped the search at ${fmt(results.length)} of ${fmt(currentTarget)} locations. Continue it, or start a new search, which replaces them.`
      : `You changed the settings, so a new search starts from scratch: it replaces the ${fmt(results.length)} locations found. Change them back to continue the stopped search instead.`;
}
/* "Continue the search": runs the stopped search on, with the same results and plan. */
$("continueGo").onclick = async () => {
  if (!stoppedSearch() || searchKey(currentSettings()) !== stoppedKey) return;
  showError("");
  const key = GOOGLE_API_KEY || $("apiKey").value.trim();
  if (!key) {
    showError("Enter your Google API key in step 3 first.");
    $("apiKey").focus();
    return;
  }
  if (!GOOGLE_API_KEY) keyStore.set(key);
  searchSettings = searchSettingsNow(key);
  stoppedKey = "";
  forgetPrune();
  hideShortfall();
  updateContinue();
  if (!(await googleReady(key))) {
    stoppedKey = runKey; // (still there, for another try)
    updateContinue();
    return;
  }
  await runSearch();
};
