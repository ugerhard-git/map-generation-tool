// "Not on a major road" and the tag "Major road" (Map Generation Tool): a panorama is on a major road when
// one of its arrows' road names matches its country's pattern (src/data/major-roads.json); elsewhere, and
// without a road name, nothing is known and the location is kept.
const { chromium } = require("./pw.js");
const { openPage, search, searchEnded, chooseCountry } = require("./helpers.js");
const { UNOFFICIAL } = require("./site.js");
(async () => {
  const b = await chromium.launch();
  let fail = 0;
  const ok = (c, m) => {
    console.log((c ? "PASS " : "FAIL ") + m);
    if (!c) fail++;
  };
  const { page: p, errors } = await openPage(b);

  // The patterns, as the page uses them
  const judged = await p.evaluate(() =>
    [
      ["DE", "B87"],
      ["DE", "K74"],
      ["DE", "Landsberger Str."],
      ["CZ", "201"],
      ["CZ", "2372"],
      ["FR", "A71"],
      ["FR", "D32"],
      ["GB", "A82"],
      ["GB", "B9074"],
      ["PL", "DK65"],
      ["PL", "DW182"],
      ["MT", "A1"],
    ]
      .map(([c, n]) => `${c} ${n}:${onMajorRoad(c, [{ description: n }]) ? "major" : "-"}`)
      .join(", "),
  );
  ok(
    judged ===
      "DE B87:major, DE K74:-, DE Landsberger Str.:-, CZ 201:major, CZ 2372:-, FR A71:major, FR D32:-, GB A82:major, GB B9074:-, PL DK65:major, PL DW182:-, MT A1:-",
    "major roads by their names, per country: " + judged,
  );
  ok(
    await p.evaluate(() => onMajorRoad("DE", [{ description: "K74" }, { description: "B87" }])),
    "at a junction with a major road: on a major road",
  );

  // The help explains the limits and how many countries; its link opens the list, and the list links back
  await p.click("[data-help=notMajorRoad]");
  const help = await p.textContent("#helpBody");
  const count = await p.evaluate(() => Object.keys(MAJOR_ROADS).length);
  ok(
    help.includes(`${count} countries so far`) && /street name/.test(help) && !/Germany: A, B/.test(help),
    `the help is short: the limits and the number of countries (${count}), not the list`,
  );
  await p.click("#helpBody [data-help-link=majorRoadsList]");
  const list = await p.textContent("#helpBody");
  ok(
    (await p.isVisible("#help")) &&
      (await p.textContent("#helpTitle")) === "Major roads by country" &&
      /Germany: A, B and L roads/.test(list) &&
      /France \(only motorways and trunk roads\): A and N roads/.test(list) &&
      /Russia: federal roads/.test(list) &&
      (await p.evaluate(() => document.querySelectorAll("#helpBody .major-roads li").length)) === count,
    "its link opens the list of every country and what counts there",
  );
  await p.click("#helpBody [data-help-link=notMajorRoad]");
  ok((await p.textContent("#helpTitle")) === "Not on a major road", "and the list links back");
  await p.keyboard.press("Escape");
  ok(await p.isHidden("#help"), "Escape closes it");

  // Google writes some letters in Cyrillic, some in Latin: both count
  ok(
    (await p.evaluate(() =>
      [
        ["RU", "М-4"],
        ["RU", "M-4"],
        ["UA", "Н07"],
        ["UA", "H08"],
        ["KZ", "А-9"],
        ["GR", "ΕΟ Τριπόλεως Καλαμάτας"],
        ["CA", "ON-401"],
        ["CA", "ON-502"],
      ]
        .map(([c, n]) => (onMajorRoad(c, [{ description: n }]) ? 1 : 0))
        .join(""),
    )) === "11111110",
    "Cyrillic and Latin letters, Greek names, and Canada's rules per province",
  );

  // A search in Germany: the panoramas on B87 and A43, or next to them, are left out
  await p.evaluate(() => {
    let n = 0;
    const names = [["B87", "B87"], ["K74", "K74"], ["Landsberger Str."], [""], ["A43"], ["K9", "B6", "K9"]];
    window.__sv = req => {
      const i = n++;
      return {
        id: "MAJORPANO" + i,
        lat: req.location.lat,
        lng: req.location.lng,
        links: names[i % names.length].map((d, k) => ({ heading: k * 120, description: d })),
      };
    };
  });
  await p.check("#notMajorRoad");
  await search(p, { country: "Germany", target: 12 });
  await searchEnded(p);
  const r = await p.evaluate(() => ({
    n: results.length,
    major: results.filter(l => l.majorRoad).length,
    left: stats.majorRoad,
    tally: document.getElementById("tally").textContent,
    name: mapName(),
  }));
  ok(r.n === 12 && r.major === 0, `12 locations, none on a major road (${r.major})`);
  ok(r.left > 0 && /on a major road/.test(r.tally), "those left out are counted: " + r.left);
  ok(/not on a major road/i.test(r.name), "the map name says so: " + r.name);

  // The note under the tick box: in which of the countries searched it works
  await p.evaluate(() => (document.getElementById("moreRoads").open = true));
  await chooseCountry(p, "Malta");
  ok(
    (await p.textContent("#majorRoadNote")) === "Recognised in Germany, not in Malta.",
    "with a country it does not know: " + (await p.textContent("#majorRoadNote")),
  );
  await p.evaluate(() => {
    chosenCountries = ["MT"];
    whereChanged();
  });
  ok(
    /no effect/.test(await p.textContent("#majorRoadNote")),
    "only such countries: " + (await p.textContent("#majorRoadNote")),
  );

  // Off, with the tag: locations on a major road are tagged
  await p.uncheck("#notMajorRoad");
  await p.check("#tagMajorRoad");
  await search(p, { country: "Germany", target: 12 });
  await searchEnded(p);
  const tagged = await p.evaluate(() => ({
    major: results.filter(l => l.majorRoad).length,
    tags: results.filter(l => tagsFor(l).includes("Major road")).length,
    popup: locationFacts(results.find(l => l.majorRoad) || {}),
  }));
  ok(
    tagged.major > 0 && tagged.tags === tagged.major,
    `"Major road" tags the ${tagged.major} on a major road`,
  );
  ok(tagged.popup.includes("Major road"), "and their popup says so");

  // Settings: kept, read back, in the history; Reset
  const s = await p.evaluate(() => ({
    clean: [cleanSettings({ notMajorRoad: true }).notMajorRoad, cleanSettings({}).notMajorRoad].join(),
    history: historyDetails(cleanSettings({ countries: ["DE"], notMajorRoad: true })),
    location: cleanLocationFields({ majorRoad: true }).majorRoad,
  }));
  ok(s.clean === "true,false", "read back and checked; settings from before: off");
  ok(/not on a major road/i.test(s.history), "in the history: " + s.history);
  ok(s.location === true, "kept with an unfinished search");
  await p.check("#notMajorRoad");
  ok(/not on a major road/i.test(await p.textContent("#sumRoads")), "the section's summary says so");
  await p.click("[data-reset=moreRoads]");
  ok(!(await p.isChecked("#notMajorRoad")), "Reset unticks it");

  // Not in Unofficial
  const { page: u, errors: uErrors } = await openPage(b, "ok", null, UNOFFICIAL);
  ok(
    (await u.$("#notMajorRoad")) === null && (await u.$("#tagMajorRoad")) === null,
    "Unofficial has neither",
  );

  ok(errors.length === 0 && uErrors.length === 0, "no page errors " + [...errors, ...uErrors].join(" | "));
  await b.close();
  console.log(fail ? `${fail} FAILED` : "ALL PASS");
})();
