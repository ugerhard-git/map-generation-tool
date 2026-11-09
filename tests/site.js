// The tests load the app from a made-up web address instead of from disk (file://).
// The test browser sometimes throws away everything a file:// page saved in the browser when it
// reloads, which made the tests that reload the page fail at random. Requests to this address are
// answered with the files in dist/, so nothing goes out to the network.
const path = require("path");

const SITE = "https://mapgen.test/";
const PAGE = SITE + "index.nokey.html";
// The second tool, Unofficial, at unofficial/ (src/unofficial/).
const UNOFFICIAL = SITE + "unofficial/index.nokey.html";
// SITE_BUILD=split runs the tests against the split build (dist/split/: scripts and styles in files of
// their own, see src/build.js) instead of the one-file pages.
const SPLIT = process.env.SITE_BUILD === "split";
const dist = path.resolve(__dirname, SPLIT ? "../dist/split" : "../dist");

/** True for requests to the made-up address that serves dist/. */
const isSite = url => url.startsWith(SITE);

/** Answers a request to the made-up address with the matching file from dist/. */
function serveSite(route) {
  const file = path.join(dist, decodeURIComponent(new URL(route.request().url()).pathname));
  if (!file.startsWith(dist + path.sep)) return route.fulfill({ status: 404, body: "" });
  return route.fulfill({ path: file });
}

module.exports = { SITE, PAGE, UNOFFICIAL, isSite, serveSite, SPLIT, DIST: dist };
