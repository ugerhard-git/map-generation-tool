// Indoor locations (Map Generation Tool): Google's own indoor panoramas are left out by default (only
// outdoor coverage is asked for), or allowed too, or the only ones kept. Whether a panorama is indoors is
// asked of Google once more: the nearest outdoor panorama at that very spot is the panorama itself only
// when it is outdoors. An "Indoor" tag can be added. Settings are kept and checked.
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
  // Google: every third panorama found with all of Google's coverage is indoors ("IN_…"); asking for
  // outdoor coverage only never gives one. The check at a panorama's spot (10 m, outdoor only) gives the
  // panorama itself when it is outdoors; for an indoor one, nothing or another, outdoor panorama nearby.
  // window.__checkFails makes that check fail.
  await p.evaluate(() => {
    let n = 0;
    const at = new Map();
    window.__sv = req => {
      const outdoorOnly = (req.sources || []).includes("outdoor");
      const spot = `${req.location.lat},${req.location.lng}`;
      if (req.radius === 10) {
        if (window.__checkFails) return { status: "UNKNOWN_ERROR" };
        const id = at.get(spot) || "";
        if (!id.startsWith("IN_")) return { id, lat: req.location.lat, lng: req.location.lng, links: [] };
        return n % 2 ? null : { id: "OUTNEAR_" + n, lat: req.location.lat, lng: req.location.lng, links: [] };
      }
      n++;
      const inside = !outdoorOnly && n % 3 === 0;
      const a = {
        id: (inside ? "IN_" : "OUT_") + n,
        lat: req.location.lat,
        lng: req.location.lng,
        links: [{ heading: 90, description: "" }],
      };
      at.set(`${a.lat},${a.lng}`, a.id);
      return a;
    };
  });
  const run = async (target = 12) => {
    await p.evaluate(() => (window.__requests = []));
    await search(p, { country: "Malta", target });
    await searchEnded(p);
    return p.evaluate(() => ({
      ids: results.map(l => l.panoId),
      indoor: results.map(l => l.indoor),
      sources: [
        ...new Set(window.__requests.filter(r => r.radius !== 10).map(r => (r.sources || []).join("+"))),
      ],
      checks: window.__requests.filter(r => r.radius === 10).length,
      stats: { ...stats },
    }));
  };
  const summary = () => p.textContent("#morePhotos .more-sum");

  // None (the default): outdoor coverage only, as before; no extra questions
  ok((await p.isChecked("#indoorNone")) && (await summary()) === "Any time", "none by default");
  let r = await run();
  ok(
    r.sources.join() === "google+outdoor" && r.checks === 0 && r.ids.every(id => id.startsWith("OUT_")),
    "none: only official outdoor coverage is asked for, and nothing more: " + r.sources.join(),
  );
  ok(
    r.indoor.every(i => i === false),
    "no location is indoors",
  );

  // Both: all of Google's coverage; each location is checked, and says whether it is indoors
  await p.check("#indoorBoth");
  ok(
    (await summary()) === "Any time, indoor too" && (await p.isVisible("#morePhotos .more-changed")),
    "both: the summary says so",
  );
  await p.check("#tagIndoor");
  r = await run(15);
  ok(r.sources.join() === "google", "both: all of Google's own coverage is asked for, indoors too");
  ok(
    r.ids.some(id => id.startsWith("IN_")) &&
      r.ids.some(id => id.startsWith("OUT_")) &&
      r.ids.every((id, i) => r.indoor[i] === id.startsWith("IN_")),
    "indoor and outdoor locations, each told right: " + r.ids.join(" "),
  );
  ok(
    r.checks >= r.ids.length && r.stats.indoorChecks === r.checks,
    "one more question for each: " + r.checks,
  );
  const tags = await p.evaluate(() =>
    JSON.parse(exportJson()).customCoordinates.map(c => [c.panoId, (c.extra?.tags || []).join()]),
  );
  ok(
    tags.every(([id, t]) => t.includes("Indoor") === id.startsWith("IN_")),
    "the Indoor tag, where it applies",
  );
  await p.evaluate(() => layer.eachLayer(m => m.getPopup && m.getPopup() && m.openPopup()));
  ok(
    (await p.evaluate(() =>
      results.filter(l => l.indoor).every(l => locationFacts(l).includes("Indoor")),
    )) === true,
    "the dot's popup says Indoor",
  );

  // Only: indoor locations only; outdoor ones are counted and left out
  await p.check("#indoorOnly");
  ok((await summary()) === "Any time, indoor only", "only: the summary says so");
  ok((await p.getAttribute("#mapName", "placeholder")) === "Malta: Indoor", "the map name says so");
  r = await run(6);
  ok(
    r.ids.length === 6 && r.ids.every(id => id.startsWith("IN_")),
    "only indoor locations: " + r.ids.join(" "),
  );
  ok(
    r.stats.notIndoor > 0 && /outdoor, not indoor/.test(await p.textContent("#tally")),
    "outdoor ones are counted as left out",
  );

  // When Google does not answer the check, the panorama is left out (it cannot be told)
  await p.evaluate(() => (window.__checkFails = true));
  await p.check("#indoorBoth");
  await p.evaluate(() => (window.__requests = []));
  await search(p, { country: "Malta", target: 3 });
  await p.waitForFunction(() => stats.failed >= 3 || !running);
  ok((await p.evaluate(() => results.length)) === 0, "a failed check: the panorama is left out");
  await p.click("#stop").catch(() => {});
  await searchEnded(p);
  await p.evaluate(() => (window.__checkFails = false));

  // Kept and checked
  ok(
    (await p.evaluate(() => localStorage.getItem("mapgen.indoor"))) === '"both"' &&
      (await p.evaluate(() => currentSettings().indoor)) === "both",
    "kept in the browser and the settings",
  );
  ok(
    (await p.evaluate(() =>
      [
        cleanSettings({}).indoor,
        cleanSettings({ indoor: "<b>" }).indoor,
        cleanSettings({ indoor: "only" }).indoor,
      ].join(),
    )) === "none,none,only",
    "settings from before, or nonsense, read as none",
  );
  ok(
    /indoor and outdoor/i.test(await p.evaluate(() => historyDetails(loadHistory()[0].settings))),
    "the history describes it",
  );
  ok(
    (await p.evaluate(() =>
      [
        cleanLocation({ lat: 35.9, lng: 14.4, heading: 1, panoId: "ABCD", cc: "MT", indoor: "yes" }).indoor,
        cleanLocation({ lat: 35.9, lng: 14.4, heading: 1, panoId: "ABCD", cc: "MT", indoor: true }).indoor,
      ].join(),
    )) === "false,true",
    "a saved location's indoor is checked",
  );
  await p.evaluate(() => applySettings(cleanSettings({ indoor: "only" })));
  ok(await p.isChecked("#indoorOnly"), "applied settings (history, settings file) set it");
  await p.click("#morePhotos .reset");
  ok((await p.isChecked("#indoorNone")) && (await summary()) === "Any time", "Reset to defaults: none");

  ok(errors.length === 0, "no page errors " + errors.join(" | "));
  await b.close();
  console.log(fail ? `${fail} FAILED` : "ALL PASS");
})();
