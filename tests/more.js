// "More options" and help (CONTRIBUTING.md: "A simple interface"): a first visitor sees only where, the
// main criteria, how many and "Find locations"; the other settings are in closed sections with a summary
// line, a "changed" mark and "Reset to defaults"; open sections are remembered; "?" buttons open help.
const pw = require("playwright"); // not tests/pw.js: this test needs the page as a first visitor sees it
const { PAGE, isSite, serveSite } = require("./site.js");
(async () => {
  const b = await pw.chromium.launch();
  let fail = 0;
  const ok = (c, m) => {
    console.log((c ? "PASS " : "FAIL ") + m);
    if (!c) fail++;
  };
  const ctx = await b.newContext({ viewport: { width: 1360, height: 860 } });
  await ctx.addInitScript(() => localStorage.setItem("mapgen.welcomed", "true"));
  const p = await ctx.newPage();
  const errors = [];
  p.on("pageerror", e => errors.push(String(e)));
  await p.route("**/*", r =>
    isSite(r.request().url()) ? serveSite(r) : r.fulfill({ status: 204, body: "" }),
  );
  await p.goto(PAGE);
  await p.waitForFunction(() => map !== null);
  const sections = ["moreDistribution", "morePhotos", "moreSearch", "moreMapFile"];
  const summary = id => p.textContent(`#${id} .more-sum`);
  const changed = id => p.isVisible(`#${id} .more-changed`);

  // The first screen
  ok(
    (await p.evaluate(ids => ids.every(id => !document.getElementById(id).open), sections)) &&
      (await p.isHidden("#radius")) &&
      (await p.isHidden("#yearsOn")) &&
      (await p.isHidden("#mapName")) &&
      (await p.isHidden("#distribution")),
    "a first visitor sees every More options section closed",
  );
  ok(
    (await p.isVisible("#country")) &&
      (await p.isVisible("#noRoadName")) &&
      (await p.isVisible("#arrowsEnd")) &&
      (await p.isVisible("#target")) &&
      (await p.isVisible("#go")),
    "and where, the main criteria, how many and Find locations",
  );
  ok((await p.$$("#fields .hint:visible")).length <= 2, "with little text on the page");

  // Summaries of the defaults, without a "changed" mark
  const sums = {};
  for (const id of sections) sums[id] = await summary(id);
  ok(
    sums.moreDistribution === "Only used with several countries" &&
      sums.morePhotos === "Any time" &&
      sums.moreSearch === "1,000 m around each spot, give up after 2,000 spots" &&
      sums.moreMapFile === "Suggested name, tags: country",
    "each section sums up its settings: " + JSON.stringify(sums),
  );
  ok(!(await changed("morePhotos")) && !(await changed("moreSearch")), "nothing is marked changed at first");

  // Changing a setting: the summary follows, the section is marked changed, Reset puts it back
  await p.click("#morePhotos summary");
  await p.check("#yearsOn");
  await p.selectOption("#yearFrom", "2015");
  await p.check("#noBadCamera");
  ok(
    (await summary("morePhotos")) === "Jan 2015 to now, no bad camera, older photos instead" &&
      (await changed("morePhotos")),
    "a changed section says what is set and is marked: " + (await summary("morePhotos")),
  );
  await p.click("#morePhotos .reset");
  ok(
    (await summary("morePhotos")) === "Any time" &&
      !(await changed("morePhotos")) &&
      !(await p.isChecked("#yearsOn")) &&
      (await p.evaluate(() => localStorage.getItem("mapgen.noBadCamera"))) === "false",
    "Reset to defaults puts them back, also what is saved",
  );
  await p.click("#moreSearch summary");
  await p.fill("#radius", "2500");
  await p.press("#radius", "Tab");
  ok(
    (await summary("moreSearch")) === "2,500 m around each spot, give up after 2,000 spots" &&
      (await changed("moreSearch")),
    "the search section too",
  );
  await p.click("#moreSearch .reset");
  ok((await p.inputValue("#radius")) === "1,000" && !(await changed("moreSearch")), "and its reset");

  // Distribution: greyed out for one country, chosen for several
  await p.fill("#country", "Malta");
  await p.keyboard.press("Enter");
  await p.click("#moreDistribution summary");
  ok(await p.isDisabled("#distribution"), "one country: the distribution is greyed out");
  await p.fill("#country", "Luxembourg");
  await p.keyboard.press("Enter");
  ok(
    (await p.isEnabled("#distribution")) && (await summary("moreDistribution")) === "An Arbitrary World",
    "two countries: it can be chosen, An Arbitrary World by default",
  );

  // Open sections are remembered
  await p.reload();
  await p.waitForFunction(() => map !== null);
  ok(
    (await p.evaluate(() => [...document.querySelectorAll("details.more[open]")].map(d => d.id).join())) ===
      "moreDistribution,morePhotos,moreSearch",
    "the sections opened stay open next time",
  );

  // Help dialogs
  await p.click('button.help[data-help="giveUpAfter"]');
  ok(
    (await p.isVisible("#help")) &&
      (await p.textContent("#helpTitle")) === "Giving up on a country" &&
      /fill the gap/.test(await p.textContent("#helpBody")) &&
      (await p.evaluate(() => document.activeElement.id)) === "helpBox",
    "a ? button opens its help in a dialog",
  );
  await p.keyboard.press("Escape");
  ok(
    (await p.isHidden("#help")) &&
      (await p.evaluate(() => document.activeElement.dataset.help)) === "giveUpAfter",
    "Escape closes it, and the focus goes back to the ? button",
  );
  const topics = await p.evaluate(() =>
    [...document.querySelectorAll("button.help")]
      .map(b => b.dataset.help)
      .filter(t => !(document.getElementById("help-" + t) instanceof HTMLTemplateElement)),
  );
  ok(topics.length === 0, "every ? button has a help text" + (topics.length ? ": missing " + topics : ""));
  await p.click('button.help[data-help="noRoadName"]');
  ok(!(await p.isChecked("#noRoadName")), "a ? next to a tick box does not tick it");
  await p.click("#helpOk");

  ok(errors.length === 0, "no page errors " + errors.join(" | "));
  await b.close();
  console.log(fail ? `${fail} FAILED` : "ALL PASS");
})();
