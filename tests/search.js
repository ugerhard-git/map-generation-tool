// The search: official coverage only, the two criteria and the camera direction, spacing between
// locations, stopping, errors from Google, and the map-making.app export. Google's script is simulated
// (tests/helpers.js), so each case decides what Google answers.
const { chromium } = require("./pw.js");
const { openPage, chooseCountry, search, searchEnded } = require("./helpers.js");
const path = require("path");
(async () => {
  const b = await chromium.launch();
  let fail = 0;
  const ok = (c, m) => {
    console.log((c ? "PASS " : "FAIL ") + m);
    if (!c) fail++;
  };
  const allErrors = [];
  const open = async mode => {
    const o = await openPage(b, mode);
    allErrors.push(o.errors);
    return o.page;
  };
  const exported = p => p.evaluate(() => JSON.parse(exportJson()));

  // 1. Before searching: a country and a key are needed
  let p = await open("ok");
  await p.click("#go");
  ok(/Choose a country/.test(await p.textContent("#error")), "asks for a country first");
  await chooseCountry(p, "Malta");
  await p.fill("#apiKey", "");
  await p.click("#go");
  ok(/API key/.test(await p.textContent("#error")), "asks for a key");
  ok(
    (await p.getAttribute("#mapName", "placeholder")) === "Malta: Official coverage",
    "suggested map name follows the choices",
  );

  // 2. Any official location: every answer is a panorama right at the random spot
  await p.evaluate(() => {
    let n = 0;
    window.__sv = req => ({
      id: "PANO_" + n++,
      lat: req.location.lat,
      lng: req.location.lng,
      links: [
        { heading: 10, description: "Triq il-Kbira" },
        { heading: 190, description: "Triq il-Kbira" },
      ],
    });
  });
  await search(p, { target: 8 });
  await searchEnded(p);
  let r = await exported(p);
  const req = await p.evaluate(() => window.__requests[0]);
  ok(
    req.sources.join() === "google" && req.preference === "nearest" && req.radius === 1000,
    "asks Google for the nearest official panorama within the radius: " + JSON.stringify(req),
  );
  ok(r.customCoordinates.length === 8, "finds the number asked for: " + r.customCoordinates.length);
  ok(/Done: 8 locations found in Malta/.test(await p.textContent("#now")), "says it is done");
  ok(
    (await p.evaluate(() => parseFloat(document.getElementById("fill").style.width))) === 100,
    "the progress bar is full",
  );
  ok(
    r.name === "Malta: Official coverage" &&
      r.customCoordinates.every(
        c => c.countryCode === "MT" && c.extra.tags.join() === "Malta" && [10, 190].includes(c.heading),
      ),
    "each location has its country code, the country name as its tag and faces along the road",
  );
  ok(
    (await p.isEnabled("#download")) && (await p.isVisible("#go")) && (await p.isHidden("#stop")),
    "after the search: download possible, form unlocked",
  );
  await p.screenshot({ path: path.join(__dirname, "../dist/screens/search-done.png") });

  // The popup of a location: what it has, the photo date and a large Street View button
  await p.evaluate(() => layer.getLayers()[0].openPopup());
  const button = await p.$(".leaflet-popup a.sv");
  const box = button && (await button.boundingBox());
  ok(
    box && box.height >= 36 && box.width >= 150 && /pano=PANO_/.test(await button.getAttribute("href")),
    "the popup has a large Open in Street View button: " + JSON.stringify(box),
  );
  ok(/Photo from 2023-04/.test(await p.textContent(".leaflet-popup")), "the popup shows the photo date");
  await p.screenshot({ path: path.join(__dirname, "../dist/screens/popup.png") });

  // Tag options: the country name by default; "No road name"/"Dead end" and the year when ticked.
  // They can be changed after the search and apply to the next download.
  ok(
    (await p.isChecked("#tagCountry")) &&
      !(await p.isChecked("#tagFeatures")) &&
      !(await p.isChecked("#tagYear")),
    "by default only the country is tagged",
  );
  await p.check("#tagYear");
  r = await exported(p);
  ok(
    r.customCoordinates.every(c => c.extra.tags.join() === "Malta,2023"),
    "the year tag is added",
  );
  await p.uncheck("#tagCountry");
  r = await exported(p);
  ok(
    r.customCoordinates.every(c => c.extra.tags.join() === "2023"),
    "the country tag can be left out",
  );
  await p.uncheck("#tagYear");
  r = await exported(p);
  ok(
    r.customCoordinates.every(c => !("extra" in c) && c.countryCode === "MT"),
    "no tags at all: no extra block",
  );
  await p.check("#tagCountry");

  // 3. No road name: only panoramas whose arrows carry no name
  await p.evaluate(() => {
    let n = 0;
    window.__sv = req => {
      n++;
      return {
        id: "NR_" + n,
        lat: req.location.lat,
        lng: req.location.lng,
        links:
          n % 3
            ? [
                { heading: 0, description: "Main Street" },
                { heading: 180, description: "" },
              ]
            : [
                { heading: 45, description: "" },
                { heading: 225, description: "" },
              ],
      };
    };
  });
  await p.check("#tagFeatures");
  await search(p, { noRoadName: true, target: 6 });
  await searchEnded(p);
  r = await exported(p);
  let tally = await p.textContent("#tally");
  ok(
    r.customCoordinates.length === 6 &&
      r.customCoordinates.every(c => c.panoId.startsWith("NR_") && c.extra.tags.includes("No road name")),
    "no road name: only nameless spots, tagged",
  );
  ok(/not matching/.test(tally), "panoramas with a road name are counted as not matching: " + tally);

  // 4. End of coverage: one arrow; the camera faces away from it
  await p.evaluate(() => {
    let n = 0;
    window.__sv = req => {
      n++;
      return {
        id: "DE_" + n,
        lat: req.location.lat,
        lng: req.location.lng,
        links:
          n % 2
            ? [{ heading: 70, description: "Road" }]
            : [
                { heading: 70, description: "" },
                { heading: 250, description: "" },
              ],
      };
    };
  });
  await search(p, { deadEnd: true, target: 4 });
  await searchEnded(p);
  r = await exported(p);
  ok(
    r.customCoordinates.length === 4 &&
      r.customCoordinates.every(c => c.heading === 250 && c.extra.tags.join() === "Malta,Dead end"),
    "end of coverage: one arrow only, camera faces where coverage stops, tagged",
  );

  // 5. Both criteria: a location must have both
  await p.evaluate(() => {
    let n = 0;
    window.__sv = req => {
      n++;
      const kinds = [
        [{ heading: 5, description: "Road" }], // dead end with a name
        [
          { heading: 5, description: "" },
          { heading: 185, description: "" },
        ], // no name, not a dead end
        [{ heading: 300, description: "" }], // both
      ];
      return { id: "B_" + n, lat: req.location.lat, lng: req.location.lng, links: kinds[n % 3] };
    };
  });
  await search(p, { noRoadName: true, deadEnd: true, target: 3 });
  await searchEnded(p);
  r = await exported(p);
  ok(
    r.customCoordinates.length === 3 &&
      r.customCoordinates.every(
        c => c.heading === 120 && c.extra.tags.join() === "Malta,No road name,Dead end",
      ),
    "both criteria: only spots with both",
  );
  ok(
    r.name === "Malta: No road name, end of coverage",
    "map name names both criteria when none is typed: " + r.name,
  );
  await p.fill("#mapName", "My Malta");
  ok((await exported(p)).name === "My Malta", "a typed map name is used");

  // 5b. Photo years: only panoramas whose photos are from the chosen years; the years can be given in
  // either order; unknown dates do not count
  ok(await p.isDisabled("#yearFrom"), "the years can only be chosen once ticked");
  await p.fill("#mapName", "");
  await p.check("#yearsOn");
  await p.selectOption("#yearFrom", "2014");
  await p.selectOption("#yearTo", "2010");
  await p.evaluate(() => {
    let n = 0;
    const dates = ["2008-05", "2012-07", "2019-01", "", "2010", "2014-12", "2015-01"];
    window.__sv = req => {
      n++;
      return {
        id: "Y_" + n,
        lat: req.location.lat,
        lng: req.location.lng,
        links: [],
        date: dates[n % dates.length],
      };
    };
  });
  await p.check("#tagYear");
  await search(p, { target: 6 });
  await searchEnded(p);
  r = await exported(p);
  const yearsFound = r.customCoordinates.map(c => c.extra.tags[c.extra.tags.length - 1]);
  ok(
    r.customCoordinates.length === 6 && yearsFound.every(y => ["2010", "2012", "2014"].includes(y)),
    "only photos from 2010 to 2014, tagged with their year: " + yearsFound.join(" "),
  );
  ok(r.name === "Malta: 2010–2014", "the map name names the years: " + r.name);
  await p.selectOption("#yearFrom", "2012");
  await p.selectOption("#yearTo", "2012");
  ok((await p.getAttribute("#mapName", "placeholder")) === "Malta: 2012", "one year: the map name names it");
  const lastYear = await p.$$eval("#yearTo option", o => o[o.length - 1].value);
  const firstYear = await p.$eval("#yearFrom option", o => o.value);
  ok(
    firstYear === "2009" && lastYear === String(new Date().getFullYear()),
    `years offered: ${firstYear} to ${lastYear}`,
  );
  await p.uncheck("#yearsOn");
  await p.uncheck("#tagYear");

  // 6. Unofficial photos, panoramas across the border, repeats and spots too close are not kept
  await p.evaluate(() => {
    let n = 0;
    window.__sv = req => {
      n++;
      if (n % 5 === 1)
        return {
          id: "USER_" + n,
          lat: req.location.lat,
          lng: req.location.lng,
          copyright: "© Jane Doe",
          links: [],
        };
      if (n % 5 === 2) return { id: "IT_" + n, lat: 41.9, lng: 12.5, links: [] }; // Rome
      if (n % 5 === 3) return { id: "SAME", lat: 35.9, lng: 14.5, links: [] };
      if (n % 5 === 4) return { id: "NEAR_" + n, lat: 35.9 + n * 1e-6, lng: 14.5, links: [] };
      return { id: "OK_" + n, lat: req.location.lat, lng: req.location.lng, links: [] };
    };
  });
  await search(p, { target: 6 });
  await searchEnded(p);
  r = await exported(p);
  tally = await p.textContent("#tally");
  const ids = r.customCoordinates.map(c => c.panoId);
  ok(
    ids.length === 6 &&
      !ids.some(id => /^USER_|^IT_/.test(id)) &&
      ids.filter(id => /SAME|NEAR/.test(id)).length <= 1,
    "only official panoramas in the country, no repeats: " + ids.join(" "),
  );
  const close = await p.evaluate(() => {
    let n = 0;
    for (const a of results)
      for (const c of results) if (a !== c && distance(a.lat, a.lng, c.lat, c.lng) < 100) n++;
    return n;
  });
  ok(close === 0, "no two locations closer than 100 m");
  ok(
    /across the border/.test(tally) && /too close/.test(tally) && !/failed/.test(tally),
    "the counters show why spots were left out: " + tally,
  );
  ok(
    r.customCoordinates.every(c => c.heading >= 0 && c.heading < 360),
    "spots without arrows get a camera direction too",
  );

  // 7. Arrows missing from the answer: asked for again by panorama id
  await p.evaluate(() => {
    let n = 0;
    window.__sv = req => {
      if (req.pano)
        return { id: req.pano, lat: 35.85 + n * 0.01, lng: 14.45, links: [{ heading: 90, description: "" }] };
      n++;
      return { id: "ID_" + n, lat: 35.85 + n * 0.01, lng: 14.45 };
    };
  });
  await search(p, { deadEnd: true, target: 2 });
  await searchEnded(p);
  r = await exported(p);
  ok(
    r.customCoordinates.length === 2 && r.customCoordinates[0].heading === 270,
    "arrows fetched by panorama id",
  );

  // 8. Stop: keeps what was found, the form unlocks
  await p.evaluate(() => {
    let n = 0;
    window.__svDelay = 30;
    window.__sv = req => ({ id: "S_" + n++, lat: req.location.lat, lng: req.location.lng, links: [] });
  });
  await search(p, { target: 100000 });
  await p.waitForFunction(() => results.length >= 10);
  ok(await p.isDisabled("#country"), "the settings are locked while searching");
  ok(await p.isDisabled("#download"), "no download while searching");
  await p.click("#stop");
  await searchEnded(p);
  const found = await p.evaluate(() => results.length);
  ok(
    found >= 10 && found < 100000 && /Stopped: [\d,]+ of 100,000/.test(await p.textContent("#now")),
    "stopped with what was found: " + (await p.textContent("#now")),
  );
  ok(
    (await p.isEnabled("#download")) && (await p.isEnabled("#country")),
    "download and form available after stopping",
  );
  await p.click("#clear");
  ok(
    (await p.textContent("#count")) === "0" && (await p.isDisabled("#download")),
    "Clear empties the results",
  );
  await p.evaluate(() => (window.__svDelay = 0));

  // 9. Google keeps failing: the search gives up with a plain message
  await p.evaluate(() => (window.__sv = () => ({ status: "UNKNOWN_ERROR" })));
  await search(p, { target: 5 });
  await searchEnded(p);
  ok(/kept answering "UNKNOWN_ERROR"/.test(await p.textContent("#error")), "gives up after repeated errors");
  ok(!/TESTKEY/.test(await p.textContent("body")), "the key is never shown");

  // 10. Settings are kept for the next visit
  await p.reload();
  await p.waitForFunction(() => map !== null);
  ok(
    (await p.evaluate(() => chosenCountries.join())) === "MT" && (await p.inputValue("#target")) === "5",
    "country and number remembered",
  );
  ok(
    (await p.isChecked("#tagFeatures")) &&
      (await p.isChecked("#tagCountry")) &&
      !(await p.isChecked("#tagYear")),
    "tag options remembered",
  );

  // 11. Key refused, script unreachable
  p = await open("denied");
  await search(p);
  await searchEnded(p);
  ok(/refused the API key/.test(await p.textContent("#error")), "a refused key is explained");
  p = await open("unreachable");
  await search(p);
  await searchEnded(p);
  ok(/could not be loaded/.test(await p.textContent("#error")), "an unreachable Google is explained");

  const errs = allErrors.flat();
  ok(errs.length === 0, "no page errors " + errs.join(" | "));
  await b.close();
  console.log(fail ? `${fail} FAILED` : "ALL PASS");
})();
