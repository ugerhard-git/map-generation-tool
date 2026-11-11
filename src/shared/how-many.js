// Shared code: step 3, how many, the search settings, the map name and the key. Used by both tools in this repository; the build puts it into a page
// where that page's app.js says /*SHARED how-many.js*/ (see src/assemble.js). It uses names that
// app.js defines, as if it were written there.
/* ---------- step 3: how many, map name and key ----------
   The number fields are plain text fields (with the number keypad on phones), not number fields:
   a number field reads "25.000", as written in Germany, as 25, and silently turns anything out of
   range into nothing. Here the visitor can write 25000, 25,000, 25.000, 25 000 or 25'000; a number
   out of range becomes the nearest one allowed, and the field then shows the number that will be used.
   The arrow keys still step the number. */
/* A whole number as typed, with any thousands separators; NaN if it is not one. */
function typedNumber(text) {
  const digits = String(text)
    .trim()
    .replace(/[\s.,'’_]/g, "");
  return /^\d{1,9}$/.test(digits) ? Number(digits) : NaN;
}
const NUMBER_FIELDS = {
  target: { lo: 1, hi: TARGET_MAX, d: TARGET_DEFAULT, step: 1 },
  radius: { lo: RADIUS_MIN, hi: RADIUS_MAX, d: RADIUS_DEFAULT, step: 50 },
  // how many random spots in a row may bring no new location before a country gives up
  giveUpAfter: { lo: GIVE_UP_MIN, hi: GIVE_UP_MAX, d: GIVE_UP_DEFAULT, step: 50 },
  // the largest map file, in MB (agreed with the owner, October 2026: 20 MB, as some places such as
  // Discord take no larger uploads)
  sizeLimit: { lo: 1, hi: 1000, d: SIZE_LIMIT_DEFAULT, step: 1 },
  // lookups sent to Google at the same time ("Lookups at the same time" under "Search")
  parallel: { lo: 1, hi: PARALLEL_MAX, d: PARALLEL, step: 1 },
};
/* The number in a field, kept within its range; the saved one (or the default) if none is typed. */
function fieldNumber(id) {
  const f = NUMBER_FIELDS[id],
    n = typedNumber($(id).value);
  if (Number.isNaN(n)) return wholeNumber(store.get(id, f.d), f.lo, f.hi, f.d);
  return Math.min(f.hi, Math.max(f.lo, n));
}
/* Shows a number in its field as the page writes numbers: "25,000". */
const showNumber = (id, n) => ($(id).value = fmt(n));
const target = () => fieldNumber("target");
const radius = () => fieldNumber("radius");
const giveUpAfter = () => fieldNumber("giveUpAfter");
const sizeLimit = () => fieldNumber("sizeLimit");
const parallel = () => fieldNumber("parallel");
$("sizeLimitOn").checked = store.get("sizeLimitOn", true) !== false;
/* The size limit's number only applies while it is ticked: greyed out otherwise. */
function updateSizeLimit() {
  $("sizeLimit").disabled = !$("sizeLimitOn").checked;
}
$("sizeLimitOn").addEventListener("change", () => {
  store.set("sizeLimitOn", $("sizeLimitOn").checked);
  updateSizeLimit();
  pruneSkipped = ""; // (a changed limit asks again)
  sizeSoon();
});
updateSizeLimit();
// Giving up is optional (agreed with the owner, October 2026): unticked, a country never gives up and the
// search runs until it is full or the visitor stops it. On by default, as before.
$("giveUpOn").checked = store.get("giveUpOn", true) !== false;
/* The spots in a row without a new location after which a country gives up; Infinity if it never does. */
const giveUpLimit = () => ($("giveUpOn").checked ? giveUpAfter() : Infinity);
/* The number of spots only applies while giving up is on: greyed out otherwise. */
function updateGiveUp() {
  $("giveUpAfter").disabled = !$("giveUpOn").checked;
}
$("giveUpOn").addEventListener("change", () => {
  store.set("giveUpOn", $("giveUpOn").checked);
  updateGiveUp();
});
updateGiveUp();
for (const [id, f] of Object.entries(NUMBER_FIELDS)) {
  showNumber(id, wholeNumber(store.get(id, f.d), f.lo, f.hi, f.d));
  // On leaving the field: keep the number and show it as it will be used
  $(id).onchange = () => {
    const n = fieldNumber(id);
    store.set(id, n);
    showNumber(id, n);
    if (id === "sizeLimit") {
      pruneSkipped = ""; // (a changed limit asks again)
      sizeSoon();
    }
    if (id === "target") {
      if (!running) searchTargets = new Map();
      if (!running && distributionUsed() && ownChosen()?.mode === "number") scaleOwnTo(n);
      renderShares();
    }
  };
  // While typing: the table of locations per country follows the number
  if (id === "target")
    $(id).oninput = () => {
      if (running || Number.isNaN(typedNumber($(id).value))) return;
      // (with your own numbers, their sum is the number of locations: they are scaled on leaving the
      // field, so the table does not set the field back while typing)
      if (distributionUsed() && ownChosen()?.mode === "number") return;
      searchTargets = new Map();
      renderShares();
    };
  // The arrow keys step the number, as in a number field
  $(id).onkeydown = e => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    const n = fieldNumber(id) + (e.key === "ArrowUp" ? f.step : -f.step);
    showNumber(id, Math.min(f.hi, Math.max(f.lo, n)));
    $(id).onchange();
  };
}
$("mapName").value = cleanText(store.get("mapName", ""), 100);
$("mapName").oninput = () => store.set("mapName", $("mapName").value.slice(0, 100));
/* The name suggested when the visitor types none: "Malta: No road name",
   "World (An Arbitrary World): End of coverage" (wantedLabel is each tool's own). */
function suggestedName() {
  const area = areaLabel(),
    dist = distributionLabel();
  return (area ? area + (dist ? ` (${dist})` : "") + ": " : "") + wantedLabel(wanted());
}
/* Shows the suggested name in the empty map name field. */
function updateMapName() {
  $("mapName").placeholder = suggestedName();
}
updateMapName();
/* The map name for the export: what the visitor typed, or the suggestion. */
const mapName = () => $("mapName").value.trim().slice(0, 100) || suggestedName();
// The key field is only shown when the site has no key of its own.
$("keyBox").hidden = !!GOOGLE_API_KEY;
$("apiKey").value = keyStore.get();
$("apiKey").onchange = () => keyStore.set($("apiKey").value.trim());
