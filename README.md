# Map Generation Tool

Builds maps for [map-making.app](https://map-making.app) and GeoGuessr: random official Google Street View locations in one or more countries, a continent or the whole world, optionally only where Street View shows no road name, where the coverage ends (one arrow), where the photos are from certain years, without the low-quality "bad camera" (using an older photo at the spot instead, where there is one), or any mix of these.

**Work in progress.** See [the plan](docs/plan.md) for what comes next.

## How it works

1. **Choose where, what to look for and how many** (up to 130,000). Where is one or more countries, a continent or the whole world.
2. **Share between countries.** With more than one country, the locations are shared between them like in a well-known GeoGuessr map you choose (An Arbitrary World by default, A Community World, A Balanced World and others), using the country distributions from [Vali](https://github.com/slashP/Vali) by slashP. A table shows how many each country gets.
3. **Random spots.** The page picks random spots inside each country and asks Google for the nearest official panorama within a chosen radius.
4. **Check the arrows.** A panorama whose arrows carry no street name has no road name; a panorama with a single arrow is where the coverage ends; its date gives the year of the photos (Google's default photos at that spot, normally the newest). Matching locations at least 100 m apart are kept. At the end of the coverage, the camera faces where it stops. When looking for ends of coverage, the search can also follow the road a short way (150 steps by default) from a spot that is not an end. A country where matching locations are too rare gives up after a set number of tries; you can then fill the gap from the other countries.
5. **Export** as a map-making.app JSON file, at the end or after stopping the search. Each location gets its country code and the tags you tick: the country's name (ticked by default), "No road name" and "Dead end" where they apply, and the year of the photos.

A long search is saved in your browser as it runs: if you close the tab, you can continue it, or download what it found, the next time you open the page.

Your last 20 searches are kept in your browser (only their settings, never the key), so you can run one again or reuse its settings under "History".

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

The build writes one self-contained file, `dist/index.html`. It embeds the Leaflet map library, the country-coder country lookup and the Overpass font, and it adds a Content Security Policy that only allows the page's own scripts to run.

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
| `src/data/vali.json` | Country distributions and continents from Vali (generated)       |
| `tools/vali.js`      | Updates `src/data/vali.json` from Vali; runs monthly on GitHub   |
| `tests/`             | Browser tests, one file per feature area                         |
| `docs/`              | [How the code works](docs/how-the-code-works.md), for developers |
| `CONTRIBUTING.md`    | How to make a change, and the rules                              |
| `SECURITY.md`        | How to report a security problem, and the protections            |

## Credits

The country distributions of well-known GeoGuessr maps and the continent lists come from [Vali](https://github.com/slashP/Vali) by slashP (GPL-3.0). Country borders come from [country-coder](https://github.com/rapideditor/country-coder), the map from [Leaflet](https://leafletjs.com) and [OpenStreetMap](https://www.openstreetmap.org/copyright).

## Licence

MIT, see [LICENSE](LICENSE).
