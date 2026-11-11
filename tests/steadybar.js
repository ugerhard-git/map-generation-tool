// The bar under the map stays steady while a search runs: digits of one width, and each counter's number
// keeps the room it has needed, so the counters and the buttons do not jump left and right, or wrap to
// another line and back, as the numbers grow.
const { chromium } = require("./pw.js");
const { openPage, search } = require("./helpers.js");
(async () => {
  const b = await chromium.launch();
  let fail = 0;
  const ok = (c, m) => {
    console.log((c ? "PASS " : "FAIL ") + m);
    if (!c) fail++;
  };
  const { page: p, errors } = await openPage(b);
  const widths = await p.evaluate(() => {
    const s = document.createElement("span");
    document.querySelector(".bar").append(s);
    const w = t => ((s.textContent = t), s.getBoundingClientRect().width);
    const r = [w("1111"), w("8888")];
    s.remove();
    return r;
  });
  ok(widths[0] === widths[1], "digits of one width in the bar: " + widths.join(" = "));

  // Most spots find nothing, some a panorama without a road name: the counters grow at different paces
  await p.evaluate(() => {
    let n = 0;
    window.__svDelay = 2;
    window.__sv = req => {
      const i = n++;
      if (i % 10 < 7) return null;
      return {
        id: "STEADY" + i,
        lat: req.location.lat,
        lng: req.location.lng,
        links: [{ heading: 0, description: i % 10 === 7 ? "" : "Main St" }],
      };
    };
  });
  await search(p, { country: "Malta", target: 2000, noRoadName: true });
  const r = await p.evaluate(async () => {
    let moves = 0,
      shrank = 0,
      prev = null;
    const t0 = Date.now();
    while (running && Date.now() - t0 < 8000) {
      await new Promise(res => setTimeout(res, 50));
      const spans = [...document.querySelectorAll("#tally span")];
      const now = {
        labels: spans.map(s => s.textContent.replace(/[\d,:]/g, "")).join("|"),
        left: spans.map(s => Math.round(s.getBoundingClientRect().left)),
        top: spans.map(s => Math.round(s.getBoundingClientRect().top)),
        button: Math.round(document.getElementById("download").getBoundingClientRect().left),
        room: spans.map(s => parseFloat(s.querySelector("b").style.minWidth)),
      };
      // (only while the same counters are shown: a new counter makes room for itself once)
      if (prev && prev.labels === now.labels) {
        now.left.forEach((x, i) => (moves += x !== prev.left[i] || now.top[i] !== prev.top[i] ? 1 : 0));
        if (now.button !== prev.button) moves++;
        now.room.forEach((w, i) => (shrank += w < prev.room[i] ? 1 : 0));
      }
      prev = now;
    }
    stopRequested = true;
    return { moves, shrank };
  });
  // (a counter moves once when another one before it gets a digit more: 9 → 10, 99 → 100, …)
  ok(r.moves <= 6, "the counters and buttons hardly move: " + r.moves + " moves in 8 seconds");
  ok(r.shrank === 0, "the room for a number never shrinks during a search");

  ok(errors.length === 0, "no page errors " + errors.join(" | "));
  await b.close();
  console.log(fail ? `${fail} FAILED` : "ALL PASS");
})();
