// Shared code: random spots on land inside a country. Used by both tools in this repository; the build puts it into a page
// where that page's app.js says /*SHARED random-spots.js*/ (see src/assemble.js). It uses names that
// app.js defines, as if it were written there.
/* ---------- random spots inside a country ---------- */
// The borders come from country-coder (the same library as countryAt). A country can have many parts
// (islands, overseas territories): a part is chosen with a chance that matches its area, then a spot in
// that part, then countryAt() confirms it, since an overseas part of France may count as another
// territory (Réunion is RE). Spots are spread evenly over the earth's surface, not over the flat map.
// The borders reach far out to sea, so only spots on land are kept (isLand, from the land map built into
// the page, see src/land.js): without that, most spots in New Zealand, Japan or Malta landed in the water.

/**
 * One piece of land of a country, ready for picking spots in it.
 * @typedef {object} BorderPart
 * @property {number[][][]} rings  outer ring first, then holes; points are [lng, lat]
 * @property {number} south
 * @property {number} north
 * @property {number} west
 * @property {number} east
 * @property {number} area         rough size, only compared with the other parts
 */
const borderCache = new Map();
/* The parts of a country's borders, largest first, or [] when the borders are not known. */
function borderParts(code) {
  if (borderCache.has(code)) return borderCache.get(code);
  let parts;
  try {
    const g = window.countryCoder?.aggregateFeature(code)?.geometry;
    const polygons = !g
      ? []
      : g.type === "Polygon"
        ? [g.coordinates]
        : g.type === "MultiPolygon"
          ? g.coordinates
          : [];
    parts = polygons
      .filter(rings => Array.isArray(rings) && rings[0]?.length > 3)
      .map(rings => {
        const lngs = rings[0].map(p => p[0]),
          lats = rings[0].map(p => p[1]);
        const south = Math.min(...lats),
          north = Math.max(...lats);
        // Shoelace formula on the flat map, corrected for the narrowing of degrees of longitude.
        let flat = 0;
        for (let i = 0, ring = rings[0]; i < ring.length - 1; i++)
          flat += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
        const area = (Math.abs(flat) / 2) * Math.cos(toRadians((south + north) / 2));
        return { rings, south, north, west: Math.min(...lngs), east: Math.max(...lngs), area };
      })
      .filter(p => p.area > 0)
      .sort((a, b) => b.area - a.area);
  } catch {
    parts = [];
  }
  borderCache.set(code, parts);
  return parts;
}
/* The land map (LAND, see src/land.js) as one byte per cell, 1 for land; decoded when first needed.
   Null if it is missing or broken: then spots are not checked for land. */
let landCells;
function landGrid() {
  if (landCells !== undefined) return landCells;
  landCells = null;
  try {
    const per = LAND.per,
      width = 360 * per,
      height = 180 * per;
    if (!Number.isInteger(per) || per < 1 || per > 100) return null;
    const bytes = Uint8Array.from(atob(LAND.runs), c => c.charCodeAt(0));
    const cells = new Uint8Array(width * height);
    let at = 0;
    const next = () => {
      let n = 0,
        shift = 0,
        b;
      do {
        if (at >= bytes.length) throw new Error("the land map ends early");
        b = bytes[at++];
        n += (b & 127) * 2 ** shift;
        shift += 7;
      } while (b & 128);
      return n;
    };
    for (let row = 0; row < height; row++)
      for (let col = 0, land = 0; col < width; land ^= 1) {
        const run = next();
        if (col + run > width) throw new Error("a row of the land map is too long");
        if (land) cells.fill(1, row * width + col, row * width + col + run);
        col += run;
      }
    landCells = { per, width, height, cells };
  } catch {
    landCells = null;
  }
  return landCells;
}
/* True if there is land at the point, or within the same cell of about 5 km (also true without a land
   map). */
function isLand(lat, lng) {
  const g = landGrid();
  if (!g) return true;
  const row = Math.min(g.height - 1, Math.max(0, Math.floor((90 - lat) * g.per)));
  const col = Math.min(g.width - 1, Math.max(0, Math.floor((lng + 180) * g.per)));
  return g.cells[row * g.width + col] === 1;
}
/* True if the point lies inside a ring of [lng, lat] points (ray casting). */
function insideRing(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i],
      [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
/* A random spot on land inside the country, or null if none was found (borders missing, say).
   Checking for land comes first, as it is the quickest check: some territories are over 99% sea
   (American Samoa, the Northern Mariana Islands), so it can take hundreds of tries to find land. A country
   whose land the land map does not show (none as of October 2026) is searched without the land check. */
const SPOT_TRIES = 20000;
const seaOnly = new Set(); // countries where no land was found, searched without the land check
function randomPointIn(code) {
  const parts = borderParts(code);
  if (!parts.length) return null;
  if (!seaOnly.has(code)) {
    const p = pickSpot(code, parts, true);
    if (p) return p;
    seaOnly.add(code);
  }
  return pickSpot(code, parts, false);
}
/* One try after another at a random spot in the parts of a country; null after SPOT_TRIES. */
function pickSpot(code, parts, landOnly) {
  const total = parts.reduce((n, p) => n + p.area, 0);
  for (let tries = 0; tries < SPOT_TRIES; tries++) {
    let pick = Math.random() * total,
      part = parts[0];
    for (const p of parts) {
      part = p;
      if ((pick -= p.area) <= 0) break;
    }
    // Picking sin(latitude) evenly spreads the spots evenly by area, also far from the equator.
    const s = Math.sin(toRadians(part.south)),
      n = Math.sin(toRadians(part.north));
    const lat = toDegrees(Math.asin(s + Math.random() * (n - s)));
    const lng = part.west + Math.random() * (part.east - part.west);
    if (landOnly && !isLand(lat, lng)) continue;
    if (!insideRing(lng, lat, part.rings[0])) continue;
    if (part.rings.slice(1).some(hole => insideRing(lng, lat, hole))) continue;
    if (countryAt(lat, lng) === code) return { lat, lng };
  }
  return null;
}
