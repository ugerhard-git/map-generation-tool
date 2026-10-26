// Your own distributions (plan step 17): made from a Vali map, edited in the table as percentages (the
// default) or numbers, converted when switching, saved as presets under "Your maps" (replace, edit a copy,
// delete), used by the search, kept by the browser, the history and the settings file, and checked.
const { chromium } = require("./pw.js");
const { openPage, chooseCountry, searchEnded } = require("./helpers.js");
(async () => {
  const b = await chromium.launch();
  let fail = 0;
  const ok = (c, m) => {
    console.log((c ? "PASS " : "FAIL ") + m);
    if (!c) fail++;
  };
  const { page: p, errors } = await openPage(b);
  const shares = () =>
    p.$$eval("#shares .own-input", list => Object.fromEntries(list.map(i => [i.dataset.code, i.value])));
  const figures = () =>
    p.$$eval("#shares .own-figure", list =>
      Object.fromEntries(list.map(c => [c.dataset.code, c.textContent])),
    );
  const share = (code, text) => p.fill(`#shares .own-input[data-code="${code}"]`, text);

  for (const c of ["Malta", "Luxembourg", "Gibraltar", "Iceland"]) await chooseCountry(p, c);
  await p.fill("#target", "1000");
  await p.press("#target", "Tab");
  ok(
    (await p.isHidden("#ownEditor")) && (await p.isVisible("#ownFromMap")),
    "with a Vali map, no editor; you can make your own",
  );

  // Made from the map: its shares as percentages that add up to 100
  await p.click("#ownFromMap");
  let s = await shares();
  const sum = Object.values(s).reduce((n, v) => n + Number(v), 0);
  ok(
    (await p.isVisible("#ownEditor")) &&
      (await p.inputValue("#distribution")) === "own" &&
      Object.keys(s).sort().join() === "GI,IS,LU,MT" &&
      Math.abs(sum - 100) < 0.001,
    "made from the map: a field per country, percentages adding up to 100: " + JSON.stringify(s),
  );
  ok((await p.textContent("#moreDistribution .more-sum")) === "Your own, percentages", "the summary says so");

  // Typing shares: kept at once, decimals with a comma too; not adding up to 100: used in proportion
  await share("GI", "10");
  await share("IS", "0,5");
  await share("LU", "40");
  await share("MT", "30");
  ok(
    /Adds up to 80\.5%: shared in proportion/.test(await p.textContent("#ownSum")) &&
      (await p.isVisible("#ownMake100")),
    "80.5% is used in proportion, and can be made 100%: " + (await p.textContent("#ownSum")),
  );
  let f = await figures();
  ok(f.LU === "497" && f.IS === "6", "the locations follow while typing: " + JSON.stringify(f));
  await share("IS", "abc");
  ok((await p.evaluate(() => own.values.IS)) === 0.5, "something that is not a share is not kept");
  await p.press(`#shares .own-input[data-code="IS"]`, "Tab");
  ok((await shares()).IS === "0.5", "and the field shows the share kept");
  await p.click("#ownMake100");
  s = await shares();
  ok(
    Math.abs(Object.values(s).reduce((n, v) => n + Number(v), 0) - 100) < 0.001 &&
      /Adds up to 100%/.test(await p.textContent("#ownSum")),
    "Make it 100% scales them: " + JSON.stringify(s),
  );
  // A small share of a small number rounds down
  await p.fill("#target", "10");
  await p.press("#target", "Tab");
  f = await figures();
  ok(f.IS === "0", "a share that rounds down shows 0 locations: " + JSON.stringify(f));
  ok(
    /round down to 0 locations/.test(await p.evaluate(() => document.getElementById("help-own").innerHTML)),
    "and the help says why",
  );
  await p.fill("#target", "1000");
  await p.press("#target", "Tab");

  // Numbers: converted for the number of locations; their sum is the number of locations
  await p.check('input[name=ownMode][value="number"]');
  s = await shares();
  const total = Object.values(s).reduce((n, v) => n + Number(v.replace(/,/g, "")), 0);
  ok(
    total === 1000 && (await p.inputValue("#target")) === "1,000",
    "switching to numbers converts for 1,000 locations: " + JSON.stringify(s),
  );
  await share("MT", "2,000");
  ok(
    (await p.inputValue("#target")) ===
      String((total - Number(s.MT.replace(/,/g, "")) + 2000).toLocaleString("en")),
    "typing a number changes the number of locations: " + (await p.inputValue("#target")),
  );
  await p.fill("#target", "500");
  await p.press("#target", "Tab");
  s = await shares();
  ok(
    Object.values(s).reduce((n, v) => n + Number(v.replace(/,/g, "")), 0) === 500,
    "changing the number of locations scales them all: " + JSON.stringify(s),
  );
  // And back to percentages
  await p.check('input[name=ownMode][value="percent"]');
  ok(
    Math.abs(Object.values(await shares()).reduce((n, v) => n + Number(v), 0) - 100) < 0.001,
    "and back to percentages",
  );

  // The search uses them: numbers exactly, percentages shared out
  await p.evaluate(() => {
    window.__sv = req => ({
      id: "OWN_" + Math.random().toString(36).slice(2, 10),
      lat: req.location.lat,
      lng: req.location.lng,
      links: [],
    });
  });
  await p.check('input[name=ownMode][value="number"]');
  await share("GI", "3");
  await share("IS", "0");
  await share("LU", "4");
  await share("MT", "5");
  await p.fill("#apiKey", "TESTKEY");
  await p.click("#go");
  await searchEnded(p);
  ok(
    (await p.evaluate(() => JSON.stringify(Object.fromEntries([...searchTargets].sort())))) ===
      '{"GI":3,"LU":4,"MT":5}' && (await p.evaluate(() => results.length)) === 12,
    "the search finds exactly the numbers entered, none for a country with 0",
  );

  // Save as a preset; it is listed under Your maps and kept
  await p.click("#ownEdit");
  await p.click("#ownSave");
  ok(/Give the preset a name first/.test(await p.textContent("#ownSaved")), "a preset needs a name");
  await p.fill("#ownName", "Small places");
  await p.click("#ownSave");
  ok(
    (await p.$$eval(
      "#distribution optgroup",
      g => g[0].label + ": " + [...g[0].children].map(o => o.textContent).join(", "),
    )) === "Your maps: Your own: Small places, Small places",
    "saved under Your maps, above Vali's maps",
  );
  await share("MT", "50");
  await p.click("#ownSave");
  ok(
    /Replaced "Small places"/.test(await p.textContent("#ownSaved")) &&
      (await p.evaluate(() => loadPresets().length)) === 1 &&
      (await p.evaluate(() => loadPresets()[0].values.MT)) === 50,
    "saving under the same name replaces the preset",
  );
  // Choosing the preset: used as it is; edit a copy, or delete it
  const presetValue = await p.evaluate(() => "preset:" + loadPresets()[0].id);
  await p.selectOption("#distribution", presetValue);
  ok(
    (await p.isHidden("#ownEditor")) &&
      (await p.isVisible("#ownFromPreset")) &&
      (await p.isVisible("#presetDelete")),
    "a preset is used as it is, with Edit a copy and Delete",
  );
  ok(
    (await p.evaluate(() => JSON.stringify(Object.fromEntries(Object.entries(planTargets()).sort())))) ===
      '{"GI":3,"LU":4,"MT":50}',
    "and the search would use its numbers: " + (await p.evaluate(() => JSON.stringify(planTargets()))),
  );
  await p.reload();
  await p.waitForFunction(() => map !== null);
  ok(
    (await p.inputValue("#distribution")) === presetValue &&
      (await p.evaluate(() => own.name)) === "Small places",
    "presets and your own are kept in this browser",
  );
  await p.click("#presetDelete");
  ok((await p.evaluate(() => loadPresets().length)) === 1, "deleting asks for a second click");
  await p.click("#presetDelete");
  ok(
    (await p.evaluate(() => loadPresets().length)) === 0 && (await p.inputValue("#distribution")) === "aaw",
    "then it is gone: " +
      (await p.evaluate(() => loadPresets().length)) +
      " " +
      (await p.inputValue("#distribution")),
  );

  // History and settings file keep the values (not a preset id), and bring them back as Your own
  await p.selectOption("#distribution", "own");
  const entry = await p.evaluate(() => {
    const s = currentSettings();
    return { distribution: s.distribution, own: s.own };
  });
  ok(
    entry.distribution === "own" && entry.own.values.MT === 50 && entry.own.mode === "number",
    "the settings hold the values themselves",
  );
  await p.selectOption("#distribution", "aaw");
  await p.evaluate(() => {
    own = null;
    applySettings(
      cleanSettings({
        countries: ["MT", "LU"],
        distribution: "own",
        own: { mode: "percent", values: { MT: 70, LU: 30 }, name: "From a file" },
      }),
    );
  });
  ok(
    (await p.inputValue("#distribution")) === "own" &&
      (await p.evaluate(() => JSON.stringify(planTargets()))) === JSON.stringify({ MT: 70, LU: 30 }),
    "loaded settings bring the distribution back as Your own",
  );
  const hostile = await p.evaluate(() =>
    cleanSettings({
      distribution: "own",
      own: {
        mode: "<b>",
        values: { MT: 1e9, LU: -5, "<img>": 50, __proto__: 3, IS: "12" },
        name: "x".repeat(99),
      },
    }),
  );
  ok(
    hostile.own.mode === "percent" &&
      JSON.stringify(hostile.own.values) === '{"MT":100,"IS":12}' &&
      hostile.own.name.length === 40,
    "values from outside are checked: " + JSON.stringify(hostile.own),
  );
  ok(
    (await p.evaluate(() => cleanSettings({ distribution: "own" }).distribution)) === "aaw" &&
      (await p.evaluate(() => cleanSettings({ distribution: "preset:abcd" }).distribution)) === "aaw",
    "without values, or a preset of another browser, the default map",
  );
  await p.evaluate(() =>
    localStorage.setItem(
      "mapgen.presets",
      JSON.stringify([{ id: "<x>", name: "Bad" }, { id: "good1", name: "", mode: "number" }, "junk"]),
    ),
  );
  ok((await p.evaluate(() => loadPresets().length)) === 0, "tampered presets are left out");

  // Too many locations in numbers: refused at the start
  await p.evaluate(() => {
    own = { mode: "number", values: { MT: 100000, LU: 100000 }, name: "" };
    saveOwn();
    renderDistributionChoices();
    document.getElementById("distribution").value = "own";
    whereChanged();
  });
  await p.click("#go");
  ok(
    /more than 130,000/.test(await p.textContent("#error")),
    "numbers adding up to more than 130,000 are refused",
  );

  // "Edit the shares" scrolls to the editor, every time
  await p.check("input[name=scope][value=countries]");
  await p.evaluate(() => {
    chosenCountries = ["MT", "LU", "GI"];
    own = { mode: "percent", values: { MT: 50, LU: 30, GI: 20 }, name: "" };
    saveOwn();
    renderDistributionChoices();
    document.getElementById("distribution").value = "own";
    whereChanged();
  });
  const editorInView = () =>
    p.evaluate(() => {
      const r = document.getElementById("ownEditor").getBoundingClientRect();
      return r.top >= 0 && r.top < innerHeight;
    });
  for (const round of [1, 2]) {
    await p.evaluate(() => {
      document.getElementById("form").scrollTop = 0;
      scrollTo(0, 0);
    });
    await p.click("#ownEdit");
    await p.waitForTimeout(900);
    ok(await editorInView(), `"Edit the shares" scrolls to the editor (time ${round})`);
  }
  // The × takes one country out; "Set all to 0" all of them, after a second click
  await p.click('#shares .own-clear[data-code="GI"]');
  ok(
    (await p.inputValue('#shares .own-input[data-code="GI"]')) === "0" &&
      (await p.evaluate(() => own.values.GI)) === undefined &&
      !(await p.isVisible('#shares .own-clear[data-code="GI"]')),
    "the × of a row sets that country to 0",
  );
  await p.click("#ownClearAll");
  ok((await p.evaluate(() => Object.keys(own.values).length)) === 2, "Set all to 0 asks for a second click");
  await p.click("#ownClearAll");
  ok(
    (await p.evaluate(() => Object.keys(own.values).length)) === 0 &&
      /Give at least one country a share/.test(await p.textContent("#ownSum")),
    "then every share is 0",
  );

  // The whole world: every country with official coverage can get a share
  await p.check("input[name=scope][value=world]");
  ok(
    await p.evaluate(() => document.querySelectorAll("#shares .own-input").length === COVERAGE.length),
    "for the whole world, a field for every country with official coverage",
  );
  ok(
    (await p.inputValue('#shares .own-input[data-code="PS"]')) === "0" &&
      (await p.inputValue('#shares .own-input[data-code="JE"]')) === "0",
    "countries a Vali map leaves out are there with 0, to be given a share",
  );
  await p.check("input[name=scope][value=continent]");
  await p.selectOption("#continent", "asia");
  await p.selectOption("#distribution", "own");
  ok(
    (await p.$$eval("#shares .own-input", list => list.map(i => i.dataset.code))).includes("PS"),
    "Palestine, in none of Vali's continent lists, is offered for Asia",
  );

  ok(errors.length === 0, "no page errors " + errors.join(" | "));
  await b.close();
  console.log(fail ? `${fail} FAILED` : "ALL PASS");
})();
