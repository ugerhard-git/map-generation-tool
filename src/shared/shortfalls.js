// Shared code: the offer when countries fell short. Used by both tools in this repository; the build puts it into a page
// where that page's app.js says /*SHARED shortfalls.js*/ (see src/assemble.js). It uses names that
// app.js defines, as if it were written there.
/* ---------- shortfalls ----------
   When countries gave up (or no spots could be made in them), the search ends short. The offer under the
   buttons then lets the visitor share the missing locations between the countries that finished, in
   their proportions, and search on; or keep what was found. */
/* The countries that fell short, with how many each is missing. */
function shortfalls() {
  return [...searchTargets]
    .map(([c, wanted]) => ({ code: c, missing: wanted - (foundBy.get(c) || 0) }))
    .filter(s => s.missing > 0 && (gaveUp.has(s.code) || noSpots.has(s.code)));
}
/* The countries that have all they wanted and did not give up: they can take more. */
const finishedCountries = () =>
  [...searchTargets]
    .filter(([c, wanted]) => (foundBy.get(c) || 0) >= wanted && !gaveUp.has(c))
    .map(([c]) => c);
/* Shows the offer when countries fell short; does nothing otherwise. */
function showShortfall() {
  const short = shortfalls();
  if (!short.length) return hideShortfall();
  const gap = short.reduce((n, s) => n + s.missing, 0),
    donors = finishedCountries();
  const names = short
    .sort((a, b) => b.missing - a.missing)
    .map(
      s => `${countryName(s.code)} (${fmt(foundBy.get(s.code) || 0)} of ${fmt(searchTargets.get(s.code))})`,
    );
  const list =
    names.length > 8 ? names.slice(0, 8).join(", ") + ` and ${names.length - 8} more` : names.join(", ");
  $("shortfallTitle").textContent =
    `${short.length === 1 ? "1 country" : fmt(short.length) + " countries"} fell short: ${fmt(gap)} ${gap === 1 ? "location" : "locations"} missing.`;
  $("shortfallText").textContent =
    `Matching locations were too rare in ${list}. ` +
    (donors.length
      ? `"Fill the gap" shares the missing locations between the other ${donors.length === 1 ? "country" : fmt(donors.length) + " countries"}, in their proportions, and searches on.`
      : "No other country in this search can take them.");
  $("fillGap").hidden = !donors.length;
  $("shortfall").hidden = false;
}
function hideShortfall() {
  $("shortfall").hidden = true;
}
/* Shares the missing locations between the finished countries and searches on. */
async function fillGap() {
  const gap = shortfalls().reduce((n, s) => n + s.missing, 0),
    donors = finishedCountries();
  if (!gap || !donors.length || running) return;
  const extra = splitTotal(Object.fromEntries(donors.map(c => [c, searchTargets.get(c)])), gap);
  for (const [c, n] of Object.entries(extra)) searchTargets.set(c, searchTargets.get(c) + n);
  // The countries that gave up keep only what they found, so the total stays the number asked for.
  for (const { code: c } of shortfalls()) searchTargets.set(c, foundBy.get(c) || 0);
  hideShortfall();
  showError("");
  await runSearch();
}
$("fillGap").onclick = fillGap;
$("keepFound").onclick = () => {
  hideShortfall();
  clearSavedSearch();
  paint(`Kept ${fmt(results.length)} locations. Download the map file when you are ready.`);
};
