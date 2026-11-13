// The search log (src/shared/search-log.js): off by default; ticked, a search notes each spot, Google's
// answer and whether it was kept or why not, and "Download the search log" saves it. Never the key; the
// first and the latest entries of a very long search. In both tools.
const fs = require("fs");
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
  const download = async p => {
    const [d] = await Promise.all([p.waitForEvent("download"), p.click("#downloadLog")]);
    return { name: d.suggestedFilename(), text: fs.readFileSync(await d.path(), "utf8") };
  };

  // Map Generation Tool
  const { page: p, errors } = await openPage(b);
  // every third spot finds nothing; the others a panorama with or without a road name
  await p.evaluate(() => {
    let n = 0;
    window.__sv = req => {
      const i = n++;
      if (req.pano) return null;
      if (i % 3 === 0) return null;
      return {
        id: "LOGPANO" + i,
        lat: req.location.lat,
        lng: req.location.lng,
        links: [{ heading: 0, pano: "NEXTPANO" + i, description: i % 3 === 1 ? "" : "Main St" }],
      };
    };
  });
  ok(!(await p.isChecked("#searchLog")), "off by default");
  await search(p, { country: "Malta", target: 3 });
  await searchEnded(p);
  ok(await p.isHidden("#downloadLog"), "no log, no link");

  await p.evaluate(() => (document.getElementById("moreSearch").open = true));
  await p.check("#searchLog");
  ok(
    /keeping a log/.test(await p.textContent("#sumSearch")) &&
      (await p.evaluate(() => document.getElementById("moreSearch").classList.contains("changed"))),
    "the Search section says so: " + (await p.textContent("#sumSearch")),
  );
  await p.click("[data-help=searchLog]");
  ok(/only needed for debugging/i.test(await p.textContent("#helpBody")), "its help says what it is for");
  await p.keyboard.press("Escape");
  await search(p, { country: "Malta", target: 4, noRoadName: true });
  await searchEnded(p);
  ok(await p.isVisible("#downloadLog"), "after a search with it: Download the search log");
  const { name, text } = await download(p);
  const log = JSON.parse(text);
  const kinds = new Set(log.entries.map(e => e.e));
  ok(/\.log\.json$/.test(name), "a .log.json file: " + name);
  ok(log.tool === "Map Generation Tool" && log.leftOut === 0, "says which tool, nothing left out");
  ok(
    ["run", "spot", "nothing", "pano", "kept", "left", "end"].every(k => kinds.has(k)),
    "spots, answers, kept and left out, start and end: " + [...kinds].join(),
  );
  const left = log.entries.find(e => e.e === "left");
  ok(left && left.why.join() === "notMatching", "why one was left out: " + (left && left.why.join()));
  const panos = log.entries.filter(e => e.e === "pano");
  const named = panos.find(e => e.roads);
  ok(
    panos.every(e => e.cc === "MT") &&
      named &&
      named.roads.join() === "Main St" &&
      panos.some(e => !e.roads && e.arrows === 1),
    "each panorama with its country, and the road name on each arrow when there is one: " +
      JSON.stringify(named && named.roads),
  );
  ok(
    log.entries.filter(e => e.e === "kept").length === 4 && log.entries.at(-1).e === "end",
    "the four locations kept, the end last",
  );
  const run = log.entries.find(e => e.e === "run");
  ok(run.settings.noRoadName === true && run.settings.target === 4, "the settings of the search");
  ok(!text.includes("TESTKEY") && !/apiKey/i.test(text), "never the key");
  ok(log.counters.length >= 1 && log.counters.at(-1).found === 4, "the counters at the end");
  ok(text.split("\n").length > log.entries.length, "one line for each entry");

  // A very long search: the first and the latest entries, and how many were left out
  const cut = await p.evaluate(() => {
    startLog(true);
    for (let i = 0; i < 45000; i++) logEvent("spot", { i });
    const parsed = JSON.parse(logText());
    return {
      n: parsed.entries.length,
      leftOut: parsed.leftOut,
      marker: parsed.entries[20000],
      after: parsed.entries[20001].i,
      last: parsed.entries.at(-1).i,
      mb: logText().length / 1e6,
    };
  });
  ok(
    cut.n === 40001 && cut.leftOut === 5001 && cut.marker.e === "left out" && cut.last === 44999,
    `capped: ${cut.n} entries, ${cut.leftOut} left out, then from ${cut.after}, up to ${cut.last}`,
  );
  ok(cut.mb < 6, `small enough: ${cut.mb.toFixed(1)} MB`);

  // Unticked again: the next search keeps none
  await p.uncheck("#searchLog");
  await search(p, { country: "Malta", target: 2 });
  await searchEnded(p);
  ok(await p.isHidden("#downloadLog"), "unticked: no log for the next search");
  ok((await p.evaluate(() => localStorage.getItem("mapgen.searchLog"))) === "false", "the choice is saved");
  await p.check("#searchLog");
  await p.click("[data-reset=moreSearch]");
  ok(!(await p.isChecked("#searchLog")), "Reset to defaults unticks it");

  // Unofficial
  const { page: u, errors: uErrors } = await openPage(b, "ok", null, UNOFFICIAL);
  await u.evaluate(() => {
    let n = 0;
    window.__sv = req => ({
      id: "UNOFFPANO" + n++,
      lat: req.location.lat,
      lng: req.location.lng,
      copyright: "© 2023 Jane Doe",
      links: [],
    });
  });
  ok(!(await u.isChecked("#searchLog")), "Unofficial: off by default");
  await u.evaluate(() => (document.getElementById("moreSearch").open = true));
  await u.check("#searchLog");
  await u.check("input[name=scope][value=countries]");
  await chooseCountry(u, "Malta");
  await u.fill("#target", "3");
  await u.fill("#apiKey", "TESTKEY");
  await u.click("#go");
  await searchEnded(u);
  const ulog = JSON.parse((await download(u)).text);
  ok(
    ulog.tool === "Unofficial" &&
      ulog.entries.filter(e => e.e === "kept").length === 3 &&
      ulog.entries.some(e => e.e === "pano" && e.by === "© 2023 Jane Doe"),
    "Unofficial keeps a log too, with the uploader",
  );

  ok(errors.length === 0 && uErrors.length === 0, "no page errors " + [...errors, ...uErrors].join(" | "));
  await b.close();
  console.log(fail ? `${fail} FAILED` : "ALL PASS");
})();
