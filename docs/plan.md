# Plan

The plan agreed with the owner on 22 October 2026. Each step is one pull request. Update this file when a step is done or the plan changes.

## What the app does

- **Area:** the whole world, a continent, or chosen countries (one or several). Only countries and territories with official Google Street View are offered.
- **Distribution:** the visitor picks one of Vali's maps (An Arbitrary World by default, A Community World, A Balanced World, …). The app splits the requested number of locations (up to 130,000) across the countries of the chosen area in that map's proportions (largest remainder method), and shows the per-country table before the search starts. For several countries or a continent, the chosen map's proportions for just those countries are used; for a continent, Vali's own continent distribution is offered too. A single country gets the full number.
- **Criteria**, ticked separately:
  - **No road name:** none of the panorama's arrows has a label.
  - **End of coverage (dead end):** exactly one arrow. The camera faces away from the arrow, towards where the coverage stops.
  - **Photo years** (added later): the photos Google shows by default at a spot, normally the newest, are from a chosen range of years between 2009 and this year.
  - With several ticked, a location must have all of them. The export can tag each location with its country's name (ticked by default), what it has ("No road name", "Dead end") and the year of the photos; the visitor chooses.
- **Search:** random spots inside the country; the nearest official panorama within a radius (a setting); locations at least 100 m apart. A live table shows each country's target, found count and state. The visitor can stop at any time and download what was found.
- **Shortfalls:** a country stops after a set number of lookups in a row that find nothing new. At the end, the app offers to fill the gap from the other countries, keeping their proportions, or to keep what was found.
- **History** of search settings, as in Lookout. No shareable links.
- Google's official Maps JavaScript API is used for the lookups (not an undocumented endpoint).

## Vali data

Vali ([slashP/Vali](https://github.com/slashP/Vali), GPL-3.0) is the source of the map distributions and continent lists. The owner asks slashP about reuse; the data file credits Vali.

- `tools/vali.js` reads Vali's `Weights.cs` and writes `src/data/vali.json` (with the Vali commit and date). It stops instead of writing a file that looks wrong.
- The build embeds the data; the page never contacts GitHub.
- `.github/workflows/vali.yml` runs monthly (and by hand), and opens a pull request when the data changed, listing what changed. It runs the checks itself and starts the Tests workflow on its branch, as pull requests created by a workflow do not start it.
- Readable map names live in a short list of our own; a new Vali map shows its code until named.

## Steps

1. **Search one country** (done): the search loop, official coverage only, both criteria, the count, spacing, live progress, stop and download, tags. Since then: the country field suggests countries while typing, a larger "Open in Street View" button, tag options (country name, what it has, year), and the photo years criterion.
2. **Areas and distributions** (done): whole world, continents, chosen countries, the Vali import and the monthly workflow, the per-country table.
3. **Shortfalls** (done): attempt budgets (a setting, 2,000 spots by default) and the end-of-search offer.
4. **History** of search settings (done): the last 20 searches in this browser, with "Run again", "Use these settings", remove, clear, and a switch to turn it off.
5. **Later, if needed:** following roads to dead ends; resuming a long search after closing the tab.

## Known limits

- Vali's data has two slips (August 2026): An Arbitrary Rural World lists Bermuda as 0 and as 1 (1 is used), and An Improved World lists Costa Rica as 200 and as 20 (200 is used, as Vali does where it picks countries from a list). The update pull requests report such slips.
- A few countries in Vali's maps have no official coverage (Belarus, Pakistan and others, about 0.01% of a map); they are left out.

- The country borders built into the page include the sea around coasts and islands, so in island countries more random spots land on water and find nothing. A larger radius helps.
- France's borders include Clipperton Island, which the borders count as France itself; a few spots land there.
