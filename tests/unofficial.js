// Unofficial, the second tool (src/unofficial/): every country and territory, the built-in distributions
// (land area, equal shares), the lookup of any panorama and keeping only unofficial ones, its filters
// (whole 360°, image size, uploaders), the uploader tag, its own saved settings and settings file, and the
// links between the two tools. The shared parts are tested through the Map Generation Tool's tests.
const { chromium } = require("./pw.js");
const { openPage, chooseCountry, searchEnded } = require("./helpers.js");
const { UNOFFICIAL } = require("./site.js");
const path = require("path");
(async () => {
  const b = await chromium.launch();
  let fail = 0;
  const ok = (c, m) => {
    console.log((c ? "PASS " : "FAIL ") + m);
    if (!c) fail++;
  };
  const allErrors = [];
  const open = async (context = null) => {
    const o = await openPage(b, "ok", context, UNOFFICIAL);
    allErrors.push(o.errors);
    return o.page;
  };
  const exported = p => p.evaluate(() => JSON.parse(exportJson()));
  /* Chooses countries (names) and starts a search for `target` locations. */
  const searchIn = async (p, countries, target) => {
    await p.check("input[name=scope][value=countries]");
    await p.evaluate(() => {
      chosenCountries = [];
      whereChanged();
    });
    for (const name of countries) await chooseCountry(p, name);
    await p.fill("#target", String(target));
    await p.fill("#apiKey", "TESTKEY");
    await p.click("#go");
  };
  /* Google's answers: an unofficial panorama right at the spot, by `uploader`, unless `official` says the
     nth answer is Google's own; `extra` adds to every answer (height, width, …). */
  const answer = (p, { uploader = "Jane Doe", official = () => false, extra = {} } = {}) =>
    p.evaluate(
      ({ uploader, official, extra }) => {
        let n = 0;
        const isOfficialAnswer = new Function("n", "return (" + official + ")(n)");
        window.__sv = req => {
          const i = n++;
          return {
            id: "CAoSLEFGMVFpcE" + i,
            lat: req.location.lat,
            lng: req.location.lng,
            copyright: isOfficialAnswer(i) ? "© 2024 Google" : `© 2023 ${uploader}`,
            links: [],
            carHeading: 42,
            ...extra,
          };
        };
      },
      { uploader, official: String(official), extra },
    );

  // 1. The page: its own title, every country and territory, no Vali maps, the link to the other tool
  let p = await open();
  ok((await p.textContent("h1")) === "Unofficial", "the page is Unofficial");
  ok(
    (await p.getAttribute(".other-tool a", "href")) === "../" &&
      /Map Generation Tool/.test(await p.textContent(".other-tool")),
    "links to the Map Generation Tool",
  );
  const facts = await p.evaluate(() => ({
    n: COUNTRIES.length,
    hasAQ: COUNTRIES.includes("AQ"),
    hasBY: COUNTRIES.includes("BY"),
    options: [...$("distribution").options].map(o => o.value),
    continents: [...$("continent").options].map(o => o.value),
    ru: COUNTRY_FACTS.RU.area,
    people: {
      CN: COUNTRY_FACTS.CN.population,
      MT: COUNTRY_FACTS.MT.population,
      BV: COUNTRY_FACTS.BV.population,
    },
    mc: COUNTRY_FACTS.MC.area,
    gf: COUNTRY_FACTS.GF,
  }));
  ok(facts.n > 240 && facts.hasAQ && facts.hasBY, "every country and territory, Antarctica and Belarus too");
  ok(
    facts.options.join() === "land,population,density,equal",
    "the built-in distributions: land area, population, population density, equal shares",
  );
  ok(
    facts.continents.join() === "africa,americas,antarctica,asia,europe,oceania",
    "the continents: " + facts.continents,
  );
  ok(
    facts.ru > 15e6 * 0.9 && facts.ru < 17e6 * 1.1 && facts.mc >= 1 && facts.mc < 50,
    `land areas: Russia ${facts.ru} km², Monaco ${facts.mc} km²`,
  );
  ok(facts.gf.parent === "FR" && facts.gf.continent === "americas", "French Guiana belongs to France");
  ok(
    facts.people.CN > 1.3e9 && facts.people.MT > 4e5 && facts.people.MT < 7e5 && facts.people.BV === 0,
    "populations: " + JSON.stringify(facts.people),
  );
  // the same security policy as the Map Generation Tool (built the same way, see tests/security.js)
  const html = require("fs").readFileSync(
    path.join(__dirname, "../dist/unofficial/index.nokey.html"),
    "utf8",
  );
  const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1] || "";
  ok(
    /script-src 'sha256-[^']+' 'sha256-[^']+' 'sha256-[^']+' https:\/\/maps\.googleapis\.com/.test(csp) &&
      /connect-src https:\/\/maps\.googleapis\.com;/.test(csp) &&
      !/\son[a-z]+="/i.test(html) &&
      !/\/\*[A-Z][A-Z_]*\*\//.test(html.replace(/<script>[\s\S]*?<\/script>/g, "")),
    "the page has the security policy, no inline event handlers and no placeholders left",
  );

  // 2. Distributions: by land area, Russia gets far more than Malta; equal shares are equal
  await p.evaluate(() => {
    chosenCountries = ["RU", "MT"];
    whereChanged();
  });
  await p.fill("#target", "1000");
  await p.dispatchEvent("#target", "change");
  let plan = await p.evaluate(() => planTargets());
  ok(plan.RU > 990 && (plan.MT || 0) <= 1, "land area: Russia gets nearly all: " + JSON.stringify(plan));
  await p.selectOption("#distribution", "equal");
  plan = await p.evaluate(() => planTargets());
  ok(plan.RU === 500 && plan.MT === 500, "equal shares: " + JSON.stringify(plan));
  ok(/equal shares/.test(await p.getAttribute("#mapName", "placeholder")), "the map name says equal shares");
  // By population, Russia (about 145 million) and Malta (about half a million); by density, Malta
  // (over 1,000 people per km²) far more than Russia (under 10)
  await p.selectOption("#distribution", "population");
  plan = await p.evaluate(() => planTargets());
  ok(plan.RU > 990 && (plan.MT || 0) <= 5, "population: " + JSON.stringify(plan));
  await p.selectOption("#distribution", "density");
  plan = await p.evaluate(() => planTargets());
  ok(plan.MT > 950 && plan.RU < 50, "population density: " + JSON.stringify(plan));
  ok(/population density/.test(await p.getAttribute("#mapName", "placeholder")), "the map name says so");
  // A place where nobody lives gets nothing by population, and the table says why
  await p.evaluate(() => {
    chosenCountries = ["MT", "BV"];
    whereChanged();
  });
  plan = await p.evaluate(() => planTargets());
  ok(plan.MT === 1000 && !plan.BV, "Bouvet Island, where nobody lives, gets none");
  ok(
    /Not in the population figures, so they get none: Bouvet Island/.test(await p.textContent("#sharesNote")),
    "the table says why: " + (await p.textContent("#sharesNote")),
  );
  await p.selectOption("#distribution", "land");
  // The whole world leaves out Antarctica; the continent Antarctica is just it
  await p.check("input[name=scope][value=world]");
  plan = await p.evaluate(() => planTargets());
  ok(!plan.AQ && plan.RU > plan.DE && Object.keys(plan).length > 100, "the world leaves out Antarctica");
  await p.check("input[name=scope][value=continent]");
  await p.selectOption("#continent", "antarctica");
  plan = await p.evaluate(() => planTargets());
  ok(Object.keys(plan).join() === "AQ" && plan.AQ === 1000, "the continent Antarctica");
  await p.selectOption("#continent", "europe");
  plan = await p.evaluate(() => planTargets());
  ok(plan.RU > 0 && plan.FR > 0 && !plan.US, "Europe has Russia and France, not the US");

  // 3. A search: any panorama is asked for, and only unofficial ones are kept
  await answer(p, { official: n => n % 2 === 0 });
  await searchIn(p, ["Malta"], 6);
  await searchEnded(p);
  let r = await exported(p);
  const req = await p.evaluate(() => window.__requests[0]);
  ok(
    req.sources.join() === "default" && req.preference === "nearest",
    "asks Google for the nearest panorama of any kind: " + JSON.stringify(req.sources),
  );
  ok(r.customCoordinates.length === 6, "finds the number asked for: " + r.customCoordinates.length);
  ok(
    r.customCoordinates.every(c => /^CAoSLEFGMVFpcE\d*[13579]$/.test(c.panoId)),
    "only unofficial panoramas are kept",
  );
  ok(
    /official coverage instead/.test(await p.textContent("#tally")) &&
      (await p.evaluate(() => stats.official)) >= 6,
    "counts the spots where Google answered with its own coverage",
  );
  ok(
    r.customCoordinates.every(c => c.heading === 42),
    "the camera faces the photo's centre by default (centerHeading)",
  );
  // the uploader: in the popup facts and as a tag
  ok(
    (await p.evaluate(() => results[0].uploader)) === "Jane Doe",
    "keeps the uploader's name, without © and the year",
  );
  await p.check("#tagUploader");
  r = await exported(p);
  ok(
    r.customCoordinates[0].extra.tags.join() === "Malta,Jane Doe",
    "the uploader tag: " + r.customCoordinates[0].extra.tags,
  );

  // 4. Filters: whole 360° only, image size, uploaders
  await answer(p, { extra: { height: 3000, width: 5000 } });
  await p.check("#full360");
  await searchIn(p, ["Malta"], 3);
  await searchEnded(p);
  ok((await p.evaluate(() => results.length)) === 0, "whole 360° only leaves out a 5000 × 3000 photo");
  await p.click("#stop").catch(() => {});
  await answer(p, { extra: { height: 3000, width: 6000 } });
  await searchIn(p, ["Malta"], 3);
  await searchEnded(p);
  ok((await p.evaluate(() => results.length)) === 3, "whole 360° only keeps a 6000 × 3000 photo");
  await p.selectOption("#minHeight", "4000");
  await p.fill("#giveUpAfter", "50");
  await p.dispatchEvent("#giveUpAfter", "change");
  await searchIn(p, ["Malta"], 3);
  await searchEnded(p);
  ok((await p.evaluate(() => results.length)) === 0, "the image size leaves out a photo 3,000 pixels high");
  await p.selectOption("#minHeight", "0");
  await p.uncheck("#full360");
  await answer(p, { uploader: "Prolific Pete" });
  await p.check("#uploadersExclude");
  await p.fill("#uploaderNames", "someone, prolific pete");
  await searchIn(p, ["Malta"], 3);
  await searchEnded(p);
  ok((await p.evaluate(() => results.length)) === 0, "leaves out an uploader, whatever the case");
  ok(
    /Not by someone and prolific pete/.test(await p.textContent("#sumUploaders")),
    "the Uploaders section says so: " + (await p.textContent("#sumUploaders")),
  );
  await p.check("#uploadersOnly");
  await searchIn(p, ["Malta"], 3);
  await searchEnded(p);
  ok((await p.evaluate(() => results.length)) === 3, "keeps only the uploaders named");
  await p.check("#uploadersAny");
  ok(await p.isDisabled("#uploaderNames"), "the names are greyed out for anyone's photos");

  // 5. Its own saved settings, history and settings file
  // (tests/pw.js puts mapgen.welcomed and mapgen.openSections there for both tools)
  const saved = (await p.evaluate(() => Object.keys(localStorage).sort())).filter(
    k => !["mapgen.welcomed", "mapgen.openSections"].includes(k),
  );
  ok(
    saved.every(k => k.startsWith("unofficial.")) && saved.includes("unofficial.uploaderMode"),
    "settings are saved as unofficial.…, never mapgen.…: " + saved.filter(k => !k.startsWith("unofficial.")),
  );
  const file = await p.evaluate(() => JSON.parse(settingsFileText()));
  ok(
    file.format === "unofficial settings" && "full360" in file.settings && !("noRoadName" in file.settings),
    "its settings file has its own format and settings",
  );
  const other = await p.evaluate(() =>
    readSettingsFile(JSON.stringify({ format: "map-generation-tool settings", version: 1, settings: {} })),
  );
  ok(
    /Map Generation Tool, the other tool/.test(other.error),
    "a settings file of the other tool: " + other.error,
  );
  const back = await p.evaluate(() =>
    readSettingsFile(
      JSON.stringify({
        format: "unofficial settings",
        version: 1,
        settings: {
          scope: "countries",
          countries: ["AQ", "XX"],
          uploaderMode: "only",
          uploaderNames: "A, B",
        },
      }),
    ),
  );
  ok(
    back.settings.countries.join() === "AQ" &&
      back.settings.uploaderMode === "only" &&
      back.settings.uploaderNames === "A, B",
    "loads its own settings, Antarctica too",
  );
  ok((await p.evaluate(() => loadHistory().length)) >= 5, "keeps a history of its searches");

  // 6. The Map Generation Tool links here
  const m = (await openPage(b)).page;
  ok((await m.getAttribute(".other-tool a", "href")) === "unofficial/", "the Map Generation Tool links here");
  const mapgenOther = await m.evaluate(() =>
    readSettingsFile(JSON.stringify({ format: "unofficial settings", version: 1, settings: {} })),
  );
  ok(/Unofficial, the other tool/.test(mapgenOther.error), "and names Unofficial for its settings files");
  await m.close();

  // 7. A screenshot of the page with the sections open
  await p.screenshot({ path: path.join(__dirname, "../dist/screens/unofficial.png"), fullPage: true });

  const errors = allErrors.flat();
  ok(errors.length === 0, "no page errors " + errors.join(" | "));
  await b.close();
  console.log(fail ? `${fail} FAILED` : "ALL PASS");
  process.exitCode = fail ? 1 : 0;
})();
