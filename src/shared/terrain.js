// Shared code: terrain. Used by both tools; the build puts it into a page where that page's app.js says
// /*SHARED terrain.js*/ (see src/assemble.js). It uses names that app.js defines, as if it were written
// there.
/* ---------- terrain ----------
   "Terrain" (plan step 48, agreed with the owner in November 2026): keep only flat, hilly or mountainous
   locations, and the tag "Flat", "Hilly" or "Mountainous". It goes by the relief, the highest point minus
   the lowest within about 1.5 km, from the Copernicus DEM GLO-90, made by tools/terrain.js into bands for
   every square of about 1 km; so it says what you see (agreed: a road on the floor of an Alpine valley is
   in the mountains). Flat is under 50 m, hilly 50 to 300 m, mountainous 300 m or more (the owner's choice,
   24 November 2026: the DEM includes trees, which can add 20–30 m; the bands are in TERRAIN.bands, so these
   can change here without making the map again). The sea gets no terrain. The map is loaded tile by tile,
   with a line under the setting (tile-maps.js); if a tile cannot be loaded, a search that needs it stops
   with that message. */
const TERRAIN_CHOICES = ["any", "flat", "hilly", "mountainous"];
const TERRAIN_FLAT_BELOW = 50, // m of relief
  TERRAIN_HILLY_BELOW = 300;
/* The terrain map, loaded tile by tile (see tile-maps.js). */
const terrainMap = tileMap(
  TERRAIN,
  "terrain map",
  "terrainStatus",
  // (the tag's box is restored after this file runs, so at first its saved value counts)
  () => terrainChosen() !== "any" || $("tagTerrain").checked || store.get("tagTerrain", false) === true,
);
const terrainNote = () => terrainMap.note();
/* The choice in the form: "any" or one of the terrains. */
function terrainChosen() {
  return document.querySelector("input[name=terrain]:checked")?.value || "any";
}
setRadio("terrain", TERRAIN_CHOICES.includes(store.get("terrain")) ? store.get("terrain") : "any");
for (const r of document.querySelectorAll("input[name=terrain]"))
  r.addEventListener("change", () => {
    store.set("terrain", terrainChosen());
    terrainNote();
  });
/* The terrain of a place: "flat", "hilly", "mountainous" or "" (the sea); null when its tile could not be
   loaded. Loads the tile first if needed. A band counts by the lowest relief in it (TERRAIN.bands). */
async function terrainOf(lat, lng) {
  const band = await terrainMap.valueAt(lat, lng);
  if (band === null) return null;
  if (!band) return "";
  const from = TERRAIN.bands[band - 1].from;
  return from < TERRAIN_FLAT_BELOW ? "flat" : from < TERRAIN_HILLY_BELOW ? "hilly" : "mountainous";
}
/* In words, for the map name, summaries and the history: "" for any. */
const terrainWords = choice => ({ flat: "flat", hilly: "hilly", mountainous: "mountainous" })[choice] || "";
/* The tag of a location with the tag on, and for the popup: "Flat", "Hilly", "Mountainous", or none. */
const terrainTag = l => ({ flat: "Flat", hilly: "Hilly", mountainous: "Mountainous" })[l.terrain] || "";
/* For the search (see checkPanorama): the terrain of a panorama when the setting or the tag needs it
   (undefined when neither does), and whether it is the one asked for. terrain is null when its tile could
   not be loaded. */
async function terrainWanted(lat, lng, choice) {
  const needed = (choice && choice !== "any") || $("tagTerrain").checked;
  if (!needed) return { wanted: true };
  const terrain = await terrainOf(lat, lng);
  return { terrain, wanted: !choice || choice === "any" || terrain === choice };
}
$("tagTerrain").addEventListener("change", terrainNote);
terrainNote();
