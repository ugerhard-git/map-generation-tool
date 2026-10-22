// Shortfalls: a country gives up after the set number of random spots in a row without a new location;
// failed lookups do not count; at the end the page offers to fill the gap from the other countries, which
// searches on with the same results, or to keep what was found; no offer after stopping by hand.
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
  const state = () =>
    p.evaluate(() => ({
      targets: Object.fromEntries(searchTargets),
      found: Object.fromEntries(foundBy),
      gaveUp: [...gaveUp].join(),
      results: results.length,
    }));

  // The setting: 2,000 by default, kept within 50 to 100,000, remembered
  ok((await p.inputValue("#giveUpAfter")) === "2000", "gives up after 2,000 spots by default");
  await p.fill("#giveUpAfter", "5");
  await p.press("#giveUpAfter", "Tab");
  ok((await p.evaluate(() => giveUpAfter())) === 2000, "a number below 50 is not used");
  await p.fill("#giveUpAfter", "60");
  await p.press("#giveUpAfter", "Tab");

  // Malta and Luxembourg: Google never finds anything in Malta, always in Luxembourg
  await p.evaluate(() => {
    let n = 0;
    window.__sv = req =>
      req.location.lat < 40
        ? null
        : { id: "LUX_" + n++, lat: req.location.lat, lng: req.location.lng, links: [] };
    document.getElementById("distribution").value = "abw";
  });
  await search(p, { country: ["Malta", "Luxembourg"], target: 20 });
  await searchEnded(p);
  let s = await state();
  const maltaWanted = s.targets.MT,
    luxWanted = s.targets.LU;
  ok(
    s.gaveUp === "MT" && !s.found.MT && s.found.LU === luxWanted,
    `Malta gave up, Luxembourg is full: ${JSON.stringify(s)}`,
  );
  const tries = await p.evaluate(() => missesInRow.get("MT"));
  // Lookups already under way when Malta gave up still count (PARALLEL run at once): 60 to 65.
  ok(
    tries >= 60 && tries < 60 + (await p.evaluate(() => PARALLEL)),
    "Malta gave up after the 60 spots set: " + tries,
  );
  ok(await p.isVisible("#shortfall"), "the offer is shown");
  const title = await p.textContent("#shortfallTitle"),
    text = await p.textContent("#shortfallText");
  ok(
    title === `1 country fell short: ${maltaWanted} locations missing.` &&
      /Malta \(0 of \d+\)/.test(text) &&
      /other country/.test(text),
    `the offer says what fell short: ${title} ${text}`,
  );
  ok((await p.isVisible("#fillGap")) && (await p.isVisible("#keepFound")), "both choices are offered");
  await p.click("#sharesSummary");
  ok(
    /1 of 2 countries done, 1 gave up/.test(await p.textContent("#sharesSummary")) &&
      /gave up/.test(await p.textContent("#shares tr.short")),
    "the table marks Malta as given up: " + (await p.textContent("#sharesSummary")),
  );
  await p.screenshot({ path: path.join(__dirname, "../dist/screens/shortfall.png") });

  // Fill the gap: Luxembourg takes Malta's share, the search goes on and keeps what it had
  const before = await p.evaluate(() => results.map(l => l.panoId).join());
  await p.click("#fillGap");
  await searchEnded(p);
  s = await state();
  ok(
    s.targets.LU === 20 && s.found.LU === 20 && s.targets.MT === 0 && s.results === 20,
    "after filling: Luxembourg has all 20, Malta keeps the 0 it found: " + JSON.stringify(s),
  );
  ok(
    (await p.evaluate(() => results.map(l => l.panoId).join())).startsWith(before),
    "the locations found before are kept",
  );
  ok(
    /Done: 20 locations found in 2 countries/.test(await p.textContent("#now")),
    "done: " + (await p.textContent("#now")),
  );
  ok(await p.isHidden("#shortfall"), "no offer any more");

  // Keep what was found: the offer closes, nothing changes
  await search(p, { country: ["Malta", "Luxembourg"], target: 20 });
  await searchEnded(p);
  await p.click("#keepFound");
  s = await state();
  ok(
    (await p.isHidden("#shortfall")) &&
      s.results === luxWanted &&
      /Kept \d+ locations/.test(await p.textContent("#now")),
    "keep what was found: offer closed, " + s.results + " locations kept",
  );
  ok(await p.isEnabled("#download"), "and they can be downloaded");

  // One country: nothing to fill from
  await search(p, { country: "Malta", target: 5 });
  await searchEnded(p);
  ok(
    (await p.isVisible("#shortfall")) &&
      (await p.isHidden("#fillGap")) &&
      /No other country/.test(await p.textContent("#shortfallText")),
    "a single country that gives up: told, without a fill button",
  );
  // A new search closes the offer
  await p.evaluate(() => {
    let n = 0;
    window.__sv = req => ({ id: "ANY_" + n++, lat: req.location.lat, lng: req.location.lng, links: [] });
  });
  await search(p, { country: "Malta", target: 3 });
  await searchEnded(p);
  ok(await p.isHidden("#shortfall"), "a new search that succeeds shows no offer");

  // Failed lookups do not count towards giving up
  await p.evaluate(() => {
    let n = 0;
    window.__sv = req =>
      n++ % 2
        ? { status: "UNKNOWN_ERROR" }
        : { id: "F_" + n, lat: req.location.lat, lng: req.location.lng, links: [] };
  });
  await p.fill("#radius", "1234"); // between the field's steps of 50: must not stop the search
  await search(p, { country: "Malta", target: 10 });
  await searchEnded(p);
  ok(
    (await p.evaluate(() => window.__requests[window.__requests.length - 1].radius)) === 1234,
    "a radius between the field's steps (1,234 m) still starts the search and is used",
  );
  await p.fill("#radius", "1000");
  s = await state();
  ok(
    !s.gaveUp && s.results === 10,
    "with every other lookup failing, Malta still gets all 10: " + JSON.stringify(s),
  );

  // Stopping by hand: no offer
  await p.evaluate(() => {
    window.__svDelay = 30;
    window.__sv = () => null;
  });
  await search(p, { country: ["Malta", "Luxembourg"], target: 20 });
  await p.waitForFunction(() => stats.tries > 10);
  await p.click("#stop");
  await searchEnded(p);
  ok(await p.isHidden("#shortfall"), "after stopping by hand there is no offer");
  await p.evaluate(() => (window.__svDelay = 0));

  // The setting is remembered
  await p.reload();
  await p.waitForFunction(() => map !== null);
  ok((await p.inputValue("#giveUpAfter")) === "60", "the number of spots is remembered");

  ok(errors.length === 0, "no page errors " + errors.join(" | "));
  await b.close();
  console.log(fail ? `${fail} FAILED` : "ALL PASS");
})();
