// The map file's size and making it smaller: the download button shows the size; over the size limit
// (20 MB by default) the page offers to make the file smaller, keeping each country's share, by an even
// spread (dropping the locations closest to others) or at random; the smaller set replaces the results
// and "Undo" brings the full set back. Made-up results stand in for a long search.
const { chromium } = require("./pw.js");
const { openPage } = require("./helpers.js");
(async () => {
  const b = await chromium.launch();
  let fail = 0;
  const ok = (c, m) => {
    console.log((c ? "PASS " : "FAIL ") + m);
    if (!c) fail++;
  };
  const { page: p, errors } = await openPage(b);

  // 2,000 locations in Malta, spread out; 6,000 in Luxembourg, 4,500 of them packed into a cluster of
  // 2 km around one spot, 1,500 spread over the country
  const fill = () =>
    p.evaluate(() => {
      let n = 0;
      const loc = (cc, lat, lng) => ({
        lat,
        lng,
        heading: 90,
        pitch: 0,
        zoom: 0,
        panoId: "PRUNE" + String(n++).padStart(17, "0"),
        date: "2023-04",
        cc,
        noRoadName: false,
        deadEnd: false,
        intersection: false,
        camera: "gen4",
        cluster: false,
      });
      const list = [];
      for (let i = 0; i < 2000; i++)
        list.push(loc("MT", 35.82 + Math.random() * 0.15, 14.35 + Math.random() * 0.2));
      for (let i = 0; i < 4500; i++)
        list.push({ ...loc("LU", 49.6 + Math.random() * 0.018, 6.1 + Math.random() * 0.027), cluster: true });
      for (let i = 0; i < 1500; i++)
        list.push(loc("LU", 49.5 + Math.random() * 0.6, 5.8 + Math.random() * 0.6));
      replaceResults(list);
      searchTargets = new Map(foundBy);
      currentTarget = list.length;
      paint("Done.");
    });
  const state = () =>
    p.evaluate(() => {
      const lu = results.filter(l => l.cc === "LU");
      return {
        n: results.length,
        mt: results.filter(l => l.cc === "MT").length,
        lu: lu.length,
        cluster: lu.filter(l => l.cluster).length / lu.length,
        spreadOut: lu.filter(l => !l.cluster).length,
        bytes: fileBytes(),
      };
    });
  const waitIdle = () => p.waitForTimeout(500);
  await fill();
  await waitIdle();

  // The size on the download button, exactly as downloaded
  const label = await p.textContent("#download");
  const bytes = await p.evaluate(() => new Blob([exportJson()]).size);
  ok(
    label === `Download map file (${(bytes / 1e6).toFixed(1)} MB)` && bytes > 1e6,
    "the download button shows the file's size: " + label,
  );
  ok(await p.isHidden("#prune"), "under the limit of 20 MB: no offer");

  // A limit of 1 MB: the offer
  ok(
    (await p.isChecked("#sizeLimitOn")) && (await p.inputValue("#sizeLimit")) === "20",
    "the limit is on, 20 MB, by default",
  );
  await p.fill("#sizeLimit", "1");
  await p.press("#sizeLimit", "Tab");
  await waitIdle();
  ok(
    (await p.isVisible("#prune")) &&
      new RegExp(`The map file is ${(bytes / 1e6).toFixed(1)} MB, over your limit of 1 MB\\.`).test(
        await p.textContent("#pruneTitle"),
      ) &&
      /keeping about [\d,]+ of the 8,000 locations\. Each country keeps its share\./.test(
        await p.textContent("#pruneText"),
      ),
    "over the limit, the offer: " +
      (await p.textContent("#pruneTitle")) +
      " " +
      (await p.textContent("#pruneText")),
  );
  ok(
    /under 1 MB/.test(await p.textContent("#moreMapFile .more-sum")) &&
      (await p.isVisible("#moreMapFile .more-changed")),
    "the summary says the limit",
  );

  // Even spread
  await p.click("#pruneGo");
  await p.waitForSelector("#pruned:not([hidden])");
  await waitIdle();
  const spread = await state();
  ok(
    spread.bytes <= 1e6 && spread.bytes > 0.95e6,
    "even spread: the file fits, just under 1 MB: " + spread.bytes,
  );
  ok(
    Math.abs(spread.mt / spread.n - 0.25) < 0.002 && Math.abs(spread.lu / spread.n - 0.75) < 0.002,
    `each country keeps its share: Malta ${spread.mt}, Luxembourg ${spread.lu} of ${spread.n}`,
  );
  ok(
    // (a few of the spread-out ones fall inside the cluster, and go with it)
    spread.spreadOut >= 1490,
    `the cluster is thinned, the rest kept: ${spread.spreadOut} of 1,500 spread-out locations in Luxembourg, ${spread.lu - spread.spreadOut} of 4,500 in the cluster`,
  );
  ok(
    (await p.isHidden("#prune")) &&
      /^Kept [\d,]+ of 8,000 locations, evenly spread; each country kept its share\.$/.test(
        await p.textContent("#prunedText"),
      ) &&
      (await p.textContent("#count")) === spread.n.toLocaleString("en"),
    "the offer goes, it says what was kept, and the results are the smaller set",
  );
  ok(
    (await p.evaluate(() => layer.getLayers().length)) === spread.n &&
      (await p.evaluate(() => [...foundBy.values()].reduce((a, v) => a + v, 0))) === spread.n,
    "the map and the counts show the smaller set",
  );

  // Undo
  await p.click("#pruneUndo");
  await waitIdle();
  ok(
    (await state()).n === 8000 && (await p.isHidden("#pruned")) && (await p.isVisible("#prune")),
    "Undo brings all 8,000 back, and the offer with them",
  );

  // Random: the cluster keeps its part
  await p.check("#pruneRandom");
  await p.click("#pruneGo");
  await p.waitForSelector("#pruned:not([hidden])");
  const random = await state();
  ok(
    random.spreadOut < 1500,
    "random drops spread-out locations too: " + random.spreadOut + " of 1,500 kept",
  );
  ok(
    random.bytes <= 1e6 &&
      Math.abs(random.lu / random.n - 0.75) < 0.002 &&
      Math.abs(random.cluster - 0.75) < 0.06 &&
      /at random/.test(await p.textContent("#prunedText")),
    `random: fits, keeps the shares, and the cluster keeps about its part (${Math.round(random.cluster * 100)}%)`,
  );
  await p.click("#pruneUndo");
  await waitIdle();

  // Download anyway: the file as it is, and no offer for it again
  const [download] = await Promise.all([p.waitForEvent("download"), p.click("#pruneSkip")]);
  ok(
    (await p.isHidden("#prune")) && /\.json$/.test(download.suggestedFilename()),
    "Download anyway downloads it and closes the offer",
  );
  await p.evaluate(() => paint());
  await waitIdle();
  ok(await p.isHidden("#prune"), "the offer stays closed for the same file");

  // No limit
  await p.uncheck("#sizeLimitOn");
  await waitIdle();
  ok(
    (await p.isDisabled("#sizeLimit")) &&
      /no size limit/.test(await p.textContent("#moreMapFile .more-sum")) &&
      (await p.isHidden("#prune")),
    "unticked: no limit, the number greyed out",
  );
  ok(
    (await p.evaluate(() =>
      [
        cleanSettings({}).sizeLimitOn,
        cleanSettings({}).sizeLimit,
        cleanSettings({ sizeLimit: 0 }).sizeLimit,
      ].join(),
    )) === "true,20,20",
    "settings from before get the limit of 20 MB; out of range, too",
  );

  // Clear forgets it all
  await p.check("#sizeLimitOn");
  await waitIdle();
  await p.click("#pruneGo");
  await p.waitForSelector("#pruned:not([hidden])");
  await p.click("#clear");
  await waitIdle();
  ok(
    (await p.isHidden("#pruned")) &&
      (await p.isHidden("#prune")) &&
      (await p.textContent("#download")) === "Download map file",
    "Clear: nothing to undo, no size",
  );

  ok(errors.length === 0, "no page errors " + errors.join(" | "));
  await b.close();
  console.log(fail ? `${fail} FAILED` : "ALL PASS");
})();
