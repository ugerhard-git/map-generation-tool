// Intersections: "Arrows: any, end of coverage, intersection" is one choice; an intersection has three
// or more arrows, the camera faces along one of them, and a tag can name it. The older tick box "End of
// coverage" (saved as deadEnd) moves over to the choice: in the browser, the history and settings files.
const { chromium } = require("./pw.js");
const { openPage, search, searchEnded } = require("./helpers.js");
(async () => {
  const b = await chromium.launch();
  let fail = 0;
  const ok = (c, m) => {
    console.log((c ? "PASS " : "FAIL ") + m);
    if (!c) fail++;
  };
  // A browser that saved "End of coverage" the old way
  const ctx = await b.newContext({ viewport: { width: 1360, height: 860 } });
  await ctx.addInitScript(() => {
    if (!sessionStorage.getItem("seeded")) {
      localStorage.setItem("mapgen.deadEnd", "true");
      sessionStorage.setItem("seeded", "1");
    }
  });
  const { page: p, errors } = await openPage(b, "ok", ctx);
  ok(
    (await p.isChecked("#arrowsEnd")) &&
      (
        await p.evaluate(() => [
          localStorage.getItem("mapgen.arrows"),
          localStorage.getItem("mapgen.deadEnd"),
        ])
      ).join() === '"end",',
    'the older saved "End of coverage" moves over to the arrows choice',
  );

  // One choice: picking one unpicks the others
  await p.check("#arrowsIntersection");
  ok(
    !(await p.isChecked("#arrowsEnd")) && !(await p.isChecked("#arrowsAny")),
    "end of coverage and intersection cannot both be chosen",
  );

  // Google answers with 1, 2, 3 and 4 arrows in turn
  await p.evaluate(() => {
    let n = 0;
    const headings = [[40], [40, 220], [10, 100, 250], [0, 90, 180, 270]];
    window.__sv = req => {
      const h = headings[n % 4];
      return {
        id: `A${h.length}_${n++}`,
        lat: req.location.lat,
        lng: req.location.lng,
        links: h.map(heading => ({ heading, description: "" })),
      };
    };
  });
  await p.check("#tagIntersection");
  await search(p, { country: "Malta", arrows: "intersection", target: 6 });
  await searchEnded(p);
  const r = await p.evaluate(() => ({
    kinds: [...new Set(results.map(l => l.panoId.split("_")[0]))].sort().join(),
    along: results.every(l =>
      (l.panoId.startsWith("A3") ? [10, 100, 250] : [0, 90, 180, 270]).includes(Math.round(l.heading)),
    ),
    tags: [...new Set(JSON.parse(exportJson()).customCoordinates.map(c => c.extra.tags.join()))].join(" | "),
    name: document.getElementById("mapName").placeholder,
  }));
  ok(r.kinds === "A3,A4", "only spots with three or more arrows: " + r.kinds);
  ok(r.along, "the camera faces along one of the arrows");
  ok(r.tags === "Malta,Intersection", "tagged Intersection: " + r.tags);
  ok(r.name === "Malta: Intersection", "the map name says so: " + r.name);
  await p.evaluate(() => layer.eachLayer(m => m.openPopup()));
  ok(/Intersection/.test(await p.textContent(".leaflet-popup")), "and the dot's popup");

  // End of coverage and any still work
  await search(p, { country: "Malta", arrows: "end", target: 3 });
  await searchEnded(p);
  ok(
    (await p.evaluate(() => results.every(l => l.panoId.startsWith("A1_")))) === true,
    "end of coverage: one arrow",
  );
  await search(p, { country: "Malta", arrows: "any", target: 8 });
  await searchEnded(p);
  ok(
    (await p.evaluate(() => [...new Set(results.map(l => l.panoId.split("_")[0]))].length)) === 4,
    "any: every number of arrows",
  );

  // History entries and settings files from before: deadEnd moves over, and is not an unknown setting
  ok(
    (await p.evaluate(() =>
      [
        cleanSettings({ deadEnd: true }).arrows,
        cleanSettings({}).arrows,
        cleanSettings({ arrows: "<b>" }).arrows,
      ].join(),
    )) === "end,any,any",
    "older settings with deadEnd read as end of coverage; nonsense as any",
  );
  const older = await p.evaluate(() =>
    readSettingsFile(
      JSON.stringify({ format: "map-generation-tool settings", version: 1, settings: { deadEnd: true } }),
    ),
  );
  ok(
    older.settings.arrows === "end" && older.notes.length === 0,
    "an older settings file loads without a note",
  );
  ok(
    /Intersection/.test(await p.evaluate(() => historyDetails(cleanSettings({ arrows: "intersection" })))),
    "the history describes it",
  );

  ok(errors.length === 0, "no page errors " + errors.join(" | "));
  await b.close();
  console.log(fail ? `${fail} FAILED` : "ALL PASS");
})();
