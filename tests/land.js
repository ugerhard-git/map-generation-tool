// Random spots only on land: the land map built into the page (src/land.js) knows land from sea,
// small islands included; random spots in a country land on it, also where the country's borders are
// mostly sea; every country offered gets spots; without land the search still works.
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

  // Known places
  const places = await p.evaluate(() =>
    Object.entries({
      Wellington: [-41.29, 174.78, true],
      "the Pacific between New Zealand and Chile": [-40, -120, false],
      Valletta: [35.9, 14.51, true],
      "the sea south of Malta": [35.5, 14.0, false],
      Gibraltar: [36.14, -5.35, true],
      "the Cocos Islands": [-12.19, 96.83, true],
      "Christmas Island": [-10.49, 105.62, true],
      Monaco: [43.74, 7.42, true],
      "the middle of the Atlantic": [30, -40, false],
      "the Sahara": [23, 13, true],
    })
      .filter(([, [lat, lng, land]]) => isLand(lat, lng) !== land)
      .map(([name]) => name),
  );
  ok(places.length === 0, "land and sea are where they should be" + (places.length ? ": " + places : ""));

  // Spots in countries whose borders are mostly sea: before, most landed in the water; now all on land
  const spots = await p.evaluate(() =>
    ["NZ", "MT", "JP", "CL"].map(code => {
      const parts = borderParts(code);
      let before = 0,
        after = 0;
      for (let i = 0; i < 400; i++) {
        const old = pickSpot(code, parts, false),
          now = randomPointIn(code);
        if (isLand(old.lat, old.lng)) before++;
        if (isLand(now.lat, now.lng) && countryAt(now.lat, now.lng) === code) after++;
      }
      return { code, before: before / 400, after: after / 400 };
    }),
  );
  ok(
    spots.every(s => s.before < 0.3 && s.after === 1),
    "spots land on land, not at sea: " +
      spots.map(s => `${s.code} ${Math.round(s.before * 100)}% → ${Math.round(s.after * 100)}%`).join(", "),
  );

  // Every country offered gets spots on land, the smallest islands too, and quickly
  const all = await p.evaluate(() => {
    const t = performance.now();
    const missing = COVERAGE.filter(code => {
      for (let i = 0; i < 20; i++) if (!randomPointIn(code)) return true;
      return false;
    });
    return { missing, seaOnly: [...seaOnly], ms: (performance.now() - t) / (COVERAGE.length * 20) };
  });
  ok(
    all.missing.length === 0 && all.seaOnly.length === 0,
    `every country offered gets spots on land (${all.missing.join() || "all"}; ${all.seaOnly.join() || "none"} without land)`,
  );
  ok(all.ms < 5, `quickly: ${all.ms.toFixed(2)} ms a spot`);

  // A country whose land the map does not show is searched without the land check, as before
  const fallback = await p.evaluate(() => {
    const kept = landCells;
    landCells = { ...kept, cells: new Uint8Array(kept.cells.length) }; // a land map without any land
    const spot = randomPointIn("MT");
    landCells = kept;
    const result = { spot: !!spot, seaOnly: seaOnly.has("MT") };
    seaOnly.delete("MT");
    return result;
  });
  ok(fallback.spot && fallback.seaOnly, "no land on the map: spots are made without the land check");

  // Without a usable land map, nothing is held back
  ok(
    await p.evaluate(() => {
      const kept = landCells;
      landCells = null;
      const r = isLand(-40, -120) && !!randomPointIn("NZ");
      landCells = kept;
      return r;
    }),
    "without a land map, every spot counts as land",
  );

  ok(errors.length === 0, "no page errors " + errors.join(" | "));
  await b.close();
  console.log(fail ? `${fail} FAILED` : "ALL PASS");
})();
