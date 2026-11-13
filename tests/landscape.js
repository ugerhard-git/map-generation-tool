// "Landscape" (src/shared/landscape.js): the landscape map is loaded in tiles of 10°, only those a search
// looks at and only when the setting or its tag is used, with a line and a spinner while they load; a
// search keeps only locations in the landscape chosen, and the tag says which. In both tools.
const fs = require("fs"),
  path = require("path"),
  zlib = require("zlib");
const { chromium } = require("./pw.js");
const { openPage, search, searchEnded } = require("./helpers.js");
const { UNOFFICIAL } = require("./site.js");

/* The landscape at a place in Germany, read straight from src/data (not as the page reads it), to choose
   the test's spots. */
const data = path.join(__dirname, "../src/data");
const manifest = JSON.parse(fs.readFileSync(path.join(data, "landscape.json"), "utf8"));
function landscapeHere(lat, lng) {
  const south = Math.floor(lat / 10) * 10,
    west = Math.floor(lng / 10) * 10;
  const key = `N${south}E${String(west).padStart(3, "0")}`;
  const bytes = zlib.inflateSync(fs.readFileSync(path.join(data, "landscape", key + ".bin")));
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
    if (r === row && col >= c && col < c + Math.floor(v / 8)) return manifest.classes[v % 8];
    c += Math.floor(v / 8);
    if (c === 1200) [c, r] = [0, r + 1];
  }
}
/* Up to 30 spots of one landscape around a place, at least 1.3 km apart (the search keeps locations 1 km
   apart). */
function spotsOf(kind, lat, lng) {
  const spots = [];
  for (let a = -5; a <= 5; a++)
    for (let o = -5; o <= 5; o++) {
      const here = [lat + a * 0.012, lng + o * 0.019];
      if (landscapeHere(...here) === kind && spots.length < 30) spots.push(here);
    }
  return spots;
}
const SPOTS = [
  spotsOf("forest", 48.3, 8.2), // the Black Forest
  spotsOf("farmland", 52.05, 11.4), // the Magdeburger Börde
  spotsOf("built-up", 52.52, 13.405), // Berlin: no landscape
];
/* The test's Street View: a spot of each of the three in turn. */
const useSpots = page =>
  page.evaluate(spots => {
    let n = 0;
    window.__sv = () => {
      const i = n++;
      const list = spots[i % 3];
      const [lat, lng] = list[Math.floor(i / 3) % list.length];
      return { id: "LAND" + i, lat, lng, links: [{ heading: 0, description: "" }] };
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
    if (/\/data\/landscape\//.test(r.url())) fetched.push(r.url().replace(/^.*\/landscape\//, ""));
  });
  await p.waitForTimeout(300);
  ok(fetched.length === 0, "nothing loaded while it is not used");
  ok(
    (await p.isChecked("input[name=landscape][value=any]")) && (await p.isHidden("#landscapeStatus")),
    "Any landscape by default, no line",
  );

  // Choosing one: the line says how the map is loaded, still nothing fetched
  await p.evaluate(() => (document.getElementById("moreLandscape").open = true));
  await p.check("input[name=landscape][value=forest]");
  ok(
    /loaded in pieces during the search/.test(await p.textContent("#landscapeStatus")) &&
      fetched.length === 0,
    "chosen: the line says it loads during the search; nothing fetched yet",
  );
  ok(/In a forest/.test(await p.textContent("#sumLandscape")), "the section's summary says so");

  ok(
    SPOTS.every(l => l.length >= 15),
    "enough test spots: " + SPOTS.map(l => l.length).join(),
  );
  // A search in Germany: spots in the Black Forest, on farmland near Magdeburg, and in Berlin. The tiles
  // are held back, to see the line while they load.
  await useSpots(p);
  let release;
  const held = new Promise(r => (release = r));
  await p.route("**/data/landscape/**", async route => {
    await held;
    await route.fallback();
  });
  const searching = search(p, { country: "Germany", target: 4 });
  await p.waitForFunction(() => document.getElementById("landscapeStatus").classList.contains("loading"));
  const loading = await p.textContent("#landscapeStatus");
  const spinner = await p.evaluate(
    () => getComputedStyle(document.getElementById("landscapeStatus"), "::before").animationName,
  );
  ok(
    /Loading the landscape map for this area/.test(loading) && spinner === "settlement-spin",
    `while a tile loads: "${loading}", with a spinner (${spinner})`,
  );
  release();
  await searching;
  await searchEnded(p);
  await p.unroute("**/data/landscape/**");
  let r = await p.evaluate(() => ({
    kinds: results.map(l => l.landscape).join(),
    left: stats.landscape,
    tally: document.getElementById("tally").textContent,
    name: mapName(),
    status: document.getElementById("landscapeStatus").textContent,
  }));
  ok(r.kinds === "forest,forest,forest,forest", "forest: only those " + r.kinds);
  ok(r.left > 0 && /in another landscape/.test(r.tally), `the others are counted (${r.left})`);
  ok(/in a forest/i.test(r.name), "the map name says so: " + r.name);
  ok(
    fetched.sort().length === 2 && /^N40E000\./.test(fetched[0]) && /^N50E010\./.test(fetched[1]),
    "only the tiles looked at, each once: " + fetched.join(),
  );
  ok(/loaded for 2 areas \(0\.\d MB\)/.test(r.status), "then the line says what is loaded: " + r.status);

  await p.check("input[name=landscape][value=farmland]");
  await useSpots(p);
  await search(p, { country: "Germany", target: 3 });
  await searchEnded(p);
  r = await p.evaluate(() => ({ kinds: results.map(l => l.landscape).join(), left: stats.landscape }));
  ok(r.kinds === "farmland,farmland,farmland" && r.left > 0, "farmland: only those " + r.kinds);
  ok(fetched.length === 2, "the tiles already loaded are not fetched again");

  // Any landscape, with the tag: each tagged with its own, none for Berlin; and the popup
  await p.check("input[name=landscape][value=any]");
  await p.check("#tagLandscape");
  await useSpots(p);
  await search(p, { country: "Germany", target: 6 });
  await searchEnded(p);
  const tagged = await p.evaluate(() =>
    results
      .map(l => `${l.landscape}:${tagsFor(l).filter(t => /Forest|Farmland|Grassland|Bare/.test(t))}`)
      .sort()
      .join(),
  );
  ok(
    tagged === "built-up:,built-up:,farmland:Farmland,farmland:Farmland,forest:Forest,forest:Forest",
    "with the tag: Forest, Farmland, none for a town: " + tagged,
  );
  const popup = await p.evaluate(() => {
    drawLocation(results.find(l => l.landscape === "farmland"));
    let html = "";
    layer.eachLayer(m => (html = m.getPopup()?.getContent() || html));
    return typeof html === "string" ? html : html.textContent;
  });
  ok(/Farmland/.test(popup), "the popup says Farmland");

  // Other places: the desert, the steppe, the sea (no tile, nothing fetched), ice
  const places = await p.evaluate(async () =>
    (
      await Promise.all(
        [
          [23, 12],
          [46.5, 105],
          [0, -150],
          [78, 16],
          [47.4, 10.98],
        ].map(([lat, lng]) => landscapeOf(lat, lng)),
      )
    ).join(),
  );
  ok(
    places === "bare,grassland,,other,bare",
    "the Sahara, Mongolia, the Pacific, Svalbard, the Zugspitze: " + places,
  );

  // Settings: kept, read back, in the history; Reset
  const s = await p.evaluate(() => ({
    clean: [
      cleanSettings({ landscape: "bare" }).landscape,
      cleanSettings({}).landscape,
      cleanSettings({ landscape: "x" }).landscape,
    ].join(),
    history: historyDetails(cleanSettings({ countries: ["DE"], landscape: "grassland" })),
    location: [
      cleanLocation({ lat: 52, lng: 13, heading: 0, panoId: "LANDPANO", cc: "DE", landscape: "forest" })
        ?.landscape,
      cleanLocation({ lat: 52, lng: 13, heading: 0, panoId: "LANDPANO", cc: "DE", landscape: "<b>" })
        ?.landscape,
    ].join(),
  }));
  ok(s.clean === "bare,any,any", "read back and checked: " + s.clean);
  ok(/in grassland or shrubland/i.test(s.history), "in the history: " + s.history);
  ok(s.location === "forest,", "kept with an unfinished search, if it is one: " + s.location);
  await p.check("input[name=landscape][value=bare]");
  await p.click("[data-reset=moreLandscape]");
  ok(await p.isChecked("input[name=landscape][value=any]"), "Reset: Any landscape");

  // A tile that does not match its integrity value: refused, and a search that needs it stops
  const { page: q, errors: qErrors } = await openPage(b);
  await q.route("**/data/landscape/**", route => route.fulfill({ body: Buffer.from("not the map") }));
  await q.evaluate(() => (document.getElementById("moreLandscape").open = true));
  await q.check("input[name=landscape][value=forest]");
  await q.evaluate(
    () =>
      (window.__sv = () => ({
        id: "LANDQ" + Math.random(),
        lat: 48.3,
        lng: 8.2,
        links: [],
      })),
  );
  await search(q, { country: "Germany", target: 3 });
  await searchEnded(q);
  ok(
    /landscape map could not be loaded/.test(await q.textContent("#error")) &&
      /could not be loaded/.test(await q.textContent("#landscapeStatus")) &&
      (await q.evaluate(() => results.length)) === 0,
    "a changed tile is refused; the search stops and says why",
  );

  // Unofficial has it too
  const { page: u, errors: uErrors } = await openPage(b, "ok", null, UNOFFICIAL);
  ok(
    (await u.evaluate(async () => [await landscapeOf(48.3, 8.2), await landscapeOf(23, 12)].join())) ===
      "forest,bare" &&
      (await u.$("#tagLandscape")) !== null &&
      (await u.$("#moreLandscape")) !== null,
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
