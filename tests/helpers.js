// Small helpers shared by the test files: opening the page with Google's script simulated.
const { PAGE, isSite, serveSite } = require("./site.js");

/** A stand-in for Google's Maps JavaScript API. Each getPanorama request is answered by the page's
 *  window.__sv(request), which a test sets with page.evaluate: it returns null (nothing found), an
 *  object with a `status` (an error), or { id, lat, lng, copyright?, links? } (a panorama).
 *  mode "denied" makes Google refuse the key, as it does on a wrong key. */
const googleScript = mode =>
  mode === "denied"
    ? `window.gm_authFailure();`
    : `window.google = { maps: { importLibrary: async () => ({ StreetViewService: class {
        getPanorama(req, cb) {
          (window.__requests = window.__requests || []).push(req);
          const a = window.__sv ? window.__sv(req) : null;
          const answer = () => {
            if (!a) return cb(null, "ZERO_RESULTS");
            if (a.status) return cb(null, a.status);
            const d = { location: { pano: a.id, latLng: { lat: () => a.lat, lng: () => a.lng } },
              copyright: a.copyright || "© 2024 Google", imageDate: "2023-04" };
            if (a.links !== undefined) d.links = a.links;
            cb(d, "OK");
          };
          setTimeout(answer, window.__svDelay || 0);
        } } }) } };
      window.__mapgenReady();`;

/** Opens the page in a new context. `google` is the mode of the simulated script ("ok", "denied" or
 *  "unreachable"). Waits shorter than 10 s are cut to 20 ms, so retries do not slow the tests down.
 *  Returns { page, errors }. */
async function openPage(browser, google = "ok") {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 860 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(String(e)));
  page.on("console", m => {
    if (/Content Security/.test(m.text())) errors.push(m.text());
  });
  await page.addInitScript(() => {
    const st = window.setTimeout;
    window.setTimeout = (f, ms, ...a) => st(f, ms >= 1000 && ms < 10000 ? 20 : ms, ...a);
  });
  await page.route("**/*", r => {
    const u = r.request().url();
    if (isSite(u)) return serveSite(r);
    if (u.includes("maps/api/js"))
      return google === "unreachable"
        ? r.abort()
        : r.fulfill({ contentType: "text/javascript", body: googleScript(google) });
    return r.fulfill({ status: 204, body: "" }); // map tiles
  });
  await page.goto(PAGE);
  await page.waitForFunction(() => map !== null);
  return { page, errors };
}

/** Chooses a country in step 1 as a visitor would: type its name, pick the first suggestion. */
async function chooseCountry(page, name) {
  await page.fill("#country", name);
  await page.keyboard.press("Enter");
}

/** Fills the form and starts a search: country (its name), criteria, number, key. */
async function search(page, { country = "Malta", noRoadName = false, deadEnd = false, target = 5 } = {}) {
  await chooseCountry(page, country);
  await page.setChecked("#noRoadName", noRoadName);
  await page.setChecked("#deadEnd", deadEnd);
  await page.fill("#target", String(target));
  await page.fill("#apiKey", "TESTKEY");
  await page.click("#go");
}

/** Waits until the running search has ended. */
const searchEnded = page =>
  page.waitForFunction(() => !running && document.getElementById("go").hidden === false, null, {
    timeout: 60000,
  });

module.exports = { openPage, chooseCountry, search, searchEnded };
