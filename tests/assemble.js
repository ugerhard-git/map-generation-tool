// Putting a page's app code together (src/assemble.js): each /*SHARED <file>*/ line is replaced by that
// file from src/shared/ (<!--SHARED <file>--> in markup), with where every line came from; a file inserted
// twice or missing stops the build; every shared file is used by a page; and both pages hold their code
// with the shared parts. Needs no browser.
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
  assemble(app("const a = 1; /*SHARED no-such-file.js*/\n")).code ===
    "const a = 1; /*SHARED no-such-file.js*/",
  "only a marker on a line of its own counts",
);

// The files of the pages of this repository that can use shared files (Distribution uses only the shared
// styles).
const pageFiles = ["src", "src/unofficial", "src/distribution"].flatMap(dir =>
  ["app.js", "style.css", "page.html"].map(f => path.join(__dirname, "..", dir, f)),
);
const MARKER = /^\s*(?:\/\*SHARED ([a-z0-9-]+\.(?:js|css))\*\/|<!--SHARED ([a-z0-9-]+\.html)-->)$/gm;
const used = new Set(
  pageFiles.flatMap(p => [...fs.readFileSync(p, "utf8").matchAll(MARKER)].map(m => m[1] || m[2])),
);
const unused = fs.readdirSync(SHARED_DIR).filter(f => !used.has(f));
ok(unused.length === 0, "every file in src/shared/ is used by a page" + (unused.length ? ": " + unused : ""));

for (const [dir, built] of [
  ["src", "dist/index.nokey.html"],
  ["src/unofficial", "dist/unofficial/index.nokey.html"],
  ["src/distribution", "dist/distribution/index.nokey.html"],
]) {
  const page = path.join(__dirname, "..", built);
  const html = fs.existsSync(page) ? fs.readFileSync(page, "utf8") : "";
  ok(
    ["app.js", "style.css"].every(f =>
      html.includes(assemble(path.join(__dirname, "..", dir, f)).code.trim()),
    ),
    `${built} holds its app code and styles with the shared parts put in`,
  );
}

fs.rmSync(work, { recursive: true, force: true });
console.log(fail ? `${fail} FAILED` : "ALL PASS");
process.exitCode = fail ? 1 : 0;
