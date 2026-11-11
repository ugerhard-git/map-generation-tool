// Look along the coverage (src/shared/walk.js): from the panorama at a random spot, follow its arrows.
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
  const { page: p, errors } = await openPage(b);
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
    // each walk's locations, as they come
    window.__walks = [];
    const walk = COVERAGE_WALK.walk;
    COVERAGE_WALK.walk = async (...a) => {
      const n = await walk(...a);
      window.__walks.push(n);
      return n;
    };
  });
  const idx = id => Number(id.slice(1));
  const run = async (opts, setup) => {
    await p.evaluate(() => {
      window.__requests = [];
      window.__walks = [];
    });
    if (setup) await setup();
    await search(p, { country: "Kazakhstan", ...opts });
    await searchEnded(p);
    return p.evaluate(() => ({
      ids: results.map(l => l.panoId),
      tries: stats.tries,
      walked: stats.walked,
      byPano: window.__requests.filter(r => r.pano).length,
      walks: window.__walks,
      minGap: Math.min(
        ...results.flatMap((a, i) => results.slice(i + 1).map(c => distance(a.lat, a.lng, c.lat, c.lng))),
      ),
    }));
  };
  const setNumber = async (id, n) => {
    await p.fill("#" + id, String(n));
    await p.dispatchEvent("#" + id, "change");
  };

  // The choice: off by default; "Until the first match" only with something asked for; the numbers shown
  // only where they apply
  ok((await p.isChecked("input[name=lookAlong][value=off]")) === true, "off by default");
  const state = () =>
    p.evaluate(() =>
      ["lookAlongFirst", "lookAlongDepth", "lookAlongSpacing", "lookAlongMax"]
        .map(id =>
          (
            id === "lookAlongFirst"
              ? document.getElementById(id).disabled
              : document.getElementById(id + "Box").hidden
          )
            ? "-"
            : "+",
        )
        .join(""),
    );
  ok((await state()) === "----", "nothing asked for: no first match, no numbers: " + (await state()));
  await p.check("#noRoadName");
  ok(
    (await state()) === "+---",
    "with No road name, Until the first match can be chosen: " + (await state()),
  );
  await p.check("#lookAlongFirst");
  ok((await state()) === "++--", "it uses only Give up after: " + (await state()));
  await p.check("input[name=lookAlong][value=follow]");
  ok((await state()) === "++++", "Follow the coverage uses all three: " + (await state()));
  ok(
    /following the coverage, 1,000 m apart, at most 20 from one spot,/.test(
      await p.textContent("#sumSearch"),
    ) && (await p.evaluate(() => document.getElementById("moreSearch").classList.contains("changed"))),
    "the Search section says so and is marked changed: " + (await p.textContent("#sumSearch")),
  );
  await p.check("#lookAlongFirst");
  await p.uncheck("#noRoadName");
  ok(
    (await state()) === "----" && !/along the coverage/.test(await p.textContent("#sumSearch")),
    "the first match chosen, then nothing asked for: greyed out, and not used",
  );
  ok(
    (await p.evaluate(() => COVERAGE_WALK.search().mode)) === "off",
    "the search would not look along the coverage then",
  );
  await p.click("[data-reset=moreSearch]");
  ok(
    (await p.isChecked("input[name=lookAlong][value=off]")) &&
      (await p.evaluate(() => localStorage.getItem("mapgen.lookAlong"))) === '"off"' &&
      !(await p.evaluate(() => document.getElementById("moreSearch").classList.contains("changed"))),
    "Reset to defaults puts it back to off",
  );

  // Off: one panorama per random spot, nothing looked up by its id
  let r = await run({ target: 6 });
  ok(r.ids.length === 6 && r.walked === 0 && r.byPano === 0, `off: no walk (${r.walked}, ${r.byPano})`);

  // Follow the coverage: from one spot, locations along the road, at least the distance apart
  await p.check("input[name=lookAlong][value=follow]");
  await setNumber("lookAlongSpacing", 1000);
  await setNumber("lookAlongMax", 20);
  r = await run({ target: 20 }, () =>
    // every random spot finds the middle of the road
    p.evaluate(() => (window.__spotPano = () => 500)),
  );
  ok(r.ids.length === 20, "follow: 20 locations: " + r.ids.length);
  ok(Math.max(...r.walks) >= 10, "most from one walk: " + Math.max(...r.walks));
  ok(r.minGap >= 1000 && r.minGap < 1100, "about 1,000 m apart: " + Math.round(r.minGap));
  const span = r.ids.map(idx);
  ok(
    Math.min(...span) < 500 && Math.max(...span) > 500,
    `both ways along the road: R${Math.min(...span)} to R${Math.max(...span)}`,
  );
  ok(r.walked === r.byPano && r.walked > 0, "walked panoramas are counted: " + r.walked);
  ok(/panoramas looked at along the coverage/.test(await p.textContent("#tally")), "and shown under the bar");

  // At most this many from one random spot; the country is never overfilled
  await setNumber("lookAlongMax", 3);
  r = await run({ target: 25 }, () =>
    p.evaluate(() => (window.__spotPano = req => Math.floor(((req.location.lng * 1000) % 1) * 1000))),
  );
  ok(r.ids.length === 25, "25 locations: " + r.ids.length);
  ok(Math.max(...r.walks) <= 3, "at most 3 from each walk: " + Math.max(...r.walks));
  ok(r.minGap >= 100, "never closer than 100 m: " + Math.round(r.minGap));
  await setNumber("lookAlongMax", 20);
  r = await run({ target: 3 }, () => p.evaluate(() => (window.__spotPano = () => 500)));
  ok(r.ids.length === 3, "a walk stops when the country is full: " + r.ids.length);

  // A larger distance
  await setNumber("lookAlongSpacing", 5000);
  r = await run({ target: 6 }, () => p.evaluate(() => (window.__spotPano = () => 500)));
  ok(r.ids.length === 6 && r.minGap >= 5000, "5,000 m apart: " + Math.round(r.minGap));
  await setNumber("lookAlongSpacing", 1000);

  // Until the first match: with No road name, along the road to the nearest panorama without a name
  await p.check("#noRoadName");
  await p.check("#lookAlongFirst");
  await p.evaluate(() => (window.__spotPano = req => Math.floor(((req.location.lng * 1000) % 1) * 1000)));
  r = await run({ target: 30, noRoadName: true });
  ok(r.ids.length === 30, "first match: 30 locations: " + r.ids.length);
  ok(
    r.ids.every(id => idx(id) % 10 === 9),
    "all without a road name: " + r.ids.slice(0, 6).join(),
  );
  ok(Math.max(...r.walks) <= 1 && r.walks.some(n => n === 1), "at most one from each walk");
  ok(r.walked > 0 && r.tries < 90, `fewer random spots needed: ${r.tries} for 30 (walked ${r.walked})`);
  // Give up after 1: only the panoramas next to the one at the spot
  await setNumber("lookAlongDepth", 1);
  const steps = await p.evaluate(async () => {
    const out = [];
    for (const start of [0, 5, 7, 8, 10, 11]) {
      const before = window.__requests.length;
      const r0 = window.__road.pano(start);
      const a = await lookupPano(r0.id, "TESTKEY"); // (shaped as the search sees it)
      window.__requests.length = before;
      searchSettings = searchSettingsNow("TESTKEY");
      searchTargets = new Map([["KZ", 1000]]);
      foundBy = new Map();
      results = [];
      cells = new Map();
      seenPanos = new Set();
      const keep = (pano, spacing) => keepPanorama(pano, "KZ", "TESTKEY", searchSettings.want, spacing);
      const n = await COVERAGE_WALK.walk(a, "KZ", "TESTKEY", searchSettings.want, false, keep);
      out.push(`${start}:${n}:${window.__requests.length - before}`);
    }
    return out.join(" ");
  });
  ok(
    steps === "0:0:1 5:0:2 7:0:2 8:1:2 10:1:1 11:0:2",
    "give up after 1: one step each way (spot:found:lookups): " + steps,
  );
  await setNumber("lookAlongDepth", 3);

  // With a period, the first match also tries the other dates of each photo
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
    const keep = (pano, spacing) => keepPanorama(pano, "KZ", "TESTKEY", searchSettings.want, spacing);
    const n = await COVERAGE_WALK.walk(start, "KZ", "TESTKEY", searchSettings.want, false, keep);
    document.getElementById("yearsOn").checked = false;
    document.getElementById("yearsOn").dispatchEvent(new Event("change"));
    return `${searchSettings.lookAlong.mode} ${n} ${results.map(l => l.panoId + " " + l.date).join()}`;
  });
  ok(older === "first 1 OLDER 2015-06", "with a period, an older photo at the spot: " + older);

  // Kept with the settings: the history, settings from before (off), and applied back
  const kept = await p.evaluate(() => {
    const s = cleanSettings({
      noRoadName: true,
      lookAlong: "follow",
      lookAlongDepth: 99,
      lookAlongSpacing: 2500,
      lookAlongMax: "x",
    });
    const before = cleanSettings({});
    applySettings({ ...currentSettings(), ...s });
    return {
      s: [s.lookAlong, s.lookAlongDepth, s.lookAlongSpacing, s.lookAlongMax].join(),
      before: before.lookAlong,
      history: historyDetails(s),
      firstNothing: historyDetails(cleanSettings({ lookAlong: "first" })),
      form: [
        document.querySelector("input[name=lookAlong]:checked").value,
        document.getElementById("lookAlongSpacing").value,
        localStorage.getItem("mapgen.lookAlongSpacing"),
      ].join(),
    };
  });
  ok(kept.s === "follow,3,2500,20", "read back and checked: " + kept.s);
  ok(kept.before === "off", "settings from before: off");
  ok(/following the coverage, 2,500 m apart/.test(kept.history), "in the history: " + kept.history);
  ok(!/along the coverage/.test(kept.firstNothing), "first match without a filter: not mentioned");
  ok(kept.form === "follow,2,500,2500", "put into the form and saved: " + kept.form);

  // The choice is kept for the next visit
  await p.reload();
  await p.waitForFunction(() => map !== null);
  ok(
    (await p.isChecked("input[name=lookAlong][value=follow]")) &&
      (await p.inputValue("#lookAlongSpacing")) === "2,500",
    "kept on the next visit",
  );

  // The time left counts random spots: with several locations from each, fewer spots are still needed
  const left = await p.evaluate(() => {
    searchTargets = new Map([["KZ", 110]]);
    foundBy = new Map([["KZ", 10]]);
    gaveUp = new Set();
    noSpots = new Set();
    missesInRow = new Map();
    searchSettings = { ...searchSettings, giveUpAfter: 2000 };
    pace = {
      since: Date.now() - 60000,
      spots: 100,
      tries: new Map([["KZ", 100]]),
      found: new Map([["KZ", 10]]),
      hits: new Map([["KZ", 2]]),
      finishAt: 0,
    };
    // 100 more locations, 5 from each spot that finds any, 1 such spot in 50: about 20 × 50 spots
    const s = secondsLeft() * (100 / 60);
    return { s, want: spotsStillNeeded(20, 0.02, 2000, 0) };
  });
  ok(
    Math.abs(left.s - left.want) < 1 && left.want > 900 && left.want < 1100,
    `time left: ${Math.round(left.s)} spots`,
  );

  ok(errors.length === 0, "no page errors " + errors.join(" | "));
  await b.close();
  console.log(fail ? `${fail} FAILED` : "ALL PASS");
})();
