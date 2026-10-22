// History of searches: each search is kept with its settings and how it ended; the same settings again
// move to the top; "Use these settings" puts every setting back; "Run again" starts the search; entries
// can be removed and the history cleared or switched off; at most 20 are kept; the key is never kept;
// tampered saved entries are dropped or cleaned.
const { chromium } = require("./pw.js");
const { openPage, search, searchEnded } = require("./helpers.js");
const path = require("path");
(async () => {
  const b = await chromium.launch();
  let fail = 0;
  const ok = (c, m) => {
    console.log((c ? "PASS " : "FAIL ") + m);
    if (!c) fail++;
  };
  const { page: p, errors } = await openPage(b);
  const saved = () => p.evaluate(() => JSON.parse(localStorage.getItem("mapgen.history") || "[]"));
  const openHistory = async () => {
    await p.click("#historyBtn");
    return p.$$eval("#historyList li", lis => lis.map(li => li.innerText.replace(/\s+/g, " ").trim()));
  };
  await p.evaluate(() => {
    let n = 0;
    // photos from 2014, so that a search for 2012–2016 finds them
    window.__sv = req => ({
      id: "HIST_" + n++,
      lat: req.location.lat,
      lng: req.location.lng,
      links: [],
      date: "2014-05",
    });
  });

  // Empty at first
  let rows = await openHistory();
  ok(
    rows.length === 0 && /No searches yet/.test(await p.textContent("#historyEmpty")),
    "empty at first, says so",
  );
  await p.click("#historyX");

  // A search is kept with its settings and how it ended
  await search(p, { country: "Malta", noRoadName: true, target: 4 });
  await searchEnded(p);
  let h = await saved();
  ok(
    h.length === 1 && h[0].title === "Malta: No road name" && h[0].outcome === "4 locations",
    "the search is kept: " + JSON.stringify(h[0]).slice(0, 160),
  );
  ok(!JSON.stringify(h).includes("TESTKEY"), "the key is never kept");
  ok(!/failed/.test(await p.textContent("#tally")), "no failed lookups in the counters");
  ok(!("results" in h[0]) && !JSON.stringify(h).includes("HIST_0"), "the locations themselves are not kept");
  rows = await openHistory();
  ok(
    rows.length === 1 &&
      /Malta: No road name/.test(rows[0]) &&
      /Malta · No road name · 4 locations · 1,000 m/.test(rows[0]) &&
      /Today, \d\d:\d\d · 4 locations/.test(rows[0]),
    "the dialog shows title, settings, time and outcome: " + rows[0],
  );
  await p.screenshot({ path: path.join(__dirname, "../dist/screens/history.png") });
  await p.click("#historyX");

  // The same settings again: still one entry, at the top; other settings: a second entry on top
  await search(p, { country: "Malta", noRoadName: true, target: 4 });
  await searchEnded(p);
  ok((await saved()).length === 1, "the same search again is not added twice");
  await p.uncheck("#noRoadName");
  await p.check("input[name=scope][value=continent]");
  await p.selectOption("#continent", "oceania");
  await p.selectOption("#distribution", "abw");
  await p.check("#yearsOn");
  await p.selectOption("#yearFrom", "2012");
  await p.selectOption("#yearTo", "2016");
  await p.fill("#target", "7");
  await p.fill("#radius", "2500");
  await p.fill("#giveUpAfter", "300");
  await p.fill("#mapName", "Oceania test");
  await p.click("#go");
  await searchEnded(p);
  h = await saved();
  ok(h.length === 2 && h[0].title === "Oceania test", "a different search is added on top");
  rows = await openHistory();
  ok(
    /Oceania · A Balanced World · 2012–2016 · 7 locations · 2,500 m/.test(rows[0]),
    "a continent with a map and years is described: " + rows[0],
  );

  // "Use these settings" on the first search puts everything back, without starting it
  await p.click("#historyList li:nth-child(2) >> text=Use these settings");
  ok(await p.isHidden("#history"), "the dialog closes");
  const form = await p.evaluate(() => ({
    scope: scope(),
    countries: chosenCountries.join(),
    noRoadName: document.getElementById("noRoadName").checked,
    yearsOn: document.getElementById("yearsOn").checked,
    target: document.getElementById("target").value,
    radius: document.getElementById("radius").value,
    giveUpAfter: document.getElementById("giveUpAfter").value,
    mapName: document.getElementById("mapName").value,
    running,
  }));
  ok(
    form.scope === "countries" &&
      form.countries === "MT" &&
      form.noRoadName &&
      !form.yearsOn &&
      form.target === "4" &&
      form.radius === "1000" &&
      form.giveUpAfter === "2000" &&
      form.mapName === "" &&
      !form.running,
    "every setting is back, nothing started: " + JSON.stringify(form),
  );
  ok(/come from your history/.test(await p.textContent("#note")), "a note says where they came from");

  // "Run again" on the Oceania search: every setting back and the search runs
  await openHistory();
  await p.click("#historyList li:nth-child(1) >> text=Run again");
  await searchEnded(p);
  const again = await p.evaluate(() => ({
    scope: scope(),
    continent: document.getElementById("continent").value,
    distribution: document.getElementById("distribution").value,
    years: `${document.getElementById("yearFrom").value}-${document.getElementById("yearTo").value}`,
    yearsOn: document.getElementById("yearsOn").checked,
    found: results.length,
    name: document.getElementById("mapName").value,
  }));
  ok(
    again.scope === "continent" &&
      again.continent === "oceania" &&
      again.distribution === "abw" &&
      again.years === "2012-2016" &&
      again.yearsOn &&
      again.name === "Oceania test",
    "Run again restores the continent, the map, the years and the name: " + JSON.stringify(again),
  );
  ok(
    /Done: 7 locations found in Oceania/.test(await p.textContent("#now")) &&
      (await saved())[0].title === "Oceania test",
    "and runs the search, which moves to the top: " + (await p.textContent("#now")),
  );
  ok(await p.isHidden("#note"), "the note is gone once a search starts");

  // Settings are remembered after "Use these settings" (they are saved like the visitor's own choices)
  await p.reload();
  await p.waitForFunction(() => map !== null);
  ok(
    (await p.evaluate(() => scope())) === "continent" && (await p.inputValue("#continent")) === "oceania",
    "applied settings are saved for the next visit",
  );

  // Remove one, clear all
  await openHistory();
  await p.click("#historyList li:nth-child(1) >> text=Remove");
  ok(
    (await saved()).length === 1 && (await p.$$("#historyList li")).length === 1,
    "Remove takes one entry out",
  );
  await p.click("#historyClear");
  ok((await saved()).length === 0 && (await p.isVisible("#historyEmpty")), "Clear history empties it");
  await p.click("#historyX");

  // At most 20 entries, newest first
  for (let i = 1; i <= 22; i++) {
    await p.evaluate(n => {
      document.getElementById("target").value = String(n);
    }, i);
    await p.evaluate(() => recordSearch());
  }
  h = await saved();
  ok(
    h.length === 20 && h[0].settings.target === 22 && h[19].settings.target === 3,
    "at most 20 entries, the newest first",
  );

  // Switched off: cleared, and nothing more is kept
  await openHistory();
  await p.uncheck("#historyOn");
  ok(
    (await saved()).length === 0 && /switched off/.test(await p.textContent("#historyEmpty")),
    "switching it off clears it",
  );
  await p.click("#historyX");
  await search(p, { country: "Malta", target: 2 });
  await searchEnded(p);
  ok((await saved()).length === 0, "while switched off, searches are not kept");
  await p.reload();
  await p.waitForFunction(() => map !== null);
  ok(!(await p.isChecked("#historyOn")), "switched off stays off after a reload");
  await openHistory();
  await p.check("#historyOn");
  await p.click("#historyX");

  // Tampered saved history: broken entries dropped, bad settings cleaned, nothing shown as HTML
  await p.evaluate(() =>
    localStorage.setItem(
      "mapgen.history",
      JSON.stringify([
        null,
        "junk",
        { at: "yesterday", settings: {} },
        { at: 5, title: "no settings" },
        {
          id: "x",
          at: Date.now(),
          title: "<img src=x onerror=window.__x=1>",
          outcome: "<b>bold</b>",
          settings: {
            scope: "mars",
            countries: ["DE", "DE", "BY", "<i>", 3],
            continent: "__proto__",
            distribution: "constructor",
            target: 1e9,
            radius: -4,
            giveUpAfter: "lots",
            yearFrom: 1900,
            noRoadName: "yes",
            mapName: { a: 1 },
          },
        },
      ]),
    ),
  );
  rows = await openHistory();
  const cleaned = (await p.evaluate(() => loadHistory()))[0];
  ok(
    rows.length === 1 &&
      (await p.$$("#historyList img")).length === 0 &&
      !(await p.evaluate(() => window.__x)),
    "only the well-formed entry is shown, as text",
  );
  ok(
    cleaned.settings.scope === "countries" &&
      cleaned.settings.countries.join() === "DE" &&
      cleaned.settings.continent === "europe" &&
      cleaned.settings.distribution === "aaw" &&
      cleaned.settings.target === 100 &&
      cleaned.settings.radius === 1000 &&
      cleaned.settings.giveUpAfter === 2000 &&
      cleaned.settings.yearFrom === 2009 &&
      cleaned.settings.noRoadName === false &&
      cleaned.settings.mapName === "",
    "its settings are cleaned: " + JSON.stringify(cleaned.settings),
  );
  await p.click("#historyList li >> text=Use these settings");
  ok((await p.evaluate(() => chosenCountries.join())) === "DE", "and can be used safely");

  ok(errors.length === 0, "no page errors " + errors.join(" | "));
  await b.close();
  console.log(fail ? `${fail} FAILED` : "ALL PASS");
})();
