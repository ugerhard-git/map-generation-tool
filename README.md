# Map Generation Tool

Builds maps for [map-making.app](https://map-making.app) and GeoGuessr: Street View locations chosen by criteria you set.

**Work in progress.** The criteria are not built yet. For now you can click the map to add the nearest Street View location by hand and download the result.

It runs entirely in the browser as a single HTML page. There is no server of its own. It shares much of its code with [Lookout (osm-tool)](https://github.com/ugerhard-git/osm-tool).

**Use it here: [ugerhard-git.github.io/map-generation-tool](https://ugerhard-git.github.io/map-generation-tool/)**

## Using it

Open the published page, or build it yourself (below) and open `dist/index.html` in a browser.

A Google API key with the **Street View Static API** enabled is needed for the Street View lookups. Either the site has one built in, or visitors enter their own.

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
npm test -- main                  # only files whose name starts with "main"
```

The tests drive the page in a headless browser. Google and the map tiles are simulated, so they need no network and no key.

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
