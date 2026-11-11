// Shared code: looking along the coverage. Only the Map Generation Tool uses it (Unofficial says
// COVERAGE_WALK = null); the build puts it into a page where that page's app.js says /*SHARED walk.js*/
// (see src/assemble.js). It uses names that app.js defines, as if it were written there.
/* ---------- look along the coverage ----------
   Adapted from the Various Map Generator's "Check linked panos" (written anew, not copied; November 2026,
   agreed with the owner). From the panorama found at a random spot, the search follows Google's arrows to
   the panoramas next to it, as one would by clicking along the road in Street View:
   - "Until the first match": while no panorama matches what is asked for, look at the next ones along the
     road, up to "Give up after" of them in a row; stop at the first match. With a period set, the other
     dates of each photo (its "older" photos) are tried too. Only with something asked for: without it,
     every panorama matches, so there is nothing to look further for.
   - "Follow the coverage": keep going along the roads from every location found, and take the next one at
     least lookAlongSpacing metres from all others; at most lookAlongMax locations from one random spot.
     Panoramas closer than that to a location of this walk are passed through without a check and do not
     count towards "Give up after".
   A walk goes breadth first (every way from a panorama, one step at a time), never into another country
   or onto coverage that is not Google's own, and never twice through one panorama. It stops when the
   search stops, when the country is full, and after WALK_LOOKUPS_PER_STEP lookups for each panorama of
   "Give up after" (plus those needed to cross the distance between locations) without a new location, so
   a walk through a dense city grid ends too. Giving up on a country and the time left still count random
   spots (see miss and countPace): a spot counts as a miss only when its walk found nothing either. */
const LOOK_ALONG = ["off", "first", "follow"];
const WALK_LOOKUPS_PER_STEP = 10;
const WALK_PANO_GAP = 5; // metres: panoramas are rarely closer together along a road (for the lookups allowed)
/* The choice in the form: "off", "first" or "follow". */
const lookAlongChosen = () => document.querySelector("input[name=lookAlong]:checked")?.value || "off";
/* The way a search looks along the coverage: "Until the first match" is off when nothing is asked for. */
const lookAlongMode = (mode, w) => (mode === "first" && !anythingWanted(w) ? "off" : mode);
setRadio("lookAlong", LOOK_ALONG.includes(store.get("lookAlong")) ? store.get("lookAlong") : "off");
for (const r of document.querySelectorAll("input[name=lookAlong]"))
  r.addEventListener("change", () => {
    store.set("lookAlong", lookAlongChosen());
    updateLookAlong();
  });
/* "Until the first match" needs something asked for; the numbers apply only to the ways that use them:
   greyed out otherwise. */
function updateLookAlong() {
  const w = wanted(),
    mode = lookAlongMode(lookAlongChosen(), w);
  $("lookAlongFirst").disabled = !anythingWanted(w);
  $("lookAlongDepth").disabled = mode === "off";
  $("lookAlongSpacing").disabled = mode !== "follow";
  $("lookAlongMax").disabled = mode !== "follow";
}
updateLookAlong(); // (and after every change in the form: see the summary below)
/* The settings in the form, as kept in the history (see currentSettings). */
const lookAlongSettings = () => ({
  lookAlong: lookAlongChosen(),
  lookAlongDepth: fieldNumber("lookAlongDepth"),
  lookAlongSpacing: fieldNumber("lookAlongSpacing"),
  lookAlongMax: fieldNumber("lookAlongMax"),
});
/* The settings in words: "along the coverage until a match", "following the coverage, 1,000 m apart, at most
   20 from one spot"; "" when off. ("Give up after" is left out: beside the country's giving up, it would
   read as the same thing.) */
function lookAlongWords(s, w) {
  const mode = lookAlongMode(s.lookAlong, w);
  if (mode === "first") return "along the coverage until a match";
  if (mode === "follow")
    return `following the coverage, ${fmt(s.lookAlongSpacing)} m apart, at most ${fmt(s.lookAlongMax)} from one spot`;
  return "";
}
const lookAlongIsDefault = s =>
  s.lookAlong === "off" &&
  s.lookAlongDepth === TOOL_NUMBER_FIELDS.lookAlongDepth.d &&
  s.lookAlongSpacing === TOOL_NUMBER_FIELDS.lookAlongSpacing.d &&
  s.lookAlongMax === TOOL_NUMBER_FIELDS.lookAlongMax.d;
/* The panoramas to look at next from one: those its arrows lead to, and with "Until the first match" and a
   period, its other dates in that period. */
function nextPanos(r, want, follow) {
  const ids = r.links.map(l => l.pano).filter(id => typeof id === "string" && id);
  if (!follow && want.years) for (const o of r.older) if (inYears(o.date, want.years)) ids.push(o.pano);
  return ids;
}
/* Looks along the coverage from the panorama found at a random spot in a country (start; keptStart: whether
   it became a location). keep(pano, spacing) is the search's check that keeps a panorama as a location,
   at least spacing metres from the others (see keepPanorama). Resolves to the number of locations kept. */
async function walkAlong(start, code, key, want, keptStart, keep) {
  const o = searchSettings.lookAlong;
  if (!o || o.mode === "off" || (o.mode === "first" && keptStart)) return 0;
  if (countryAt(start.lat, start.lng) !== code) return 0;
  const follow = o.mode === "follow";
  const full = () => (foundBy.get(code) || 0) >= searchTargets.get(code);
  // the lookups allowed without a new location
  const leash = WALK_LOOKUPS_PER_STEP * o.depth + (follow ? 2 * Math.ceil(o.spacing / WALK_PANO_GAP) : 0);
  const mine = keptStart ? [start] : []; // this walk's locations
  const seen = new Set([start.panoId]);
  // each panorama to go on from, with the panoramas in a row without a match that led to it (the one at
  // the random spot does not count: it is not along the coverage)
  const queue = [{ r: start, misses: 0 }];
  let kept = 0,
    sinceKept = 0;
  while (queue.length) {
    const { r, misses } = queue.shift();
    if (misses >= o.depth) continue;
    for (const id of nextPanos(r, want, follow)) {
      if (seen.has(id)) continue;
      seen.add(id);
      if (stopRequested || fatal || full() || sinceKept >= leash) return kept;
      sinceKept++;
      stats.walked++;
      const a = await lookupPano(id, key);
      if (keyRefused) {
        fatal = "Google refused the API key. Check that it is right and has the Maps JavaScript API enabled.";
        return kept;
      }
      if (a.status !== "OK") {
        stats.failed++;
        continue;
      }
      // not on into another country, nor onto coverage that is not Google's own
      if (!isOfficial(a.copyright) || countryAt(a.lat, a.lng) !== code) continue;
      // too close to a location of this walk to be one: only passed through
      if (follow && mine.some(m => distance(a.lat, a.lng, m.lat, m.lng) < o.spacing)) {
        queue.push({ r: a, misses });
        continue;
      }
      if (await keep(a, follow ? o.spacing : MIN_SPACING)) {
        kept++;
        sinceKept = 0;
        if (!follow || kept >= o.max) return kept;
        mine.push(a);
        queue.push({ r: a, misses: 0 });
      } else if (fatal) return kept;
      else queue.push({ r: a, misses: misses + 1 });
    }
  }
  return kept;
}

/* Looking along the coverage as the rest of the page sees it (the settings, the history, the "Search"
   section and the search): through this one name, so a tool without it says COVERAGE_WALK = null. */
const COVERAGE_WALK = {
  /* The search's settings (see toolSearchSettings): the way, after what is asked for. */
  search: () => {
    const s = lookAlongSettings();
    return {
      mode: lookAlongMode(s.lookAlong, wanted()),
      depth: s.lookAlongDepth,
      spacing: s.lookAlongSpacing,
      max: s.lookAlongMax,
    };
  },
  walk: walkAlong,
  /* Its part of currentSettings, cleanSettings and applySettings (through the tool's own, see "settings:
     this tool"). Settings from before it get the defaults: off. */
  settings: lookAlongSettings,
  clean: r => ({
    lookAlong: LOOK_ALONG.includes(r.lookAlong) ? r.lookAlong : "off",
    ...Object.fromEntries(
      ["lookAlongDepth", "lookAlongSpacing", "lookAlongMax"].map(id => {
        const f = TOOL_NUMBER_FIELDS[id];
        return [id, wholeNumber(r[id], f.lo, f.hi, f.d)];
      }),
    ),
  }),
  apply: s => {
    setRadio("lookAlong", s.lookAlong);
    store.set("lookAlong", s.lookAlong);
    for (const id of ["lookAlongDepth", "lookAlongSpacing", "lookAlongMax"]) {
      showNumber(id, s[id]);
      store.set(id, s[id]);
    }
    updateLookAlong();
  },
  /* Its words in the history (see historyDetails): none when off. */
  details: s => {
    const words = lookAlongWords(s, wantedOf(s));
    return words ? [words] : [];
  },
  /* Its part of the "Search" section's summary, "changed" mark and reset (see "more options"). */
  // (updateMore asks for it after every change in the form, also of the filters, which decide whether
  // "Until the first match" can be chosen: so the fields are updated here)
  summary: () => {
    updateLookAlong();
    return lookAlongWords(lookAlongSettings(), wanted());
  },
  changed: () => !lookAlongIsDefault(lookAlongSettings()),
  reset: () => {
    setRadio("lookAlong", "off");
    store.set("lookAlong", "off");
    for (const [id, f] of Object.entries(TOOL_NUMBER_FIELDS)) setControl(id, fmt(f.d));
    updateLookAlong();
  },
};
