# Map Generation Tool

Builds maps for [map-making.app](https://map-making.app) and GeoGuessr: random official Google Street View locations in one or more countries, a continent or the whole world, optionally only where Street View shows no road name, where the coverage ends (one arrow), where the photos are from a certain period (month and year), from certain camera generations (Gen 4, Gen 2/3 or the low-quality "bad camera") or without bad camera (using an older photo at the spot instead, where there is one), or any mix of these. The first camera generation (Gen 1) is always left out.

**Work in progress.** See [the plan](docs/plan.md) for what comes next.

## How it works

1. **Choose where, what to look for and how many** (up to 130,000). Where is one or more countries, a continent or the whole world. Settings most people never need to change (the distribution, the photo period (month and year) and bad camera, the search radius, the map name and tags) are in closed "More options" sections, each showing what is set; a "?" next to a setting explains it.
2. **Share between countries.** With more than one country, the locations are shared between them like in a well-known GeoGuessr map you choose (An Arbitrary World by default, A Community World, A Balanced World and others), using the country distributions from [Vali](https://github.com/slashP/Vali) by slashP. A table shows how many each country gets.
3. **Random spots.** The page picks random spots on land inside each country (the country borders reach far out to sea, so a built-in land map keeps spots out of the water) and asks Google for the nearest official panorama within a chosen radius.
4. **Check the arrows.** A panorama whose arrows carry no street name has no road name; a panorama with a single arrow is where the coverage ends; its date gives the month and year of the photos (Google's default photos at that spot, normally the newest). Matching locations at least 100 m apart are kept. At the end of the coverage, the camera faces where it stops. A country where matching locations are too rare gives up after a set number of tries; you can then fill the gap from the other countries.
5. **Export** as a map-making.app JSON file, at the end or after stopping the search. The map on the page shows the first 20,000 locations, to stay quick; the file has all of them. Each location gets its country code and the tags you tick: the country's name (ticked by default), "No road name" and "Dead end" (each a separate option) where they apply, and the date of the photos, as the year (2023) or month and year (04-2023), and the camera (Gen 4, Gen 2/3, Bad camera).

While a search runs, the status line shows a forecast of the time left, learnt from how fast it finds locations in each country. The counters below it show how long the search has been running.

A long search is saved in your browser as it runs: if you close the tab, you can continue it, or download what it found, the next time you open the page.

Your last 20 searches are kept in your browser (only their settings, never the key), so you can run one again or reuse its settings under "History".

Under "Settings file" you can save all your settings to a file (`….settings.json`, readable in any text editor) and load them again later, or give them to someone else. The file never holds your Google key.

It runs entirely in the browser as a single HTML page. There is no server of its own. It shares much of its code with [Lookout (osm-tool)](https://github.com/ugerhard-git/osm-tool).

**Use it here: [ugerhard-git.github.io/map-generation-tool](https://ugerhard-git.github.io/map-generation-tool/)**

## Using it

Open the published page, or build it yourself (below) and open `dist/index.html` in a browser.

A Google API key with the **Maps JavaScript API** enabled is needed for the Street View lookups. Either the site has one built in, or visitors enter their own. A large search makes many requests, so set a daily quota on the key.

## Building

Requires Node.js 20 or newer.

```sh
npm install
npm run build                          # dist/index.html without a key
GOOGLE_API_KEY=your-key npm run build  # dist/index.html with your key built in
```

The build writes one self-contained file, `dist/index.html`. It embeds the Leaflet map library, the country-coder country lookup, a land map made from Natural Earth and the Overpass font, and it adds a Content Security Policy that only allows the page's own scripts to run.

Never commit a key. The key is inserted by the build from the `GOOGLE_API_KEY` environment variable; the published site gets it from a GitHub secret.

## Tests

```sh
npx playwright install chromium   # once
npm run build
npm test                          # all test files
npm test -- search                # only files whose name starts with "search"
```

The tests drive the page in a headless browser. Google's script and the map tiles are simulated, so they need no network and no key.

## Project layout

| Path                 | What it is                                                       |
| -------------------- | ---------------------------------------------------------------- |
| `src/page.html`      | The page's markup and site owner settings                        |
| `src/style.css`      | The page's styles                                                |
| `src/icon.svg`       | The page icon; `npm run icons` makes the PNG versions next to it |
| `src/app.js`         | The app code                                                     |
| `src/build.js`       | Builds `dist/index.html`                                         |
| `src/land.js`        | Makes the land map for the page, during the build                |
| `src/data/vali.json` | Country distributions and continents from Vali (generated)       |
| `tools/vali.js`      | Updates `src/data/vali.json` from Vali; runs monthly on GitHub   |
| `tests/`             | Browser tests, one file per feature area                         |
| `docs/`              | [How the code works](docs/how-the-code-works.md), for developers |
| `CONTRIBUTING.md`    | How to make a change, and the rules                              |
| `SECURITY.md`        | How to report a security problem, and the protections            |

## Credits

The country distributions of well-known GeoGuessr maps and the continent lists come from [Vali](https://github.com/slashP/Vali) by slashP (GPL-3.0). Country borders come from [country-coder](https://github.com/rapideditor/country-coder), the land map from [Natural Earth](https://www.naturalearthdata.com) (public domain) through [world-atlas](https://github.com/topojson/world-atlas) (ISC), the map from [Leaflet](https://leafletjs.com) and [OpenStreetMap](https://www.openstreetmap.org/copyright).

## Licence

MIT, see [LICENSE](LICENSE).
