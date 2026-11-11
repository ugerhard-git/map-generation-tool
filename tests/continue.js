// Continuing a stopped search: after "Stop", "Continue the search" runs it on from where it stopped while
// the settings that decide which locations are found are those it ran with; "Start a new search" starts
// afresh. The number, the radius, the lookups at the same time and giving up may change: a higher number
// looks for more, a lower one keeps that many at random, each country its share; also after a search that
// ended. With other changed settings, only a new search is possible: a warning says so, and "Start a new
// search" asks first, naming what changed. Settings that only shape the map file do not count as changes.
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
  // Every spot has a panorama; answers take a moment, so a search can be stopped midway
  await p.evaluate(() => {
    let n = 0;
    window.__svDelay = 30;
    window.__sv = req => ({ id: "CONT_" + n++, lat: req.location.lat, lng: req.location.lng, links: [] });
  });
  const shown = async () => ({
    cont: await p.isVisible("#continueGo"),
    go: await p.textContent("#go"),
    note: (await p.isVisible("#continueNote")) ? await p.textContent("#continueNote") : "",
    warn: await p.evaluate(() => document.getElementById("continueNote").classList.contains("error")),
  });
  const stopAt = async n => {
    await p.waitForFunction(n => results.length >= n, n);
    await p.click("#stop");
    await searchEnded(p);
    return p.evaluate(() => results.length);
  };

  // Nothing to continue at first
  let s = await shown();
  ok(!s.cont && s.go === "Find locations" && !s.note, "at first: only Find locations");

  // Stopped: continue or start a new search
  await search(p, { country: "Malta", target: 300 });
  const stopped = await stopAt(20);
  const firstIds = await p.evaluate(() => results.map(l => l.panoId));
  s = await shown();
  ok(
    s.cont &&
      s.go === "Start a new search" &&
      !s.warn &&
      s.note ===
        `You stopped the search at ${stopped} of 300 locations. Continue it, or start a new search, which replaces them.`,
    "stopped: Continue the search, or Start a new search: " + s.note,
  );
  ok(
    (await p.evaluate(() => document.getElementById("go").classList.contains("second"))) === true,
    "Start a new search is the second choice",
  );

  // Map file settings do not count as changes
  await p.check("#tagYear");
  await p.fill("#mapName", "Malta test");
  await p.press("#mapName", "Tab");
  ok((await shown()).cont, "changing the map name or tags keeps Continue");

  // The radius may change: Continue stays, and says it goes on with the changed settings
  await p.fill("#radius", "2500");
  await p.press("#radius", "Tab");
  s = await shown();
  ok(
    s.cont &&
      !s.warn &&
      /keeps the \d+ locations found and looks for \d+ more, with your changed settings/.test(s.note),
    "a changed radius keeps Continue: " + s.note,
  );
  await p.fill("#radius", "1000");
  await p.press("#radius", "Tab");

  // A filter does: warned, no Continue; changing it back brings Continue back
  await p.check("#noRoadName");
  s = await shown();
  ok(
    !s.cont &&
      s.warn &&
      s.go === "Start a new search" &&
      new RegExp(
        `You changed settings that decide which locations are found, so the ${stopped} locations found cannot be kept`,
      ).test(s.note),
    "changed filter: a warning, and no Continue: " + s.note,
  );
  // "Start a new search" asks first, and names what changed; Cancel keeps everything
  await p.check("#arrowsEnd");
  await p.click("#go");
  ok(await p.isVisible("#newSearch"), "Start a new search asks first");
  const dialog = await p.textContent("#newSearch");
  ok(
    (await p.evaluate(() =>
      [...document.querySelectorAll("#newSearchChanged li")].map(li => li.textContent).join(),
    )) === "Roads and arrows" && dialog.includes(`The ${stopped} locations found so far`),
    "it says why, and names the section that changed: " +
      (await p.evaluate(() => document.getElementById("newSearchChanged").textContent)),
  );
  await p.click("#newSearchCancel");
  ok(
    (await p.isHidden("#newSearch")) && (await p.evaluate(() => !running && results.length)) === stopped,
    "Cancel: nothing lost",
  );
  await p.uncheck("#noRoadName");
  await p.check("#arrowsAny");
  ok((await shown()).cont && !(await shown()).warn, "the settings changed back: Continue again");

  // Continue: the same search runs on, keeping what was found
  await p.click("#continueGo");
  ok((await p.evaluate(() => running)) && (await p.isHidden("#continueGo")), "Continue runs the search on");
  const again = await stopAt(stopped + 15);
  const ids = await p.evaluate(() => results.map(l => l.panoId));
  ok(
    again > stopped && firstIds.every((id, i) => ids[i] === id) && new Set(ids).size === ids.length,
    `it kept the ${stopped} found and went on to ${again}, no repeats`,
  );
  ok(
    (await p.evaluate(() => loadHistory().length)) === 1,
    "continuing is the same search: no new history entry",
  );

  // Start a new search: from scratch
  await p.click("#go");
  await p.waitForFunction(() => running);
  const fresh = await p.evaluate(() => results.map(l => l.panoId));
  ok(
    fresh.every(id => !ids.includes(id)),
    "Start a new search starts from scratch",
  );
  const n3 = await stopAt(10);
  ok((await shown()).cont, "stopped again: Continue is offered again (" + n3 + ")");

  // Clear: nothing to continue
  await p.click("#clear");
  s = await shown();
  ok(!s.cont && s.go === "Find locations" && !s.note, "Clear: only Find locations");

  // A search that ended on its own: nothing to continue while the number stays
  await p.evaluate(() => (window.__svDelay = 0));
  await search(p, { country: ["Malta", "Luxembourg"], target: 40 });
  await searchEnded(p);
  s = await shown();
  ok(!s.cont && s.go === "Find locations", "a finished search: nothing to continue");
  const done = await p.evaluate(() => results.map(l => l.panoId));
  const share = () =>
    p.evaluate(() =>
      [...foundBy]
        .sort()
        .map(([c, n]) => c + n)
        .join(),
    );
  const plan = await p.evaluate(() =>
    Object.entries(planTargets())
      .sort()
      .map(([c, n]) => c + n)
      .join(),
  );

  // A higher number: Continue looks for more, keeping them all
  await p.fill("#target", "60");
  await p.press("#target", "Tab");
  s = await shown();
  ok(
    s.cont && /keeps the 40 locations found and looks for 20 more/.test(s.note),
    "finished, then a higher number: Continue: " + s.note,
  );
  await p.click("#continueGo");
  await searchEnded(p);
  const more = await p.evaluate(() => results.map(l => l.panoId));
  ok(
    more.length === 60 && done.every((id, i) => more[i] === id),
    `it kept the 40 and found 20 more (${more.length})`,
  );
  ok(
    (await p.evaluate(() => [loadHistory().length, loadHistory()[0].settings.target].join())) === "3,60",
    "the history entry now says 60",
  );

  // A lower number: keeps that many, at random, each country its share; no lookups
  await p.fill("#target", "15");
  await p.press("#target", "Tab");
  s = await shown();
  ok(s.cont && /keeps 15 of the 60 locations, chosen at random/.test(s.note), "a lower number: " + s.note);
  const lookups = await p.evaluate(() => (window.__requests = []).length);
  await p.click("#continueGo");
  const low = await p.evaluate(() => ({
    ids: results.map(l => l.panoId),
    running,
    targets: [...searchTargets]
      .sort()
      .map(([c, n]) => c + n)
      .join(),
    status: document.getElementById("now").textContent,
    asked: window.__requests.length,
    dots: (() => {
      let n = 0;
      layer.eachLayer(() => n++);
      return n;
    })(),
  }));
  ok(
    low.ids.length === 15 && low.ids.every(id => more.includes(id)) && !low.running && low.asked === lookups,
    "15 of them kept, without a new search: " + low.status,
  );
  ok(
    low.targets ===
      (await p.evaluate(() =>
        Object.entries(planTargets())
          .sort()
          .map(([c, n]) => c + n)
          .join(),
      )) && low.targets === (await share()),
    "each country keeps its share: " + low.targets + " (was " + plan + " of 40)",
  );
  ok(low.dots === 15, "the map shows the 15");
  ok(!(await shown()).cont && (await shown()).go === "Find locations", "then nothing more to continue");

  // A changed filter after a finished search: a new search, without asking (nothing was stopped)
  await p.check("#noRoadName");
  await p.click("#go");
  ok(await p.isHidden("#newSearch"), "a finished search: Find locations starts at once");
  await searchEnded(p);
  await p.uncheck("#noRoadName");

  // Unofficial does the same
  const { page: u, errors: uErrors } = await openPage(b, "ok", null, UNOFFICIAL);
  await u.evaluate(() => {
    let n = 0;
    window.__svDelay = 30;
    window.__sv = req => ({
      id: "UNOFFCONT" + n++,
      lat: req.location.lat,
      lng: req.location.lng,
      copyright: "© 2023 Jane Doe",
      links: [],
    });
  });
  await u.check("input[name=scope][value=countries]");
  await chooseCountry(u, "Malta");
  await u.fill("#target", "300");
  await u.fill("#apiKey", "TESTKEY");
  await u.click("#go");
  await u.waitForFunction(() => results.length >= 10);
  await u.click("#stop");
  await searchEnded(u);
  await u.check("#full360");
  await u.click("#go");
  const uDialog = await u.evaluate(() => document.getElementById("newSearchChanged").textContent);
  ok(
    (await u.isVisible("#newSearch")) && uDialog.length > 0,
    "Unofficial: asks first too, naming " + uDialog,
  );
  await u.click("#newSearchCancel");
  await u.uncheck("#full360");
  await u.fill("#target", "20");
  await u.press("#target", "Tab");
  ok(await u.isVisible("#continueGo"), "Unofficial: Continue with a lower number");
  ok(uErrors.length === 0, "Unofficial: no page errors " + uErrors.join(" | "));

  ok(errors.length === 0, "no page errors " + errors.join(" | "));
  await b.close();
  console.log(fail ? `${fail} FAILED` : "ALL PASS");
})();
