// The camera view (plan step 16): where the camera faces (along the road, at an angle to the car, or
// random) and how far it tilts (the same for every location, or random within a range). The car is the
// direction Google says it faced (centerHeading). The drawings follow the fields and set them by pointer;
// the map file, the Street View link, the history, the settings file and saved searches keep it all.
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
  const exported = () => p.evaluate(() => JSON.parse(exportJson()).customCoordinates);
  // Every panorama: arrows at 100° and 280°, the car drove towards 130°; every third one without a car
  // direction from Google
  const answers = (carHeading = 130) =>
    p.evaluate(car => {
      let n = 0;
      window.__sv = req => {
        n++;
        return {
          id: "VIEW_" + n,
          lat: req.location.lat,
          lng: req.location.lng,
          links: [
            { heading: 100, description: "" },
            { heading: 280, description: "" },
          ],
          ...(n % 3 ? { carHeading: car } : {}),
        };
      };
    }, carHeading);
  await answers();

  // Defaults: along the road, level
  ok(
    (await sum()) === "Along the road, level" && !(await p.isVisible("#moreView .more-changed")),
    "the default: along the road, level",
  );
  ok(
    (await p.isDisabled("#carAngle")) && (await p.isDisabled("#tiltMin")),
    "what does not apply is greyed out",
  );
  await search(p, { country: "Malta", target: 6 });
  await searchEnded(p);
  let c = await exported();
  ok(
    c.every(l => [100, 280].includes(l.heading) && l.pitch === 0),
    "by default the camera looks along the road, level",
  );

  // At an angle to the car: 90° to its right, 15° up
  await p.check("#directionCar");
  await p.fill("#carAngle", "90");
  await p.press("#carAngle", "Tab");
  await p.fill("#tilt", "15");
  await p.press("#tilt", "Tab");
  ok((await sum()) === "90° to the car (right), 15° up", "the summary says so: " + (await sum()));
  await search(p, { country: "Malta", target: 6 });
  await searchEnded(p);
  c = await exported();
  const withCar = await p.evaluate(() => results.map(l => [l.panoId.slice(5) % 3 !== 0, l.heading]));
  ok(
    withCar.every(([hasCar, h]) => h === (hasCar ? 220 : 190)) &&
      withCar.some(([hasCar]) => hasCar) &&
      withCar.some(([hasCar]) => !hasCar) &&
      c.every(l => l.pitch === 15),
    "90° to the right of a car driving towards 130° looks at 220°, 15° up; without Google's car direction, the road (100°) stands in: " +
      JSON.stringify(withCar),
  );
  ok(
    /&heading=220&pitch=15&fov=100$/.test(
      await p.evaluate(() => streetViewLink(results.find(l => l.heading === 220))),
    ),
    "the Street View link opens looking that way",
  );

  // Random direction, random tilt within a range
  await p.check("#directionRandom");
  await p.check("#tiltRandom");
  await p.fill("#tiltMin", "−10");
  await p.press("#tiltMin", "Tab");
  await p.fill("#tiltMax", "10");
  await p.press("#tiltMax", "Tab");
  ok((await sum()) === "Random direction, random tilt −10° to 10°", "random: " + (await sum()));
  await search(p, { country: "Malta", target: 12 });
  await searchEnded(p);
  c = await exported();
  ok(
    new Set(c.map(l => Math.round(l.heading))).size > 6 && c.every(l => l.heading >= 0 && l.heading < 360),
    "random directions, all different",
  );
  ok(
    c.every(l => l.pitch >= -10 && l.pitch <= 10) && new Set(c.map(l => l.pitch)).size > 6,
    "random tilts, all within −10° to 10°: " + c.map(l => l.pitch).join(" "),
  );

  // A random direction within a range, clockwise from the front of the car: 45° to 135° (the right
  // side), then 315° to 45° (the front, across 0°). The car drives towards 130°; without Google's car
  // direction, the road (100°) stands in.
  ok(await p.isVisible("#dirFromHandle"), "in random, the car drawing shows the range with two handles");
  await p.fill("#dirFrom", "45");
  await p.press("#dirFrom", "Tab");
  await p.fill("#dirTo", "135");
  await p.press("#dirTo", "Tab");
  ok(
    (await sum()) === "Random direction, 45° to 135° from the car, random tilt −10° to 10°",
    "the summary says the range: " + (await sum()),
  );
  const within = (h, from, span) => (((h - from) % 360) + 360) % 360 <= span;
  const ranged = async (from, span) => {
    await search(p, { country: "Malta", target: 12 });
    await searchEnded(p);
    return p.evaluate(
      ([from, span]) =>
        results.map(l => {
          const front = Number(l.panoId.slice(5)) % 3 ? 130 : 100;
          return [l.heading, (((l.heading - front - from) % 360) + 360) % 360 <= span];
        }),
      [from, span],
    );
  };
  let r = await ranged(45, 90);
  ok(
    r.every(([, ok]) => ok),
    "45° to 135°: every direction on the right side of the car: " + r.map(([h]) => h).join(" "),
  );
  await p.fill("#dirFrom", "315");
  await p.press("#dirFrom", "Tab");
  await p.fill("#dirTo", "45");
  await p.press("#dirTo", "Tab");
  r = await ranged(315, 90);
  ok(
    r.every(([, ok]) => ok),
    "315° to 45°: within 45° of the front, across 0°: " + r.map(([h]) => h).join(" "),
  );
  ok(within(10, 350, 30) && !within(40, 350, 30), "(the check itself handles the way round)");
  ok(
    (await p.evaluate(() => loadHistory()[0].settings.dirFrom)) === 315 &&
      (await p.evaluate(() => cleanSettings({}).dirTo)) === 360 &&
      (await p.evaluate(() => cleanSettings({ dirFrom: 400, dirTo: -5 }).dirFrom)) === 0,
    "the range is kept with the settings, 0° to 360° by default, and checked",
  );
  // The whole way round again
  await p.fill("#dirFrom", "0");
  await p.press("#dirFrom", "Tab");
  await p.fill("#dirTo", "360");
  await p.press("#dirTo", "Tab");
  ok((await sum()) === "Random direction, random tilt −10° to 10°", "0° to 360° is any direction");

  // Typed angles: kept within range, the angle to the car goes round; the arrow keys turn it
  await p.check("#directionCar");
  await p.check("#tiltFixed");
  await p.fill("#carAngle", "450");
  await p.press("#carAngle", "Tab");
  await p.fill("#tilt", "200");
  await p.press("#tilt", "Tab");
  ok(
    (await p.inputValue("#carAngle")) === "90" && (await p.inputValue("#tilt")) === "90",
    "450° is 90°; a tilt of 200° is 90°",
  );
  await p.click("#carAngle");
  await p.keyboard.press("ArrowUp");
  await p.keyboard.press("Shift+ArrowDown");
  ok((await p.inputValue("#carAngle")) === "94", "the arrow keys turn it, 5° or 1° with Shift");

  // The drawings follow the fields, and set them by pointer
  ok(
    (await p.getAttribute("#directionArrow", "transform")) === "rotate(94)" &&
      (await p.getAttribute("#tiltArrow", "transform")) === "rotate(-90)",
    "the drawings follow the fields",
  );
  await p.check("#directionRoad");
  const dial = await p.locator("#directionDial").boundingBox();
  await p.mouse.click(dial.x + dial.width / 2, dial.y + dial.height * 0.9); // straight below the car
  ok(
    (await p.isChecked("#directionCar")) && (await p.inputValue("#carAngle")) === "180",
    "clicking behind the car on the drawing chooses 180°, and the angle to the car",
  );
  // Points of the tilt drawing on the screen, from the drawing's own units
  const onScreen = (x, y) =>
    p.evaluate(
      ([x, y]) => {
        const pt = new DOMPoint(x, y).matrixTransform(document.getElementById("tiltDial").getScreenCTM());
        return [pt.x, pt.y];
      },
      [x, y],
    );
  await p.mouse.move(...(await onScreen(60, 0)));
  await p.mouse.down();
  await p.mouse.move(...(await onScreen(50, -50)), { steps: 4 }); // dragged up to 45°
  await p.mouse.up();
  ok(
    (await p.inputValue("#tilt")) === "45",
    "dragging the tilt arrow up to 45°: " + (await p.inputValue("#tilt")),
  );

  // Kept: history, settings file, saved locations, and checked
  await search(p, { country: "Malta", target: 2 });
  await searchEnded(p);
  const kept = await p.evaluate(() => loadHistory()[0].settings);
  ok(
    kept.viewDirection === "car" && kept.carAngle === 180 && kept.tilt === 45 && kept.tiltMode === "fixed",
    "the history keeps the camera view",
  );
  ok(
    /camera 180° to the car \(back\), 45° up/.test(
      await p.evaluate(() => historyDetails(loadHistory()[0].settings)),
    ),
    "and describes it",
  );
  const cleaned = await p.evaluate(() =>
    cleanSettings({ viewDirection: "<b>", carAngle: 999, tiltMode: "sideways", tilt: -500, tiltMin: "x" }),
  );
  ok(
    cleaned.viewDirection === "road" &&
      cleaned.carAngle === 0 &&
      cleaned.tiltMode === "fixed" &&
      cleaned.tilt === 0 &&
      cleaned.tiltMin === -20,
    "settings out of range get their defaults",
  );
  ok(
    (await p.evaluate(
      () => cleanLocation({ lat: 1, lng: 1, heading: 10, pitch: 120, panoId: "ABCD", cc: "MT" }).pitch,
    )) === 0,
    "a saved location's tilt is checked",
  );

  // Reset
  await p.click("#moreView .reset");
  ok(
    (await sum()) === "Along the road, level" &&
      (await p.inputValue("#carAngle")) === "0" &&
      (await p.isChecked("#directionRoad")),
    "Reset to defaults: along the road, level",
  );

  ok(errors.length === 0, "no page errors " + errors.join(" | "));
  await b.close();
  console.log(fail ? `${fail} FAILED` : "ALL PASS");
})();
