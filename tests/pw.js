// Playwright with the first-visit welcome already dismissed and the "More options" sections open, so the
// other suites test the page itself.
const pw = require("playwright");
// The "More options" sections are opened too, so the suites can reach every setting; tests/more.js
// checks the page as a first visitor sees it.
// Both tools: the Map Generation Tool ("mapgen.…") and Unofficial ("unofficial.…").
const seen = () => {
  const sections = {
    mapgen: ["moreDistribution", "moreRoads", "morePhotos", "moreView", "moreSearch", "moreMapFile"],
    unofficial: ["moreDistribution", "morePhotos", "moreUploaders", "moreView", "moreSearch", "moreMapFile"],
  };
  try {
    for (const [tool, open] of Object.entries(sections)) {
      localStorage.setItem(tool + ".welcomed", "true");
      if (localStorage.getItem(tool + ".openSections") === null)
        localStorage.setItem(tool + ".openSections", JSON.stringify(open));
    }
  } catch {}
};
const launch = pw.chromium.launch.bind(pw.chromium);
pw.chromium.launch = async (...a) => {
  const b = await launch(...a);
  const np = b.newPage.bind(b),
    nc = b.newContext.bind(b);
  b.newContext = async (...x) => {
    const c = await nc(...x);
    await c.addInitScript(seen);
    return c;
  };
  b.newPage = async (...x) => {
    const p = await np(...x);
    await p.context().addInitScript(seen);
    return p;
  };
  return b;
};
module.exports = pw;
