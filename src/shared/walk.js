// Shared code: looking along the coverage. Only the Map Generation Tool uses it (Unofficial says
// COVERAGE_WALK = null); the build puts it into a page where that page's app.js says /*SHARED walk.js*/
// (see src/assemble.js). It uses names that app.js defines, as if it were written there.
/* ---------- look along the coverage ----------
   Adapted from the Various Map Generator's "Check linked panos" (written anew, not copied; November 2026,
   agreed with the owner). When the panorama found at a random spot does not match what is asked for, the
   search follows Google's arrows to the panoramas next to it, as one would by clicking along the road in
   Street View, up to "Give up after" of them in a row, and stops at the first that matches. With a period
   set, the other dates of each photo (its "older" photos) are tried too. Only with something asked for:
   without it, every panorama matches, so there is nothing to look further for.
   A walk goes breadth first (every way from a panorama, one step at a time), never into another country
   or onto coverage that is not Google's own, and never twice through one panorama. It stops when the
   search stops, when the country is full, and after WALK_LOOKUPS_PER_STEP lookups for each step of "Give up
   after", so a walk through a dense city grid ends too. A spot counts as a miss for giving up only when
   its walk found nothing either (see attempt).
   "Follow the coverage", which went on along the roads for more locations from one spot, was in the first
   version (plan step 33) and taken out again (plan step 34): on real coverage in Kazakhstan it took twice
   as long as random spots alone, as each step along a road is one more lookup, and its locations bunched on
   a few stretches of road. Its saved settings are cleared (see OLDER_SETTING_NAMES). */
const WALK_LOOKUPS_PER_STEP = 10;
// Settings of "Follow the coverage", saved from 11 November 2026 until it was taken out, are cleared
for (const id of ["lookAlongSpacing", "lookAlongMax"]) store.remove(id);
/* The settings saved as "follow" become off (it was the other way to look along the coverage). */
const cleanLookAlong = v => (v === "first" ? "first" : "off");
$("lookAlong").checked = cleanLookAlong(store.get("lookAlong")) === "first";
store.set("lookAlong", $("lookAlong").checked ? "first" : "off");
$("lookAlong").addEventListener("change", () => {
  store.set("lookAlong", $("lookAlong").checked ? "first" : "off");
  updateLookAlong();
});
/* Whether a search looks along the coverage: ticked, and something asked for. */
const lookAlongUsed = (s, w) => s.lookAlong === "first" && anythingWanted(w);
/* Looking along the coverage needs something asked for: greyed out otherwise. "Give up after" is shown only
   while it is used (agreed with the owner, November 2026); hidden, it keeps its saved value. */
function updateLookAlong() {
  const w = wanted();
  $("lookAlong").disabled = !anythingWanted(w);
  $("lookAlongDepthBox").hidden = !lookAlongUsed(lookAlongSettings(), w);
}
/* The settings in the form, as kept in the history (see currentSettings): lookAlong "first" or "off" (a
   word rather than true or false, as it was one of several ways at first). */
const lookAlongSettings = () => ({
  lookAlong: $("lookAlong").checked ? "first" : "off",
  lookAlongDepth: fieldNumber("lookAlongDepth"),
});
updateLookAlong(); // (and after every change in the form: see the summary below)
/* The panoramas to look at next from one: those its arrows lead to, and with a period, its other dates in
   that period. */
function nextPanos(r, want) {
  const ids = r.links.map(l => l.pano).filter(id => typeof id === "string" && id);
  if (want.years) for (const o of r.older) if (inYears(o.date, want.years)) ids.push(o.pano);
  return ids;
}
/* Looks along the coverage from the panorama found at a random spot in a country (start), which did not
   become a location. keep(pano) is the search's check that keeps a panorama as a location (see
   keepPanorama). Resolves to true when one was kept. */
async function walkAlong(start, code, key, want, keep) {
  const o = searchSettings.lookAlong;
  if (!o?.on || countryAt(start.lat, start.lng) !== code) return false;
  const full = () => (foundBy.get(code) || 0) >= searchTargets.get(code);
  const seen = new Set([start.panoId]);
  // each panorama to go on from, with the panoramas in a row without a match that led to it (the one at
  // the random spot does not count: it is not along the coverage)
  const queue = [{ r: start, misses: 0 }];
  let lookups = 0;
  while (queue.length) {
    const { r, misses } = queue.shift();
    if (misses >= o.depth) continue;
    for (const id of nextPanos(r, want)) {
      if (seen.has(id)) continue;
      seen.add(id);
      if (stopRequested || fatal || full() || lookups >= WALK_LOOKUPS_PER_STEP * o.depth) return false;
      lookups++;
      stats.walked++;
      const a = await lookupPano(id, key);
      if (keyRefused) {
        fatal = "Google refused the API key. Check that it is right and has the Maps JavaScript API enabled.";
        return false;
      }
      if (a.status !== "OK") {
        logEvent("failed", { status: a.status, pano: id });
        stats.failed++;
        continue;
      }
      logEvent("step", { from: r.panoId, ...logPano(a) });
      // not on into another country, nor onto coverage that is not Google's own
      if (!isOfficial(a.copyright) || countryAt(a.lat, a.lng) !== code) continue;
      if (await keep(a)) return true;
      if (fatal) return false;
      queue.push({ r: a, misses: misses + 1 });
    }
  }
  return false;
}

/* Looking along the coverage as the rest of the page sees it (the settings, the history, the "Search"
   section and the search): through this one name, so a tool without it says COVERAGE_WALK = null. */
const COVERAGE_WALK = {
  /* The search's settings (see toolSearchSettings). */
  search: () => {
    const s = lookAlongSettings();
    return { on: lookAlongUsed(s, wanted()), depth: s.lookAlongDepth };
  },
  walk: walkAlong,
  /* Its part of currentSettings, cleanSettings and applySettings (through the tool's own, see "settings:
     this tool"). Settings from before it get the default, off; so do those with "follow". */
  settings: lookAlongSettings,
  clean: r => {
    const f = TOOL_NUMBER_FIELDS.lookAlongDepth;
    return {
      lookAlong: cleanLookAlong(r.lookAlong),
      lookAlongDepth: wholeNumber(r.lookAlongDepth, f.lo, f.hi, f.d),
    };
  },
  apply: s => {
    $("lookAlong").checked = s.lookAlong === "first";
    store.set("lookAlong", s.lookAlong);
    showNumber("lookAlongDepth", s.lookAlongDepth);
    store.set("lookAlongDepth", s.lookAlongDepth);
    updateLookAlong();
  },
  /* Its words in the history (see historyDetails): none when not used. */
  details: s => (lookAlongUsed(s, wantedOf(s)) ? ["along the coverage until a match"] : []),
  /* Its part of the "Search" section's summary, "changed" mark and reset (see "more options"). */
  // (updateMore asks for it after every change in the form, also of the filters, which decide whether it
  // can be ticked: so the fields are updated here. "Give up after" is left out of the words: beside the
  // country's giving up, it would read as the same thing.)
  summary: () => {
    updateLookAlong();
    return lookAlongUsed(lookAlongSettings(), wanted()) ? "along the coverage until a match" : "";
  },
  changed: () =>
    $("lookAlong").checked || fieldNumber("lookAlongDepth") !== TOOL_NUMBER_FIELDS.lookAlongDepth.d,
  reset: () => {
    setControl("lookAlong", false);
    setControl("lookAlongDepth", fmt(TOOL_NUMBER_FIELDS.lookAlongDepth.d));
    updateLookAlong();
  },
};
