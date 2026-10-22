// Layout and page icon: the headline "Map Generation Tool" stays on one line from wide windows down to
// small phones, and the page carries the tool's own icon (src/icon.svg) in all three sizes.
const { chromium } = require("./pw.js");
const { openPage } = require("./helpers.js");
const fs = require("fs"),
  path = require("path");
(async () => {
  const b = await chromium.launch();
  let fail = 0;
  const ok = (c, m) => {
    console.log((c ? "PASS " : "FAIL ") + m);
    if (!c) fail++;
  };
  const { page: p, errors } = await openPage(b);
  // 1360 and 1100: the widest and a medium panel; 900: the narrowest panel (340 px); 375 and 320: phones
  for (const width of [1360, 1100, 900, 375, 320]) {
    await p.setViewportSize({ width, height: 860 });
    const h = await p.evaluate(() => {
      const el = document.querySelector("h1");
      return { height: el.getBoundingClientRect().height, size: parseFloat(getComputedStyle(el).fontSize) };
    });
    ok(
      h.height < h.size * 1.5,
      `${width} px wide: the headline is one line (${h.height.toFixed(0)} px high, ${h.size.toFixed(0)} px type)`,
    );
  }
  await p.setViewportSize({ width: 1360, height: 860 });
  await p.screenshot({
    path: path.join(__dirname, "../dist/screens/headline.png"),
    clip: { x: 0, y: 0, width: 420, height: 160 },
  });

  // The icon: the tool's own, not Lookout's
  const icons = await p.evaluate(() =>
    [...document.querySelectorAll("link[rel~=icon], link[rel=apple-touch-icon]")].map(l =>
      l.getAttribute("href"),
    ),
  );
  const svg = icons.find(h => h.startsWith("data:image/svg+xml;base64,"));
  ok(
    icons.length === 3 &&
      svg &&
      Buffer.from(svg.split(",")[1], "base64").toString() ===
        fs.readFileSync(path.join(__dirname, "../src/icon.svg"), "utf8"),
    "the page has src/icon.svg and the two PNG sizes",
  );
  ok(
    !/Lookout/.test(fs.readFileSync(path.join(__dirname, "../src/icon.svg"), "utf8")),
    "the icon is the tool's own",
  );

  ok(errors.length === 0, "no page errors " + errors.join(" | "));
  await b.close();
  console.log(fail ? `${fail} FAILED` : "ALL PASS");
})();
