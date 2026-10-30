// Continuing a stopped search: after "Stop", "Continue the search" runs it on from where it stopped while
// the settings are those it ran with; "Start a new search" starts afresh. With changed settings, only a
// new search is possible, and a warning says it starts from scratch. Settings that only shape the map
// file (name, tags, size limit) do not count as changes.
const { chromium } = require("./pw.js");
const { openPage, search, searchEnded } = require("./helpers.js");
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

  // A search setting does: warned, no Continue; changing it back brings Continue back
  await p.fill("#radius", "2500");
  await p.press("#radius", "Tab");
  s = await shown();
  ok(
    !s.cont &&
      s.warn &&
      s.go === "Start a new search" &&
      new RegExp(
        `You changed the settings, so a new search starts from scratch: it replaces the ${stopped} locations found\\.`,
      ).test(s.note),
    "changed settings: a warning, and no Continue: " + s.note,
  );
  await p.fill("#radius", "1000");
  await p.press("#radius", "Tab");
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

  // A search that ended on its own: nothing to continue
  await p.evaluate(() => (window.__svDelay = 0));
  await search(p, { country: "Malta", target: 5 });
  await searchEnded(p);
  s = await shown();
  ok(!s.cont && s.go === "Find locations", "a finished search: nothing to continue");

  ok(errors.length === 0, "no page errors " + errors.join(" | "));
  await b.close();
  console.log(fail ? `${fail} FAILED` : "ALL PASS");
})();
