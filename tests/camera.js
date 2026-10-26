// Camera generations: told apart by the image height (8192 Gen 4; 6656 Gen 2/3, or bad camera from 2020
// on outside India, Nepal, Nigeria, Lebanon, São Tomé and Príncipe; smaller Gen 1). Gen 1 is left out of
// every search. Choosing cameras keeps only those, greys out "No bad camera", and uses an older photo at
// the spot with a chosen camera when the newest has none. A tag names each location's camera.
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
  const kinds = () => p.evaluate(() => [...new Set(results.map(l => l.panoId.split("_")[0]))].sort().join());

  // Telling the cameras apart
  const told = await p.evaluate(() =>
    [
      [{ height: 8192, date: "2023-05" }, "MT"],
      [{ height: 6656, date: "2023-05" }, "MT"],
      [{ height: 6656, date: "2023-05" }, "IN"],
      [{ height: 6656, date: "2015-05" }, "MT"],
      [{ height: 1664, date: "2008-05" }, "US"],
      [{ height: 0, date: "2023-05" }, "MT"],
      // a size none of the cameras makes (Sydney has 12000 × 6000 photos from 2017–2018)
      [{ height: 6000, date: "2018-11" }, "AU"],
    ]
      .map(([r, cc]) => cameraOf(r, cc) || "unknown")
      .join(),
  );
  ok(
    told === "gen4,badcam,gen23,gen23,gen1,unknown,unknown",
    "the cameras are told apart by image size (real sizes, October 2026): " + told,
  );

  // Google answers in turn: Gen 4, Gen 2/3 (2015), bad camera (2023), Gen 1 (2008), no size (2023).
  // Every spot also has an older Gen 2/3 photo (OLD23, 2014) and Gen 1 (OLD1, 2008) in its history.
  await p.evaluate(() => {
    let n = 0;
    const answers = [
      { kind: "GEN4", height: 8192, date: "2024-03" },
      { kind: "GEN23", height: 6656, date: "2015-06" },
      { kind: "BAD", height: 6656, date: "2023-11" },
      { kind: "GEN1", height: 1664, date: "2008-05" },
      { kind: "NOSIZE", date: "2023-01" },
    ];
    window.__spots = {};
    window.__sv = req => {
      if (req.pano) {
        const [kind, k] = req.pano.split("_");
        const photo = { OLD23: { height: 6656, date: "2014-04" }, OLD1: { height: 1664, date: "2008-02" } }[
          kind
        ];
        if (!photo) return null;
        return { id: req.pano, ...window.__spots[k], links: [], ...photo };
      }
      const k = n++;
      const a = answers[k % answers.length];
      window.__spots[k] = { lat: req.location.lat, lng: req.location.lng };
      return {
        id: `${a.kind}_${k}`,
        lat: req.location.lat,
        lng: req.location.lng,
        links: [],
        height: a.height,
        date: a.date,
        time: [
          { pano: `${a.kind}_${k}`, date: a.date },
          { pano: `OLD23_${k}`, date: "2014-04" },
          { pano: `OLD1_${k}`, date: "2008-02" },
        ],
      };
    };
  });

  // No camera chosen: any camera but Gen 1
  await search(p, { country: "Malta", target: 12 });
  await searchEnded(p);
  ok(
    (await kinds()) === "BAD,GEN23,GEN4,NOSIZE",
    "with no camera chosen, Gen 1 is still left out: " + (await kinds()),
  );
  ok(/\d+ Gen 1/.test(await p.textContent("#tally")), "and counted");

  // Gen 2/3 only: "No bad camera" greyed out; newer photos replaced by the older Gen 2/3 one
  await p.check("#camGen23");
  ok(!(await p.isChecked("#useOlder")), "using an older photo is off by default");
  await p.check("#useOlder");
  ok(
    (await p.isDisabled("#noBadCamera")) && (await p.isEnabled("#useOlder")),
    'with a camera chosen, "No bad camera" is greyed out and older photos can be used',
  );
  await p.check("#tagCamera");
  await search(p, { country: "Malta", target: 12 });
  await searchEnded(p);
  const gen23 = await p.evaluate(() => ({
    kinds: [...new Set(results.map(l => l.panoId.split("_")[0]))].sort().join(),
    cams: [...new Set(results.map(l => l.camera))].join(),
    older: stats.olderUsed,
    tags: [...new Set(JSON.parse(exportJson()).customCoordinates.map(c => c.extra.tags.join()))].join(" | "),
    name: document.getElementById("mapName").placeholder,
  }));
  ok(
    gen23.kinds === "GEN23,OLD23" && gen23.cams === "gen23" && gen23.older > 0,
    "Gen 2/3 only, with older Gen 2/3 photos where the newest is another camera: " + JSON.stringify(gen23),
  );
  ok(gen23.tags === "Malta,Gen 2/3", "the camera tag: " + gen23.tags);
  ok(gen23.name === "Malta: Gen 2/3", "the map name says which camera: " + gen23.name);
  ok(
    (await p.textContent("#morePhotos .more-sum")) === "Any time, Gen 2/3 only, older photos instead",
    "the summary too: " + (await p.textContent("#morePhotos .more-sum")),
  );

  // Without older photos: only spots whose newest photo is Gen 2/3
  await p.uncheck("#useOlder");
  await search(p, { country: "Malta", target: 4 });
  await searchEnded(p);
  ok(
    (await kinds()) === "GEN23" && (await p.evaluate(() => stats.olderLookups)) === 0,
    "without older photos, only the newest photos count",
  );
  ok(/\d+ other cameras/.test(await p.textContent("#tally")), "the others are counted");
  await p.check("#useOlder");

  // Bad camera only, Gen 4 and bad camera together
  await p.uncheck("#camGen23");
  await p.check("#camBad");
  await search(p, { country: "Malta", target: 4 });
  await searchEnded(p);
  ok((await kinds()) === "BAD", "bad camera only: " + (await kinds()));
  await p.check("#camGen4");
  await search(p, { country: "Malta", target: 6 });
  await searchEnded(p);
  ok((await kinds()) === "BAD,GEN4", "Gen 4 and bad camera: " + (await kinds()));
  ok(
    (await p.getAttribute("#mapName", "placeholder")) === "Malta: Gen 4 and Bad camera",
    "named in the map name",
  );
  // In Nigeria, the same photos count as Gen 2/3, not bad camera
  await p.uncheck("#camGen4");
  await p.fill("#giveUpAfter", "60");
  await search(p, { country: "Nigeria", target: 2 });
  await searchEnded(p);
  ok(
    (await p.evaluate(() => results.length)) === 0,
    "in Nigeria, 6656-high photos from 2023 are not bad camera",
  );

  // Kept in the history and the settings
  ok(
    (await p.evaluate(() => loadHistory()[0].settings.camBad)) === true &&
      (await p.evaluate(() => cleanSettings({ camGen4: "yes" }).camGen4)) === false,
    "the cameras are kept with the settings, and checked",
  );
  ok(
    /Bad camera/.test(await p.evaluate(() => historyDetails(loadHistory()[0].settings))),
    "and described in the history",
  );
  ok(
    (await p.evaluate(
      () => cleanLocation({ lat: 1, lng: 1, heading: 0, panoId: "ABCD", cc: "MT", camera: "<b>" }).camera,
    )) === "",
    "a saved location's camera is checked",
  );

  // Reset puts everything back
  await p.click("#morePhotos .reset");
  ok(
    !(await p.isChecked("#camBad")) && (await p.isEnabled("#noBadCamera")),
    "Reset to defaults clears the cameras",
  );

  ok(errors.length === 0, "no page errors " + errors.join(" | "));
  await b.close();
  console.log(fail ? `${fail} FAILED` : "ALL PASS");
})();
