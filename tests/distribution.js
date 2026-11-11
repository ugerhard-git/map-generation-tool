// Distribution, the third tool: a map file in, its countries, territories and continents out, as a table,
// a CSV of the view shown and an Excel file with one tab per view. The page has no map and no Google, so
// nothing outside is simulated: every request that is not the page itself is refused.
const { chromium } = require("./pw.js");
const { DISTRIBUTION, isSite, serveSite, SPLIT } = require("./site.js");
const fs = require("fs");

/* The files of a zip archive stored without compression, as the page writes them: name -> text. Also
   checks each file's CRC-32, so a broken archive fails here. */
function unzip(buf) {
  const files = {};
  const crcTable = Array.from({ length: 256 }, (x, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = b => {
    let c = 0xffffffff;
    for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  let at = buf.readUInt32LE(end + 16);
  const count = buf.readUInt16LE(end + 10);
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(at) !== 0x02014b50) throw new Error("bad central directory");
    const size = buf.readUInt32LE(at + 20),
      nameLength = buf.readUInt16LE(at + 28),
      local = buf.readUInt32LE(at + 42),
      crc = buf.readUInt32LE(at + 16);
    const name = buf.toString("utf8", at + 46, at + 46 + nameLength);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + size);
    if (crc32(data) !== crc) throw new Error("CRC wrong for " + name);
    files[name] = data.toString("utf8");
    at += 46 + nameLength + buf.readUInt16LE(at + 30) + buf.readUInt16LE(at + 32);
  }
  return files;
}

(async () => {
  const b = await chromium.launch();
  let fail = 0;
  const ok = (c, m) => {
    console.log((c ? "PASS " : "FAIL ") + m);
    if (!c) fail++;
  };
  const ctx = await b.newContext({ viewport: { width: 1360, height: 860 }, acceptDownloads: true });
  const p = await ctx.newPage();
  const errors = [],
    outside = [];
  p.on("pageerror", e => errors.push(String(e)));
  p.on("console", m => /Content Security/.test(m.text()) && errors.push(m.text()));
  await p.route("**/*", r => {
    if (isSite(r.request().url())) return serveSite(r);
    outside.push(r.request().url());
    return r.fulfill({ status: 204, body: "" });
  });
  await p.goto(DISTRIBUTION);

  // The page as a first visitor sees it
  ok(
    (await p.isVisible("#empty")) &&
      (await p.isDisabled("#downloadCsv")) &&
      (await p.isDisabled("#downloadXlsx")),
    "before a file: a note to choose one, downloads greyed out",
  );
  const links = await p.$$eval(".other-tool a", as => as.map(a => a.getAttribute("href")).join());
  ok(links === "../,../unofficial/", "links to the Map Generation Tool and Unofficial: " + links);

  // A map with country codes, some missing, territories coded with their country, one at sea, one broken
  const at = (lat, lng, countryCode, n = 1) =>
    Array.from({ length: n }, () => ({ lat, lng, heading: 0, pitch: 0, zoom: 0, panoId: null, countryCode }));
  const locations = [
    ...at(52.52, 13.4, "DE", 3), // Berlin
    ...at(48.85, 2.35, "FR", 2), // Paris
    ...at(18.45, -66.07, "US", 2), // San Juan, coded as the United States: counts as Puerto Rico
    ...at(39.74, -104.99, "us"), // Denver, lower-case code
    ...at(-21.1, 55.5, "FR"), // Réunion, coded as France
    ...at(22.3, 114.17, "HK"), // Hong Kong
    ...at(13.47, 144.75, null), // Guam, no code: from the position
    ...at(30, -40, null), // the middle of the Atlantic: no country
    { lat: "x", lng: 3 }, // no valid position: skipped
  ];
  const upload = (name, content) =>
    p.setInputFiles("#file", { name, mimeType: "application/json", buffer: Buffer.from(content) });
  await upload("test.json", JSON.stringify({ name: "Test: World", customCoordinates: locations }));
  await p.waitForSelector("#result:not([hidden])");
  const table = () =>
    p.$$eval("#tableBody tr", rows => rows.map(r => [...r.cells].map(c => c.textContent).join("|")));
  const info = await p.textContent("#fileInfo");
  ok(
    /“Test: World”: 12 locations in 7 countries and territories\. 1 skipped/.test(info),
    "the file's name, locations, places and skipped ones: " + info,
  );
  let rows = await table();
  ok(
    rows.join("\n") ===
      [
        "Germany|DE|Europe|3|25.00%",
        "France|FR|Europe|2|16.67%",
        "Puerto Rico|PR|North America|2|16.67%",
        "Guam|GU|Oceania|1|8.33%",
        "Hong Kong|HK|Asia|1|8.33%",
        "Réunion|RE|Africa|1|8.33%",
        "United States|US|North America|1|8.33%",
        "No country|||1|8.33%",
      ].join("\n"),
    "each on its own: the file's code first, made exact by the position (PR, RE), the position where there is no code, the one at sea last:\n  " +
      rows.join("\n  "),
  );
  ok(
    /no country for 1: found from their position/.test(await p.textContent("#resultSummary")) &&
      /far out at sea/.test(await p.textContent("#resultSummary")),
    "the summary says where countries came from",
  );

  // Territories counted with their country, except the owner's list
  await p.check("input[name=view][value=folded]");
  rows = await table();
  ok(
    rows.join("\n") ===
      [
        "United States|US|North America|4|33.33%|Puerto Rico (2), Guam (1)",
        "Germany|DE|Europe|3|25.00%|",
        "France|FR|Europe|2|16.67%|",
        "Hong Kong|HK|Asia|1|8.33%|",
        "Réunion|RE|Africa|1|8.33%|",
        "No country|||1|8.33%|",
      ].join("\n"),
    "folded: Puerto Rico and Guam count with the United States; Réunion and Hong Kong stay on their own:\n  " +
      rows.join("\n  "),
  );

  // Continents: where each location lies
  await p.check("input[name=view][value=continents]");
  rows = await table();
  ok(
    rows.join("\n") ===
      [
        "Europe|2|5|41.67%",
        "North America|2|3|25.00%",
        "Africa|1|1|8.33%",
        "Asia|1|1|8.33%",
        "Oceania|1|1|8.33%",
        "No continent||1|8.33%",
      ].join("\n"),
    "continents: Réunion in Africa, Puerto Rico in North America:\n  " + rows.join("\n  "),
  );

  // Sorting by a column, and back
  await p.check("input[name=view][value=countries]");
  await p.click("th >> text=Country or territory");
  rows = await table();
  ok(
    rows.map(r => r.split("|")[0]).join() ===
      "France,Germany,Guam,Hong Kong,Puerto Rico,Réunion,United States,No country",
    "a click on a heading sorts by it, the row without a country stays last: " +
      rows.map(r => r.split("|")[0]),
  );
  ok(
    (await p.getAttribute("th:has-text('Country or territory')", "aria-sort")) === "ascending",
    "the sorted column says so to screen readers",
  );

  // CSV of the view shown, as shown
  const csv = async format => {
    await p.selectOption("#numberFormat", format);
    const [d] = await Promise.all([p.waitForEvent("download"), p.click("#downloadCsv")]);
    return { name: d.suggestedFilename(), text: fs.readFileSync(await d.path(), "utf8") };
  };
  let file = await csv("point");
  ok(file.name === "test-world-distribution-countries.csv", "the CSV is named after the map: " + file.name);
  const lines = file.text.replace(/^\ufeff/, "").split("\r\n");
  ok(
    lines[0] === "Country or territory,Code,Continent,Locations,Share (%)" &&
      lines[1] === "France,FR,Europe,2,16.67" &&
      lines[8] === "No country,,,1,8.33" &&
      lines.length === 10 &&
      file.text.startsWith("\ufeff"),
    "CSV with points: a heading row, the rows in the order shown, plain numbers:\n  " + lines.join("\n  "),
  );
  file = await csv("comma");
  ok(
    file.text.includes(
      "Country or territory;Code;Continent;Locations;Share (%)\r\nFrance;FR;Europe;2;16,67\r\n",
    ),
    "CSV with commas: decimal commas, columns split by semicolons",
  );
  await p.check("input[name=view][value=folded]");
  file = await csv("point");
  ok(
    file.name === "test-world-distribution-folded.csv" &&
      file.text.includes('United States,US,North America,4,33.33,"Puerto Rico (2), Guam (1)"\r\n'),
    "the folded view's CSV lists the territories counted in, quoted",
  );
  ok(
    (await p.evaluate(() => localStorage.getItem("distribution.numberFormat"))) === '"point"',
    "the number format chosen is remembered",
  );

  // The browser's language decides "automatic"
  const auto = await b.newContext({ locale: "de-DE" });
  const ap = await auto.newPage();
  await ap.route("**/*", r => (isSite(r.request().url()) ? serveSite(r) : r.fulfill({ status: 204 })));
  await ap.goto(DISTRIBUTION);
  ok(
    (await ap.evaluate(() => csvNumberFormat("auto"))) === "comma" &&
      /1234,5/.test(await ap.textContent("#numberFormatAuto")),
    "in a German browser, automatic means decimal commas",
  );
  await auto.close();

  // The Excel file: one tab per view and "About"
  const [d] = await Promise.all([p.waitForEvent("download"), p.click("#downloadXlsx")]);
  ok(d.suggestedFilename() === "test-world-distribution.xlsx", "the Excel file: " + d.suggestedFilename());
  let parts = {};
  try {
    parts = unzip(fs.readFileSync(await d.path()));
  } catch (e) {
    ok(false, "the Excel file is a valid zip archive: " + e.message);
  }
  ok(
    [
      "[Content_Types].xml",
      "_rels/.rels",
      "xl/workbook.xml",
      "xl/styles.xml",
      "xl/worksheets/sheet1.xml",
      "xl/worksheets/sheet4.xml",
    ].every(n => parts[n]),
    "the Excel file holds a workbook, its styles and four sheets: " + Object.keys(parts).join(", "),
  );
  const tabs = [...(parts["xl/workbook.xml"] || "").matchAll(/<sheet name="([^"]+)"/g)].map(m => m[1]);
  ok(tabs.join() === "Countries,Territories counted in,Continents,About", "its tabs: " + tabs.join(", "));
  const sheet1 = parts["xl/worksheets/sheet1.xml"] || "";
  ok(
    sheet1.includes('<c r="A2" t="inlineStr"><is><t xml:space="preserve">Germany</t></is></c>') &&
      sheet1.includes('<c r="D2"><v>3</v></c><c r="E2" s="2"><v>0.25</v></c>') &&
      sheet1.includes('state="frozen"'),
    "numbers are numbers and shares exact fractions shown as percentages; the heading row stays in view",
  );
  ok(
    (parts["xl/worksheets/sheet4.xml"] || "").includes("Test: World") &&
      (parts["xl/worksheets/sheet4.xml"] || "").includes("<v>12</v>"),
    "About names the map and the number of locations",
  );

  // Files that are not maps
  // (reading a file takes a moment: each check waits for its message or table first)
  const settled = (test, ...arg) => p.waitForFunction(test, ...arg, { timeout: 5000 }).catch(() => {});
  await upload("bad.json", "{ not json");
  await settled(() => !document.getElementById("fileError").hidden);
  ok(
    /not a JSON file/.test(await p.textContent("#fileError")) &&
      (await p.isHidden("#result")) &&
      (await p.isDisabled("#downloadCsv")),
    "a file that is not JSON: a message, no table",
  );
  await upload("settings.json", JSON.stringify({ format: "map-generation-tool settings", settings: {} }));
  await settled(() => /no list/.test(document.getElementById("fileError").textContent));
  ok(/no list of locations/.test(await p.textContent("#fileError")), "a settings file: a message");
  // map-making.app's own export: a list, with names that must stay text
  await upload(
    "plain.json",
    JSON.stringify([
      { lat: 52.5, lng: 13.4, countryCode: "<b>DE</b>" },
      { lat: 41.9, lng: 12.5, countryCode: "IT" },
    ]),
  );
  await settled(() => !document.getElementById("result").hidden);
  ok(
    (await p.isHidden("#fileError")) &&
      (await table()).join() === "Germany|DE|Europe|1|50.00%|,Italy|IT|Europe|1|50.00%|" &&
      (await p.$("#tableBody b")) === null,
    "map-making.app's plain list is read; a strange country code is ignored, never shown as HTML",
  );

  // A tampered saved view falls back to the default
  await p.evaluate(() => localStorage.setItem("distribution.view", JSON.stringify("<img>")));
  await p.reload();
  ok(
    (await p.evaluate(() => currentView())) === "countries",
    "a tampered saved view falls back to countries and territories",
  );

  // The security policy: no outside host at all
  const html = fs.readFileSync(
    require("path").join(require("./site.js").DIST, "distribution/index.nokey.html"),
    "utf8",
  );
  const csp = /http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(html)[1];
  ok(
    /connect-src 'none'/.test(csp) &&
      !/googleapis|gstatic|openstreetmap/.test(csp) &&
      (SPLIT ? /script-src 'self';/.test(csp) : !/'self'/.test(csp)) &&
      !/googleApiKey/.test(html),
    "the policy allows no outside host, and the page has no Google key setting: " + csp.slice(0, 90) + "…",
  );
  ok(outside.length === 0, "nothing was requested from outside: " + outside.join(", "));
  ok(errors.length === 0, "no page errors " + errors.join(" | "));
  await p.screenshot({ path: require("path").join(__dirname, "../dist/screens/distribution.png") });
  await b.close();
  console.log(fail ? `${fail} FAILED` : "ALL PASS");
  process.exitCode = fail ? 1 : 0;
})();
