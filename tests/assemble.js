// Putting a page's app code together (src/assemble.js): each /*SHARED <file>*/ line is replaced by that
// file from src/shared/, with where every line came from; a file inserted twice or missing stops the
// build; every shared file is used by a page; and the page holds the shared code. Needs no browser.
const fs = require("fs"),
  os = require("os"),
  path = require("path");
const { assemble, SHARED_DIR } = require("../src/assemble.js");

let fail = 0;
const ok = (c, m) => {
  console.log((c ? "PASS " : "FAIL ") + m);
  if (!c) fail++;
};
const throws = (f, pattern) => {
  try {
    f();
    return false;
  } catch (e) {
    return pattern.test(e.message);
  }
};

const work = fs.mkdtempSync(path.join(os.tmpdir(), "assemble-test-"));
const app = text => {
  const file = path.join(work, "app.js");
  fs.writeFileSync(file, text);
  return file;
};

// A real shared file, so the test follows the folder the build uses.
const sharedName = fs.readdirSync(SHARED_DIR).find(f => f.endsWith(".js"));
const sharedLines = fs.readFileSync(path.join(SHARED_DIR, sharedName), "utf8").replace(/\n$/, "").split("\n");

const result = assemble(app(`const a = 1;\n/*SHARED ${sharedName}*/\nconst b = 2;\n`));
const lines = result.code.split("\n");
ok(
  lines[0] === "const a = 1;" &&
    lines.slice(1, 1 + sharedLines.length).join("\n") === sharedLines.join("\n") &&
    lines[1 + sharedLines.length] === "const b = 2;" &&
    lines.length === sharedLines.length + 2,
  "the marker line is replaced by the shared file, in place",
);
ok(
  result.origins.length === lines.length &&
    result.origins[0].line === 1 &&
    result.origins[1].file === path.join(SHARED_DIR, sharedName) &&
    result.origins[1].line === 1 &&
    result.origins[lines.length - 1].line === 3,
  "every line knows its file and line",
);
ok(
  throws(() => assemble(app(`/*SHARED ${sharedName}*/\n/*SHARED ${sharedName}*/\n`)), /inserted twice/),
  "a shared file inserted twice stops the build",
);
ok(
  throws(() => assemble(app("/*SHARED no-such-file.js*/\n")), /does not exist/),
  "a missing shared file stops the build",
);
ok(
  assemble(app("  /*SHARED no-such-file.js*/\n")).code === "  /*SHARED no-such-file.js*/",
  "only a marker on a line of its own counts",
);

// The pages of this repository.
const pages = [path.join(__dirname, "../src/app.js")];
const used = new Set(
  pages.flatMap(p =>
    [...fs.readFileSync(p, "utf8").matchAll(/^\/\*SHARED ([a-z0-9-]+\.js)\*\/$/gm)].map(m => m[1]),
  ),
);
const unused = fs.readdirSync(SHARED_DIR).filter(f => !used.has(f));
ok(unused.length === 0, "every file in src/shared/ is used by a page" + (unused.length ? ": " + unused : ""));

const built = path.join(__dirname, "../dist/index.nokey.html");
ok(
  fs.existsSync(built) && fs.readFileSync(built, "utf8").includes(assemble(pages[0]).code.trim()),
  "the built page holds app.js with the shared code put in",
);

fs.rmSync(work, { recursive: true, force: true });
console.log(fail ? `${fail} FAILED` : "ALL PASS");
process.exitCode = fail ? 1 : 0;
