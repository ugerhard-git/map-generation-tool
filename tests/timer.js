// The time spent searching: shown first in the counters as a clock, ticking every second even between
// finds, kept after the search ends, saved with an unfinished search and added up when it is continued,
// and cleared with "Clear".
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
  const timeShown = () =>
    p.evaluate(() => {
      const first = document.querySelector("#tally span");
      return first && / spent searching$/.test(first.textContent) ? first.querySelector("b").textContent : "";
    });

  // The clock
  const clocks = await p.evaluate(() => [0, 42e3, 725e3, 4325e3, 90061e3, -5].map(clockTime).join(" "));
  ok(clocks === "0:00 0:42 12:05 1:12:05 25:01:01 0:00", "times read like a clock: " + clocks);

  // While searching: Google answers slowly (12 s), so nothing is found for a while; the time goes on
  await p.evaluate(() => {
    window.__svDelay = 12000;
    window.__sv = req => ({
      id: "TM_" + Math.random().toString(36).slice(2, 10),
      lat: req.location.lat,
      lng: req.location.lng,
      links: [],
    });
  });
  await search(p, { country: "Malta", target: 50 });
  await p.waitForFunction(() => running && stats.tries > 0);
  await p.waitForFunction(() => / spent searching$/.test(document.querySelector("#tally span")?.textContent));
  ok(/^0:0\d$/.test(await timeShown()), "a new search starts at 0:00: " + (await timeShown()));
  await p.evaluate(() => (runStartedAt -= 65000)); // as if it had run for a minute
  await p.waitForTimeout(1500);
  ok(
    /^1:0[5-7]$/.test(await timeShown()),
    "it ticks every second, also between finds: " + (await timeShown()),
  );

  // Stopped: the time stays, and no longer goes on
  await p.evaluate(() => (window.__svDelay = 0));
  await p.click("#stop");
  await searchEnded(p);
  const stoppedAt = await timeShown();
  await p.waitForTimeout(1500);
  ok(
    /^1:\d\d$/.test(stoppedAt) && (await timeShown()) === stoppedAt,
    "after stopping it stays at " + stoppedAt,
  );

  // Saved with the unfinished search, offered with it, and added up when it is continued
  const saved = await p.evaluate(
    async () => (await dbRequest("readonly", s => s.get(DB_KEY))).stats.searchedMs,
  );
  ok(saved >= 65000, "the time is saved with the unfinished search: " + saved + " ms");
  await p.reload();
  await p.waitForFunction(() => map !== null);
  await p.waitForTimeout(300);
  ok(
    /found so far, in 1:\d\d of searching\./.test(await p.textContent("#resumeText")),
    "the offer to continue says how long it searched: " + (await p.textContent("#resumeText")),
  );
  await p.evaluate(() => {
    window.__svDelay = 30;
    window.__sv = req => ({
      id: "TM_" + Math.random().toString(36).slice(2, 10),
      lat: req.location.lat,
      lng: req.location.lng,
      links: [],
    });
  });
  await p.fill("#apiKey", "TESTKEY");
  await p.click("#resumeGo");
  await searchEnded(p);
  const after = await p.evaluate(() => stats.searchedMs);
  ok(after > saved && /^1:\d\d$/.test(await timeShown()), "continuing adds to it: " + (await timeShown()));

  // A tampered saved time is ignored
  ok(
    (
      await p.evaluate(() =>
        cleanSaved({ version: 1, savedAt: 1, targets: [["MT", 5]], stats: { searchedMs: -1 } }),
      )
    ).stats.searchedMs === 0 &&
      (
        await p.evaluate(() =>
          cleanSaved({ version: 1, savedAt: 1, targets: [["MT", 5]], stats: { searchedMs: 1e15 } }),
        )
      ).stats.searchedMs === 0,
    "a saved time out of range is ignored",
  );

  // Clear: gone
  await p.click("#clear");
  ok((await timeShown()) === "" && (await p.evaluate(() => searchedFor())) === 0, "Clear removes it");

  ok(errors.length === 0, "no page errors " + errors.join(" | "));
  await b.close();
  console.log(fail ? `${fail} FAILED` : "ALL PASS");
})();
