// Shared code: the map. Used by both tools in this repository; the build puts it into a page
// where that page's app.js says /*SHARED map.js*/ (see src/assemble.js). It uses names that
// app.js defines, as if it were written there.
/* ---------- map ---------- */
let map = null,
  layer = null;
function initMap() {
  if (FRAMED || map) return;
  // Canvas drawing keeps thousands of dots fast.
  map = L.map("map", { worldCopyJump: true, preferCanvas: true }).setView([25, 10], 2);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);
  layer = L.layerGroup().addTo(map);
}
window.addEventListener("load", initMap);
/* Zooms the map to the countries searched: to the largest part of each (France without its overseas
   parts, say), or to the whole world when that is wider than a hemisphere. */
function showArea(codes) {
  if (!map) return;
  const parts = codes.map(c => borderParts(c)[0]).filter(Boolean);
  if (!parts.length) return;
  const south = Math.min(...parts.map(p => p.south)),
    north = Math.max(...parts.map(p => p.north)),
    west = Math.min(...parts.map(p => p.west)),
    east = Math.max(...parts.map(p => p.east));
  if (east - west > 180) map.setView([25, 10], 2);
  else
    map.fitBounds(
      [
        [south, west],
        [north, east],
      ],
      { padding: [20, 20] },
    );
}
/* Street View at a location, facing its heading. */
const streetViewLink = l =>
  `https://www.google.com/maps/@?api=1&map_action=pano&pano=${encodeURIComponent(l.panoId)}&heading=${Math.round(l.heading)}&pitch=${Math.round(l.pitch || 0)}&fov=${linkFov(l.zoom || 0)}`;
/* A zoom as Google Maps links take it: the field of view in degrees, 180° halved for each step of zoom,
   kept within the 10° to 100° such links accept. */
const linkFov = zoom => Math.round(Math.min(100, Math.max(10, 180 / 2 ** zoom)));
/* Draws a found location as a dot with a popup: country, what it has (each tool's locationFacts), photo
   date, Street View button. */
function drawLocation(l) {
  if (!map) return;
  const has = [
    ...locationFacts(l),
    l.town === true ? "In a town or village" : l.town === false ? "In the countryside" : "",
    landscapeFact(l),
  ]
    .filter(Boolean)
    .join(", ");
  L.circleMarker([l.lat, l.lng], {
    radius: 5,
    weight: 1.5,
    color: "#14213d",
    fillColor: "#f2a900",
    fillOpacity: 1,
  })
    .bindPopup(
      `<div class="pop"><b>${esc(countryName(l.cc))}</b>${has ? esc(has) + "<br />" : ""}${l.date ? "Photo from " + esc(l.date) : ""}<a class="sv" href="${esc(streetViewLink(l))}" target="_blank" rel="noopener">Open in Street View</a></div>`,
      { minWidth: 200 },
    )
    .addTo(layer);
}
