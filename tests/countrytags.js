// Country tags: with the country tag on, each location is tagged with the tag from the owner's list
// (src/data/country-tags.json, built into the page), such as "USA" and "UAE"; a country or territory not
// on the list keeps its English name. The tags are the same in every browser.
const fs = require("fs"),
  path = require("path");
const { chromium } = require("./pw.js");
const { openPage, search, searchEnded } = require("./helpers.js");
(async () => {
  const b = await chromium.launch();
  let fail = 0;
  const ok = (c, m) => {
    console.log((c ? "PASS " : "FAIL ") + m);
    if (!c) fail++;
  };
  const list = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../src/data/country-tags.json"), "utf8"),
  ).tags;
  const { page: p, errors } = await openPage(b);

  // The list is in the page
  const inPage = await p.evaluate(() => COUNTRY_TAGS);
  ok(
    Object.keys(inPage).length === Object.keys(list).length &&
      Object.entries(list).every(([code, e]) => inPage[code] === e.tag),
    `all ${Object.keys(list).length} tags of the list are built into the page`,
  );

  // The tag of each kind of country
  const tags = await p.evaluate(() =>
    Object.fromEntries(
      ["US", "AE", "TR", "HK", "PS", "BA", "ST", "DE", "GI", "MO"].map(cc => [
        cc,
        tagsFor({ cc, date: "", noRoadName: false, deadEnd: false, intersection: false, camera: "" }).join(),
      ]),
    ),
  );
  ok(tags.US === "USA" && tags.AE === "UAE", "the United States is tagged USA, the United Arab Emirates UAE");
  ok(
    tags.TR === "Turkey" &&
      tags.HK === "Hong Kong" &&
      tags.PS === "Palestine" &&
      tags.BA === "Bosnia and Herzegovina" &&
      tags.ST === "Sao Tome and Principe" &&
      tags.DE === "Germany",
    "the others as the list writes them: " + JSON.stringify(tags),
  );
  ok(tags.GI === "Gibraltar" && tags.MO.length > 0, "a territory not on the list keeps its English name");

  // Every country with coverage has a tag; the list covers all of them except territories
  const missing = await p.evaluate(() => COVERAGE.filter(c => !Object.hasOwn(COUNTRY_TAGS, c)).join(" "));
  ok(
    missing === "AS AX BM CC CW CX FO GI GL GU IM JE MO MP PR RE VI",
    "only territories are not on the list: " + missing,
  );

  // In the map file
  await p.evaluate(() => {
    window.__sv = req => ({
      id: "TAG_" + Math.random().toString(36).slice(2, 10),
      lat: req.location.lat,
      lng: req.location.lng,
      links: [{ heading: 90, description: "" }],
    });
  });
  await search(p, { country: "United States", target: 3 });
  await searchEnded(p);
  const file = await p.evaluate(() =>
    JSON.parse(exportJson()).customCoordinates.map(c => c.extra?.tags?.join()),
  );
  ok(file.length === 3 && file.every(t => t === "USA"), "the map file has the tag USA: " + file.join(" | "));
  await p.uncheck("#tagCountry");
  ok(
    (await p.evaluate(() => JSON.parse(exportJson()).customCoordinates.every(c => !c.extra))) === true,
    "with the country tag off, there is none",
  );

  ok(errors.length === 0, "no page errors " + errors.join(" | "));
  await b.close();
  console.log(fail ? `${fail} FAILED` : "ALL PASS");
})();
