// Shared code: landscape. Used by both tools; the build puts it into a page where that page's app.js says
// /*SHARED landscape.js*/ (see src/assemble.js). It uses names that app.js defines, as if it were written
// there.
/* ---------- landscape ----------
   "Landscape" (plan step 47, agreed with the owner in November 2026): keep only locations in a forest, on
   farmland, in grassland or shrubland, or on bare ground or in a desert, and the tag "Forest", "Farmland",
   "Grassland" or "Bare ground". It goes by ESA WorldCover 2021 (10 m, CC BY 4.0), made by
   tools/landscape.js into the main landscape of every square of 1/120° (about 1 km), so a location gets
   what its road runs through; water does not count. The map is in tiles of 10° (made on GitHub, see
   .github/workflows/landscape.yml), files next to the page (LANDSCAPE: where, their integrity values and
   the grid), and a page loads a tile only when it looks at a place in it, with the setting or the tag on;
   the page's policy allows these fetches ('self'), as for the settlement map. While tiles load, a line
   under the choice says so, with a spinner; if one cannot be loaded, the line says that, and a search
   that needs it stops with that message. Built-up squares are left to "Town or countryside"; they, the
   rest (ice, wetland, tundra) and the sea get no landscape. How the map is loaded is in tile-maps.js. */
const LANDSCAPE_CHOICES = ["any", "forest", "farmland", "grassland", "bare"];
/* The landscape map, loaded tile by tile (see tile-maps.js). */
const landscapeMap = tileMap(
  LANDSCAPE,
  "landscape map",
  "landscapeStatus",
  // (the tag's box is restored after this file runs, so at first its saved value counts)
  () => landscapeChosen() !== "any" || $("tagLandscape").checked || store.get("tagLandscape", false) === true,
);
const landscapeNote = () => landscapeMap.note();
/* The choice in the form: "any" or one of the landscapes. */
function landscapeChosen() {
  return document.querySelector("input[name=landscape]:checked")?.value || "any";
}
setRadio("landscape", LANDSCAPE_CHOICES.includes(store.get("landscape")) ? store.get("landscape") : "any");
for (const r of document.querySelectorAll("input[name=landscape]"))
  r.addEventListener("change", () => {
    store.set("landscape", landscapeChosen());
    landscapeNote();
  });
/* The landscape of a place: "forest", "farmland", "grassland", "bare", "built-up", "other" or "" (the sea,
   or nothing known); null when its tile could not be loaded. Loads the tile first if needed. */
async function landscapeOf(lat, lng) {
  const value = await landscapeMap.valueAt(lat, lng);
  return value === null ? null : LANDSCAPE.classes[value] || "";
}
/* In words, for the map name, summaries and the history: "" for any. */
const landscapeWords = choice =>
  ({
    forest: "in a forest",
    farmland: "on farmland",
    grassland: "in grassland or shrubland",
    bare: "on bare ground or in a desert",
  })[choice] || "";
/* The tag of a location with the tag on: "Forest", "Farmland", "Grassland", "Bare ground", or none. */
const landscapeTag = l =>
  ({ forest: "Forest", farmland: "Farmland", grassland: "Grassland", bare: "Bare ground" })[l.landscape] ||
  "";
/* For the popup: what the landscape is, or "". */
const landscapeFact = l =>
  ({
    forest: "Forest",
    farmland: "Farmland",
    grassland: "Grassland or shrubland",
    bare: "Bare ground or desert",
  })[l.landscape] || "";
/* For the search (see checkPanorama): the landscape of a panorama when the setting or the tag needs it
   (undefined when neither does), and whether it is the one asked for. landscape is null when its tile
   could not be loaded. */
async function landscapeWanted(lat, lng, choice) {
  const needed = (choice && choice !== "any") || $("tagLandscape").checked;
  if (!needed) return { wanted: true };
  const landscape = await landscapeOf(lat, lng);
  return { landscape, wanted: !choice || choice === "any" || landscape === choice };
}
$("tagLandscape").addEventListener("change", landscapeNote);
landscapeNote();
