// Look along the coverage (src/shared/walk.js): when the panorama at a random spot does not match, follow
// its arrows to the first one that does.
// Google is simulated with one road across Kazakhstan: panoramas R0 to R999, 50 m apart going east, each
// with arrows to the one before and after it. A random spot gets a panorama somewhere on the road; every
// tenth panorama (R9, R19, …) has no road name.
const { chromium } = require("./pw.js");
const { openPage, search, searchEnded } = require("./helpers.js");
(async () => {
  const b = await chromium.launch();
  let fail = 0;
  const ok = (c, m) => {
    console.log((c ? "PASS " : "FAIL ") + m);
    if (!c) fail++;
  };
  // A browser that saved "Follow the coverage", taken out again
  const ctx = await b.newContext({ viewport: { width: 1360, height: 860 } });
  await ctx.addInitScript(() => {
    if (!sessionStorage.getItem("seeded")) {
      localStorage.setItem("mapgen.lookAlong", '"follow"');
      localStorage.setItem("mapgen.lookAlongSpacing", "2500");
      localStorage.setItem("mapgen.lookAlongMax", "20");
      sessionStorage.setItem("seeded", "1");
    }
  });
  const { page: p, errors } = await openPage(b, "ok", ctx);
  await p.evaluate(() => {
    const N = 1000,
      LAT = 48,
      LNG = 67,
      STEP = 50 / (111320 * Math.cos((LAT * Math.PI) / 180)); // 50 m in degrees of longitude
    const nameless = i => i % 10 === 9;
    const pano = i => ({
      id: "R" + String(i).padStart(4, "0"),
      lat: LAT,
      lng: LNG + i * STEP,
      links: [i - 1, i + 1]
        .filter(j => j >= 0 && j < N)
        .map(j => ({
          heading: j > i ? 90 : 270,
          pano: "R" + String(j).padStart(4, "0"),
          description: nameless(i) ? "" : "Road",
        })),
    });
    window.__road = { N, pano };
    // a random spot: a panorama on the road, picked from the spot's position
    window.__spotPano = req => Math.floor(((req.location.lng * 1000) % 1) * N);
    window.__sv = req => (req.pano ? pano(Number(req.pano.slice(1))) : pano(window.__spotPano(req)));
    // whether each walk found a location, as they come
    window.__walks = [];
    const walk = COVERAGE_WALK.walk;
    COVERAGE_WALK.walk = async (...a) => {
      const n = await walk(...a);
      window.__walks.push(n);
      return n;
    };
  });
  const idx = id => Number(id.slice(1));
  const run = async opts => {
    await p.evaluate(() => {
      window.__requests = [];
      window.__walks = [];
    });
    await search(p, { country: "Kazakhstan", ...opts });
    await searchEnded(p);
    return p.evaluate(() => ({
      ids: results.map(l => l.panoId),
      tries: stats.tries,
      walked: stats.walked,
      byPano: window.__requests.filter(r => r.pano).length,
      walks: window.__walks,
    }));
  };
  const setNumber = async (id, n) => {
    await p.fill("#" + id, String(n));
    await p.dispatchEvent("#" + id, "change");
  };

  ok(
    (
      await p.evaluate(() => [
        localStorage.getItem("mapgen.lookAlong"),
        localStorage.getItem("mapgen.lookAlongSpacing"),
        localStorage.getItem("mapgen.lookAlongMax"),
      ])
    ).join() === '"off",,',
    '"Follow the coverage" saved before: off, its numbers cleared',
  );

  // The tick box: off by default; only with something asked for; "Give up after" shown only while used
  const state = () =>
    p.evaluate(
      () =>
        (document.getElementById("lookAlong").disabled ? "-" : "+") +
        (document.getElementById("lookAlongDepthBox").hidden ? "-" : "+"),
    );
  ok(!(await p.isChecked("#lookAlong")), "off by default");
  ok((await state()) === "--", "nothing asked for: greyed out, no number: " + (await state()));
  await p.check("#noRoadName");
  ok((await state()) === "+-", "with No road name, it can be ticked: " + (await state()));
  await p.check("#lookAlong");
  ok((await state()) === "++", "ticked: Give up after is shown: " + (await state()));
  ok(
    /along the coverage until a match/.test(await p.textContent("#sumSearch")) &&
      (await p.evaluate(() => document.getElementById("moreSearch").classList.contains("changed"))),
    "the Search section says so and is marked changed: " + (await p.textContent("#sumSearch")),
  );
  await p.uncheck("#noRoadName");
  ok(
    (await state()) === "--" && !/along the coverage/.test(await p.textContent("#sumSearch")),
    "ticked, then nothing asked for: greyed out, and not used",
  );
  ok((await p.evaluate(() => COVERAGE_WALK.search().on)) === false, "the search would not use it then");
  await p.click("[data-reset=moreSearch]");
  ok(
    !(await p.isChecked("#lookAlong")) &&
      (await p.evaluate(() => localStorage.getItem("mapgen.lookAlong"))) === '"off"' &&
      !(await p.evaluate(() => document.getElementById("moreSearch").classList.contains("changed"))),
    "Reset to defaults unticks it",
  );

  // Off: one panorama per random spot, nothing looked up by its id
  let r = await run({ target: 6, noRoadName: true });
  ok(r.ids.length === 6 && r.walked === 0 && r.byPano === 0, `off: no walk (${r.walked}, ${r.byPano})`);
  const offTries = r.tries;

  // With No road name: along the road to the nearest panorama without a name
  await p.check("#lookAlong");
  r = await run({ target: 30, noRoadName: true });
  ok(r.ids.length === 30, "30 locations: " + r.ids.length);
  ok(
    r.ids.every(id => idx(id) % 10 === 9),
    "all without a road name: " + r.ids.slice(0, 6).join(),
  );
  ok(r.walks.some(Boolean) && r.walks.some(w => !w), "some walks found one, some not");
  ok(r.walked > 0 && r.walked === r.byPano, "walked panoramas are counted: " + r.walked);
  ok(/panoramas looked at along the coverage/.test(await p.textContent("#tally")), "and shown under the bar");
  ok(r.tries < 90, `fewer random spots needed: ${r.tries} for 30 (off: ${offTries} for 6)`);
  // Give up after 1: only the panoramas next to the one at the spot
  await setNumber("lookAlongDepth", 1);
  const steps = await p.evaluate(async () => {
    const out = [];
    for (const start of [0, 5, 7, 8, 10, 11]) {
      const before = window.__requests.length;
      const a = await lookupPano(window.__road.pano(start).id, "TESTKEY"); // (shaped as the search sees it)
      window.__requests.length = before;
      searchSettings = searchSettingsNow("TESTKEY");
      searchTargets = new Map([["KZ", 1000]]);
      foundBy = new Map();
      results = [];
      cells = new Map();
      seenPanos = new Set();
      const keep = pano => keepPanorama(pano, "KZ", "TESTKEY", searchSettings.want);
      const found = await COVERAGE_WALK.walk(a, "KZ", "TESTKEY", searchSettings.want, keep);
      out.push(`${start}:${found ? 1 : 0}:${window.__requests.length - before}`);
    }
    return out.join(" ");
  });
  ok(
    steps === "0:0:1 5:0:2 7:0:2 8:1:2 10:1:1 11:0:2",
    "give up after 1: one step each way (spot:found:lookups): " + steps,
  );
  await setNumber("lookAlongDepth", 3);

  // With a period, it also tries the other dates of each photo
  const older = await p.evaluate(async () => {
    window.__sv = req =>
      req.pano === "NEWER"
        ? {
            id: "NEWER",
            lat: 48,
            lng: 67,
            date: "2023-04",
            links: [],
            time: [{ pano: "OLDER", date: "2015-06" }],
          }
        : req.pano === "OLDER"
          ? { id: "OLDER", lat: 48, lng: 67, date: "2015-06", links: [] }
          : null;
    document.getElementById("noRoadName").checked = false;
    document.getElementById("yearsOn").checked = true;
    document.getElementById("yearsOn").dispatchEvent(new Event("change"));
    document.getElementById("yearFrom").value = "2014";
    document.getElementById("yearTo").value = "2016";
    document.getElementById("yearTo").dispatchEvent(new Event("change"));
    searchSettings = searchSettingsNow("TESTKEY");
    searchTargets = new Map([["KZ", 10]]);
    foundBy = new Map();
    results = [];
    cells = new Map();
    seenPanos = new Set();
    const start = await lookupPano("NEWER", "TESTKEY");
    const keep = pano => keepPanorama(pano, "KZ", "TESTKEY", searchSettings.want);
    const found = await COVERAGE_WALK.walk(start, "KZ", "TESTKEY", searchSettings.want, keep);
    document.getElementById("yearsOn").checked = false;
    document.getElementById("yearsOn").dispatchEvent(new Event("change"));
    return `${searchSettings.lookAlong.on} ${found} ${results.map(l => l.panoId + " " + l.date).join()}`;
  });
  ok(older === "true true OLDER 2015-06", "with a period, an older photo at the spot: " + older);

  // Kept with the settings: the history, settings from before (off), "follow" (off), and applied back
  const kept = await p.evaluate(() => {
    const s = cleanSettings({ noRoadName: true, lookAlong: "first", lookAlongDepth: 5 });
    applySettings({ ...currentSettings(), ...s });
    return {
      s: [s.lookAlong, s.lookAlongDepth, cleanSettings({ lookAlongDepth: 99 }).lookAlongDepth].join(),
      before: cleanSettings({}).lookAlong,
      follow: cleanSettings({ lookAlong: "follow", lookAlongSpacing: 2500 }),
      history: historyDetails(s),
      firstNothing: historyDetails(cleanSettings({ lookAlong: "first" })),
      form: [
        document.getElementById("lookAlong").checked,
        document.getElementById("lookAlongDepth").value,
        localStorage.getItem("mapgen.lookAlongDepth"),
      ].join(),
    };
  });
  ok(kept.s === "first,5,3", "read back and checked: " + kept.s);
  ok(kept.before === "off", "settings from before: off");
  ok(
    kept.follow.lookAlong === "off" && !("lookAlongSpacing" in kept.follow),
    '"Follow the coverage" from before: off, its numbers dropped',
  );
  ok(/along the coverage until a match/.test(kept.history), "in the history: " + kept.history);
  ok(!/along the coverage/.test(kept.firstNothing), "ticked without a filter: not mentioned");
  ok(kept.form === "true,5,5", "put into the form and saved: " + kept.form);

  // The choice is kept for the next visit
  await p.reload();
  await p.waitForFunction(() => map !== null);
  ok(
    (await p.isChecked("#lookAlong")) && (await p.inputValue("#lookAlongDepth")) === "5",
    "kept on the next visit",
  );

  ok(errors.length === 0, "no page errors " + errors.join(" | "));
  await b.close();
  console.log(fail ? `${fail} FAILED` : "ALL PASS");
})();
