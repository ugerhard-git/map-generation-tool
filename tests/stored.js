// Hostile values saved in the browser or loaded from a settings file: your own distribution, its
// presets, the camera view, the open sections and the history. Anyone (another program, a browser add-on,
// a shared settings file) can put anything there, so every value is checked when read back: names with
// markup are shown only as text, "__proto__"-style names change nothing, numbers out of range get their
// defaults, and names that are not countries cannot crowd out real shares.
const { chromium } = require("./pw.js");
const { openPage } = require("./helpers.js");
(async () => {
  const b = await chromium.launch();
  let fail = 0;
  const ok = (c, m) => {
    console.log((c ? "PASS " : "FAIL ") + m);
    if (!c) fail++;
  };
  // the same keys and values, in any order
  const same = (a, b) =>
    Object.keys(a).length === Object.keys(b).length && Object.entries(b).every(([k, v]) => a[k] === v);
  const bad = '"><img src=x onerror="window.__x=1">';
  const ctx = await b.newContext({ viewport: { width: 1360, height: 860 } });
  await ctx.addInitScript(bad => {
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    const put = (k, v) => localStorage.setItem("mapgen." + k, typeof v === "string" ? v : JSON.stringify(v));
    put(
      "own",
      '{"mode":"number","values":{"MT":1e300,"LU":"5","GI":-4,"__proto__":{"polluted":1},"constructor":9},"name":' +
        JSON.stringify(bad) +
        "}",
    );
    put("presets", [
      { id: "abcd", name: bad, mode: "percent", values: { MT: 50 } },
      { id: "abcd", name: "the same id again", values: { MT: 1 } },
      { id: "<b>", name: "a bad id", values: { MT: 1 } },
      { id: "efgh", name: "", values: { MT: 1 } },
      null,
      5,
    ]);
    put("distribution", "preset:abcd");
    put("openSections", ["__proto__", "toString", "moreDistribution"]);
    put("viewDirection", "constructor");
    put("carAngle", "1e999");
    put("tiltMin", { valueOf: 1 });
    put("history", [
      {
        at: 1,
        title: bad,
        settings: {
          scope: "countries",
          countries: ["MT", "LU"],
          distribution: "own",
          own: { values: { MT: 10 }, name: bad },
        },
      },
    ]);
  }, bad);
  const { page: p, errors } = await openPage(b, "ok", ctx);
  const hostileShown = () =>
    p.evaluate(() => ({ ran: window.__x, imgs: document.querySelectorAll("img[src=x]").length }));

  const r = await p.evaluate(() => ({
    own,
    presets: loadPresets().map(x => x.id),
    names: [...document.querySelectorAll("#distribution option")].slice(0, 2).map(o => o.textContent),
    view: viewSettings(),
    open: [...document.querySelectorAll("details.more[open]")].map(d => d.id).join(),
    polluted: {}.polluted,
  }));
  ok(
    r.own.mode === "number" && same(r.own.values, { MT: 130000, LU: 5 }),
    "your own distribution: shares kept in range, nonsense and prototype names dropped: " +
      JSON.stringify(r.own.values),
  );
  ok(r.presets.join() === "abcd", "presets with a repeated id, a bad id, no name or no shape are dropped");
  ok(
    r.names[1] === bad && (await hostileShown()).imgs === 0,
    "names with markup appear in the list as text only",
  );
  ok(
    r.view.direction === "road" && r.view.carAngle === 0 && r.view.tiltMin === -20,
    "camera view values that are not well-formed get their defaults",
  );
  ok(r.open === "moreDistribution", "only real sections are opened");
  ok(r.polluted === undefined, "nothing leaks into other objects");

  // The history shows the hostile title and name as text
  await p.click("#historyBtn");
  ok(
    (await p.textContent("#historyList")).includes(bad) && (await hostileShown()).imgs === 0,
    "the history shows a title with markup as text",
  );
  await p.click("#historyX");

  // A settings file whose own distribution starts with thousands of names that are not countries
  const values = Object.fromEntries(Array.from({ length: 5000 }, (_, i) => ["K" + i, 1]));
  Object.assign(values, { MT: 70, LU: 30, toString: 5 });
  const f = await p.evaluate(
    values =>
      readSettingsFile(
        JSON.stringify({
          format: "map-generation-tool settings",
          version: 1,
          settings: {
            distribution: "own",
            own: { mode: "__proto__", values, name: "<b>x</b>".repeat(20) },
            viewDirection: "random",
            dirFrom: "45abc",
            dirTo: 1e9,
            tiltMax: "NaN",
          },
        }),
      ),
    values,
  );
  ok(
    f.settings.distribution === "own" &&
      f.settings.own.mode === "percent" &&
      same(f.settings.own.values, { MT: 70, LU: 30 }) &&
      f.settings.own.name.length <= 40,
    "a settings file: the real shares are kept, however many other names come first: " +
      JSON.stringify(f.settings.own),
  );
  ok(
    f.settings.dirFrom === 0 && f.settings.dirTo === 360 && f.settings.tiltMax === 20,
    "and camera view values out of range get their defaults",
  );
  const hostile = await hostileShown();
  ok(!hostile.ran && hostile.imgs === 0, "nothing ran");

  ok(errors.length === 0, "no page errors " + errors.join(" | "));
  await b.close();
  console.log(fail ? `${fail} FAILED` : "ALL PASS");
})();
