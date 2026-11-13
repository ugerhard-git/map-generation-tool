// Linting: finds likely mistakes (unknown names, unused variables, …). Layout is left to Prettier.
// Run with `npm run lint`; it also runs on every pull request.
import js from "@eslint/js";
import globals from "globals";
import * as espree from "espree";
import { createRequire } from "node:module";
import path from "node:path";

const { assemble, SHARED_DIR } = createRequire(import.meta.url)("./src/assemble.js");

// Names the page itself defines: the build adds Leaflet (L), the Vali data and the major roads (VALI,
// MAJOR_ROADS, Map Generation Tool), the
// country facts (COUNTRY_FACTS, Unofficial), the places (PLACES, Distribution), the country tags
// (COUNTRY_TAGS), the land map (LAND), where the settlement map is (SETTLEMENTS) and the framing check (FRAMED) before app.js, and Google's script
// adds `google` when it loads.
const pageGlobals = {
  L: "readonly",
  google: "readonly",
  FRAMED: "readonly",
  VALI: "readonly",
  MAJOR_ROADS: "readonly",
  COUNTRY_FACTS: "readonly",
  PLACES: "readonly",
  COUNTRY_TAGS: "readonly",
  LAND: "readonly",
  SETTLEMENTS: "readonly",
};

// app.js is linted with the shared code put in (src/assemble.js), as the page gets it: names one part
// defines and the other uses are then known, and unused ones are still found. A problem in shared code
// is reported on the /*SHARED …*/ line of app.js, naming the shared file and its line. The shared files
// are not linted on their own, as they are only parts of app.js.
const assembled = {};
const withSharedCode = {
  preprocess(text, filename) {
    assembled[filename] = assemble(filename);
    return [{ text: assembled[filename].code, filename: "app.js" }];
  },
  postprocess([messages], filename) {
    const { origins } = assembled[filename];
    const ownLines = [];
    // The line in app.js that inserts each shared file, to report problems in shared code on.
    const sharedMarks = {};
    let ownLine = 0;
    for (const o of origins) {
      if (o.file === filename) ownLine = o.line;
      else sharedMarks[o.file] ??= ownLine + 1;
      ownLines.push(o.file === filename ? o.line : sharedMarks[o.file]);
    }
    return messages.map(m => {
      const o = origins[m.line - 1];
      if (!o || o.file === filename) return { ...m, line: o ? o.line : m.line, endLine: undefined };
      const where = path.relative(path.dirname(SHARED_DIR), o.file) + ":" + o.line;
      return {
        ...m,
        line: ownLines[m.line - 1],
        column: 1,
        endLine: undefined,
        message: `${where}: ${m.message}`,
      };
    });
  },
  supportsAutofix: false,
};

// The pages' app code: the Map Generation Tool's, Unofficial's and Distribution's.
const APPS = ["src/app.js", "src/unofficial/app.js", "src/distribution/app.js"];

// The tests run some code inside the pages (page.evaluate), where it uses app.js's top-level names.
// Read those names from both pages' app code with the shared code, so this list never goes out of date.
const appNames = {};
for (const node of APPS.flatMap(f => espree.parse(assemble(f).code, { ecmaVersion: "latest" }).body)) {
  if (node.type === "VariableDeclaration")
    for (const d of node.declarations) if (d.id.type === "Identifier") appNames[d.id.name] = "writable";
  if ((node.type === "FunctionDeclaration" || node.type === "ClassDeclaration") && node.id)
    appNames[node.id.name] = "readonly";
}

export default [
  { ignores: ["dist/", "node_modules/", "src/shared/"] },
  js.configs.recommended,
  {
    rules: {
      // `catch {}` is used on purpose where the browser may block storage (private windows).
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  {
    files: APPS,
    processor: withSharedCode,
  },
  {
    // The app code with the shared code put in, which ESLint names src/app.js/0_app.js.
    files: APPS.map(f => f + "/*.js"),
    languageOptions: { sourceType: "script", globals: { ...globals.browser, ...pageGlobals } },
  },
  {
    files: [
      "src/build.js",
      "src/land.js",
      "src/assemble.js",
      "src/countries.js",
      "tests/**/*.js",
      "tools/**/*.js",
    ],
    languageOptions: { sourceType: "commonjs", globals: { ...globals.node } },
  },
  {
    files: ["tests/**/*.js"],
    languageOptions: { globals: { ...globals.browser, ...pageGlobals, ...appNames } },
  },
];
