# Map Generation Tool

Builds maps for [map-making.app](https://map-making.app) and GeoGuessr: random official Google Street View locations in a country, optionally only where Street View shows no road name, where the coverage ends (one arrow), or both.

**Work in progress.** One country at a time for now; whole-world and continent searches with the country distributions of well-known GeoGuessr maps come next. See [the plan](docs/plan.md).

## How it works

1. **Choose a country, what to look for and how many** (up to 130,000).
2. **Random spots.** The page picks random spots inside the country and asks Google for the nearest official panorama within a chosen radius.
3. **Check the arrows.** A panorama whose arrows carry no street name has no road name; a panorama with a single arrow is where the coverage ends. Matching locations at least 100 m apart are kept, tagged with their country and what they have. At the end of the coverage, the camera faces where it stops.
4. **Export** as a map-making.app JSON file, at the end or after stopping the search.

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

| Path              | What it is                                                       |
| ----------------- | ---------------------------------------------------------------- |
| `src/page.html`   | The page's markup and site owner settings                        |
| `src/style.css`   | The page's styles                                                |
| `src/icon.svg`    | The page icon; `npm run icons` makes the PNG versions next to it |
| `src/app.js`      | The app code                                                     |
| `src/build.js`    | Builds `dist/index.html`                                         |
| `tests/`          | Browser tests, one file per feature area                         |
| `docs/`           | [How the code works](docs/how-the-code-works.md), for developers |
| `CONTRIBUTING.md` | How to make a change, and the rules                              |
| `SECURITY.md`     | How to report a security problem, and the protections            |

## Licence

MIT, see [LICENSE](LICENSE).
