// "Town or countryside" (src/shared/settlements.js): the map of towns and villages is loaded only when
// the setting or its tag is used, with a line and a spinner while it loads; then a search keeps only
// locations in a town or village, or only those in the countryside; the tag says which. In both tools.
const { chromium } = require("./pw.js");
const { openPage, search, searchEnded } = require("./helpers.js");
const { UNOFFICIAL } = require("./site.js");
(async () => {
  const b = await chromium.launch();
  let fail = 0;
  const ok = (c, m) => {
    console.log((c ? "PASS " : "FAIL ") + m);
    if (!c) fail++;
  };
  const { page: p, errors } = await openPage(b);
  const fetched = [];
  p.on("request", r => {
    if (/\/data\/settlements\./.test(r.url())) fetched.push(r.url());
  });
  await p.waitForTimeout(300);
  ok(fetched.length === 0, "not loaded while it is not used");
  ok((await p.isChecked("input[name=settlement][value=any]")) === true, "Anywhere by default");

  // Choosing it: the line says it is loading, with a spinner, then that it is loaded
  let release;
  const held = new Promise(r => (release = r));
  await p.route("**/data/settlements.*", async route => {
    await held;
    await route.fallback();
  });
  await p.evaluate(() => (document.getElementById("moreSettlement").open = true));
  await p.check("input[name=settlement][value=town]");
  await p.waitForFunction(() => document.getElementById("settlementStatus").classList.contains("loading"));
  const loading = await p.textContent("#settlementStatus");
  const spinner = await p.evaluate(
    () => getComputedStyle(document.getElementById("settlementStatus"), "::before").animationName,
  );
  ok(
    /Loading the map of towns and villages \(2\.0 MB\)/.test(loading) && spinner === "settlement-spin",
    `while loading: "${loading}", with a spinner (${spinner})`,
  );
  release();
  await p.waitForFunction(() => settlementMap !== null, null, { timeout: 30000 });
  ok(
    (await p.textContent("#settlementStatus")) === "The map of towns and villages is loaded." &&
      fetched.length === 1,
    "then: loaded, once",
  );
  await p.unroute("**/data/settlements.*");

  // Where towns are, as the map says
  const places = await p.evaluate(() =>
    [
      [52.52, 13.405], // Berlin
      [48.137, 11.575], // Munich
      [35.68, 139.76], // Tokyo
      [-23.55, -46.63], // São Paulo
      [23.0, 12.0], // the Sahara
      [-25.0, 133.0], // central Australia
      [0, -150], // the Pacific
      [89.9, 0], // near the North Pole, outside the grid
    ]
      .map(([lat, lng]) => (townAt(lat, lng) ? 1 : 0))
      .join(""),
  );
  ok(places === "11110000", "cities are towns; deserts, the sea and the poles are not: " + places);

  // A search in Germany: spots in Berlin and in the countryside around it
  await p.evaluate(() => {
    let n = 0;
    const spots = [
      [52.52, 13.405], // Berlin
      [52.3, 12.6], // fields near Brandenburg an der Havel
      [52.5, 13.35], // Berlin, Tiergarten side
      [52.95, 13.9], // Schorfheide forest
    ];
    window.__sv = () => {
      const i = n++;
      const [lat, lng] = spots[i % spots.length];
      return { id: "SETTLE" + i, lat: lat + (i >> 2) * 0.002, lng, links: [{ heading: 0, description: "" }] };
    };
  });
  await search(p, { country: "Germany", target: 6 });
  await searchEnded(p);
  let r = await p.evaluate(() => ({
    towns: results.map(l => l.town).join(),
    left: stats.settlement,
    tally: document.getElementById("tally").textContent,
    name: mapName(),
  }));
  ok(r.towns === "true,true,true,true,true,true", "in a town or village: only those " + r.towns);
  ok(r.left > 0 && /in the countryside/.test(r.tally), `those in the countryside are counted (${r.left})`);
  ok(/in a town or village/i.test(r.name), "the map name says so: " + r.name);

  await p.check("input[name=settlement][value=country]");
  await search(p, { country: "Germany", target: 6 });
  await searchEnded(p);
  r = await p.evaluate(() => ({ towns: results.map(l => l.town).join(), left: stats.settlement }));
  ok(
    r.towns === "false,false,false,false,false,false" && r.left > 0,
    "in the countryside: only those " + r.towns,
  );

  // The tag, and the popup
  await p.check("#tagSettlement");
  const tags = await p.evaluate(() =>
    results.map(l => tagsFor(l).filter(t => /Town|Countryside/.test(t))).join(),
  );
  ok(/^(Countryside,){5}Countryside$/.test(tags), "the tag says Countryside: " + tags);
  ok(
    (await p.evaluate(() => locationFacts(results[0]).length >= 0 && results[0].town === false)) &&
      /In the countryside/.test(
        await p.evaluate(() => {
          drawLocation(results[0]);
          let html = "";
          layer.eachLayer(m => (html = m.getPopup()?.getContent() || html));
          return typeof html === "string" ? html : html.textContent;
        }),
      ),
    "the popup says In the countryside",
  );

  // Settings: kept, read back, in the history; Reset
  const s = await p.evaluate(() => ({
    clean: [
      cleanSettings({ settlement: "town" }).settlement,
      cleanSettings({}).settlement,
      cleanSettings({ settlement: "x" }).settlement,
    ].join(),
    history: historyDetails(cleanSettings({ countries: ["DE"], settlement: "country" })),
    location: cleanLocation({ lat: 52, lng: 13, heading: 0, panoId: "SETTLEPANO", cc: "DE", town: true })
      ?.town,
  }));
  ok(s.clean === "town,any,any", "read back and checked: " + s.clean);
  ok(/in the countryside/i.test(s.history), "in the history: " + s.history);
  ok(s.location === true, "kept with an unfinished search");
  ok(/In the countryside/.test(await p.textContent("#sumSettlement")), "the section's summary says so");
  await p.click("[data-reset=moreSettlement]");
  ok(await p.isChecked("input[name=settlement][value=any]"), "Reset: Anywhere");

  // A file that does not match its integrity value: refused, and a search that needs it stops
  const { page: q, errors: qErrors } = await openPage(b);
  await q.route("**/data/settlements.*", route => route.fulfill({ body: Buffer.from("not the map") }));
  await q.evaluate(() => (document.getElementById("moreSettlement").open = true));
  await q.check("input[name=settlement][value=town]");
  await q.waitForFunction(() => document.getElementById("settlementStatus").classList.contains("error"));
  ok(
    /could not be loaded/.test(await q.textContent("#settlementStatus")),
    "a changed file is refused: " + (await q.textContent("#settlementStatus")),
  );
  await q.evaluate(
    () =>
      (window.__sv = req => ({
        id: "SETTLEQ" + Math.random(),
        lat: req.location.lat,
        lng: req.location.lng,
        links: [],
      })),
  );
  await search(q, { country: "Malta", target: 3 });
  await searchEnded(q);
  ok(
    /map of towns and villages could not be loaded/.test(await q.textContent("#error")) &&
      (await q.evaluate(() => results.length)) === 0,
    "a search that needs it stops and says why",
  );

  // Unofficial has it too
  const { page: u, errors: uErrors } = await openPage(b, "ok", null, UNOFFICIAL);
  await u.evaluate(() => (document.getElementById("moreSettlement").open = true));
  await u.check("input[name=settlement][value=country]");
  await u.waitForFunction(() => settlementMap !== null, null, { timeout: 30000 });
  ok(
    (await u.evaluate(() => [townAt(52.52, 13.405), townAt(23, 12)].join())) === "true,false" &&
      (await u.$("#tagSettlement")) !== null,
    "Unofficial: loaded, the same answers, and the tag",
  );

  ok(
    errors.length === 0 &&
      uErrors.length === 0 &&
      qErrors.filter(e => !/integrity|digest|resource/i.test(e)).length === 0,
    "no page errors " + [...errors, ...uErrors, ...qErrors].join(" | "),
  );
  await b.close();
  console.log(fail ? `${fail} FAILED` : "ALL PASS");
})();
