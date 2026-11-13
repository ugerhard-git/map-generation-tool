// "Remove all countries" in step 1: with two or more chosen countries, removes them all after asking, in
// both tools.
const { chromium } = require("./pw.js");
const { openPage, chooseCountry } = require("./helpers.js");
const { UNOFFICIAL } = require("./site.js");
(async () => {
  const b = await chromium.launch();
  let fail = 0;
  const ok = (c, m) => {
    console.log((c ? "PASS " : "FAIL ") + m);
    if (!c) fail++;
  };
  for (const [tool, url] of [
    ["Map Generation Tool", undefined],
    ["Unofficial", UNOFFICIAL],
  ]) {
    const { page: p, errors } = await openPage(b, "ok", null, url);
    await p.check("input[name=scope][value=countries]");
    await p.evaluate(() => {
      chosenCountries = [];
      whereChanged();
    });
    const chosen = () => p.evaluate(() => chosenCountries.join());
    await chooseCountry(p, "Malta");
    ok(await p.isHidden("#clearCountries"), `${tool}: one country, no "Remove all countries"`);
    await chooseCountry(p, "Germany");
    await chooseCountry(p, "France");
    ok(await p.isVisible("#clearCountries"), `${tool}: with three, "Remove all countries" is shown`);

    // Asks first, naming them; Cancel keeps them
    await p.click("#clearCountries");
    ok(
      (await p.isVisible("#clearCountriesDialog")) &&
        (await p.textContent("#clearCountriesText")) ===
          "This removes the 3 chosen countries: Malta, Germany, France.",
      `${tool}: asks first: ` + (await p.textContent("#clearCountriesText")),
    );
    await p.click("#clearCountriesCancel");
    ok(
      (await p.isHidden("#clearCountriesDialog")) && (await chosen()) === "MT,DE,FR",
      `${tool}: Cancel keeps them`,
    );
    await p.click("#clearCountries");
    await p.keyboard.press("Escape");
    ok((await chosen()) === "MT,DE,FR", `${tool}: Escape keeps them too`);

    // Remove all: none chosen, saved, the link gone
    await p.click("#clearCountries");
    await p.click("#clearCountriesGo");
    ok(
      (await chosen()) === "" &&
        (await p.isHidden("#countryChips")) &&
        (await p.isHidden("#clearCountries")) &&
        (await p.evaluate(() => localStorage.getItem((STORE_PREFIX || "") + "countries"))) === "[]",
      `${tool}: Remove all: none chosen, and saved so`,
    );

    // Many: the first six named, and how many more
    await p.evaluate(() => {
      chosenCountries = ["MT", "DE", "FR", "IT", "ES", "PT", "AT", "CH", "BE", "NL"];
      whereChanged();
    });
    await p.click("#clearCountries");
    ok(
      /the 10 chosen countries: Malta, Germany, France, Italy, Spain, Portugal and 4 more\./.test(
        await p.textContent("#clearCountriesText"),
      ),
      `${tool}: with many, the first six and how many more`,
    );
    await p.click("#clearCountriesX");
    ok(errors.length === 0, `${tool}: no page errors ` + errors.join(" | "));
  }
  await b.close();
  console.log(fail ? `${fail} FAILED` : "ALL PASS");
})();
