// Areas and distributions: the whole world, a continent or chosen countries; how the number of locations
// is split between countries (Vali's maps, largest remainder); the table of locations per country; the
// map name; a search over several countries; and the saved choices.
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
  const { page: p, errors } = await openPage(b);
  const sum = o => Object.values(o).reduce((a, n) => a + n, 0);

  // The Vali data is in the page
  const data = await p.evaluate(() => ({
    maps: Object.keys(VALI.maps),
    continents: Object.keys(VALI.continents),
    commit: VALI.source.commit,
  }));
  ok(
    data.maps.includes("acw") &&
      data.maps.length >= 10 &&
      data.continents.length === 6 &&
      /^[0-9a-f]{40}$/.test(data.commit),
    `Vali data built into the page: ${data.maps.length} maps, ${data.continents.length} continents, commit ${data.commit.slice(0, 7)}`,
  );

  // Splitting a total: whole numbers that add up; the largest remainders get the rest
  const split = await p.evaluate(() => ({
    even: splitTotal({ AA: 1, BB: 1, CC: 1 }, 10),
    one: splitTotal({ AA: 1, BB: 1, CC: 1 }, 1),
    skewed: splitTotal({ AA: 70, BB: 25, CC: 5 }, 7),
    zero: splitTotal({ AA: 0, BB: 3 }, 4),
    none: splitTotal({ AA: 0 }, 4),
    big: (() => {
      const w = VALI.maps.acw.weights,
        s = splitTotal(w, 130000);
      return {
        total: Object.values(s).reduce((a, n) => a + n, 0),
        de: s.DE,
        deExact: (130000 * w.DE) / Object.values(w).reduce((a, n) => a + n, 0),
      };
    })(),
  }));
  ok(
    JSON.stringify(split.even) === '{"AA":4,"BB":3,"CC":3}',
    "10 between 3 equal: 4, 3, 3 " + JSON.stringify(split.even),
  );
  ok(
    JSON.stringify(split.one) === '{"AA":1}',
    "1 between 3: only one country gets it, the others are left out",
  );
  ok(
    sum(split.skewed) === 7 && split.skewed.AA === 5 && split.skewed.BB === 2 && !split.skewed.CC,
    "7 split 70:25:5 gives 5 and 2 " + JSON.stringify(split.skewed),
  );
  ok(
    JSON.stringify(split.zero) === '{"BB":4}' && JSON.stringify(split.none) === "{}",
    "a share of 0 gets nothing",
  );
  ok(
    split.big.total === 130000 && Math.abs(split.big.de - split.big.deExact) < 1,
    `130,000 with A Community World: adds up, Germany ${split.big.de} (exact ${split.big.deExact.toFixed(2)})`,
  );

  // The whole world: Vali's maps to choose from, A Community World first chosen; only official coverage
  await p.check("input[name=scope][value=world]");
  ok(
    (await p.isHidden("#countriesBox")) && (await p.isVisible("#distributionBox")),
    "whole world: no country field, a map to choose",
  );
  const maps = await p.$$eval("#distribution option", o => o.map(x => x.textContent));
  ok(
    (await p.inputValue("#distribution")) === "acw" &&
      maps.includes("A Balanced World") &&
      maps.every((n, i) => !i || maps[i - 1].localeCompare(n) <= 0),
    "maps listed by name, A Community World chosen: " + maps.join(", "),
  );
  let w = await p.evaluate(() => areaWeights());
  ok(
    w.DE > 0 && !("BY" in w) && !("PK" in w),
    "countries without official coverage (Belarus, Pakistan) are left out",
  );
  await p.fill("#target", "1000");
  await p.press("#target", "Tab");
  ok(await p.isVisible("#sharesBox"), "the table of locations per country is shown");
  await p.click("#sharesSummary");
  const rows = await p.$$eval("#shares tr", r => r.map(x => [...x.cells].map(c => c.textContent)));
  const wanted = rows.reduce((a, r) => a + Number(r[1].replace(/,/g, "")), 0);
  ok(
    wanted === 1000 && rows.length > 50,
    `the table adds up to 1,000 over ${rows.length} countries; first ${rows[0].join(" ")}`,
  );
  ok(
    /Locations per country: \d+ countries/.test(await p.textContent("#sharesSummary")) &&
      /round(s)? down to 0/.test(await p.textContent("#sharesNote")),
    "the table says how many countries, and that some get none: " + (await p.textContent("#sharesNote")),
  );
  ok(
    (await p.getAttribute("#mapName", "placeholder")) === "World (A Community World): Official coverage",
    "map name: World (A Community World)",
  );
  await p.screenshot({ path: path.join(__dirname, "../dist/screens/world.png") });
  await p.selectOption("#distribution", "abw");
  ok(
    (await p.getAttribute("#mapName", "placeholder")) === "World (A Balanced World): Official coverage",
    "another map: the name follows",
  );

  // A continent: Vali's own distribution of the continent first, or a map restricted to the continent
  await p.check("input[name=scope][value=continent]");
  await p.selectOption("#continent", "southamerica");
  const first = await p.$eval("#distribution option", o => o.textContent);
  ok(
    first === "Vali's South America map" && (await p.inputValue("#distribution")) === "continent",
    "a continent: Vali's map of it first",
  );
  w = await p.evaluate(() => areaWeights());
  ok(
    Object.keys(w).includes("BR") && !Object.keys(w).includes("DE"),
    "South America: Brazil yes, Germany no",
  );
  ok(
    (await p.getAttribute("#mapName", "placeholder")) === "South America: Official coverage",
    "map name: South America",
  );
  await p.selectOption("#distribution", "acw");
  const w2 = await p.evaluate(() => areaWeights());
  ok(
    Object.keys(w2).sort().join() === Object.keys(w).sort().join() && w2.BR !== w.BR,
    "a map on a continent: the same countries, the map's shares",
  );
  ok(
    (await p.getAttribute("#mapName", "placeholder")) ===
      "South America (A Community World): Official coverage",
    "map name names the map",
  );

  // Chosen countries with a map that does not have all of them
  await p.check("input[name=scope][value=countries]");
  await p.evaluate(() => {
    chosenCountries = [];
    whereChanged();
  });
  for (const n of ["Germany", "Malta", "Andorra"]) await chooseCountry(p, n);
  await p.selectOption("#distribution", "lerg");
  w = await p.evaluate(() => areaWeights());
  const note = await p.textContent("#sharesNote");
  if (w.MT === 0)
    ok(
      /Not in Less Extreme Region Guessing/.test(note) && /Malta/.test(note),
      "a country the map lacks is named: " + note,
    );
  else ok(true, "Less Extreme Region Guessing has Malta in this Vali version");
  await p.evaluate(() => {
    chosenCountries = ["MT", "AD"].filter(c => !VALI.maps.lerg.weights[c]);
    whereChanged();
  });
  if ((await p.evaluate(() => chosenCountries.length)) >= 2) {
    ok(
      /None of these countries/.test(await p.textContent("#sharesNote")),
      "none in the map: says to choose another",
    );
    await p.fill("#apiKey", "TESTKEY");
    await p.click("#go");
    ok(/Choose another map/.test(await p.textContent("#error")), "and the search does not start");
  } else ok(true, "(no two countries missing from that map to test with)");

  // A search over three small countries: each gets its share, the table shows them done
  await p.evaluate(() => {
    document.getElementById("distribution").value = "acw"; // hidden here: fewer than two countries chosen
    whereChanged();
  });
  await p.evaluate(() => {
    let n = 0;
    window.__sv = req => ({ id: "AREA_" + n++, lat: req.location.lat, lng: req.location.lng, links: [] });
  });
  await search(p, { country: ["Malta", "Luxembourg", "San Marino"], target: 30 });
  await searchEnded(p);
  const per = await p.evaluate(() => ({
    targets: Object.fromEntries(searchTargets),
    found: Object.fromEntries(foundBy),
    codes: [...new Set(results.map(l => l.cc))].sort().join(),
  }));
  ok(
    sum(per.targets) === 30 &&
      JSON.stringify(per.targets) ===
        JSON.stringify(Object.fromEntries(Object.keys(per.targets).map(c => [c, per.found[c]]))),
    "each country got exactly its share: " +
      JSON.stringify(per.targets) +
      " found " +
      JSON.stringify(per.found),
  );
  ok(per.codes === "LU,MT,SM", "locations in all three countries");
  ok(
    /Done: 30 locations found in 3 countries/.test(await p.textContent("#now")),
    "done message: " + (await p.textContent("#now")),
  );
  ok(
    /3 of 3 countries done/.test(await p.textContent("#sharesSummary")) &&
      (await p.$$("#shares tr.done")).length === 3,
    "the table shows every country done",
  );
  const exported = await p.evaluate(() => JSON.parse(exportJson()));
  ok(
    exported.customCoordinates.every(
      c =>
        ["MT", "LU", "SM"].includes(c.countryCode) &&
        c.extra.tags[0] === { MT: "Malta", LU: "Luxembourg", SM: "San Marino" }[c.countryCode],
    ),
    "each location has its own country code and name",
  );
  await p.screenshot({ path: path.join(__dirname, "../dist/screens/areas-done.png") });

  // Changing the area afterwards shows the new plan, not the last search
  await chooseCountry(p, "Austria");
  ok(
    /4 countries$/.test(await p.textContent("#sharesSummary")),
    "after a change the table shows the plan again",
  );

  // The choices are saved for the next visit
  await p.check("input[name=scope][value=continent]");
  await p.selectOption("#continent", "oceania");
  await p.selectOption("#distribution", "abw");
  await p.reload();
  await p.waitForFunction(() => map !== null);
  ok(
    (await p.isChecked("input[name=scope][value=continent]")) &&
      (await p.inputValue("#continent")) === "oceania" &&
      (await p.inputValue("#distribution")) === "abw" &&
      (await p.evaluate(() => chosenCountries.join())) === "MT,LU,SM,AT",
    "area, continent, map and countries remembered",
  );
  // Tampered saved choices fall back to defaults
  await p.evaluate(() => {
    localStorage.setItem("mapgen.scope", JSON.stringify("mars"));
    localStorage.setItem("mapgen.continent", JSON.stringify("__proto__"));
    localStorage.setItem("mapgen.distribution", JSON.stringify("<b>"));
    localStorage.setItem("mapgen.countries", JSON.stringify(["DE", "DE", "BY", 7, "<i>"]));
  });
  await p.reload();
  await p.waitForFunction(() => map !== null);
  ok(
    (await p.isChecked("input[name=scope][value=countries]")) &&
      (await p.inputValue("#continent")) === "europe" &&
      (await p.evaluate(() => chosenCountries.join())) === "DE",
    "tampered area, continent and countries fall back or are cleaned",
  );
  await p.check("input[name=scope][value=world]");
  ok((await p.inputValue("#distribution")) === "acw", "a tampered map falls back to A Community World");

  ok(errors.length === 0, "no page errors " + errors.join(" | "));
  await b.close();
  console.log(fail ? `${fail} FAILED` : "ALL PASS");
})();
