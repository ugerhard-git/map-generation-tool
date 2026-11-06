// Puts a page's files together: the page's own app.js, style.css or page.html, with each line that says
// /*SHARED <file>*/ (in code and styles) or <!--SHARED <file>--> (in markup) replaced by that file from
// src/shared/. The two tools in this repository share code this way while each page stays one
// self-contained file. Used by the build (src/build.js), the linter (eslint.config.mjs) and the tests.
//
// A shared file is a run of whole sections, written as if it stood in the page's file at that spot: shared
// code uses app.js's names, and app.js uses its names. Each may be inserted once per page.
const fs = require("fs"),
  path = require("path");

const SHARED_DIR = path.join(__dirname, "shared");
// The marker, alone on its line (it may be indented): the file's name is in group 1 or 2.
const MARK = /^\s*(?:\/\*SHARED ([a-z0-9-]+\.(?:js|css))\*\/|<!--SHARED ([a-z0-9-]+\.html)-->)$/;

/**
 * One file of a page with the shared files put in, and where each line came from (for error messages).
 * @param {string} appFile path of the page's app.js, style.css or page.html
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
      const name = m[1] || m[2];
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
