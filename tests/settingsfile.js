// The settings file: "Save settings to a file" writes every setting as readable JSON (never the key);
// "Load settings from a file" sets them all again. Loaded files are untrusted: broken, wrong, oversized
// and hostile files are refused or cleaned, and what was left out is said.
const { chromium } = require("./pw.js");
const { openPage, chooseCountry } = require("./helpers.js");
(async () => {
  const b = await chromium.launch();
  let fail = 0;
  const ok = (c, m) => {
    console.log((c ? "PASS " : "FAIL ") + m);
    if (!c) fail++;
  };
  const { page: p, errors } = await openPage(b);

  // Some settings away from the defaults
  await chooseCountry(p, "Malta");
  await chooseCountry(p, "Luxembourg");
  await p.selectOption("#distribution", "acw");
  await p.check("#arrowsEnd");
  await p.check("#yearsOn");
  await p.selectOption("#yearFrom", "2015");
  await p.check("#noBadCamera");
  await p.fill("#target", "2500");
  await p.press("#target", "Tab");
  await p.fill("#radius", "3000");
  await p.press("#radius", "Tab");
  await p.fill("#mapName", "Small places");
  await p.check("#tagYear");
  await p.uncheck("#tagCountry");
  // A made-up key, put together here so the repository never holds anything shaped like a real key
  // (GitHub's secret scanning would rightly flag it)
  const fakeKey = ["AI", "za", "NOT", "A", "REAL", "KEY"].join("") + "x".repeat(26);
  await p.fill("#apiKey", fakeKey);
  await p.press("#apiKey", "Tab");

  // Save
  await p.click("#settingsBtn");
  const [download] = await Promise.all([p.waitForEvent("download"), p.click("#settingsSave")]);
  const text = require("fs").readFileSync(await download.path(), "utf8");
  const file = JSON.parse(text);
  ok(download.suggestedFilename() === "small-places.settings.json", "the file is named after the map");
  ok(
    file.format === "map-generation-tool settings" &&
      file.version === 1 &&
      !isNaN(Date.parse(file.saved)) &&
      text.includes('\n  "settings": {\n'),
    "readable JSON with a format name, a version and the date",
  );
  const s = file.settings;
  ok(
    s.countries.join() === "MT,LU" &&
      s.distribution === "acw" &&
      s.arrows === "end" &&
      s.yearsOn === true &&
      s.yearFrom === 2015 &&
      s.noBadCamera === true &&
      s.target === 2500 &&
      s.radius === 3000 &&
      s.mapName === "Small places" &&
      s.tagYear === true &&
      s.tagCountry === false,
    "every setting is in it, the tags too",
  );
  ok(!text.includes(fakeKey) && !/AIza|apiKey|key/i.test(text), "the Google key is never in it");
  ok(/Saved as small-places\.settings\.json/.test(await p.textContent("#settingsMsg")), "it says where");

  // Load it into a page with other settings: everything comes back
  await p.click("#settingsX");
  await p.click("#moreSearch .reset");
  await p.click("#morePhotos .reset");
  await p.check("#arrowsAny");
  await p.evaluate(() => {
    chosenCountries = ["DE"];
    whereChanged();
  });
  // Choosing a file is read asynchronously: wait until the dialog closes (loaded) or says why not
  const load = async (name, content) => {
    await p.click("#settingsBtn");
    await p.setInputFiles("#settingsPick", {
      name,
      mimeType: "application/json",
      buffer: Buffer.from(content),
    });
    await p.waitForFunction(
      () => document.getElementById("settingsFile").hidden || !document.getElementById("settingsMsg").hidden,
    );
  };
  await load("small-places.settings.json", text);
  ok(
    (await p.isHidden("#settingsFile")) &&
      (await p.evaluate(() => chosenCountries.join())) === "MT,LU" &&
      (await p.inputValue("#distribution")) === "acw" &&
      (await p.isChecked("#arrowsEnd")) &&
      (await p.isChecked("#noBadCamera")) &&
      (await p.inputValue("#yearFrom")) === "2015" &&
      (await p.inputValue("#target")) === "2,500" &&
      (await p.inputValue("#radius")) === "3,000" &&
      (await p.inputValue("#mapName")) === "Small places" &&
      (await p.isChecked("#tagYear")) &&
      !(await p.isChecked("#tagCountry")),
    "loading sets every setting as it was",
  );
  ok(
    (await p.textContent("#note")) === "Settings loaded from small-places.settings.json." &&
      (await p.evaluate(() => localStorage.getItem("mapgen.radius"))) === "3000",
    "it says so, and the settings are kept for next time",
  );

  // Unknown settings, a newer version, countries without coverage: used where possible, and said
  await load(
    "newer.settings.json",
    JSON.stringify({
      format: "map-generation-tool settings",
      version: 7,
      settings: { countries: ["MT", "BY", "ZZ"], target: 300, cameraTilt: 20, presetName: "x" },
    }),
  );
  const note = await p.textContent("#note");
  ok(
    (await p.evaluate(() => chosenCountries.join())) === "MT" &&
      (await p.inputValue("#target")) === "300" &&
      /newer version/.test(note) &&
      /Not used, as this tool does not know them: cameraTilt, presetName\./.test(note) &&
      /2 countries were left out/.test(note),
    "a newer file: what can be used is, the rest is named: " + note,
  );
  ok(
    (await p.inputValue("#radius")) === "1,000" && (await p.isChecked("#arrowsAny")),
    "settings missing from the file get their defaults",
  );

  // Files that are not settings files: refused, nothing changes
  const refused = [
    ["notes.txt", "hello", /could not be read/],
    ["map.json", JSON.stringify({ name: "x", customCoordinates: [] }), /map file, not a settings file/],
    [
      "other.json",
      JSON.stringify({ format: "something else", version: 1, settings: {} }),
      /not a settings file/,
    ],
    [
      "empty.settings.json",
      JSON.stringify({ format: "map-generation-tool settings", version: 1 }),
      /no settings/,
    ],
    ["big.settings.json", " ".repeat(200001), /too large/],
  ];
  for (const [name, content, why] of refused) {
    await load(name, content);
    const msg = await p.textContent("#settingsMsg");
    ok(
      why.test(msg) &&
        (await p.isVisible("#settingsFile")) &&
        (await p.evaluate(() => chosenCountries.join())) === "MT",
      `${name}: refused, nothing changes (${msg})`,
    );
    await p.click("#settingsX");
  }

  // A hostile file: nothing runs, every value is checked
  await load(
    "evil.settings.json",
    JSON.stringify({
      format: "map-generation-tool settings",
      version: 1,
      settings: {
        scope: "<img src=x onerror=window.__x=1>",
        countries: ["<b>", "__proto__", "MT"],
        distribution: "__proto__",
        continent: "constructor",
        target: 1e12,
        radius: -5,
        yearFrom: "2015; drop",
        mapName: "<img src=x onerror=window.__x=2>" + "x".repeat(500),
        tagYear: "yes",
        "<script>": 1,
      },
    }),
  );
  const evil = await p.evaluate(() => ({
    s: currentSettings(),
    x: window.__x,
    imgs: document.querySelectorAll("img[src=x]").length,
  }));
  ok(
    evil.s.scope === "countries" &&
      evil.s.countries.join() === "MT" &&
      evil.s.distribution === "aaw" &&
      evil.s.target === 100 &&
      evil.s.radius === 1000 &&
      evil.s.yearFrom === 2007 &&
      evil.s.mapName.length <= 100 &&
      evil.s.tagYear === false &&
      !evil.x &&
      evil.imgs === 0,
    "a hostile file is cleaned: defaults for anything not well-formed, nothing runs",
  );
  ok(
    {}.polluted === undefined && (await p.evaluate(() => ({}).target)) === undefined,
    "and nothing leaks into other objects",
  );

  // The history keeps the tags too (one description of the settings)
  ok(
    (await p.evaluate(() => cleanSettings({ tagYear: true, tagCountry: false }))).tagYear === true &&
      (await p.evaluate(() => cleanSettings({}))).tagCountry === true,
    "older history entries get the default tags",
  );

  // Settings from before months could be chosen (history, files, what the browser saved): only years,
  // which read as January to December; "now" and nonsense in the "to" year
  const old = await p.evaluate(() => {
    const a = cleanSettings({ yearsOn: true, yearFrom: 2015, yearTo: 2020 });
    return {
      a: [a.yearFrom, a.monthFrom, a.yearTo, a.monthTo].join(),
      label: periodLabel(periodOf(a)),
      now: cleanSettings({ yearTo: "now" }).yearTo,
      junk: cleanSettings({ yearTo: "later" }).yearTo,
      future: cleanSettings({ yearTo: 3000 }).yearTo,
    };
  });
  ok(
    old.a === "2015,1,2020,12" &&
      old.label === "Jan 2015 to Dec 2020" &&
      old.now === "now" &&
      old.junk === "now" &&
      old.future === "now",
    "older settings with only years read as January to December: " + JSON.stringify(old),
  );
  await p.evaluate(() => {
    for (const k of ["monthFrom", "monthTo"]) localStorage.removeItem("mapgen." + k);
    localStorage.setItem("mapgen.yearsOn", "true");
    localStorage.setItem("mapgen.yearFrom", "2012");
    localStorage.setItem("mapgen.yearTo", "2016");
  });
  await p.reload();
  await p.waitForFunction(() => map !== null);
  ok(
    (await p.evaluate(() => periodLabel(years()))) === "Jan 2012 to Dec 2016",
    "years saved in the browser before months read as Jan 2012 to Dec 2016",
  );

  ok(errors.length === 0, "no page errors " + errors.join(" | "));
  await b.close();
  console.log(fail ? `${fail} FAILED` : "ALL PASS");
})();
