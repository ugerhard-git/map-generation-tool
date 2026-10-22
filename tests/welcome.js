// The first-visit dialog: shown once per browser, closed by the button, the x, Escape or a click
// outside, reopened by "How it works"; it keeps the keyboard inside while open and gives the focus back.
const { chromium } = require("playwright");
const { PAGE, isSite, serveSite } = require("./site.js");
(async () => {
  const b = await chromium.launch();
  let fail = 0;
  const ok = (c, m) => {
    console.log((c ? "PASS " : "FAIL ") + m);
    if (!c) fail++;
  };
  const p = await b.newPage({ viewport: { width: 1360, height: 860 } });
  const errs = [];
  p.on("pageerror", e => errs.push(String(e)));
  await p.route("**/*", r =>
    isSite(r.request().url()) ? serveSite(r) : r.fulfill({ status: 204, body: "" }),
  );
  await p.goto(PAGE);
  ok(
    (await p.isVisible("#welcome")) && (await p.evaluate(() => document.activeElement.id === "welcomeBox")),
    "shown on the first visit, focus inside",
  );
  await p.screenshot({ path: require("path").join(__dirname, "../dist/screens/welcome.png") });
  await p.click("#welcomeBox h2");
  ok(await p.isVisible("#welcome"), "a click inside the box does not close it");
  await p.mouse.click(20, 20);
  ok(await p.isHidden("#welcome"), "a click outside the box closes it");
  await p.reload();
  ok(await p.isHidden("#welcome"), "not shown again after a reload");

  await p.click("#howBtn");
  ok(await p.isVisible("#welcome"), '"How it works" opens it again');
  for (let i = 0; i < 4; i++) await p.keyboard.press("Tab");
  ok(
    await p.evaluate(() => document.getElementById("welcomeBox").contains(document.activeElement)),
    "Tab keeps the keyboard inside the dialog",
  );
  await p.keyboard.press("Escape");
  ok(
    (await p.isHidden("#welcome")) && (await p.evaluate(() => document.activeElement.id === "howBtn")),
    "Escape closes it and the focus goes back to the button",
  );
  await p.click("#howBtn");
  await p.click("#welcomeX");
  ok(await p.isHidden("#welcome"), "the x closes it");
  await p.click("#howBtn");
  await p.click("#welcomeOk");
  ok(await p.isHidden("#welcome"), '"Start" closes it');
  ok(errs.length === 0, "no page errors " + errs.join(" | "));
  await b.close();
  console.log(fail ? `${fail} FAILED` : "ALL PASS");
})();
