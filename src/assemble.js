// Puts a page's app code together: the page's own app.js, with each line /*SHARED <file>*/ replaced by
// that file from src/shared/. The two tools in this repository share code this way while each page stays
// one self-contained file. Used by the build (src/build.js), the linter (eslint.config.mjs) and the tests.
//
// A shared file is a run of whole sections, written as if it stood in app.js at that spot: it uses
// app.js's names, and app.js uses its names. Each may be inserted once per page.
const fs = require("fs"),
  path = require("path");

const SHARED_DIR = path.join(__dirname, "shared");
const MARK = /^\/\*SHARED ([a-z0-9-]+\.js)\*\/$/;

/**
 * The app code of one page, and where each line came from (for error messages).
 * @param {string} appFile path of the page's app.js
 * @returns {{ code: string, origins: { file: string, line: number }[] }} origins[i] is the source of
 *   line i + 1 of code
 */
function assemble(appFile) {
  const lines = [],
    origins = [],
    used = new Set();
  fs.readFileSync(appFile, "utf8")
    .replace(/\n$/, "")
    .split("\n")
    .forEach((text, i) => {
      const m = MARK.exec(text);
      if (!m) {
        lines.push(text);
        origins.push({ file: appFile, line: i + 1 });
        return;
      }
      const name = m[1];
      if (used.has(name)) throw new Error(`${appFile}: src/shared/${name} is inserted twice`);
      used.add(name);
      const shared = path.join(SHARED_DIR, name);
      if (!fs.existsSync(shared)) throw new Error(`${appFile}:${i + 1}: src/shared/${name} does not exist`);
      fs.readFileSync(shared, "utf8")
        .replace(/\n$/, "")
        .split("\n")
        .forEach((t, j) => {
          lines.push(t);
          origins.push({ file: shared, line: j + 1 });
        });
    });
  return { code: lines.join("\n"), origins };
}

module.exports = { assemble, SHARED_DIR };
