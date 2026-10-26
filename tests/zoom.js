// The zoom (plan step 20), in the camera view section: the same for every location (0 by default, the
// widest view, as the map files had before), or random within a range. Each location's zoom goes into
// the map file and, as a field of view, into the Street View link; the history, the settings file and
// saved searches keep the settings, and values from outside are checked.
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
  const sum = () => p.textContent("#moreView .more-sum");
  const zooms = () => p.evaluate(() => JSON.parse(exportJson()).customCoordinates.map(c => c.zoom));
  // Google answers every spot with a panorama with two arrows
  await p.evaluate(() => {
    let n = 0;
    window.__sv = req => ({
      id: "ZOOM_" + ++n,
      lat: req.location.lat,
      lng: req.location.lng,
      links: [
        { heading: 100, description: "" },
        { heading: 280, description: "" },
      ],
    });
  });
  const type = async (id, text) => {
    await p.fill("#" + id, text);
    await p.press("#" + id, "Tab");
  };

  // The default: zoom 0, as before; the range is greyed out (and not shown)
  ok(
    (await sum()) === "Along the road, level" &&
      (await p.inputValue("#zoom")) === "0" &&
      (await p.isDisabled("#zoomMin")) &&
      (await p.isHidden("#zoomRangeFields")),
    "by default zoom 0, and the summary does not mention it",
  );
  await search(p, { country: "Malta", target: 4 });
  await searchEnded(p);
  ok(
    (await zooms()).every(z => z === 0),
    "the map file has zoom 0 by default",
  );

  // The same zoom for every location; a comma works as the decimal mark
  await type("zoom", "1,5");
  ok(
    (await p.inputValue("#zoom")) === "1.5" &&
      (await sum()) === "Along the road, level, zoom 1.5" &&
      (await p.isVisible("#moreView .more-changed")),
    "zoom 1.5: the summary says so: " + (await sum()),
  );
  await search(p, { country: "Malta", target: 4 });
  await searchEnded(p);
  ok(
    (await zooms()).every(z => z === 1.5),
    "every location has zoom 1.5",
  );
  ok(
    /&fov=64$/.test(await p.evaluate(() => streetViewLink(results[0]))),
    "the Street View link opens with the same view (64°)",
  );
  ok(
    (await p.evaluate(() => [0, 1, 2, 4].map(z => linkFov(z)).join())) === "100,90,45,11",
    "zoom as a link's field of view: 0 is 100° (the widest a link takes), 1 is 90°, 2 is 45°, 4 is 11°",
  );

  // Typed values are kept within 0 to 4; the arrow keys change the zoom
  await type("zoom", "9");
  ok((await p.inputValue("#zoom")) === "4", "9 becomes 4, the closest");
  await type("zoom", "hello");
  ok((await p.inputValue("#zoom")) === "4", "text that is not a number keeps the zoom");
  await type("zoom", "1");
  await p.click("#zoom");
  await p.keyboard.press("ArrowUp");
  await p.keyboard.press("Shift+ArrowDown");
  ok((await p.inputValue("#zoom")) === "1.4", "the arrow keys: 0.5 up, then 0.1 down with Shift");

  // The slider follows the field, and sets it when dragged or moved by keyboard
  ok((await p.inputValue("#zoomSlider")) === "1.4", "the slider follows the field");
  await p.locator("#zoomFixedFields .zoom-slider").scrollIntoViewIfNeeded();
  const track = await p.locator("#zoomFixedFields .zoom-slider").boundingBox();
  await p.mouse.click(track.x + 10 + (track.width - 20) * 0.75, track.y + track.height / 2); // at 3
  ok(
    (await p.inputValue("#zoom")) === "3" &&
      (await p.evaluate(() => localStorage.getItem("mapgen.zoom"))) === "3",
    "clicking the slider at 3 sets the zoom to 3: " + (await p.inputValue("#zoom")),
  );
  await p.focus("#zoomSlider");
  await p.keyboard.press("ArrowLeft");
  ok((await p.inputValue("#zoom")) === "2.9", "the slider's arrow keys change it by 0.1");
  ok(
    (await p.getAttribute("#zoomSlider", "aria-label")) === "Zoom" &&
      (await p.evaluate(() => document.getElementById("zoomFill").getBoundingClientRect().width)) > 0,
    "the slider is named for screen readers, and the part chosen is filled in",
  );
  await type("zoom", "1.4");

  // Random, within a range (the "to" may be typed first: the range is the same)
  await p.check("#zoomRandom");
  ok(
    (await p.isDisabled("#zoom")) && (await p.isVisible("#zoomRangeFields")),
    "random: the range can be set, the single zoom is greyed out",
  );
  await type("zoomMin", "3");
  await type("zoomMax", "1");
  ok(
    (await p.inputValue("#zoomMinSlider")) === "3" && (await p.inputValue("#zoomMaxSlider")) === "1",
    "the two handles of the range slider follow the fields",
  );
  await p.locator("#zoomRangeFields .zoom-slider").scrollIntoViewIfNeeded();
  const range = await p.locator("#zoomRangeFields .zoom-slider").boundingBox();
  const at = z => range.x + 10 + ((range.width - 20) * z) / 4;
  await p.mouse.move(at(1), range.y + range.height / 2);
  await p.mouse.down();
  await p.mouse.move(at(0.5), range.y + range.height / 2, { steps: 4 });
  await p.mouse.up();
  ok(
    (await p.inputValue("#zoomMax")) === "0.5" && (await p.inputValue("#zoomMin")) === "3",
    "dragging the handle at 1 to 0.5 moves that end of the range: " +
      (await p.inputValue("#zoomMin")) +
      " to " +
      (await p.inputValue("#zoomMax")),
  );
  await type("zoomMax", "1");
  ok((await sum()) === "Along the road, level, random zoom 1 to 3", "the summary: " + (await sum()));
  await search(p, { country: "Malta", target: 12 });
  await searchEnded(p);
  const z = await zooms();
  ok(
    z.length === 12 && z.every(x => x >= 1 && x <= 3 && Math.round(x * 10) === x * 10) && new Set(z).size > 4,
    "random zooms, all from 1 to 3 with one decimal: " + z.join(" "),
  );

  // Kept: history, settings, saved search; and checked
  const kept = await p.evaluate(() => loadHistory()[0].settings);
  ok(kept.zoomMode === "random" && kept.zoomMin === 3 && kept.zoomMax === 1, "the history keeps the zoom");
  ok(
    /random zoom 1 to 3/.test(await p.evaluate(() => historyDetails(loadHistory()[0].settings))),
    "and describes it",
  );
  const cleaned = await p.evaluate(() => [
    cleanSettings({}),
    cleanSettings({ zoomMode: "<b>", zoom: 7, zoomMin: -1, zoomMax: "2" }),
    cleanSettings({ zoomMode: "random", zoom: 2.25, zoomMin: 0.5, zoomMax: 4 }),
  ]);
  ok(
    cleaned[0].zoomMode === "fixed" && cleaned[0].zoom === 0 && cleaned[0].zoomMax === 2,
    "older settings without a zoom get zoom 0",
  );
  ok(
    cleaned[1].zoomMode === "fixed" &&
      cleaned[1].zoom === 0 &&
      cleaned[1].zoomMin === 0 &&
      cleaned[1].zoomMax === 2 &&
      cleaned[2].zoom === 2.3 &&
      cleaned[2].zoomMin === 0.5 &&
      cleaned[2].zoomMax === 4,
    "zooms out of range or not numbers get their defaults; one decimal is kept",
  );
  ok(
    (await p.evaluate(() =>
      [
        cleanLocation({ lat: 1, lng: 1, heading: 10, zoom: 9, panoId: "ABCD", cc: "MT" }).zoom,
        cleanLocation({ lat: 1, lng: 1, heading: 10, zoom: 2.5, panoId: "ABCD", cc: "MT" }).zoom,
      ].join(),
    )) === "0,2.5",
    "a saved location's zoom is checked",
  );

  // Applying settings (as "Use these settings" and settings files do) sets the fields
  await p.evaluate(() => applySettings(cleanSettings({ zoomMode: "fixed", zoom: 2.5 })));
  ok(
    (await p.isChecked("#zoomFixed")) &&
      (await p.inputValue("#zoom")) === "2.5" &&
      (await p.evaluate(() => localStorage.getItem("mapgen.zoom"))) === "2.5",
    "applied settings set the zoom and keep it for next time",
  );

  // Reset
  await p.click("#moreView .reset");
  ok(
    (await sum()) === "Along the road, level" &&
      (await p.inputValue("#zoom")) === "0" &&
      (await p.inputValue("#zoomMax")) === "2" &&
      (await p.isChecked("#zoomFixed")),
    "Reset to defaults: zoom 0",
  );

  ok(errors.length === 0, "no page errors " + errors.join(" | "));
  await b.close();
  console.log(fail ? `${fail} FAILED` : "ALL PASS");
})();
