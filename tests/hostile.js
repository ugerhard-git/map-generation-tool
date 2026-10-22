// Hostile answers from Google's script: markup in the road names, the copyright, the date, the panorama
// ids and the list of older photos never reaches the page as HTML, malformed ids are refused, and the
// map file stays well-formed. (Google's script runs on the page, so its answers are treated as untrusted
// like everything else from outside.)
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
  const bad = '"><img src=x onerror="window.__x=1">';
  await p.evaluate(bad => {
    let n = 0;
    window.__sv = req => {
      n++;
      // every other answer has a panorama id with markup in it, which must be refused
      const id = n % 2 ? `HOSTILE_${n}` : `HOSTILE_${n}${bad}`;
      return {
        id,
        lat: req.location.lat,
        lng: req.location.lng,
        date: "2023-04" + bad,
        links: [{ heading: 90, description: bad, pano: "NEXT" + bad }],
        height: 6656,
        time: [{ pano: "OLD" + bad, date: "2015-01" }],
      };
    };
  }, bad);
  await p.check("#noBadCamera");
  await search(p, { country: "Malta", target: 3 });
  await searchEnded(p);
  const r = await p.evaluate(() => ({
    ids: results.map(l => l.panoId),
    dates: results.map(l => l.date),
    stats: { ...stats },
  }));
  ok(
    r.ids.length === 3 && r.ids.every(id => /^HOSTILE_\d+$/.test(id)),
    "panorama ids with markup are refused: " + r.ids.join(),
  );
  ok(
    r.dates.every(d => d === ""),
    "a date that is not a date is dropped",
  );
  ok(
    !(await p.evaluate(b => isOfficial("© 2024 Google" + b), bad)),
    "a copyright with markup in it does not count as official coverage",
  );
  ok(r.stats.olderLookups === 0, "older photos with markup in their id are not looked up");

  // Open every popup: no element made from Google's text
  await p.evaluate(() => layer.eachLayer(m => m.openPopup()));
  ok(
    (await p.$$("img[src=x], .leaflet-popup img")).length === 0 && !(await p.evaluate(() => window.__x)),
    "nothing from the answers runs or becomes an element",
  );
  const file = await p.evaluate(() => JSON.parse(exportJson()));
  ok(
    file.customCoordinates.length === 3 && file.customCoordinates.every(c => !/[<>"]/.test(c.panoId)),
    "the map file is well-formed",
  );

  ok(errors.length === 0, "no page errors " + errors.join(" | "));
  await b.close();
  console.log(fail ? `${fail} FAILED` : "ALL PASS");
})();
