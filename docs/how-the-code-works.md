# How the code works

A guide for developers. For using the app, see the [README](../README.md).

## The big picture

The Map Generation Tool is a single web page with no server of its own. Everything happens in the visitor's browser. It will build [map-making.app](https://map-making.app) maps of Street View locations from criteria the visitor chooses. The criteria are not built yet; for now the visitor picks locations by hand:

1. **Click the map.** The page asks Google's Street View metadata service for the nearest outdoor panorama within the chosen distance.
2. **Accept it.** A panorama that is new becomes a location: drawn on the map, with its country found offline by the built-in country-coder library, and the camera turned towards the clicked spot.
3. **Export.** The locations download as a map-making.app JSON file.

Much of the code is copied from [Lookout (osm-tool)](https://github.com/ugerhard-git/osm-tool). The two apps keep separate copies on purpose. When a feature needs a part Lookout already has (Overpass queries, the official-coverage check, street names, shareable links, history of searches), copy it from Lookout's `src/app.js` and adapt it.

## Files

| File            | What is in it                                                                                                                                                                       |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/page.html` | The markup, the site owner settings (Google key) and placeholders such as `/*APP_JS*/` that the build fills in.                                                                     |
| `src/style.css` | The styles.                                                                                                                                                                         |
| `src/icon.svg`  | The page icon (for now Lookout's). `npm run icons` (`tools/icons.js`) makes `icon-32.png` and `icon-180.png` from it for Safari and phones; the build puts all three into the page. |
| `src/app.js`    | All app code. Starts with an overview of how the app works, the shared state and what is saved in the browser.                                                                      |
| `src/build.js`  | Puts everything into one file, `dist/index.html`: markup, styles, app code, Leaflet, country-coder and the font. Then fingerprints the scripts for the Content Security Policy.     |
| `tests/run.js`  | Runs every test file. On GitHub it also reports failures as notes on the run.                                                                                                       |
| `tests/site.js` | Serves `dist/` at the made-up address `https://mapgen.test/` for the tests.                                                                                                         |
| `tests/pw.js`   | Playwright with the first-visit dialog already dismissed.                                                                                                                           |
| `tests/*.js`    | One file per feature area. Every outside service (Google, map tiles) is simulated with Playwright routes, so the tests run offline and need no key.                                 |

The three source files use the same section names, in the same order as the page: step 1, step 2, the map, Street View, the run, export and the dialogs. Search for `---------- step 2` (for example) to find the matching part in each file.

## Where to find things in app.js

| Section            | What it does                                                                                      | Main functions                                     |
| ------------------ | ------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| data               | The site owner settings and fixed limits.                                                         |                                                    |
| helpers            | Small tools: saving settings, the country at a position, distances and directions, escaping text. | `store`, `countryAt`, `distance`, `bearing`, `esc` |
| step 1             | Choosing locations; for now only the search distance for picking by hand.                         | `radius`                                           |
| step 2             | Map name and the visitor's own Google key.                                                        | `mapName`                                          |
| map                | The map and drawing locations.                                                                    | `initMap`, `drawLocation`                          |
| Google Street View | Looking up panoramas and explaining failures.                                                     | `lookup`, `cleanPano`, `failReason`                |
| run                | Adding a location from a click, the status line and counter.                                      | `addAt`, `paint`                                   |
| export             | The map-making.app file.                                                                          | `exportJson`                                       |
| dialogs            | The first-visit welcome: opening, closing, keeping the keyboard inside.                           | `openDialog`, `closeDialog`                        |

The data shapes `Location` and `PanoAnswer` are described at the top of `app.js`. VS Code shows these descriptions when you hover over a variable.

## Rules worth knowing before you change something

- **Edit `src/`, never `dist/`.** Run `npm run build && npm test` after every change.
- **No inline event handlers.** The page's security policy only runs the scripts the build fingerprinted, so `onclick="…"` in the HTML does nothing. Wire events up in `app.js`.
- **No new outside scripts or CDNs.** Libraries are installed with npm and embedded by the build.
- **The page may only connect to Google's Street View service.** A feature that needs another service adds just that host to `connect-src` in `src/build.js`, and `tests/security.js` with it.
- **Treat everything from outside as untrusted:** Google, uploaded files and saved settings. Check values before use, and put text on the page with `textContent` or through `esc()`.
- **Never put keys in the code, in shared links or in error messages.** The site key comes from the `GOOGLE_API_KEY` environment variable at build time.
- **Interface text is for non-technical people:** plain words, sentence case, say what happened and what to do.

## Formatting

The code is formatted with [Prettier](https://prettier.io). `npm run format` formats everything, and `npm run format:check` checks it, which also runs on every pull request. With the recommended VS Code extension, files are formatted when you save.

## Linting

[ESLint](https://eslint.org) looks for likely mistakes: names that do not exist, variables that are never used, code that has no effect. `npm run lint` runs it; it also runs on every pull request, and the recommended VS Code extension underlines problems as you type. The settings are in `eslint.config.mjs`. They know which names the page provides besides `app.js` (Leaflet's `L`, `FRAMED`, `google`), and they let the tests use `app.js`'s top-level names inside `page.evaluate`, read straight from `app.js`.

## Tests

```sh
npm run build
npm test              # all test files
npm test -- main      # only files whose name starts with "main"
```

Each test file prints `PASS …` or `FAIL …` lines and ends with `ALL PASS`. Screenshots of some states are saved in `dist/screens/`. To test something new, copy the setup of a test file close to your feature: `tests/main.js` shows how to answer the page's requests to Google with made-up data.

When writing a test:

- **Load the page from `PAGE`** (`tests/site.js`), not from disk (`file://`). Answer its requests with `isSite`/`serveSite` and simulate every outside service with Playwright routes, so the tests run offline and need no key.
- **Start Playwright from `tests/pw.js`**, which dismisses the first-visit welcome dialog, unless the test is about that dialog.
- **End with `ALL PASS`** when every check held; `tests/run.js` looks for it.

## Publishing

Every push to `main` builds the page with the site key (the `GOOGLE_API_KEY` secret, handed only to that build step) and publishes it to GitHub Pages (`.github/workflows/deploy.yml`). The tests run first, on a build without the key.

## Updates

Dependabot (settings in `.github/dependabot.yml`) proposes updates once a month, as pull requests:

- **Development tools** (Playwright, Prettier, ESLint): their minor and patch updates come together in one pull request. A major update comes on its own, as it may need changes here.
- **Leaflet, country-coder and the font:** one pull request each. These end up in the published page, so check the page itself after merging.
- **GitHub Actions:** together in one pull request.

Only versions that have been out for at least a week are proposed. Security fixes are proposed straight away.
