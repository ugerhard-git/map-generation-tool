// The forecast of the time left: "estimating" at first, then a rough time in the status line, worked out
// from each country's spots per location so far and the spots per second; countries without a location
// yet count with the spots left before they give up; smoothed; learning starts again with each run.
const { chromium } = require("./pw.js");
const { openPage, search, searchEnded } = require("./helpers.js");
(async () => {
  const b = await chromium.launch();
  let fail = 0;
  const ok = (c, m) => {
    console.log((c ? "PASS " : "FAIL ") + m);
    if (!c) fail++;
  };
  const { page: p, errors } = await openPage(b);

  // Rough times
  const words = await p.evaluate(() =>
    [20, 60, 150, 9.6 * 60, 23 * 60, 89 * 60, 3 * 3600, 30 * 3600, 5 * 86400].map(describeTimeLeft),
  );
  ok(
    words.join(" | ") ===
      [
        "less than a minute left",
        "about 1 minute left",
        "about 3 minutes left",
        "about 10 minutes left",
        "about 25 minutes left",
        "about 90 minutes left",
        "about 3 hours left",
        "about 30 hours left",
        "about 5 days left",
      ].join(" | "),
    "times are rough: " + words.join(" | "),
  );

  // The forecast itself, from a made-up state: Malta needs 5 more and has cost 10 spots per location
  // (50 spots); Luxembourg has found nothing in 100 spots, so it counts with the 1,900 spots left before
  // it gives up. 1,950 spots at 5 spots per second: 390 seconds.
  const forecast = await p.evaluate(() => {
    const now = Date.now();
    searchSettings = { ...searchSettings, giveUpAfter: 2000 };
    searchTargets = new Map([
      ["MT", 10],
      ["LU", 10],
    ]);
    foundBy = new Map([["MT", 5]]);
    missesInRow = new Map([["LU", 100]]);
    gaveUp = new Set();
    noSpots = new Set();
    startPace();
    pace.since = now - 30000;
    pace.spots = 150;
    pace.tries = new Map([
      ["MT", 50],
      ["LU", 100],
    ]);
    pace.found = new Map([["MT", 5]]);
    const first = secondsLeft(now);
    gaveUp.add("LU"); // a country that gave up costs nothing more
    const afterGivingUp = secondsLeft(now);
    gaveUp.clear();
    const early = { ...pace };
    pace.since = now - 5000; // too early
    const tooEarly = secondsLeft(now);
    Object.assign(pace, early);
    return { first, afterGivingUp, tooEarly };
  });
  ok(Math.round(forecast.first) === 390, "the forecast adds up each country's spots: " + forecast.first);
  ok(
    Math.round(forecast.afterGivingUp) === 10,
    "a country that gave up is left out: " + forecast.afterGivingUp,
  );
  ok(forecast.tooEarly === null, "nothing is forecast in the first seconds");

  // Countries likely to give up: figures from a real world search of 100,000 locations (October 2026).
  // New Zealand had found 2 locations in 2,692 spots and needed 1,916 more: 2.6 million spots if it went
  // on to the end, but with 2,000 misses in a row likely, it gives up after about 4,600 on average. The
  // United States (39 in 5,858, 4,278 more) will very likely fill up, so it counts in full.
  const odds = await p.evaluate(() => ({
    nz: spotsStillNeeded(1916, 2 / 2692, 2000, 0),
    us: spotsStillNeeded(4278, 39 / 5858, 2000, 0),
    easy: spotsStillNeeded(50, 0.5, 2000, 0),
    none: spotsStillNeeded(50, 0, 2000, 300),
    used: spotsStillNeeded(50, 0.01, 2000, 2000),
  }));
  ok(
    odds.nz > 4000 && odds.nz < 5200,
    `a country that will likely give up counts with the spots until it does: ${Math.round(odds.nz)}`,
  );
  ok(
    odds.us > 0.99 * 4278 * (5858 / 39) && odds.us <= 4278 * (5858 / 39),
    `a country that will likely fill up counts in full: ${Math.round(odds.us)}`,
  );
  ok(Math.round(odds.easy) === 100, "where every other spot finds one, 50 locations take 100 spots");
  ok(odds.none === 1700 && odds.used === 0, "nothing found yet: the spots left before giving up");
  ok(
    (await p.evaluate(() => {
      pace.since = Date.now() - 5000;
      return timeLeftText();
    })) === "estimating time left…",
    "until then it says it is estimating",
  );

  // Smoothing: the first forecast is shown as it is; a new one only moves it part of the way
  const smooth = await p.evaluate(() => {
    const now = Date.now();
    pace.since = now - 30000;
    pace.finishAt = 0;
    const a = timeLeftText(now); // 390 s: about 6 minutes
    foundBy.set("MT", 10); // Malta is full: only Luxembourg's 1,900 spots are left, 380 s
    missesInRow.set("LU", 100);
    const b = (pace.finishAt - now) / 1000;
    timeLeftText(now);
    const c = (pace.finishAt - now) / 1000;
    return { a, b, c };
  });
  ok(smooth.a === "about 7 minutes left", "the first forecast is shown: " + smooth.a);
  ok(
    Math.round(smooth.c) === Math.round(smooth.b + (380 - smooth.b) * 0.2),
    `a new forecast moves the one shown a fifth of the way: ${Math.round(smooth.b)} s to ${Math.round(smooth.c)} s`,
  );

  // In a running search: estimating first, then a time in the status line
  await p.evaluate(() => {
    window.__svDelay = 30;
    window.__sv = req => ({
      id: "TL_" + Math.random().toString(36).slice(2, 10),
      lat: req.location.lat,
      lng: req.location.lng,
      links: [],
    });
  });
  await search(p, { country: "Malta", target: 100000 });
  await p.waitForFunction(() => results.length >= 5);
  ok(/found, estimating time left…$/.test(await p.textContent("#now")), "a new search starts by estimating");
  const since = await p.evaluate(() => pace.since);
  ok(Date.now() - since < 30000 && (await p.evaluate(() => pace.tries.get("MT") > 0)), "learning restarted");
  await p.evaluate(() => (pace.since -= PACE_WAIT)); // as if 20 seconds had passed
  await p.waitForFunction(() => pace.spots >= PACE_SPOTS);
  await p.waitForFunction(() =>
    /, about [\d,]+ (minutes?|hours|days) left$/.test(document.getElementById("now").textContent),
  );
  ok(true, "then the status line shows the time left: " + (await p.textContent("#now")));
  await p.click("#stop");
  await searchEnded(p);
  ok(!/left/.test(await p.textContent("#now")), "a stopped search shows no forecast");

  ok(errors.length === 0, "no page errors " + errors.join(" | "));
  await b.close();
  console.log(fail ? `${fail} FAILED` : "ALL PASS");
})();
