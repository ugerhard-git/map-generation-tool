// Used by the build for Unofficial: the facts about every country and territory that the page needs, from
// the country-coder library and the land map (src/land.js), worked out once per build:
//
//   area       km² of land, for the "Land area" distribution: the land map's cells whose centre lies in the
//              country, sampled every STRIDE cells (a 2.7-second job for the whole earth; measured November
//              2026). A place too small for any sample (Monaco, Vatican City, San Marino, Gibraltar, Macao,
//              Sint Maarten) gets the area inside its borders instead.
//   continent  "africa", "americas", "antarctica", "asia", "europe" or "oceania": the UN region that
//              country-coder gives the place. A country made of several parts (France with its overseas
//              parts, say) has none of its own: CONTINENT_OF gives it. The build stops if a place has none,
//              so a new version of country-coder cannot leave one out unnoticed.
//   population the number of people, from Natural Earth (src/data/population.json, made by
//              tools/population.js); 0 for a place without any (Bouvet Island, say).
//   parent     for a territory, the country whose tag it also gets (as TERRITORY_OF in the Map Generation
//              Tool): Réunion is France's. "" for a country, and for Hong Kong, which keeps its own tag
//              only, as in Lookout.
const STRIDE = 2;
const REGIONS = { "002": "africa", "019": "americas", 142: "asia", 150: "europe", "009": "oceania" };
// The continent of the countries made of several parts, which have no UN region of their own in
// country-coder (checked November 2026), and of Antarctica, which country-coder counts as a region.
const CONTINENT_OF = {
  DK: "europe",
  ES: "europe",
  FR: "europe",
  GB: "europe",
  NL: "europe",
  NO: "europe",
  RU: "europe",
  UM: "oceania",
  US: "americas",
  AQ: "antarctica",
};
const OWN_TAG_ONLY = ["HK"];

/** Rough area in km² of a GeoJSON geometry, on a sphere: good enough for small places. */
function geometryArea(g) {
  if (!g) return 0;
  const polygons = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
  let km2 = 0;
  for (const rings of polygons)
    rings.forEach((ring, i) => {
      let flat = 0,
        lat = 0;
      for (let k = 0; k + 1 < ring.length; k++) {
        flat += ring[k][0] * ring[k + 1][1] - ring[k + 1][0] * ring[k][1];
        lat += ring[k][1];
      }
      const a = (Math.abs(flat) / 2) * Math.cos(((lat / Math.max(1, ring.length - 1)) * Math.PI) / 180);
      km2 += (i === 0 ? 1 : -1) * a * 111.32 * 111.32;
    });
  return Math.max(0, km2);
}

/**
 * @param {Uint8Array} cells the land map, a byte per cell, 1 for land, row by row from the north
 * @param {number} per cells per degree
 * @param {object} cc the country-coder library
 * @param {Record<string, number>} population people per two-letter code (src/data/population.json)
 * @returns {Record<string, {area: number, population: number, continent: string, parent: string}>}
 */
function countryFacts(cells, per, cc, population = {}) {
  const W = 360 * per,
    H = 180 * per;
  const area = {};
  const cellKm2 = (111.32 / per) ** 2 * STRIDE * STRIDE;
  for (let row = 0; row < H; row += STRIDE) {
    const lat = 90 - (row + 0.5) / per,
      km2 = cellKm2 * Math.cos((lat * Math.PI) / 180);
    for (let col = 0; col < W; col += STRIDE) {
      if (!cells[row * W + col]) continue;
      const code = cc.iso1A2Code([-180 + (col + 0.5) / per, lat], { level: "territory" });
      if (code) area[code] = (area[code] || 0) + km2;
    }
  }
  const level = id => cc.feature(id)?.properties.level;
  const facts = {};
  const places = cc.borders.features.filter(
    f => f.properties.iso1A2 && ["country", "territory"].includes(f.properties.level),
  );
  for (const f of places) {
    const code = f.properties.iso1A2;
    // (Ceuta and Melilla, EA, have no borders of their own at this level: they count as Spain)
    const whole = cc.aggregateFeature(code);
    if (!area[code] && !whole?.geometry) continue;
    const groups = f.properties.groups || [];
    const continent = CONTINENT_OF[code] || REGIONS[groups.find(g => REGIONS[g])];
    if (!continent) throw new Error(`countries.js: ${code} has no continent; add it to CONTINENT_OF`);
    const parent =
      f.properties.level === "territory" && !OWN_TAG_ONLY.includes(code)
        ? groups.find(g => /^[A-Z]{2}$/.test(g) && level(g) === "country") || ""
        : "";
    facts[code] = {
      area: Math.max(1, Math.round(area[code] || geometryArea(whole.geometry))),
      population: population[code] || 0,
      continent,
      parent,
    };
  }
  // Antarctica is a region in country-coder, not a country: it is found by the samples only.
  if (area.AQ)
    facts.AQ = {
      area: Math.round(area.AQ),
      population: population.AQ || 0,
      continent: "antarctica",
      parent: "",
    };
  return facts;
}

// ---------- Distribution ----------
// Used by the build for Distribution (src/distribution/): for every country and territory, its name, its
// continent and, for a territory, the country it belongs to. Unlike countryFacts above:
//   - North and South America are two continents, as in Vali's continent lists: South America is the UN
//     subregion 005; Central America, the Caribbean and Northern America count as North America.
//   - Every territory names its country, Hong Kong too (CN): which territories are folded into their
//     country is the page's choice (KEEP_SEPARATE in src/distribution/app.js).
//   - Places without land in the land map are kept too: a map may still have locations there.
// A territory's continent is where it lies (Réunion: Africa), not its country's.
const SOUTH_AMERICA = "005";
const NORTH_AMERICA = ["013", "029", "021"];
const CONTINENT_OF_SPLIT = { ...CONTINENT_OF, US: "northamerica" };

/**
 * @param {object} cc the country-coder library
 * @param {Record<string, string>} names English names from the owner's list (country-tags.json), by code
 * @returns {Record<string, {name: string, continent: string, country: string}>}
 */
function distributionFacts(cc, names = {}) {
  const level = id => cc.feature(id)?.properties.level;
  const facts = {};
  for (const f of cc.borders.features) {
    const p = f.properties;
    if (!p.iso1A2 || !["country", "territory"].includes(p.level)) continue;
    const groups = p.groups || [];
    let continent = CONTINENT_OF_SPLIT[p.iso1A2];
    if (!continent && groups.includes(SOUTH_AMERICA)) continent = "southamerica";
    if (!continent && groups.some(g => NORTH_AMERICA.includes(g))) continent = "northamerica";
    if (!continent && groups.includes("019")) continent = "northamerica"; // (none left in country-coder 5)
    if (!continent) continent = REGIONS[groups.find(g => REGIONS[g])];
    if (!continent) throw new Error(`countries.js: ${p.iso1A2} has no continent; add it to CONTINENT_OF`);
    facts[p.iso1A2] = {
      name: names[p.iso1A2] || p.nameEn || p.iso1A2,
      continent,
      country:
        p.level === "territory" ? groups.find(g => /^[A-Z]{2}$/.test(g) && level(g) === "country") || "" : "",
    };
  }
  facts.AQ = { name: names.AQ || "Antarctica", continent: "antarctica", country: "" };
  return facts;
}

module.exports = { countryFacts, distributionFacts };
