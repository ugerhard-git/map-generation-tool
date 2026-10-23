// The land map built into the page, made by src/build.js from Natural Earth's land outlines (the
// world-atlas package, land-10m.json; public domain, packaged under the ISC licence).
//
// Why: the country borders of country-coder reach far out to sea (New Zealand's shape is about 87% sea,
// Malta's about 95%), so many random spots landed in the water, where there is no Street View. The page
// keeps only spots on land (app.js: random spots).
//
// The map is a grid of PER cells per degree (20: cells about 5.5 km tall). A cell counts as land if any
// land lies in it, also a sliver of coast, so small islands are never lost and spots just off a coast,
// where a road may be within the search radius, are kept. Each row of the grid, from north to south and
// from 180° west eastwards, is stored as the lengths of its runs of sea and land cells, starting with sea,
// each written as a variable-length number (7 bits per byte, the top bit set on all but the last byte).
// The bytes are embedded in the page as base64 text.
const fs = require("fs");

const PER = 20;

/** Natural Earth's land polygons as arrays of rings of [lng, lat] points, decoded from TopoJSON. */
function landPolygons(file) {
  const topo = JSON.parse(fs.readFileSync(file, "utf8"));
  const { scale, translate } = topo.transform;
  // TopoJSON stores shared lines ("arcs") once, as small steps from the previous point.
  const arcs = topo.arcs.map(arc => {
    let x = 0,
      y = 0;
    return arc.map(([dx, dy]) => {
      x += dx;
      y += dy;
      return [x * scale[0] + translate[0], y * scale[1] + translate[1]];
    });
  });
  // A ring lists its arcs by number; a negative number ~i means arc i backwards.
  const ring = ids => {
    const out = [];
    for (const i of ids) {
      const arc = i < 0 ? arcs[~i].slice().reverse() : arcs[i];
      out.push(...(out.length ? arc.slice(1) : arc));
    }
    return out;
  };
  const land = topo.objects.land;
  const polygons = [];
  for (const g of land.geometries || [land])
    for (const p of g.type === "Polygon" ? [g.arcs] : g.arcs) polygons.push(p.map(ring));
  if (polygons.length < 1000)
    throw new Error(`expected thousands of land polygons, found ${polygons.length}`);
  return polygons;
}

/** The land grid: a byte per cell, 1 for land, row by row from the north. */
function landGrid(polygons) {
  const W = 360 * PER,
    H = 180 * PER,
    cells = new Uint8Array(W * H);
  const mark = (row, col) => {
    if (row >= 0 && row < H) cells[row * W + (((col % W) + W) % W)] = 1;
  };
  for (const rings of polygons) {
    // Cells whose centre is inside the polygon (holes, such as lakes, are left out)
    let south = 90,
      north = -90;
    for (const [, lat] of rings[0]) {
      south = Math.min(south, lat);
      north = Math.max(north, lat);
    }
    const first = Math.max(0, Math.floor((90 - north) * PER)),
      last = Math.min(H - 1, Math.floor((90 - south) * PER));
    for (let row = first; row <= last; row++) {
      const lat = 90 - (row + 0.5) / PER,
        crossings = [];
      for (const r of rings)
        for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
          const [x1, y1] = r[i],
            [x2, y2] = r[j];
          if (y1 > lat !== y2 > lat) crossings.push(x1 + ((lat - y1) * (x2 - x1)) / (y2 - y1));
        }
      crossings.sort((a, b) => a - b);
      for (let k = 0; k + 1 < crossings.length; k += 2) {
        const from = Math.ceil((crossings[k] + 180) * PER - 0.5),
          to = Math.floor((crossings[k + 1] + 180) * PER - 0.5);
        for (let col = from; col <= to; col++) mark(row, col);
      }
    }
    // Cells the coastline passes through, so that slivers of coast and small islands count too
    for (const r of rings)
      for (let i = 0; i + 1 < r.length; i++) {
        const [x1, y1] = r[i],
          [x2, y2] = r[i + 1];
        const steps = Math.ceil(Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1)) * PER * 2) + 1;
        for (let t = 0; t <= steps; t++)
          mark(
            Math.floor((90 - (y1 + ((y2 - y1) * t) / steps)) * PER),
            Math.floor((x1 + ((x2 - x1) * t) / steps + 180) * PER),
          );
      }
  }
  return cells;
}

/** The grid as run lengths in base64 (see the top of this file). */
function encode(cells) {
  const W = 360 * PER,
    H = 180 * PER,
    bytes = [];
  const number = n => {
    while (n >= 128) {
      bytes.push((n & 127) | 128);
      n >>>= 7;
    }
    bytes.push(n);
  };
  for (let row = 0; row < H; row++) {
    let value = 0,
      run = 0;
    for (let col = 0; col < W; col++) {
      if (cells[row * W + col] === value) run++;
      else {
        number(run);
        value ^= 1;
        run = 1;
      }
    }
    number(run);
  }
  return Buffer.from(bytes).toString("base64");
}

/** The land map for the page: { per, runs }. */
function landMap(file) {
  const cells = landGrid(landPolygons(file));
  const share = cells.reduce((n, c) => n + c, 0) / cells.length;
  // About 29% of the earth is land; with the coast cells, about 30%.
  if (share < 0.25 || share > 0.36) throw new Error(`the land map is ${(share * 100).toFixed(1)}% land`);
  return { per: PER, runs: encode(cells) };
}

module.exports = { landMap };
