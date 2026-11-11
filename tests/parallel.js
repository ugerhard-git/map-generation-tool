// Lookups at the same time: 6 unless "Lookups at the same time" under "Search" says otherwise (1 to 50); kept
// with the settings and in the history. In both tools.
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
  /* The lookups under way at once, early in a search: Google answers only after 300 ms. */
  const atOnce = async (p, start) => {
    await p.evaluate(() => {
      window.__requests = [];
      window.__svDelay = 300;
      window.__sv = req => ({
        id: "PARAPANO" + Math.random(),
        lat: req.location.lat,
        lng: req.location.lng,
        links: [],
      });
    });
    await start();
    await p.waitForTimeout(150);
    const n = await p.evaluate(() => window.__requests.length);
    await searchEnded(p);
    await p.evaluate(() => (window.__svDelay = 0));
    return n;
  };

  const { page: p, errors } = await openPage(b);
  await p.evaluate(() => (document.getElementById("moreSearch").open = true));
  ok((await p.inputValue("#parallel")) === "6", "6 by default");
  let n = await atOnce(p, () => search(p, { country: "Malta", target: 40 }));
  ok(n === 6, "6 lookups at once: " + n);

  await p.fill("#parallel", "20");
  await p.press("#parallel", "Tab");
  ok(
    /20 lookups at once/.test(await p.textContent("#sumSearch")) &&
      (await p.evaluate(() => document.getElementById("moreSearch").classList.contains("changed"))),
    "the Search section says so: " + (await p.textContent("#sumSearch")),
  );
  n = await atOnce(p, () => search(p, { country: "Malta", target: 60 }));
  ok(n === 20, "20 lookups at once: " + n);
  ok((await p.evaluate(() => localStorage.getItem("mapgen.parallel"))) === "20", "the number is saved");
  await p.fill("#parallel", "500");
  await p.press("#parallel", "Tab");
  ok((await p.inputValue("#parallel")) === "50", "at most 50");

  await p.click("[data-help=parallel]");
  const help = await p.textContent("#helpBody");
  ok(
    /at once/.test(help) && /failed lookups/.test(help) && /limit/.test(help),
    "the help explains it and the risks",
  );
  await p.keyboard.press("Escape");

  const kept = await p.evaluate(() => ({
    before: cleanSettings({}).parallel,
    wrong: cleanSettings({ parallel: 99 }).parallel,
    read: cleanSettings({ parallel: 25 }).parallel,
    history: historyDetails(cleanSettings({ parallel: 25 })),
    plain: historyDetails(cleanSettings({})),
  }));
  ok(
    kept.before === 6 && kept.wrong === 6 && kept.read === 25,
    "read back and checked: " + JSON.stringify(kept),
  );
  ok(
    /25 lookups at once/.test(kept.history) && !/lookups at once/.test(kept.plain),
    "in the history when not 6",
  );
  await p.evaluate(() => applySettings(cleanSettings({ ...currentSettings(), parallel: 12 })));
  ok((await p.inputValue("#parallel")) === "12", "put back into the form from the history");
  await p.click("[data-reset=moreSearch]");
  ok((await p.inputValue("#parallel")) === "6", "Reset to defaults: 6");

  // Unofficial has it too
  const { page: u, errors: uErrors } = await openPage(b, "ok", null, UNOFFICIAL);
  await u.evaluate(() => (document.getElementById("moreSearch").open = true));
  await u.fill("#parallel", "15");
  await u.press("#parallel", "Tab");
  await u.evaluate(() => {
    window.__requests = [];
    window.__svDelay = 300;
    window.__sv = req => ({
      id: "UNOFFPARA" + Math.random(),
      lat: req.location.lat,
      lng: req.location.lng,
      copyright: "© 2023 Jane Doe",
      links: [],
    });
  });
  await u.check("input[name=scope][value=countries]");
  await chooseCountry(u, "Malta");
  await u.fill("#target", "40");
  await u.fill("#apiKey", "TESTKEY");
  await u.click("#go");
  await u.waitForTimeout(150);
  n = await u.evaluate(() => window.__requests.length);
  await searchEnded(u);
  ok(n === 15, "Unofficial: 15 lookups at once: " + n);

  ok(errors.length === 0 && uErrors.length === 0, "no page errors " + [...errors, ...uErrors].join(" | "));
  await b.close();
  console.log(fail ? `${fail} FAILED` : "ALL PASS");
})();
