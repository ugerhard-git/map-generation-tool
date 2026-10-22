// Random spots: randomPointIn() only gives spots inside the chosen country (also for countries with
// overseas parts, islands and small territories), and spreads them over the whole country.
const { chromium } = require("./pw.js");
const { openPage } = require("./helpers.js");
(async () => {
  const b = await chromium.launch();
  let fail = 0;
  const ok = (c, m) => {
    console.log((c ? "PASS " : "FAIL ") + m);
    if (!c) fail++;
  };
  const { page, errors } = await openPage(b);
  for (const code of ["MT", "DE", "FR", "US", "NZ", "GB", "GI", "RE", "ID", "CC"]) {
    const r = await page.evaluate(code => {
      const pts = Array.from({ length: 300 }, () => randomPointIn(code));
      return {
        missing: pts.filter(p => !p).length,
        wrong: pts.filter(p => p && countryAt(p.lat, p.lng) !== code).length,
      };
    }, code);
    ok(r.missing === 0 && r.wrong === 0, `${code}: 300 spots, all inside: ${JSON.stringify(r)}`);
  }
  // France: no spots in its overseas territories, which count as their own (Réunion is RE). A few may
  // fall on Clipperton Island, which country-coder counts as France itself.
  const fr = await page.evaluate(() => {
    const pts = Array.from({ length: 1000 }, () => randomPointIn("FR"));
    return pts.filter(p => p.lat > 41 && p.lat < 52 && p.lng > -6 && p.lng < 10).length;
  });
  ok(fr >= 950, `France: ${fr} of 1000 spots in mainland France or Corsica`);
  // Germany: spots spread over north and south, east and west
  const de = await page.evaluate(() => {
    const pts = Array.from({ length: 400 }, () => randomPointIn("DE"));
    const north = pts.filter(p => p.lat > 51).length,
      east = pts.filter(p => p.lng > 10.5).length;
    return { north, east };
  });
  ok(
    de.north > 120 && de.north < 280 && de.east > 120 && de.east < 280,
    "Germany: spots spread over the whole country: " + JSON.stringify(de),
  );
  ok((await page.evaluate(() => randomPointIn("ZZ"))) === null, "an unknown country gives no spot");
  ok(errors.length === 0, "no page errors " + errors.join(" | "));
  await b.close();
  console.log(fail ? `${fail} FAILED` : "ALL PASS");
})();
