// Security checks that are not tied to one feature: the content security policy, a self-contained page
// without keys, framing, and stored values that have been tampered with.
const { chromium } = require("./pw.js");
const { SITE, PAGE, isSite, serveSite } = require("./site.js");
const path = require("path");
const fs = require("fs");
const page = path.resolve(__dirname, "../dist/index.nokey.html");
(async () => {
  const b = await chromium.launch();
  let fail = 0;
  const ok = (c, m) => {
    console.log((c ? "PASS " : "FAIL ") + m);
    if (!c) fail++;
  };
  const html = fs.readFileSync(page, "utf8");
  const csp = /http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(html)[1];
  const script = /script-src ([^;]*)/.exec(csp)[1];
  ok(
    !/unsafe-inline|unsafe-eval|\*\.googleapis\.com|https:(\s|$)|\*(\s|$)/.test(script),
    "scripts: only fingerprinted inline code and Google's own script hosts: " +
      script.replace(/'sha256-[^']*'/g, "sha"),
  );
  ok(
    /default-src 'none'/.test(csp) &&
      /object-src 'none'/.test(csp) &&
      /base-uri 'none'/.test(csp) &&
      /form-action 'none'/.test(csp),
    "default, plugins, base address and form targets locked down",
  );
  ok(
    /connect-src https:\/\/maps\.googleapis\.com(;|$)/.test(csp),
    "the page may only talk to Google's Street View service",
  );
  ok(
    !/https?:\/\/(cdnjs|unpkg|cdn\.jsdelivr|fonts\.googleapis)/.test(html),
    "no libraries or fonts from CDNs",
  );
  ok(
    !/\/\*(APP_CSS|APP_JS|LEAFLET_JS|COUNTRY_CODER_JS|LEAFLET_CSS|FONT_CSS|CSP|ICON_SVG|ICON_PNG|ICON_TOUCH)\*\//.test(
      html,
    ),
    "every build placeholder filled in",
  );
  ok(
    !/<script[^>]+src=|<link[^>]+stylesheet/i.test(html) &&
      html.includes(fs.readFileSync(path.resolve(__dirname, "../src/app.js"), "utf8").trim()) &&
      html.includes(fs.readFileSync(path.resolve(__dirname, "../src/style.css"), "utf8").trim()),
    "one self-contained file with the app code and styles inside",
  );
  ok(
    /window\.countryCoder|globalThis\.countryCoder/.test(html) && !/sourceMappingURL/.test(html),
    "country lookup library built into the page, without links to outside files",
  );
  ok(!/AIza[0-9A-Za-z_-]{35}/.test(html.replace("AIza…", "")), "no Google key in the key-less build");

  // framed by another page: the app does not run, a link opens it on its own
  const outer = path.resolve(__dirname, "../dist/frame-test.html");
  fs.writeFileSync(
    outer,
    `<!doctype html><title>outer</title><iframe id="f" src="index.nokey.html" style="width:900px;height:600px"></iframe>`,
  );
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", e => errs.push(String(e)));
  p.on("console", m => {
    if (/Content Security/.test(m.text())) errs.push(m.text());
  });
  await p.route("**/*", r =>
    isSite(r.request().url()) ? serveSite(r) : r.fulfill({ status: 204, body: "" }),
  );
  await p.goto(SITE + "frame-test.html");
  await p.waitForTimeout(800);
  const f = p.frames().find(x => x.url().includes("index.nokey.html"));
  const st = await f.evaluate(() => ({
    app: !document.querySelector(".app").hidden,
    framed: !document.getElementById("framed").hidden,
    welcome: !document.getElementById("welcome").hidden,
    link: document.getElementById("framedLink").getAttribute("href"),
    target: document.getElementById("framedLink").target,
  }));
  ok(
    !st.app && st.framed && !st.welcome && st.target === "_top" && /index\.nokey\.html$/.test(st.link),
    "inside a frame: app hidden, link to open it on its own: " + JSON.stringify(st),
  );
  await p.goto(PAGE);
  ok((await p.isVisible(".app")) && (await p.isHidden("#framed")), "opened directly: app shown");

  // tampered stored values do not break the page
  await p.evaluate(() => {
    localStorage.setItem("mapgen.radius", JSON.stringify("__proto__"));
    localStorage.setItem("mapgen.mapName", JSON.stringify({ toString: "<img src=x>" }));
    localStorage.setItem("mapgen.country", JSON.stringify("<b>"));
    localStorage.setItem("mapgen.target", JSON.stringify(1e9));
    localStorage.setItem("mapgen.noRoadName", JSON.stringify("yes"));
    localStorage.setItem("mapgen.deadEnd", "{");
    localStorage.setItem("mapgen.tagCountry", JSON.stringify("no"));
    localStorage.setItem("mapgen.tagYear", JSON.stringify(1));
    localStorage.setItem("mapgen.yearFrom", JSON.stringify("<b>"));
    localStorage.setItem("mapgen.yearTo", JSON.stringify(3000));
  });
  await p.reload();
  await p.waitForTimeout(300);
  const t = await p.evaluate(() => ({
    radius: radius(),
    target: target(),
    name: document.getElementById("mapName").value,
    country: document.getElementById("country").value,
    wanted: wanted(),
    chosen: chosenCountry,
    tagCountry: document.getElementById("tagCountry").checked,
    tagYear: document.getElementById("tagYear").checked,
    yearFrom: document.getElementById("yearFrom").value,
    yearTo: document.getElementById("yearTo").value,
  }));
  ok(
    t.radius === 1000 &&
      t.target === 100 &&
      t.name === "" &&
      t.country === "" &&
      t.chosen === "" &&
      t.tagCountry &&
      !t.tagYear &&
      t.yearFrom === "2009" &&
      t.yearTo === String(new Date().getFullYear()) &&
      !t.wanted.noRoadName &&
      !t.wanted.deadEnd,
    "tampered settings fall back to defaults: " + JSON.stringify(t),
  );
  await p.evaluate(() => localStorage.setItem("mapgen.radius", "99999"));
  await p.reload();
  ok((await p.evaluate(() => radius())) === 1000, "a radius out of range falls back to the default");
  ok(errs.length === 0, "no page errors or blocked scripts " + errs.join(" | "));
  fs.unlinkSync(outer);
  await b.close();
  console.log(fail ? `${fail} FAILED` : "ALL PASS");
})();
