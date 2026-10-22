// Following the road to find the end of coverage (walkToEnd): from a found spot that is not an end, the
// search follows the arrows, straight on at junctions, and keeps the end it reaches; it stops at the step
// limit and on a ring road; it only runs for "End of coverage", can be switched off, and is saved with
// the settings and in the history. Google's script is simulated with a small made-up road network.
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
  // A road through Malta from ROAD_0 (south) to ROAD_60 (north), 60 panoramas about 110 m apart; both
  // ends have one arrow. ROAD_30 has a side road to the east (SIDE_0 … SIDE_5, which also ends). Every
  // random spot finds ROAD_20, between two arrows, so only walking can find an end; walking north passes
  // the junction at ROAD_30, where it must carry straight on.
  const roadNetwork = () => {
    window.__sv = req => {
      const id = req.pano || "ROAD_20";
      const [kind, num] = id.split("_"),
        k = Number(num);
      if (kind === "RING") {
        // a ring road of 20 panoramas: never an end
        return {
          id,
          lat: 35.9 + 0.003 * Math.sin((k * Math.PI) / 10),
          lng: 14.42 + 0.003 * Math.cos((k * Math.PI) / 10),
          links: [
            { heading: 90, pano: `RING_${(k + 1) % 20}`, description: "" },
            { heading: 270, pano: `RING_${(k + 19) % 20}`, description: "" },
          ],
        };
      }
      if (kind === "SIDE")
        return {
          id,
          lat: 35.91,
          lng: 14.421 + k * 0.001,
          links: [
            { heading: 270, pano: k ? `SIDE_${k - 1}` : "ROAD_30", description: "" },
            ...(k < 5 ? [{ heading: 90, pano: `SIDE_${k + 1}`, description: "" }] : []),
          ],
        };
      const links = [];
      if (k > 0) links.push({ heading: 180, pano: `ROAD_${k - 1}`, description: "" });
      if (k < 60) links.push({ heading: 0, pano: `ROAD_${k + 1}`, description: "" });
      if (k === 30) links.push({ heading: 92, pano: "SIDE_0", description: "" });
      return { id, lat: 35.88 + k * 0.001, lng: 14.42, links };
    };
  };
  await p.evaluate(roadNetwork);
  await p.fill("#giveUpAfter", "50");

  // The option: on by default, only for "End of coverage"
  await p.uncheck("#deadEnd");
  ok(
    (await p.isChecked("#walkOn")) && (await p.isDisabled("#walkOn")) && (await p.isDisabled("#walkSteps")),
    "on by default; only usable with End of coverage",
  );
  await p.check("#deadEnd");
  ok((await p.isEnabled("#walkOn")) && (await p.inputValue("#walkSteps")) === "150", "150 steps by default");

  // Walking finds both ends of the road, never the side road (straight on at the junction)
  await search(p, { country: "Malta", deadEnd: true, target: 2 });
  await searchEnded(p);
  let r = await p.evaluate(() => ({
    found: results
      .map(l => `${l.panoId}@${Math.round(l.heading)}`)
      .sort()
      .join(" "),
    steps: stats.walkSteps,
    ends: stats.walkEnds,
    tally: document.getElementById("tally").textContent,
  }));
  ok(
    r.found === "ROAD_0@180 ROAD_60@0",
    "both ends found, straight on past the junction, each facing where the coverage stops: " + r.found,
  );
  ok(r.ends >= 2 && r.steps >= 60, `the walks are counted: ${r.steps} steps, ${r.ends} ends`);
  ok(
    /steps along roads/.test(r.tally) && /ends found by following roads/.test(r.tally),
    "the counters show the walking: " + r.tally,
  );

  // A step limit too short to reach an end: nothing found, and Malta gives up
  await p.fill("#walkSteps", "10");
  await search(p, { country: "Malta", deadEnd: true, target: 2 });
  await searchEnded(p);
  r = await p.evaluate(() => ({ found: results.length, steps: stats.walkSteps, walks: stats.tries }));
  ok(
    r.found === 0 && r.steps <= r.walks * 10,
    `10 steps are not enough: nothing found, at most 10 steps per walk (${r.steps} steps, ${r.walks} walks)`,
  );
  ok(await p.isVisible("#shortfall"), "and the country gives up after its tries, as usual");

  // A ring road: the walk stops when it comes back, instead of going round for ever
  await p.fill("#walkSteps", "150");
  await p.evaluate(() => {
    const road = window.__sv;
    window.__sv = req => road({ ...req, pano: req.pano || "RING_0" });
  });
  await search(p, { country: "Malta", deadEnd: true, target: 1 });
  await searchEnded(p);
  r = await p.evaluate(() => ({ found: results.length, steps: stats.walkSteps, walks: stats.tries }));
  ok(
    r.found === 0 && r.steps <= r.walks * 20,
    `on a ring road each walk stops after one round: ${r.steps} steps for ${r.walks} walks`,
  );

  // Switched off: no walking, so no ends from a junction
  await p.evaluate(roadNetwork);
  await p.uncheck("#walkOn");
  ok(await p.isDisabled("#walkSteps"), "the number of steps can only be changed while it is on");
  await search(p, { country: "Malta", deadEnd: true, target: 2 });
  await searchEnded(p);
  r = await p.evaluate(() => ({ found: results.length, steps: stats.walkSteps }));
  ok(r.found === 0 && r.steps === 0, "switched off: roads are not followed");

  // Without "End of coverage", roads are never followed
  await p.check("#walkOn");
  await search(p, { country: "Malta", noRoadName: true, target: 1 });
  await searchEnded(p);
  ok((await p.evaluate(() => stats.walkSteps)) === 0, "for other criteria, roads are not followed");

  // Saved, and kept in the history
  await p.check("#deadEnd");
  await p.fill("#walkSteps", "300");
  await p.press("#walkSteps", "Tab");
  await search(p, { country: "Malta", deadEnd: true, target: 1 });
  await searchEnded(p);
  const entry = await p.evaluate(() => loadHistory()[0]);
  ok(
    entry.settings.walkOn === true && entry.settings.walkSteps === 300,
    "the history keeps the road settings",
  );
  ok(
    /roads followed up to 300 steps/.test(await p.evaluate(() => historyDetails(loadHistory()[0].settings))),
    "and describes them",
  );
  await p.reload();
  await p.waitForFunction(() => map !== null);
  ok(
    (await p.isChecked("#walkOn")) && (await p.inputValue("#walkSteps")) === "300",
    "remembered after a reload",
  );
  // An older history entry, from before roads could be followed, gets the defaults
  const old = await p.evaluate(() => cleanSettings({ scope: "countries", countries: ["MT"], deadEnd: true }));
  ok(old.walkOn === true && old.walkSteps === 150, "older history entries get the road defaults");

  ok(errors.length === 0, "no page errors " + errors.join(" | "));
  await b.close();
  console.log(fail ? `${fail} FAILED` : "ALL PASS");
})();
