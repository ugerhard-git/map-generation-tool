// Shared code: the forecast of the time left while a search runs. Used by both tools in this repository; the build puts it into a page
// where that page's app.js says /*SHARED time-left.js*/ (see src/assemble.js). It uses names that
// app.js defines, as if it were written there.
/* ---------- time left ----------
   A forecast of how long the running search still takes, learnt while it runs: for each country, how
   many random spots one new location has cost so far, and overall, how many spots per second the
   search gets through. Time left = the spots still needed in all countries / spots per second.
   Where locations are rare, a country is likely to give up (see giveUpAfter) long before it is full, so
   each country counts with the spots it can be expected to take until it is full or gives up
   (spotsStillNeeded); one that has found nothing yet counts with the spots it has left before giving
   up. The forecast is for the search to end: with countries that give up, it may end short. The
   countries that are hard to fill decide most of the result, as they also keep a search running at
   the end. Shown only after PACE_WAIT and PACE_SPOTS, as
   the first numbers jump around, and smoothed, so it does not jump with every location found.
   Learning starts again with every run (a new search, "Fill the gap", or continuing a saved one). */
const PACE_WAIT = 20000, // ms of searching before a forecast is shown
  PACE_SPOTS = 50, // random spots tried before a forecast is shown
  PACE_SMOOTH = 0.2; // how much a new forecast moves the one shown (0–1)
/** @type {{since: number, spots: number, tries: Map<string, number>, found: Map<string, number>, finishAt: number}} */
let pace = null;
/* Starts learning for a run. */
function startPace() {
  pace = { since: Date.now(), spots: 0, tries: new Map(), found: new Map(), hits: new Map(), finishAt: 0 };
}
/* Counts a random spot tried in a country (found 0), or the locations found from one (found > 0): more
   than one when the search looks along the coverage (see src/shared/walk.js). */
function countPace(code, found = 0) {
  if (!pace) return;
  if (!found) {
    pace.tries.set(code, (pace.tries.get(code) || 0) + 1);
    pace.spots++;
    return;
  }
  pace.found.set(code, (pace.found.get(code) || 0) + found);
  pace.hits.set(code, (pace.hits.get(code) || 0) + 1);
}
/* Seconds the search still needs, or null while there is too little to go on. */
function secondsLeft(now = Date.now()) {
  if (!pace || now - pace.since < PACE_WAIT || pace.spots < PACE_SPOTS) return null;
  const perSecond = pace.spots / ((now - pace.since) / 1000);
  let spots = 0;
  for (const [code, wanted] of searchTargets) {
    const need = wanted - (foundBy.get(code) || 0);
    if (need <= 0 || gaveUp.has(code) || noSpots.has(code)) continue;
    const tries = pace.tries.get(code) || 0,
      found = pace.found.get(code) || 0,
      // the spots that found something, and the locations each brought (one, unless the search looks
      // along the coverage)
      hits = pace.hits?.get(code) ?? found,
      perHit = hits ? found / hits : 1;
    spots += spotsStillNeeded(
      Math.ceil(need / perHit),
      tries ? hits / tries : 0,
      searchSettings.giveUpAfter,
      missesInRow.get(code) || 0,
    );
  }
  return spots / perSecond;
}
/* How many more random spots a country can be expected to take, until it has `need` more locations or
   gives up: each spot finds a location with chance `chance`, and the country gives up after `giveUp`
   spots in a row without one (it has `misses` of them already).
   The spots until the next location or giving up, whichever comes first, are on average
   (1 - (1 - chance)^giveUp) / chance; the country gets to the next location with chance
   1 - (1 - chance)^giveUp. Where locations are common, this is simply need / chance. Where they are rare,
   giving up soon is likely, and that is what the country costs: New Zealand at 1 location in 1,346 spots
   would need 2.6 million spots for 1,916 locations, but gives up after about 4,600 on average. */
function spotsStillNeeded(need, chance, giveUp, misses) {
  const first = Math.max(0, giveUp - misses); // spots left in the current run of misses
  if (chance <= 0) return first; // (Infinity for a country that never gives up and has found nothing yet)
  if (chance >= 1) return need;
  const logMiss = Math.log1p(-chance);
  const missRun = Math.exp(giveUp * logMiss); // chance of giveUp misses in a row
  const missFirst = Math.exp(first * logMiss);
  const spotsFirst = (1 - missFirst) / chance; // to the next location, or giving up
  const spotsEach = (1 - missRun) / chance; // the same for each location after that
  // Locations after the next one, counted with the chance of getting that far: 1 + s + s² + … (s = the
  // chance of finding each), at most need - 1.
  const rest = need - 1;
  const later = rest <= 0 ? 0 : missRun < 1e-12 ? rest : -Math.expm1(rest * Math.log1p(-missRun)) / missRun;
  return spotsFirst + (1 - missFirst) * spotsEach * later;
}
/* The forecast for the status line: "about 4 minutes left", or "estimating time left…" at first. The
   finish time shown moves only part of the way towards each new forecast. */
function timeLeftText(now = Date.now()) {
  const left = secondsLeft(now);
  if (left === null) return "estimating time left…";
  // a country that never gives up and has found nothing yet: no end can be foreseen
  if (!Number.isFinite(left)) return "time left unknown: nothing found yet in some countries";
  const finish = now + left * 1000;
  pace.finishAt = pace.finishAt ? pace.finishAt + (finish - pace.finishAt) * PACE_SMOOTH : finish;
  return describeTimeLeft(Math.max(0, (pace.finishAt - now) / 1000));
}
/* Seconds as a rough time: "less than a minute left", "about 25 minutes left", "about 3 hours left". */
function describeTimeLeft(seconds) {
  const minutes = seconds / 60;
  if (minutes < 1) return "less than a minute left";
  if (minutes < 90) {
    const m = minutes < 10 ? Math.round(minutes) : Math.round(minutes / 5) * 5;
    return `about ${m} ${m === 1 ? "minute" : "minutes"} left`;
  }
  const hours = minutes / 60;
  if (hours < 48) return `about ${Math.round(hours)} hours left`;
  return `about ${fmt(Math.round(hours / 24))} days left`;
}
