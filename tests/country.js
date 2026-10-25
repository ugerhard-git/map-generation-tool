// The country field in step 1: suggestions while typing (official coverage only, best matches first),
// adding countries as chips with the keyboard or the mouse, removing them, leaving the field with partial
// or wrong text, and the chosen countries coming back on the next visit (also from the older saved
// setting with one country).
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
  const chosen = () => p.evaluate(() => chosenCountries.join());
  const chips = () => p.$$eval("#countryChips .chip", c => c.map(x => x.textContent).join());

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

  // Keyboard: arrow down and Enter add a country as a chip, without starting a search
  await p.fill("#country", "united");
  await p.keyboard.press("ArrowDown");
  await p.keyboard.press("Enter");
  ok(
    (await chosen()) === "GB" &&
      (await chips()) === "United Kingdom" &&
      (await p.inputValue("#country")) === "",
    "arrow down and Enter add the second suggestion as a chip and empty the field",
  );
  ok(
    !(await p.evaluate(() => running)) && (await p.textContent("#error")) === "",
    "Enter does not start a search",
  );
  ok(
    (await p.getAttribute("#mapName", "placeholder")) === "United Kingdom: Official coverage",
    "the suggested map name follows the country",
  );
  ok(
    (await p.isDisabled("#distribution")) && (await p.isVisible("#distributionNote")),
    "one country: the distribution is greyed out, with a note why",
  );
  ok(await p.isHidden("#sharesBox"), "one country: no table of locations per country");

  // Mouse: a click on a suggestion adds it; chosen countries are not suggested again
  await p.fill("#country", "mal");
  await p.screenshot({ path: path.join(__dirname, "../dist/screens/country.png") });
  await p.click("#countryList li >> text=Malta");
  ok((await chosen()) === "GB,MT", "a click adds the country");
  await p.fill("#country", "united k");
  ok((await shown()).length === 0, "a chosen country is not suggested again");
  await p.keyboard.press("Escape");
  ok(
    (await p.inputValue("#country")) === "" && (await p.isHidden("#countryList")),
    "Escape empties the field",
  );
  ok(
    (await p.isEnabled("#distribution")) && (await p.isHidden("#distributionNote")),
    "two countries: the distribution can be chosen",
  );
  ok(
    (await p.getAttribute("#mapName", "placeholder")) ===
      "United Kingdom, Malta (An Arbitrary World): Official coverage",
    "two countries: the map name names both and the map",
  );

  // Leaving the field: text matching one country adds it; other text is cleared
  await p.fill("#country", "Norw");
  await p.click("#target");
  await p.waitForTimeout(250);
  ok((await chosen()) === "GB,MT,NO", "'Norw' and leaving: Norway added");
  await p.fill("#country", "s");
  await p.click("#target");
  await p.waitForTimeout(250);
  ok((await chosen()) === "GB,MT,NO" && (await p.inputValue("#country")) === "", "unclear text: cleared");

  // Removing: a click on a chip, or Backspace in the empty field
  await p.click("#countryChips .chip >> text=Malta");
  ok((await chosen()) === "GB,NO", "a click on a chip removes it");
  await p.focus("#country");
  await p.keyboard.press("Backspace");
  ok((await chosen()) === "GB", "Backspace in the empty field removes the last country");
  await p.keyboard.press("Escape");

  // The choice is saved for the next visit
  await p.reload();
  await p.waitForFunction(() => map !== null);
  ok((await chosen()) === "GB" && (await chips()) === "United Kingdom", "remembered after a reload");

  // A browser that saved one country before several could be chosen keeps it
  await p.evaluate(() => {
    localStorage.removeItem("mapgen.countries");
    localStorage.setItem("mapgen.country", JSON.stringify("MT"));
  });
  await p.reload();
  await p.waitForFunction(() => map !== null);
  ok(
    (await chosen()) === "MT" &&
      (await p.evaluate(() => localStorage.getItem("mapgen.country"))) === null &&
      (await p.evaluate(() => localStorage.getItem("mapgen.countries"))) === '["MT"]',
    "an older saved country is moved over to the new setting",
  );

  ok(errors.length === 0, "no page errors " + errors.join(" | "));
  await b.close();
  console.log(fail ? `${fail} FAILED` : "ALL PASS");
})();
