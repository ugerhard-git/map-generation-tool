// Resuming a long search: the search is saved in the browser while it runs; after the page is closed and
// opened again, a box offers to continue it, to download what was found, or to discard it. A finished
// search, "Keep what was found" and "Clear" remove it; a new tab asks for the visitor's own key again;
// the saved search goes on in the same history entry; a tampered saved search is checked.
const { chromium } = require("./pw.js");
const { openPage, search, searchEnded } = require("./helpers.js");
(async () => {
  const b = await chromium.launch();
  let fail = 0;
  const ok = (c, m) => {
    console.log((c ? "PASS " : "FAIL ") + m);
    if (!c) fail++;
  };
  // Google finds a panorama at every random spot, a little slowly so a search can be caught mid-way.
  // Ids are random, so panoramas found after a reload never repeat earlier ones by chance.
  const slowGoogle = page =>
    page.evaluate(() => {
      window.__svDelay = 25;
      window.__sv = req => ({
        id: "RES_" + Math.random().toString(36).slice(2, 10),
        lat: req.location.lat,
        lng: req.location.lng,
        links: [],
      });
    });
  const savedCount = page =>
    page.evaluate(async () => (await dbRequest("readonly", s => s.get(DB_KEY)))?.results?.length ?? -1);
  const waitSaved = async (page, n) => {
    for (let i = 0; i < 300; i++) {
      if ((await savedCount(page)) >= n) return true;
      await page.waitForTimeout(50);
    }
    return false;
  };
  // What is saved, once the browser has finished writing it: saving runs alongside the page, so a check
  // right after an action could read the state from just before. Waits up to 3 s for `want(count)`.
  const savedWhen = async (page, want) => {
    let n = await savedCount(page);
    for (let i = 0; i < 60 && !want(n); i++) {
      await page.waitForTimeout(50);
      n = await savedCount(page);
    }
    return n;
  };
  const reopen = async page => {
    await page.reload();
    await page.waitForFunction(() => map !== null);
    await page.waitForTimeout(300); // the saved search is read back without waiting for anything else
    await slowGoogle(page);
  };

  const { page: p, errors } = await openPage(b);
  ok(await p.isHidden("#resume"), "nothing to resume at first");

  // 1. A long search is saved while it runs; closing the page mid-way and opening it again offers it
  await slowGoogle(p);
  await search(p, { country: ["Malta", "Luxembourg"], target: 120 });
  ok(await waitSaved(p, 20), "the running search is saved in this browser");
  const before = await p.evaluate(() => results.map(l => l.panoId));
  await reopen(p); // as if the tab had been closed
  ok(await p.isVisible("#resume"), "after reopening, the unfinished search is offered");
  const text = await p.textContent("#resume");
  ok(
    /An unfinished search: Malta, Luxembourg/.test(text) &&
      /Today, \d\d:\d\d/.test(text) &&
      /of 120 locations found so far/.test(text),
    "it says what and how far: " + text.replace(/\s+/g, " ").trim(),
  );
  ok(!(await p.evaluate(() => running)), "nothing runs until the visitor chooses");

  // Continue: the settings, the locations and the progress come back, and the search runs to the end
  // The saved locations, read before continuing. The search goes on right away and may find more before
  // the check below runs, so the check is that every saved one is back, not an exact count.
  const savedIds = await p.evaluate(async () =>
    (await dbRequest("readonly", s => s.get(DB_KEY))).results.map(l => l.panoId),
  );
  await p.click("#resumeGo");
  await p.waitForFunction(() => running);
  const restored = await p.evaluate(() => ({
    n: results.length,
    ids: results.map(l => l.panoId),
    chosen: chosenCountries.join(),
  }));
  ok(
    savedIds.length > 0 && savedIds.every(id => restored.ids.includes(id)) && restored.chosen === "MT,LU",
    `continue puts back all ${savedIds.length} saved locations (${restored.n} now) and the countries`,
  );
  ok(
    before.slice(0, 10).every(id => restored.ids.includes(id)),
    "the locations found before closing are kept",
  );
  await searchEnded(p);
  const done = await p.evaluate(() => ({
    n: results.length,
    unique: new Set(results.map(l => l.panoId)).size,
    perCountry: JSON.stringify([...foundBy].sort()),
    targets: JSON.stringify([...searchTargets].sort()),
  }));
  ok(
    done.n === 120 && done.unique === 120 && done.perCountry === done.targets,
    "the search finishes with all 120, no repeats, each country its share",
  );
  ok(/Done: 120 locations/.test(await p.textContent("#now")), "done message");
  const hist = await p.evaluate(() => loadHistory());
  ok(
    hist.length === 1 && hist[0].outcome === "120 locations",
    "the history entry of the search is completed, not doubled",
  );
  ok((await savedWhen(p, n => n === -1)) === -1, "a finished search is no longer kept");
  await reopen(p);
  ok(await p.isHidden("#resume"), "so nothing is offered after reopening");

  // 2. Stopped by hand: kept. "Download what was found" brings the locations back without searching.
  await search(p, { country: "Malta", target: 500 });
  await p.waitForFunction(() => results.length >= 15);
  await p.click("#stop");
  await searchEnded(p);
  const stoppedAt = await p.evaluate(() => results.length);
  ok(
    (await savedWhen(p, n => n === stoppedAt)) === stoppedAt,
    "a stopped search is kept, with everything found: " + stoppedAt,
  );
  await reopen(p);
  await p.click("#resumeShow");
  ok(
    (await p.evaluate(() => results.length)) === stoppedAt &&
      !(await p.evaluate(() => running)) &&
      (await p.isEnabled("#download")),
    "Download what was found: the locations are back, ready to download, nothing runs",
  );
  ok(
    JSON.parse(await p.evaluate(() => exportJson())).customCoordinates.length === stoppedAt,
    "and the map file has them all",
  );
  await reopen(p);
  ok(await p.isVisible("#resume"), "still offered next time, until it is continued or discarded");

  // 3. A new tab: the visitor's own key is gone (it is kept for one tab only), so Continue asks for it
  const tab = (await openPage(b, "ok", p.context())).page;
  await tab.waitForTimeout(300);
  await slowGoogle(tab);
  ok(
    (await tab.inputValue("#apiKey")) === "" && (await tab.isVisible("#resume")),
    "a new tab: no key, the search is offered",
  );
  await tab.click("#resumeGo");
  ok(
    /Enter your Google API key/.test(await tab.textContent("#error")) && (await tab.isVisible("#resume")),
    "Continue asks for the key first",
  );
  await tab.fill("#apiKey", "TESTKEY");
  await tab.click("#resumeGo");
  await tab.waitForFunction(n => results.length >= n + 5, stoppedAt, { timeout: 30000 });
  await tab.click("#stop");
  await searchEnded(tab);
  ok((await tab.evaluate(() => results.length)) > stoppedAt, "with the key, the search goes on");

  // 4. Discard; Keep what was found; Clear: nothing kept
  await reopen(tab);
  await tab.click("#resumeDrop");
  ok((await savedWhen(tab, n => n === -1)) === -1 && (await tab.isHidden("#resume")), "Discard removes it");
  await search(tab, { country: "Malta", target: 400 });
  await tab.waitForFunction(() => results.length >= 5);
  await tab.click("#stop");
  await searchEnded(tab);
  await tab.click("#clear");
  ok((await savedWhen(tab, n => n === -1)) === -1, "Clear removes it");

  // A search that ended short is kept until the visitor chooses; "Keep what was found" removes it
  await tab.fill("#giveUpAfter", "50");
  await tab.evaluate(() => {
    window.__svDelay = 0;
    const g = window.__sv;
    window.__sv = req => (req.location.lat < 40 ? null : g(req)); // nothing ever in Malta
  });
  await search(tab, { country: ["Malta", "Luxembourg"], target: 20 });
  await searchEnded(tab);
  ok(
    (await tab.isVisible("#shortfall")) && (await savedWhen(tab, n => n > 0)) > 0,
    "a search that ended short is kept",
  );
  await tab.click("#keepFound");
  ok((await savedWhen(tab, n => n === -1)) === -1, "Keep what was found removes it");

  // 5. A tampered saved search: broken locations are left out, a broken record is not offered
  await tab.evaluate(() =>
    dbRequest("readwrite", s =>
      s.put(
        {
          version: 1,
          savedAt: Date.now(),
          title: "<img src=x onerror=window.__x=1>",
          settings: { scope: "countries", countries: ["MT"] },
          area: "Malta",
          total: 10,
          targets: [
            ["MT", 10],
            ["<b>", 5],
          ],
          found: [["MT", 3]],
          results: [
            { lat: 35.9, lng: 14.4, heading: 90, panoId: "GOOD_ONE", cc: "MT", date: "2020-01" },
            { lat: 35.91, lng: 14.41, heading: 400, panoId: "BAD_HEADING", cc: "MT" },
            { lat: 35.92, lng: 14.42, heading: 10, panoId: "x<y", cc: "MT" },
            { lat: 35.93, lng: 14.43, heading: 10, panoId: "WRONG_COUNTRY", cc: "BY" },
            "junk",
          ],
        },
        DB_KEY,
      ),
    ),
  );
  await reopen(tab);
  ok(
    (await tab.isVisible("#resume")) &&
      /1 of 10 locations/.test(await tab.textContent("#resume")) &&
      (await tab.$$("#resume img")).length === 0,
    "only the well-formed location counts, and the title is shown as text",
  );
  await tab.click("#resumeShow");
  ok((await tab.evaluate(() => results.map(l => l.panoId).join())) === "GOOD_ONE", "and only it comes back");
  await tab.evaluate(() => dbRequest("readwrite", s => s.put({ version: 99, savedAt: "soon" }, DB_KEY)));
  await reopen(tab);
  ok(await tab.isHidden("#resume"), "a broken saved search is not offered");

  ok(errors.length === 0 && !(await tab.evaluate(() => window.__x)), "no page errors " + errors.join(" | "));
  await b.close();
  console.log(fail ? `${fail} FAILED` : "ALL PASS");
})();
