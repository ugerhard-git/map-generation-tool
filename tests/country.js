// The country field in step 1: suggestions while typing (official coverage only, best matches first),
// picking with the keyboard or the mouse, leaving the field with partial or wrong text, and the saved
// choice coming back on the next visit.
const { chromium } = require("./pw.js");
const { openPage } = require("./helpers.js");
const path = require("path");
(async () => {
  const b = await chromium.launch();
  let fail = 0;
  const ok = (c, m) => {
    console.log((c ? "PASS " : "FAIL ") + m);
    if (!c) fail++;
  };
  const { page: p, errors } = await openPage(b);
  const shown = () => p.$$eval("#countryList li[role=option]", lis => lis.map(li => li.textContent));
  const chosen = () => p.evaluate(() => chosenCountry);

  // Focus: the whole list, official coverage only, sorted by name
  await p.click("#country");
  let names = await shown();
  const coverage = await p.evaluate(() => COVERAGE.map(countryName));
  ok(
    names.length === coverage.length &&
      names.every(n => coverage.includes(n)) &&
      names.every((n, i) => !i || names[i - 1].localeCompare(n) <= 0),
    `focus shows every country with official coverage, sorted: ${names.length}, first ${names[0]}`,
  );
  ok(await p.isVisible("#countryList"), "the list is shown");

  // Typing narrows the list; names starting with the text come first
  await p.fill("#country", "ger");
  names = await shown();
  ok(names[0] === "Germany", "typing 'ger' suggests Germany first: " + names.slice(0, 3).join(", "));
  await p.fill("#country", "united");
  names = await shown();
  ok(
    names.includes("United Kingdom") && names.includes("United States") && names.length <= 4,
    "typing 'united' suggests the United Kingdom and the United States: " + names.join(", "),
  );
  await p.fill("#country", "aland");
  ok((await shown())[0] === "Åland Islands", "accents do not matter: 'aland' finds Åland Islands");
  await p.fill("#country", "de");
  ok((await shown())[0] === "Germany", "the two-letter code 'de' finds Germany first");
  await p.fill("#country", "zzzz");
  ok(
    (await shown()).length === 0 && /No country/.test(await p.textContent("#countryList")),
    "no match: says so",
  );

  // Keyboard: arrow down and Enter pick a country, without starting a search
  await p.fill("#country", "united");
  await p.keyboard.press("ArrowDown");
  await p.keyboard.press("Enter");
  ok(
    (await chosen()) === "GB" && (await p.inputValue("#country")) === "United Kingdom",
    "arrow down and Enter pick the second suggestion (after the United Arab Emirates)",
  );
  ok(await p.isHidden("#countryList"), "the list closes after picking");
  ok(
    !(await p.evaluate(() => running)) && (await p.textContent("#error")) === "",
    "Enter does not start a search",
  );
  ok(
    (await p.getAttribute("#mapName", "placeholder")) === "United Kingdom: Official coverage",
    "the suggested map name follows the country",
  );

  // Mouse: a click on a suggestion picks it
  await p.fill("#country", "mal");
  await p.screenshot({ path: path.join(__dirname, "../dist/screens/country.png") });
  await p.click("#countryList li >> text=Malta");
  ok((await chosen()) === "MT", "a click picks the country");

  // Escape puts the chosen country back
  await p.fill("#country", "fra");
  await p.keyboard.press("Escape");
  ok((await p.inputValue("#country")) === "Malta" && (await chosen()) === "MT", "Escape keeps Malta");

  // Leaving the field: text matching one country chooses it; other text puts back the choice
  await p.fill("#country", "Norw");
  await p.click("#target");
  await p.waitForTimeout(250);
  ok(
    (await chosen()) === "NO" && (await p.inputValue("#country")) === "Norway",
    "'Norw' and leaving: Norway",
  );
  await p.fill("#country", "s");
  await p.click("#target");
  await p.waitForTimeout(250);
  ok((await chosen()) === "NO" && (await p.inputValue("#country")) === "Norway", "unclear text: Norway kept");

  // The choice is saved for the next visit
  await p.reload();
  await p.waitForFunction(() => map !== null);
  ok((await chosen()) === "NO" && (await p.inputValue("#country")) === "Norway", "remembered after a reload");

  ok(errors.length === 0, "no page errors " + errors.join(" | "));
  await b.close();
  console.log(fail ? `${fail} FAILED` : "ALL PASS");
})();
