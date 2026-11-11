# Map Generation Tool

Builds maps for [map-making.app](https://map-making.app) and GeoGuessr: random official Google Street View locations in one or more countries, a continent or the whole world, optionally only where Street View shows no road name, where the coverage ends (one arrow), at intersections (three or more arrows) or where there are no arrows at all, where the photos are from a certain period (month and year), from certain camera generations (Gen 4, Gen 2/3 or the low-quality "bad camera") or without bad camera (using an older photo at the spot instead, where there is one), or any mix of these. The first camera generation (Gen 1) is always left out.

A second tool lives in this repository too: **[Unofficial](#unofficial)** finds random _unofficial_ Street View coverage instead, such as photospheres, drone shots and road coverage that Google did not take itself.

**Work in progress.** See [the plan](docs/plan.md) for what comes next.

## How it works

1. **Choose where, what to look for and how many** (up to 130,000). Where is one or more countries, a continent or the whole world. Everything beyond that (the filters: road names, arrows, the photo period and camera; the distribution, the photo period (month and year) and bad camera, the search radius, the map name and tags) are in closed "More options" sections, each showing what is set; a "?" next to a setting explains it.
2. **Share between countries.** With more than one country, the locations are shared between them like in a well-known GeoGuessr map you choose (An Arbitrary World by default, A Community World, A Balanced World and others), using the country distributions from [Vali](https://github.com/slashP/Vali) by slashP. A table shows how many each country gets. You can also make your own distribution, starting from one of these or with equal shares for every country: enter each country's share as a percentage, or an exact number of locations, in the table (the × next to a share takes a country out), and save it as a preset in your browser ("Your maps").
3. **Random spots.** The page picks random spots on land inside each country (the country borders reach far out to sea, so a built-in land map keeps spots out of the water) and asks Google for the nearest official panorama within a chosen radius.
4. **Check the arrows.** A panorama whose arrows carry no street name has no road name; a panorama with a single arrow is where the coverage ends, one with three or more is an intersection, one with none is a photo on its own; its date gives the month and year of the photos (Google's default photos at that spot, normally the newest). Matching locations at least 100 m apart are kept. At the end of the coverage, the camera faces where it stops. Under "Camera view" you can instead choose the camera's direction relative to the Street View car (front, right, back, left or anything in between) or a random one, anywhere or within a range around the car, and how far it tilts up or down, fixed or random within a range; you set both on drawings of the car. The zoom, too, can be set for every location or be random within a range. A country where matching locations are too rare gives up after a set number of tries; you can then fill the gap from the other countries. Giving up can be switched off, so the search keeps trying until it has every location or you stop it.
5. **Export** as a map-making.app JSON file, at the end or after stopping the search. The download button shows the file's size; over the size limit (20 MB by default, as for Discord uploads) you can make it smaller, each country keeping its share, by an even spread (dropping the locations closest to others) or at random, and undo it. The map on the page shows the first 20,000 locations, to stay quick; the file has all of them. Each location gets its country code and the tags you tick: the country (ticked by default; its tag comes from the owner's list in `src/data/country-tags.json`, such as "USA" and "UAE"; a territory such as Puerto Rico gets its own name and its country's tag by default, or one of the two, as chosen under "Tag territories with"), "No road name", "Dead end" and "Intersection" (each a separate option) where they apply, and the date of the photos, as the year (2023) or month and year (04-2023), and the camera (Gen 4, Gen 2/3, Bad camera).

While a search runs, the status line shows a forecast of the time left, learnt from how fast it finds locations in each country. The counters below it show how long the search has been running.

A search you stop can be continued from where it stopped, as long as its settings stay the same (the map name, tags and size limit may change); with changed settings, a new search starts from scratch, and the page says so. A long search is also saved in your browser as it runs: if you close the tab, you can continue it, or download what it found, the next time you open the page.

Your last 20 searches are kept in your browser (only their settings, never the key), so you can run one again or reuse its settings under "History".

Under "Settings file" you can save all your settings to a file (`….settings.json`, readable in any text editor) and load them again later, or give them to someone else. The file never holds your Google key.

It runs entirely in the browser as a single HTML page. There is no server of its own. It shares much of its code with [Lookout (osm-tool)](https://github.com/ugerhard-git/osm-tool).

**Use it here: [ugerhard-git.github.io/map-generation-tool](https://ugerhard-git.github.io/map-generation-tool/)**

## Unofficial

**Use it here: [ugerhard-git.github.io/map-generation-tool/unofficial](https://ugerhard-git.github.io/map-generation-tool/unofficial/)**

The second tool builds map-making.app maps of random **unofficial** Street View locations: everything Google shows that Google did not take itself. It works like the Map Generation Tool and shares most of its code, with these differences:

- **Every country and territory** can be chosen, Antarctica too, not only those with official coverage. The continents are the UN regions.
- **Distributions:** by land area (the default), population, population density (people per km² of land) or in equal shares, besides your own. The whole world leaves out Antarctica unless you choose it. With population density, small crowded places such as Singapore and Monaco get the most, so it suits a few countries better than the whole world.
- **The lookup:** Google can be asked for its own coverage only, but not for unofficial coverage only. So each random spot asks for the nearest photo of any kind, and keeps it only if it is not Google's own. Where Google's own coverage is nearer, it hides any unofficial photo next to it, so most locations are found away from Google's roads, and a search takes far longer. Indoor photos are found too: Google does not say which photospheres are indoors.
- **Filters:** the photo period, whole 360° photos only, the image size, with or without arrows (connected to other photos, or a photo on its own), and uploaders to leave out or to keep only. No road names or cameras.
- **Tags:** the country, the uploader's name, "Arrows" or "No arrows", and the date.
- **Giving up:** a country gives up after 5,000 random spots in a row without a new location (2,000 in the Map Generation Tool), as unofficial coverage is rarer.
- **No camera view:** every location faces as the photo faces (the middle of the photo), level, at zoom 0. The settings for direction, tilt and zoom are left out, to keep the page simple.

Its settings are saved in your browser apart from the Map Generation Tool's, and each tool has its own history and settings files.

## Using it

Open the published page, or build it yourself (below) and open `dist/index.html` (Unofficial: `dist/unofficial/index.html`) in a browser.

A Google API key with the **Maps JavaScript API** enabled is needed for the Street View lookups. Either the site has one built in, or visitors enter their own. A large search makes many requests, so set a daily quota on the key.

## Building

Requires Node.js 20 or newer.

```sh
npm install
npm run build                          # both pages without a key
GOOGLE_API_KEY=your-key npm run build  # both pages with your key built in
```

The build writes one self-contained file for each tool, `dist/index.html` and `dist/unofficial/index.html`. Each embeds the Leaflet map library, the country-coder country lookup, a land map made from Natural Earth and the Overpass font, and it adds a Content Security Policy that only allows the page's own scripts to run.

For hosting both tools on a server of your own, the build also writes them split up, in `dist/split/`: the same two pages, `index.html` and `unofficial/index.html`, with their scripts and styles as files in `dist/split/assets/`. Both pages load the same files for what they share (Leaflet, country-coder, the land map, the font and the shared styles), so a browser that opens both downloads those once; each tool's data and app code is a file of its own. The file names carry a fingerprint, so the server can let browsers keep them for a long time (for example `Cache-Control: max-age=31536000, immutable` for `assets/`). Upload the whole folder, keeping its layout. Its security policy allows scripts from the page's own server and Google's, and every script and style sheet carries its fingerprint, so a changed file is refused.

Never commit a key. The key is inserted by the build from the `GOOGLE_API_KEY` environment variable; the published site gets it from a GitHub secret.

## Tests

```sh
npx playwright install chromium   # once
npm run build
npm test                          # all test files
npm test -- search                # only files whose name starts with "search"
npm run test:split                # all test files, against the split build (dist/split/)
```

The tests drive the page in a headless browser. Google's script and the map tiles are simulated, so they need no network and no key.

## Project layout

| Path                         | What it is                                                       |
| ---------------------------- | ---------------------------------------------------------------- |
| `src/page.html`              | The Map Generation Tool's markup and site owner settings         |
| `src/style.css`              | The Map Generation Tool's styles                                 |
| `src/icon.svg`               | The page icon; `npm run icons` makes the PNG versions next to it |
| `src/app.js`                 | The Map Generation Tool's own app code                           |
| `src/unofficial/`            | Unofficial's markup, styles and own app code                     |
| `src/shared/`                | Code, markup and styles both tools use                           |
| `src/assemble.js`            | Puts a page's files and the shared parts together                |
| `src/build.js`               | Builds both pages into `dist/`                                   |
| `src/land.js`                | Makes the land map for the pages, during the build               |
| `src/countries.js`           | Unofficial's land area, continent and country per place (build)  |
| `src/data/vali.json`         | Country distributions and continents from Vali (generated)       |
| `tools/vali.js`              | Updates `src/data/vali.json` from Vali; runs monthly on GitHub   |
| `src/data/country-tags.json` | The tag each country gets in the map file (edited by hand)       |
| `src/data/population.json`   | Unofficial's populations, from Natural Earth (generated)         |
| `tools/population.js`        | Updates `src/data/population.json` from Natural Earth (by hand)  |
| `tests/`                     | Browser tests, one file per feature area                         |
| `docs/`                      | [How the code works](docs/how-the-code-works.md), for developers |
| `CONTRIBUTING.md`            | How to make a change, and the rules                              |
| `SECURITY.md`                | How to report a security problem, and the protections            |

## Credits

The country distributions of well-known GeoGuessr maps and the continent lists come from [Vali](https://github.com/slashP/Vali) by slashP (GPL-3.0). Country borders, and Unofficial's continents and territories, come from [country-coder](https://github.com/rapideditor/country-coder), the land map and Unofficial's populations from [Natural Earth](https://www.naturalearthdata.com) (public domain) through [world-atlas](https://github.com/topojson/world-atlas) (ISC), the map from [Leaflet](https://leafletjs.com) and [OpenStreetMap](https://www.openstreetmap.org/copyright).

## Licence

MIT, see [LICENSE](LICENSE).
