# How the code works

A guide for developers. For using the app, see the [README](../README.md).

## The big picture

The Map Generation Tool is a single web page with no server of its own. Everything happens in the visitor's browser. It builds [map-making.app](https://map-making.app) maps of random official Google Street View locations that match what the visitor chooses. What comes next is in [the plan](plan.md).

1. **Settings.** The visitor picks where (one or more countries, a continent or the whole world), what each location must have (no road name, the end of the coverage, photos from certain years, in any mix) and how many locations.
2. **Locations per country.** With more than one country, the number is split between them in the proportions of a well-known GeoGuessr map, from [Vali](https://github.com/slashP/Vali) by slashP, in whole numbers that add up (largest remainder method). The table under the steps shows the split before the search and the progress during it.
3. **Random spots.** The page keeps choosing a country that still needs locations, and a random spot inside it, using the country borders of the built-in country-coder library, spread evenly by area.
4. **Google.** For each spot, Google's Maps JavaScript API is asked for the nearest official panorama within the chosen radius. Its answer includes the panorama's arrows: their labels are the road names, and a panorama with one arrow is where the coverage ends.
5. **Keep or skip.** A panorama that matches, lies in that country and is at least 100 m from every location so far becomes a location. Several lookups run at once until every country has its number or the visitor stops.
6. **Shortfalls.** A country gives up after a set number of random spots in a row without a new location (2,000 by default; failed lookups do not count). If countries fell short, the page offers to share the missing locations between the countries that finished, in their proportions, and search on, or to keep what was found.
7. **Export.** The locations download as a map-making.app JSON file, each with its country code and the tags the visitor ticked: the country's name (ticked by default), "No road name" and "Dead end" where they apply, and the year of the photos.

Much of the code is copied from [Lookout (osm-tool)](https://github.com/ugerhard-git/osm-tool). The two apps keep separate copies on purpose. When a feature needs a part Lookout already has (Overpass queries, the official-coverage check, street names, shareable links, history of searches), copy it from Lookout's `src/app.js` and adapt it.

## Files

| File                 | What is in it                                                                                                                                                                                             |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/page.html`      | The markup, the site owner settings (Google key) and placeholders such as `/*APP_JS*/` that the build fills in.                                                                                           |
| `src/style.css`      | The styles.                                                                                                                                                                                               |
| `src/icon.svg`       | The page icon: a folded map with three random locations. `npm run icons` (`tools/icons.js`) makes `icon-32.png` and `icon-180.png` from it for Safari and phones; the build puts all three into the page. |
| `src/app.js`         | All app code. Starts with an overview of how the app works, the shared state and what is saved in the browser.                                                                                            |
| `src/build.js`       | Puts everything into one file, `dist/index.html`: markup, styles, app code, the Vali data, Leaflet, country-coder and the font. Then fingerprints the scripts for the Content Security Policy.            |
| `src/data/vali.json` | The country distributions of well-known GeoGuessr maps and the continent lists, from Vali. Made by `tools/vali.js`; never edit it by hand.                                                                |
| `tools/vali.js`      | Imports `src/data/vali.json` from a copy of Vali: `node tools/vali.js <folder>`. Checks the data and stops instead of writing a file that looks wrong. See "Updates".                                     |
| `tests/run.js`       | Runs every test file. On GitHub it also reports failures as notes on the run.                                                                                                                             |
| `tests/site.js`      | Serves `dist/` at the made-up address `https://mapgen.test/` for the tests.                                                                                                                               |
| `tests/pw.js`        | Playwright with the first-visit dialog already dismissed.                                                                                                                                                 |
| `tests/helpers.js`   | Opens the page with Google's script simulated (`openPage`), fills in and starts a search (`search`), waits for it to end (`searchEnded`).                                                                 |
| `tests/*.js`         | One file per feature area. Every outside service (Google, map tiles) is simulated with Playwright routes, so the tests run offline and need no key.                                                       |

The three source files use the same section names, in the same order as the page: steps 1 to 3, locations per country, the search buttons and the shortfall offer, the map, the bottom bar, buttons and dialogs. `app.js` adds sections for random spots, Street View and the run. Search for `---------- step 2` (for example) to find the matching part in each file.

## Where to find things in app.js

| Section               | What it does                                                                                                                                                  | Main functions                                                                                                        |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| data                  | The site owner settings, the countries with official coverage, and fixed limits (radius, spacing, lookups at once).                                           |                                                                                                                       |
| helpers               | Small tools: saving settings, country names, the country at a position, distances, escaping text.                                                             | `store`, `countryName`, `countryAt`, `distance`, `esc`                                                                |
| random spots          | Random spots inside a country, from the built-in borders.                                                                                                     | `borderParts`, `randomPointIn`                                                                                        |
| step 1                | Where: chosen countries (chips, a field with suggestions), a continent or the whole world; the map whose shares are used; the shares of the area's countries. | `matchCountries`, `addCountry`, `renderDistributionChoices`, `whereChanged`, `areaWeights`, `splitTotal`, `areaLabel` |
| step 2                | What each location must have: no road name, end of coverage, photo years.                                                                                     | `wanted`, `years`, `inYears`, `wantedLabel`                                                                           |
| step 3                | How many, the radius, when a country gives up, the map name, the tag options and the visitor's own Google key.                                                | `target`, `radius`, `giveUpAfter`, `mapName`, `tagsFor`                                                               |
| locations per country | The table of locations per country: the split before a search, wanted and found during and after it.                                                          | `renderShares`                                                                                                        |
| map                   | The map and drawing locations.                                                                                                                                | `initMap`, `showArea`, `drawLocation`                                                                                 |
| Google Street View    | Loading Google's script, looking up panoramas, reading their arrows.                                                                                          | `loadGoogleScript`, `lookup`, `cleanPano`, `arrowFacts`                                                               |
| run                   | The search from start to finish: the workers, choosing the next country, counting misses, spacing, camera direction, progress and messages.                   | `startSearch`, `runSearch`, `pickCountry`, `attempt`, `miss`, `tooClose`, `cameraHeading`, `paint`                    |
| shortfalls            | The offer when countries fell short: fill the gap from the finished countries, or keep what was found.                                                        | `shortfalls`, `showShortfall`, `fillGap`                                                                              |
| export                | The map-making.app file.                                                                                                                                      | `exportJson`                                                                                                          |
| dialogs               | The first-visit welcome: opening, closing, keeping the keyboard inside.                                                                                       | `openDialog`, `closeDialog`                                                                                           |

The data shapes `Location`, `Arrow` and `PanoAnswer` are described at the top of `app.js`. VS Code shows these descriptions when you hover over a variable.

## Rules worth knowing before you change something

- **Edit `src/`, never `dist/`.** Run `npm run build && npm test` after every change.
- **No inline event handlers.** The page's security policy only runs the scripts the build fingerprinted, so `onclick="…"` in the HTML does nothing. Wire events up in `app.js`.
- **No new outside scripts or CDNs.** Libraries are installed with npm and embedded by the build.
- **The page may only connect to Google's Maps service** (`maps.googleapis.com`). A feature that needs another service adds just that host to `connect-src` in `src/build.js`, and `tests/security.js` with it.
- **Treat everything from outside as untrusted:** Google, uploaded files and saved settings. Check values before use, and put text on the page with `textContent` or through `esc()`.
- **Never put keys in the code, in shared links or in error messages.** The site key comes from the `GOOGLE_API_KEY` environment variable at build time.
- **Interface text is for non-technical people:** plain words, sentence case, say what happened and what to do.

## Formatting

The code is formatted with [Prettier](https://prettier.io). `npm run format` formats everything, and `npm run format:check` checks it, which also runs on every pull request. With the recommended VS Code extension, files are formatted when you save.

## Linting

[ESLint](https://eslint.org) looks for likely mistakes: names that do not exist, variables that are never used, code that has no effect. `npm run lint` runs it; it also runs on every pull request, and the recommended VS Code extension underlines problems as you type. The settings are in `eslint.config.mjs`. They know which names the page provides besides `app.js` (Leaflet's `L`, the Vali data `VALI`, `FRAMED`, `google`), and they let the tests use `app.js`'s top-level names inside `page.evaluate`, read straight from `app.js`.

## Tests

```sh
npm run build
npm test              # all test files
npm test -- search    # only files whose name starts with "search"
```

Each test file prints `PASS …` or `FAIL …` lines and ends with `ALL PASS`. Screenshots of some states are saved in `dist/screens/`. To test something new, copy the setup of a test file close to your feature: `tests/search.js` shows how to decide what the simulated Google answers.

When writing a test:

- **Open the page with `openPage`** from `tests/helpers.js`. It loads the page from `PAGE` (`tests/site.js`) rather than from disk, simulates Google's script and the map tiles, and shortens waits, so the tests run offline, fast and need no key. Set `window.__sv` in the page to decide Google's answer to each request.
- **Start Playwright from `tests/pw.js`**, which dismisses the first-visit welcome dialog, unless the test is about that dialog.
- **End with `ALL PASS`** when every check held; `tests/run.js` looks for it.
- **`tests/valitool.js` needs no browser:** it runs `tools/vali.js` on made-up copies of Vali's files in a temporary folder.

## Publishing

Every push to `main` builds the page with the site key (the `GOOGLE_API_KEY` secret, handed only to that build step) and publishes it to GitHub Pages (`.github/workflows/deploy.yml`). The tests run first, on a build without the key.

## Updates

Dependabot (settings in `.github/dependabot.yml`) proposes updates once a month, as pull requests:

- **Development tools** (Playwright, Prettier, ESLint): their minor and patch updates come together in one pull request. A major update comes on its own, as it may need changes here.
- **Leaflet, country-coder and the font:** one pull request each. These end up in the published page, so check the page itself after merging.
- **GitHub Actions:** together in one pull request.

Only versions that have been out for at least a week are proposed. Security fixes are proposed straight away.

**Vali's data** is not a package, so Dependabot cannot watch it. `.github/workflows/vali.yml` does instead, on the 3rd of every month (and when started by hand under Actions → Update Vali data → Run workflow):

1. It clones the latest Vali and runs `tools/vali.js`. If the distributions and continents are the same as in `src/data/vali.json`, it stops there.
2. If they changed, it runs the formatting check, lint, build and all tests, pushes the new file to the branch `vali-update` and opens a pull request (or updates the open one) that lists what changed: maps added or removed, countries added or removed, the largest changes in shares, and any slips found in Vali's data.
3. Pull requests opened by a workflow do not start the Tests workflow, so it starts that workflow on the branch itself; the required "test" check then runs as usual.

If Vali's files look wrong, the import stops, the run fails and GitHub notifies the owner. For this to work, the repository setting "Allow GitHub Actions to create and approve pull requests" must be on. A new map in Vali gets a name made from its list name; add a proper name to `MAP_NAMES` in `tools/vali.js`.
