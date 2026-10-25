// Typing numbers into step 3 (number of locations, radius, give up after): plain digits or with any
// thousands separator (25000, 25,000, 25.000, 25 000, 25'000); out of range becomes the nearest number
// allowed; nonsense keeps the number before; the arrow keys step it; the table of locations per country
// follows while typing; Enter starts the search with the number just typed.
const { chromium } = require("./pw.js");
const { openPage, chooseCountry, searchEnded } = require("./helpers.js");
(async () => {
  const b = await chromium.launch();
  let fail = 0;
  const ok = (c, m) => {
    console.log((c ? "PASS " : "FAIL ") + m);
    if (!c) fail++;
  };
  // A German browser, where "25.000" means twenty-five thousand
  const ctx = await b.newContext({ locale: "de-DE", viewport: { width: 1360, height: 860 } });
  const { page: p, errors } = await openPage(b, "ok", ctx);
  await chooseCountry(p, "Germany");
  await chooseCountry(p, "France");
  const type = async (id, text) => {
    await p.click("#" + id);
    await p.keyboard.press("Control+A");
    await p.keyboard.type(text);
  };
  const leave = () => p.keyboard.press("Tab");
  const shown = id => p.inputValue("#" + id);

  // Every way of writing twenty-five thousand
  for (const text of ["25000", "25,000", "25.000", "25 000", "25'000"]) {
    await type("target", text);
    const typing = await p.evaluate(() => target());
    await leave();
    ok(
      typing === 25000 &&
        (await shown("target")) === "25,000" &&
        (await p.evaluate(() => target())) === 25000,
      `"${text}" is 25,000, while typing and after (shown as ${await shown("target")})`,
    );
  }
  ok((await p.evaluate(() => localStorage.getItem("mapgen.target"))) === "25000", "and it is kept");

  // Out of range: the nearest number allowed, shown in the field
  await type("target", "130001");
  await leave();
  ok((await shown("target")) === "130,000", "above the maximum: 130,000");
  await type("target", "0");
  await leave();
  ok((await shown("target")) === "1", "below the minimum: 1");
  await type("radius", "20.000");
  await leave();
  ok((await shown("radius")) === "10,000", "the radius too: 20.000 becomes 10,000 m");
  await type("giveUpAfter", "5.000");
  await leave();
  ok(
    (await shown("giveUpAfter")) === "5,000" && (await p.evaluate(() => giveUpAfter())) === 5000,
    "give up after: 5.000 spots",
  );

  // Nonsense: the number from before stays
  await type("target", "250");
  await leave();
  await type("target", "a lot");
  await leave();
  ok((await shown("target")) === "250", "something that is not a number keeps the number before");
  await type("target", "2.5");
  ok((await p.evaluate(() => target())) === 25, '"2.5" has no decimals here: it is read as 25');
  await leave();

  // The arrow keys step the number, within the range
  await type("target", "100");
  await p.keyboard.press("ArrowUp");
  await p.keyboard.press("ArrowUp");
  ok((await shown("target")) === "102", "arrow up: one more each time");
  await type("radius", "1,000");
  await p.keyboard.press("ArrowDown");
  ok((await shown("radius")) === "950", "arrow down on the radius: 50 m less");
  await type("radius", "50");
  await p.keyboard.press("ArrowDown");
  ok((await shown("radius")) === "50", "never below the minimum");

  // The table follows while typing, before leaving the field
  const rows = () => p.evaluate(() => [...document.querySelectorAll("#shares tr")].map(r => r.textContent));
  await type("target", "1.000");
  ok(
    (await rows()).some(r => /500/.test(r)) && (await p.inputValue("#target")) === "1.000",
    "the table of locations per country follows while typing",
  );

  // Enter starts the search with the number just typed
  await p.evaluate(() => {
    window.__sv = req => ({
      id: "NUM_" + Math.random().toString(36).slice(2, 10),
      lat: req.location.lat,
      lng: req.location.lng,
      links: [],
    });
  });
  await p.fill("#apiKey", "TESTKEY");
  await type("target", "12");
  await p.keyboard.press("Enter");
  await searchEnded(p);
  ok(
    (await p.evaluate(() => results.length)) === 12 && (await shown("target")) === "12",
    "Enter searches for the number just typed: " + (await p.evaluate(() => results.length)),
  );

  // Settings from the history are shown the same way
  await p.evaluate(() => applySettings(cleanSettings({ countries: ["MT"], target: 30000, radius: 2500 })));
  ok(
    (await shown("target")) === "30,000" && (await shown("radius")) === "2,500",
    "settings from the history are shown as 30,000 and 2,500",
  );

  ok(errors.length === 0, "no page errors " + errors.join(" | "));
  await b.close();
  console.log(fail ? `${fail} FAILED` : "ALL PASS");
})();
