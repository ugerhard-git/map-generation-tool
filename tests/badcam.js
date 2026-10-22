// "No bad camera": panoramas 6656 pixels high with photos from 2020 on are left out, except in India,
// Nepal, Nigeria, Lebanon, and São Tomé and Príncipe; older 6656-high photos, current 8192-high ones and
// panoramas without a known size are kept. Also: off by default, the counter, the map name, the history,
// ends found by following a road, and Lebanon in the country list.
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
  // Google answers, in turn: bad camera (6656, 2023), current camera (8192, 2024), an older camera
  // (6656, 2015), and a panorama without a known size (2023).
  await p.evaluate(() => {
    let n = 0;
    const kinds = [
      { kind: "BADCAM", height: 6656, date: "2023-11" },
      { kind: "GEN4", height: 8192, date: "2024-03" },
      { kind: "OLDGEN", height: 6656, date: "2015-06" },
      { kind: "NOSIZE", date: "2023-01" },
    ];
    window.__sv = req => {
      const k = kinds[n % 4];
      return {
        id: `${k.kind}_${n++}`,
        lat: req.location.lat,
        lng: req.location.lng,
        links: [],
        date: k.date,
        height: k.height,
      };
    };
  });
  const kindsFound = () =>
    p.evaluate(() => [...new Set(results.map(l => l.panoId.split("_")[0]))].sort().join());

  ok(!(await p.isChecked("#noBadCamera")), "off by default");

  // Off: everything is kept
  await search(p, { country: "Malta", target: 12 });
  await searchEnded(p);
  ok((await kindsFound()) === "BADCAM,GEN4,NOSIZE,OLDGEN", "off: bad camera is kept like everything else");

  // On: bad camera is left out, older 6656-high photos and unknown sizes are kept
  await p.check("#noBadCamera");
  await search(p, { country: "Malta", target: 9 });
  await searchEnded(p);
  ok(
    (await kindsFound()) === "GEN4,NOSIZE,OLDGEN",
    "on: bad camera left out; current, older and unknown kept: " + (await kindsFound()),
  );
  ok(/\d+ bad camera/.test(await p.textContent("#tally")), "the counters show how many were left out");
  ok((await p.getAttribute("#mapName", "placeholder")) === "Malta: No bad camera", "the map name says so");
  ok((await p.evaluate(() => loadHistory()[0].settings.noBadCamera)) === true, "the history keeps it");
  ok(
    /No bad camera/.test(await p.evaluate(() => historyDetails(loadHistory()[0].settings))),
    "and describes it",
  );

  // The countries where bad camera is kept
  const kept = await p.evaluate(() =>
    ["IN", "NP", "NG", "LB", "ST", "MT", "DE"]
      .map(c => `${c}:${isBadCamera({ height: 6656, date: "2023-11" }, c)}`)
      .join(" "),
  );
  ok(
    kept === "IN:false NP:false NG:false LB:false ST:false MT:true DE:true",
    "bad camera counts as such everywhere but India, Nepal, Nigeria, Lebanon, São Tomé and Príncipe: " + kept,
  );
  ok(
    (await p.evaluate(() => isBadCamera({ height: 6656, date: "2019-12" }, "MT"))) === false &&
      (await p.evaluate(() => isBadCamera({ height: 6656, date: "2020-01" }, "MT"))) === true &&
      (await p.evaluate(() => isBadCamera({ height: 6656, date: "" }, "MT"))) === false,
    "the year rule: from 2020 on; without a date it does not count",
  );
  await search(p, { country: "Nigeria", target: 8 });
  await searchEnded(p);
  ok((await kindsFound()).includes("BADCAM"), "in Nigeria, bad camera is kept even with the option on");

  // Lebanon is offered now
  await search(p, { country: "Lebanon", target: 4 });
  await searchEnded(p);
  ok(
    (await p.evaluate(() => chosenCountries.join())) === "LB" &&
      /Done: 4 locations found in Lebanon/.test(await p.textContent("#now")),
    "Lebanon can be chosen and searched",
  );

  // A dead end reached by following a road is checked too
  await p.evaluate(() => {
    window.__sv = req => {
      const k = req.pano ? Number(req.pano.split("_")[1]) : 0;
      const links = [{ heading: 0, pano: `ROAD_${k + 1}`, description: "" }];
      if (k > 0) links.push({ heading: 180, pano: `ROAD_${k - 1}`, description: "" });
      // ROAD_5 is the end, photographed with the bad camera; going south from ROAD_0 there is no road
      if (k === 5) links.splice(0, 1);
      return {
        id: `ROAD_${k}`,
        lat: 35.88 + k * 0.001,
        lng: 14.42,
        links: k === 0 ? [links[0], { heading: 180, pano: "", description: "" }] : links,
        height: k === 5 ? 6656 : 8192,
        date: "2023-05",
      };
    };
  });
  await p.fill("#giveUpAfter", "50");
  await search(p, { country: "Malta", deadEnd: true, target: 1 });
  await searchEnded(p);
  const walked = await p.evaluate(() => ({
    found: results.length,
    ends: stats.walkEnds,
    bad: stats.badCamera,
  }));
  ok(
    walked.found === 0 && walked.ends > 0 && walked.bad >= walked.ends,
    "an end reached by walking that is bad camera is left out: " + JSON.stringify(walked),
  );

  // Older photos instead of bad camera. Every spot is bad camera (2023) and has older photos: bad camera
  // again (2022), the current camera (2021) and an older camera (2015). The newest that is not bad camera
  // is the 2021 one. Lookups by panorama id answer with those photos.
  const olderSpots = (opts = {}) =>
    p.evaluate(o => {
      let n = 0;
      window.__sv = req => {
        if (req.pano) {
          const [kind, k] = req.pano.split("_");
          const photos = {
            BAD22: { height: 6656, date: "2022-04" },
            NEW21: { height: 8192, date: "2021-05" },
            OLD15: { height: 6656, date: "2015-06" },
          };
          const ph = photos[kind];
          if (!ph) return null;
          const at = window.__spots[k];
          return { id: req.pano, lat: at.lat, lng: at.lng, links: [], ...ph };
        }
        const k = n++;
        (window.__spots = window.__spots || {})[k] = req.location;
        const time = o.noList
          ? undefined
          : [
              { pano: `SPOT_${k}`, date: "2023-11" },
              { pano: `OLD15_${k}`, date: "2015-06" },
              { pano: `NEW21_${k}`, date: "2021-05" },
              { pano: `BAD22_${k}`, date: "2022-04" },
            ];
        return {
          id: `SPOT_${k}`,
          lat: req.location.lat,
          lng: req.location.lng,
          links: [],
          height: 6656,
          date: "2023-11",
          time,
          dateKey: o.dateKey,
        };
      };
    }, opts);
  ok(await p.isChecked("#useOlder"), "using an older photo is on by default");
  await p.uncheck("#deadEnd");
  await p.fill("#giveUpAfter", "50");
  await olderSpots();
  await p.check("#tagYear");
  await search(p, { country: "Malta", target: 3 });
  await searchEnded(p);
  let used = await p.evaluate(() => ({
    found: results.map(l => l.panoId.split("_")[0] + "@" + l.date).join(" "),
    used: stats.olderUsed,
    tally: document.getElementById("tally").textContent,
    tags: JSON.parse(exportJson())
      .customCoordinates.map(c => c.extra.tags.join())
      .join(" | "),
  }));
  ok(
    used.found === "NEW21@2021-05 NEW21@2021-05 NEW21@2021-05",
    "the newest photo that is not bad camera is used: " + used.found,
  );
  ok(used.used === 3 && /older photos used instead/.test(used.tally), "counted: " + used.tally);
  ok(used.tags === "Malta,2021 | Malta,2021 | Malta,2021", "the map file gets that photo's year");
  // It must still match: with years 2023–2026, the 2021 photo does not, so nothing is found
  await p.check("#yearsOn");
  await p.selectOption("#yearFrom", "2023");
  await search(p, { country: "Malta", target: 2 });
  await searchEnded(p);
  ok((await p.evaluate(() => results.length)) === 0, "an older photo outside the chosen years is not used");
  await p.uncheck("#yearsOn");
  // A renamed date field in Google's list still works
  await olderSpots({ dateKey: "xQ" });
  await search(p, { country: "Malta", target: 2 });
  await searchEnded(p);
  ok(
    (await p.evaluate(() => results.every(l => l.panoId.startsWith("NEW21_")))) &&
      (await p.evaluate(() => results.length)) === 2,
    "still works when Google renames the date field",
  );
  // Without the list, bad camera is simply left out
  await olderSpots({ noList: true });
  await search(p, { country: "Malta", target: 2 });
  await searchEnded(p);
  ok(
    (await p.evaluate(() => results.length)) === 0 && (await p.evaluate(() => stats.badCamera)) > 0,
    "without Google's list, bad camera is left out as before",
  );
  // Switched off: bad camera is left out, no older photos are looked at
  await olderSpots();
  await p.uncheck("#useOlder");
  await search(p, { country: "Malta", target: 2 });
  await searchEnded(p);
  used = await p.evaluate(() => ({ found: results.length, lookups: stats.olderLookups }));
  ok(used.found === 0 && used.lookups === 0, "switched off: no older photos are looked at");
  // Only with "No bad camera", and kept in the history
  await p.uncheck("#noBadCamera");
  ok(await p.isDisabled("#useOlder"), "the option can only be changed with No bad camera ticked");
  await p.check("#noBadCamera");
  await p.check("#useOlder");
  await search(p, { country: "Malta", target: 1 });
  await searchEnded(p);
  ok((await p.evaluate(() => loadHistory()[0].settings.useOlder)) === true, "the history keeps it");
  ok(
    (await p.evaluate(() => cleanSettings({ noBadCamera: true }).useOlder)) === true,
    "older history entries get it on, the default",
  );
  // Reading Google's list: dates by type, newest first, the current photo and broken entries left out
  const read = await p.evaluate(() =>
    JSON.stringify(
      olderPhotos(
        [
          { pano: "CURRENT_1", gD: new Date(2024, 0, 1) },
          { pano: "A_older_1", gD: new Date(2010, 5, 1) },
          { pano: "B_newer_1", zz: new Date(2019, 11, 1) },
          { pano: "no_date_1" },
          { pano: "x<y", gD: new Date(2018, 0, 1) },
          "junk",
          null,
        ],
        "CURRENT_1",
      ),
    ),
  );
  ok(
    read === '[{"pano":"B_newer_1","date":"2019-12"},{"pano":"A_older_1","date":"2010-06"}]',
    "Google's list is read safely, newest first: " + read,
  );

  ok(errors.length === 0, "no page errors " + errors.join(" | "));
  await b.close();
  console.log(fail ? `${fail} FAILED` : "ALL PASS");
})();
