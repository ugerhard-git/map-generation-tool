// Security checks that are not tied to one feature: the content security policy, a self-contained page
// without keys, framing, and stored values that have been tampered with.
const { chromium } = require("./pw.js");
const { SITE, PAGE, isSite, serveSite, SPLIT, DIST } = require("./site.js");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const { assemble } = require("../src/assemble.js");
const page = path.join(DIST, "index.nokey.html");
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
    !/unsafe-inline|unsafe-eval|\*\.googleapis\.com|https:(\s|$)|\*(\s|$)/.test(script) &&
      (SPLIT
        ? script.trim() === "'self' https://maps.googleapis.com https://*.gstatic.com"
        : !/'self'/.test(script)),
    (SPLIT
      ? "scripts: only from this server and Google's own script hosts: "
      : "scripts: only fingerprinted inline code and Google's own script hosts: ") +
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
    /connect-src 'self' https:\/\/maps\.googleapis\.com(;|$)/.test(csp),
    "the page may only talk to Google's Street View service, and fetch the settlement map from its own site",
  );
  ok(
    !/https?:\/\/(cdnjs|unpkg|cdn\.jsdelivr|fonts\.googleapis)/.test(html),
    "no libraries or fonts from CDNs",
  );
  ok(
    !/\/\*(APP_CSS|APP_JS|VALI|LEAFLET_JS|COUNTRY_CODER_JS|LEAFLET_CSS|FONT_CSS|CSP|ICON_SVG|ICON_PNG|ICON_TOUCH)\*\//.test(
      html,
    ),
    "every build placeholder filled in",
  );
  if (!SPLIT) {
    ok(
      !/<script[^>]+src=|<link[^>]+stylesheet/i.test(html) &&
        html.includes(assemble(path.resolve(__dirname, "../src/app.js")).code.trim()) &&
        html.includes(assemble(path.resolve(__dirname, "../src/style.css")).code.trim()),
      "one self-contained file with the app code and styles inside",
    );
    ok(
      /window\.countryCoder|globalThis\.countryCoder/.test(html) && !/sourceMappingURL/.test(html),
      "country lookup library built into the page, without links to outside files",
    );
  } else {
    // The split build: no code inside the page; every script and style sheet is a file under assets/
    // with its fingerprint, which the browser checks before using it
    const tags = [...html.matchAll(/<(?:script|link)[^>]+(?:src|href)="([^"]+)"[^>]*>/g)].filter(m =>
      /\.(js|css)"/.test(m[0]),
    );
    const files = tags.map(([tag, href]) => {
      const file = path.join(DIST, href);
      const integrity = /integrity="([^"]+)"/.exec(tag)?.[1];
      const want =
        fs.existsSync(file) &&
        "sha384-" + crypto.createHash("sha384").update(fs.readFileSync(file)).digest("base64");
      return { href, ok: !!integrity && integrity === want };
    });
    ok(
      files.length >= 5 && files.every(f => f.ok && f.href.startsWith("assets/")),
      "every script and style sheet is a file under assets/ with its fingerprint: " +
        files.map(f => f.href + (f.ok ? "" : " (fingerprint wrong)")).join(", "),
    );
    ok(
      !/<script>|<script\s+(?!type="application\/json")[^>]*>[^<]/.test(html) && !/<style>/.test(html),
      "no code or styles left inside the page",
    );
    const other = fs.readFileSync(path.join(DIST, "unofficial", "index.nokey.html"), "utf8");
    const shared = ["leaflet", "country-coder", "land", "shared"].every(
      n =>
        new RegExp(`"assets/${n}\\.[0-9a-f]+\\.(js|css)"`).test(html) &&
        new RegExp(`"\\.\\./assets/${n}\\.[0-9a-f]+\\.(js|css)"`).test(other) &&
        html.match(new RegExp(`assets/${n}\\.[0-9a-f]+`))[0] ===
          other.match(new RegExp(`assets/${n}\\.[0-9a-f]+`))[0],
    );
    ok(
      shared,
      "both tools load the same files for Leaflet, country-coder, the land map and the shared styles",
    );
  }
  ok(!/AIza[0-9A-Za-z_-]{35}/.test(html.replace("AIza…", "")), "no Google key in the key-less build");
  // Nothing shaped like a Google key in the repository's own files either (tests included: a made-up
  // key in a test is flagged by GitHub's secret scanning just like a real one)
  const keyShaped = [];
  const walk = dir => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if ([".git", "node_modules", "dist"].includes(e.name)) continue;
      const f = path.join(dir, e.name);
      if (e.isDirectory()) walk(f);
      else if (
        /\.(js|mjs|html|css|md|json|yml|yaml|svg)$/.test(e.name) &&
        /AIza[0-9A-Za-z_-]{35}/.test(fs.readFileSync(f, "utf8"))
      )
        keyShaped.push(path.relative(path.join(__dirname, ".."), f));
    }
  };
  walk(path.join(__dirname, ".."));
  ok(
    keyShaped.length === 0,
    "nothing shaped like a Google key in the repository" + (keyShaped.length ? ": " + keyShaped : ""),
  );

  // framed by another page: the app does not run, a link opens it on its own
  const outer = path.join(DIST, "frame-test.html");
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

  if (SPLIT) {
    // A script file changed on the server (or on the way) does not run: its fingerprint no longer matches
    const tctx = await b.newContext();
    const t = await tctx.newPage();
    const blocked = [];
    t.on("console", m => /integrity|digest/i.test(m.text()) && blocked.push(m.text()));
    await t.route("**/*", async r => {
      const url = r.request().url();
      if (!isSite(url)) return r.fulfill({ status: 204, body: "" });
      if (/assets\/mapgen\.[0-9a-f]+\.js$/.test(url))
        return r.fulfill({ contentType: "text/javascript", body: "window.__tampered = true;" });
      return serveSite(r);
    });
    await t.goto(PAGE);
    await t.waitForTimeout(800);
    ok(
      (await t.evaluate(() => !window.__tampered && typeof searchTargets === "undefined")) &&
        blocked.length > 0,
      "a changed script file is refused: " + (blocked[0] || "nothing refused").slice(0, 120),
    );
    await tctx.close();
  }

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
    localStorage.setItem("mapgen.giveUpAfter", JSON.stringify(-1));
  });
  await p.reload();
  await p.waitForTimeout(300);
  const t = await p.evaluate(() => ({
    radius: radius(),
    target: target(),
    name: document.getElementById("mapName").value,
    country: document.getElementById("country").value,
    wanted: wanted(),
    chosen: chosenCountries.join(),
    tagCountry: document.getElementById("tagCountry").checked,
    tagYear: document.getElementById("tagYear").checked,
    yearFrom: document.getElementById("yearFrom").value,
    yearTo: document.getElementById("yearTo").value,
    giveUpAfter: giveUpAfter(),
  }));
  ok(
    t.radius === 1000 &&
      t.target === 300 &&
      t.name === "" &&
      t.country === "" &&
      t.chosen === "" &&
      t.tagCountry &&
      !t.tagYear &&
      t.yearFrom === "2007" &&
      t.giveUpAfter === 2000 &&
      t.yearTo === "now" &&
      !t.wanted.noRoadName &&
      t.wanted.arrows === "any",
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
