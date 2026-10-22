// Picking locations by hand: a click on the map asks Google (simulated) for the nearest panorama, the
// location is drawn and counted, repeats are refused, failures are explained without the key, and the
// export is a valid map-making.app file.
const { chromium } = require("./pw.js");
const { PAGE, isSite, serveSite } = require("./site.js");
const path = require("path");
const H = { "access-control-allow-origin": "*" };
(async () => {
  const b = await chromium.launch();
  let fail = 0;
  const ok = (c, m) => {
    console.log((c ? "PASS " : "FAIL ") + m);
    if (!c) fail++;
  };
  const p = await b.newPage({ viewport: { width: 1360, height: 860 } });
  const errs = [],
    reqs = [];
  p.on("pageerror", e => errs.push(String(e)));
  // Google's answer for the next lookup; each test step sets it.
  let answer = null;
  await p.route("**/*", r => {
    const u = r.request().url();
    if (isSite(u)) return serveSite(r);
    if (u.includes("streetview/metadata")) {
      reqs.push(u);
      return answer === "abort" ? r.abort() : r.fulfill({ headers: H, json: answer });
    }
    return r.fulfill({ status: 204, body: "" }); // map tiles
  });
  await p.goto(PAGE);
  await p.waitForFunction(() => map !== null);

  ok(await p.isVisible("#keyBox"), "without a site key, the key field is shown");
  ok(await p.isDisabled("#download"), "nothing to download before the first location");

  // no key yet: asked for one, nothing sent to Google
  await p.evaluate(() => addAt(48.137, 11.575));
  ok(/API key/.test(await p.textContent("#error")) && reqs.length === 0, "asks for a key before looking up");

  await p.fill("#apiKey", "TESTKEY");
  await p.fill("#radius", "80");
  await p.fill("#mapName", "Munich test");
  answer = {
    status: "OK",
    pano_id: "PANO_A",
    location: { lat: 48.1371, lng: 11.5753 },
    date: "2023-05",
    copyright: "© Google",
  };
  await p.evaluate(() => addAt(48.137, 11.575));
  ok(/radius=80/.test(reqs[0]) && /location=48\.137,11\.575/.test(reqs[0]), "asks Google with the radius");
  ok(
    (await p.textContent("#count")) === "1" && (await p.isEnabled("#download")),
    "location added and counted",
  );
  ok((await p.evaluate(() => layer.getLayers().length)) === 1, "location drawn on the map");

  // the same panorama again is refused
  await p.evaluate(() => addAt(48.1372, 11.5751));
  ok(
    (await p.textContent("#count")) === "1" && /already/.test(await p.textContent("#now")),
    "the same panorama is not added twice",
  );

  // failures are explained in plain words, never with the key
  for (const [a, re, what] of [
    [{ status: "ZERO_RESULTS" }, /No Street View near this spot/, "nothing nearby"],
    [
      { status: "REQUEST_DENIED", error_message: "key TESTKEY invalid" },
      /refused the API key/,
      "key refused",
    ],
    ["abort", /did not reach Google/, "no connection"],
    [{ status: "OK", pano_id: "x<y", location: { lat: 1, lng: 2 } }, /could not be used/, "malformed answer"],
  ]) {
    answer = a;
    await p.evaluate(() => addAt(10, 10));
    const t = await p.textContent("#now");
    ok(re.test(t) && !/TESTKEY/.test(t), `${what}: "${t}"`);
  }
  ok((await p.textContent("#count")) === "1", "failed lookups add nothing");

  // export
  const json = JSON.parse(await p.evaluate(() => exportJson()));
  const c = json.customCoordinates[0];
  console.log("  ", JSON.stringify(json));
  ok(
    json.name === "Munich test" && json.customCoordinates.length === 1,
    "export has the name and the location",
  );
  ok(
    c.panoId === "PANO_A" &&
      c.lat === 48.1371 &&
      c.countryCode === "DE" &&
      c.extra.tags[0] === "DE" &&
      c.heading >= 0 &&
      c.heading < 360,
    "export entry has panorama, position, country and a heading",
  );
  const [dl] = await Promise.all([p.waitForEvent("download"), p.click("#download")]);
  ok(dl.suggestedFilename() === "munich-test.json", "download file name: " + dl.suggestedFilename());
  await p.screenshot({ path: path.join(__dirname, "../dist/screens/main.png") });

  await p.click("#clear");
  ok((await p.textContent("#count")) === "0" && (await p.isDisabled("#download")), "Clear empties the map");
  ok(errs.length === 0, "no page errors " + errs.join(" | "));
  await b.close();
  console.log(fail ? `${fail} FAILED` : "ALL PASS");
})();
