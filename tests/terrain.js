// "Terrain" (src/shared/terrain.js, loaded through tile-maps.js): the terrain map is loaded in tiles of
// 10°, only those a search looks at and only when the setting or its tag is used, with a line and a spinner
// while they load; flat under 50 m of relief, hilly to 300 m, mountainous above; a search keeps only
// locations of the terrain chosen, and the tag says which. In both tools.
const fs = require("fs"),
  path = require("path"),
  zlib = require("zlib");
const { chromium } = require("./pw.js");
const { openPage, search, searchEnded } = require("./helpers.js");
const { UNOFFICIAL } = require("./site.js");

/* The terrain at a place in Germany, read straight from src/data (not as the page reads it), to choose the
   test's spots. */
const data = path.join(__dirname, "../src/data");
const manifest = JSON.parse(fs.readFileSync(path.join(data, "terrain.json"), "utf8"));
function terrainHere(lat, lng) {
  const south = Math.floor(lat / 10) * 10,
    west = Math.floor(lng / 10) * 10;
  const key = `N${south}E${String(west).padStart(3, "0")}`;
  const bytes = zlib.inflateSync(fs.readFileSync(path.join(data, "terrain", key + ".bin")));
  const row = Math.floor((south + 10 - lat) * 120),
    col = Math.floor((lng - west) * 120);
  let i = 0,
    r = 0,
    c = 0;
  for (;;) {
    let v = 0,
      shift = 1,
      x;
    do {
      x = bytes[i++];
      v += (x & 127) * shift;
      shift *= 128;
    } while (x & 128);
    if (r === row && col >= c && col < c + Math.floor(v / 8)) {
      const from = manifest.bands[(v % 8) - 1].from;
      return from < 50 ? "flat" : from < 300 ? "hilly" : "mountainous";
    }
    c += Math.floor(v / 8);
    if (c === 1200) [c, r] = [0, r + 1];
  }
}
/* Up to 30 spots of one terrain around a place, at least 1.3 km apart (the search keeps locations 1 km
   apart). */
function spotsOf(kind, lat, lng) {
  const spots = [];
  for (let a = -5; a <= 5; a++)
    for (let o = -5; o <= 5; o++) {
      const here = [lat + a * 0.012, lng + o * 0.019];
      if (terrainHere(...here) === kind && spots.length < 30) spots.push(here);
    }
  return spots;
}
const SPOTS = [
  spotsOf("flat", 52.05, 11.4), // the Magdeburger Börde
  spotsOf("hilly", 51.3, 9.5), // the hills around Kassel
  spotsOf("mountainous", 47.66, 11.6), // the Alps near the Tegernsee (in Germany, not Austria)
];
/* The test's Street View: a spot of each of the three in turn. */
const useSpots = page =>
  page.evaluate(spots => {
    let n = 0;
    window.__sv = () => {
      const i = n++;
      const list = spots[i % 3];
      const [lat, lng] = list[Math.floor(i / 3) % list.length];
      return { id: "TERR" + i, lat, lng, links: [{ heading: 0, description: "" }] };
    };
  }, SPOTS);
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
    if (/\/data\/terrain\//.test(r.url())) fetched.push(r.url().replace(/^.*\/terrain\//, ""));
  });
  await p.waitForTimeout(300);
  ok(fetched.length === 0, "nothing loaded while it is not used");
  ok(
    (await p.isChecked("input[name=terrain][value=any]")) && (await p.isHidden("#terrainStatus")),
    "Any terrain by default, no line",
  );

  // Choosing one: the line says how the map is loaded, still nothing fetched
  await p.evaluate(() => (document.getElementById("moreTerrain").open = true));
  await p.check("input[name=terrain][value=mountainous]");
  ok(
    /terrain map is loaded in pieces during the search/.test(await p.textContent("#terrainStatus")) &&
      fetched.length === 0,
    "chosen: the line says it loads during the search; nothing fetched yet",
  );
  ok((await p.textContent("#sumTerrain")) === "Mountainous", "the section's summary says so");
  ok(
    SPOTS.every(l => l.length >= 15),
    "enough test spots: " + SPOTS.map(l => l.length).join(),
  );

  // A search in Germany: flat, hilly and mountainous spots in turn. The tiles are held back, to see the
  // line while they load.
  await useSpots(p);
  let release;
  const held = new Promise(r => (release = r));
  await p.route("**/data/terrain/**", async route => {
    await held;
    await route.fallback();
  });
  const searching = search(p, { country: "Germany", target: 4 });
  await p.waitForFunction(() => document.getElementById("terrainStatus").classList.contains("loading"));
  const loading = await p.textContent("#terrainStatus");
  const spinner = await p.evaluate(
    () => getComputedStyle(document.getElementById("terrainStatus"), "::before").animationName,
  );
  ok(
    /Loading the terrain map for this area/.test(loading) && spinner === "settlement-spin",
    `while a tile loads: "${loading}", with a spinner (${spinner})`,
  );
  release();
  await searching;
  await searchEnded(p);
  await p.unroute("**/data/terrain/**");
  let r = await p.evaluate(() => ({
    kinds: results.map(l => l.terrain).join(),
    left: stats.terrain,
    tally: document.getElementById("tally").textContent,
    name: mapName(),
    status: document.getElementById("terrainStatus").textContent,
  }));
  ok(r.kinds === "mountainous,mountainous,mountainous,mountainous", "mountainous: only those " + r.kinds);
  ok(r.left > 0 && /in another terrain/.test(r.tally), `the others are counted (${r.left})`);
  ok(/mountainous/i.test(r.name), "the map name says so: " + r.name);
  ok(
    fetched.sort().length === 3 &&
      /^N40E010\./.test(fetched[0]) &&
      /^N50E000\./.test(fetched[1]) &&
      /^N50E010\./.test(fetched[2]),
    "only the tiles looked at, each once: " + fetched.join(),
  );
  ok(/loaded for 3 areas \(0\.\d MB\)/.test(r.status), "then the line says what is loaded: " + r.status);

  for (const kind of ["flat", "hilly"]) {
    await p.check(`input[name=terrain][value=${kind}]`);
    await useSpots(p);
    await search(p, { country: "Germany", target: 3 });
    await searchEnded(p);
    r = await p.evaluate(() => ({ kinds: results.map(l => l.terrain).join(), left: stats.terrain }));
    ok(r.kinds === [kind, kind, kind].join() && r.left > 0, `${kind}: only those ` + r.kinds);
  }
  ok(fetched.length === 3, "the tiles already loaded are not fetched again");

  // Any terrain, with the tag: each tagged with its own; and the popup
  await p.check("input[name=terrain][value=any]");
  await p.check("#tagTerrain");
  await useSpots(p);
  await search(p, { country: "Germany", target: 6 });
  await searchEnded(p);
  const tagged = await p.evaluate(() =>
    results
      .map(l => `${l.terrain}:${tagsFor(l).filter(t => /^(Flat|Hilly|Mountainous)$/.test(t))}`)
      .sort()
      .join(),
  );
  ok(
    tagged === "flat:Flat,flat:Flat,hilly:Hilly,hilly:Hilly,mountainous:Mountainous,mountainous:Mountainous",
    "with the tag: " + tagged,
  );
  const popup = await p.evaluate(() => {
    drawLocation(results.find(l => l.terrain === "hilly"));
    let html = "";
    layer.eachLayer(m => (html = m.getPopup()?.getContent() || html));
    return typeof html === "string" ? html : html.textContent;
  });
  ok(/Hilly/.test(popup), "the popup says Hilly");

  // Other places: the Dutch polder, the Himalaya, the Kazakh steppe, the Pacific (no tile)
  const places = await p.evaluate(async () =>
    (
      await Promise.all(
        [
          [52.3, 5.0],
          [27.8, 86.71],
          [50.5, 70.0],
          [0, -150],
        ].map(([lat, lng]) => terrainOf(lat, lng)),
      )
    ).join(),
  );
  ok(places === "flat,mountainous,flat,", "the polder, the Himalaya, the steppe, the Pacific: " + places);

  // Settings: kept, read back, in the history; Reset
  const s = await p.evaluate(() => ({
    clean: [
      cleanSettings({ terrain: "hilly" }).terrain,
      cleanSettings({}).terrain,
      cleanSettings({ terrain: "x" }).terrain,
    ].join(),
    history: historyDetails(cleanSettings({ countries: ["DE"], terrain: "flat" })),
    location: [
      cleanLocation({ lat: 52, lng: 13, heading: 0, panoId: "TERRPANO", cc: "DE", terrain: "hilly" })
        ?.terrain,
      cleanLocation({ lat: 52, lng: 13, heading: 0, panoId: "TERRPANO", cc: "DE", terrain: "<b>" })?.terrain,
    ].join(),
  }));
  ok(s.clean === "hilly,any,any", "read back and checked: " + s.clean);
  ok(/flat/i.test(s.history), "in the history: " + s.history);
  ok(s.location === "hilly,", "kept with an unfinished search, if it is one: " + s.location);
  await p.check("input[name=terrain][value=flat]");
  await p.click("[data-reset=moreTerrain]");
  ok(await p.isChecked("input[name=terrain][value=any]"), "Reset: Any terrain");

  // A tile that does not match its integrity value: refused, and a search that needs it stops
  const { page: q, errors: qErrors } = await openPage(b);
  await q.route("**/data/terrain/**", route => route.fulfill({ body: Buffer.from("not the map") }));
  await q.evaluate(() => (document.getElementById("moreTerrain").open = true));
  await q.check("input[name=terrain][value=hilly]");
  await q.evaluate(
    () => (window.__sv = () => ({ id: "TERRQ" + Math.random(), lat: 51.3, lng: 9.5, links: [] })),
  );
  await search(q, { country: "Germany", target: 3 });
  await searchEnded(q);
  ok(
    /terrain map could not be loaded/.test(await q.textContent("#error")) &&
      /could not be loaded/.test(await q.textContent("#terrainStatus")) &&
      (await q.evaluate(() => results.length)) === 0,
    "a changed tile is refused; the search stops and says why",
  );

  // Unofficial has it too
  const { page: u, errors: uErrors } = await openPage(b, "ok", null, UNOFFICIAL);
  ok(
    (await u.evaluate(async () => [await terrainOf(47.45, 11.0), await terrainOf(52.3, 5.0)].join())) ===
      "mountainous,flat" &&
      (await u.$("#tagTerrain")) !== null &&
      (await u.$("#moreTerrain")) !== null,
    "Unofficial: the section, the same answers, and the tag",
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
