// Shared code: town or countryside. Used by both tools; the build puts it into a page where that page's
// app.js says /*SHARED settlements.js*/ (see src/assemble.js). It uses names that app.js defines, as if
// it were written there.
/* ---------- town or countryside ----------
   "Town or countryside" (plan step 46, agreed with the owner in November 2026): keep only locations in a
   town or village, or only those in the countryside, and the tag "Town" or "Countryside". Where the towns
   and villages are comes from the European Commission's Global Human Settlement Layer (GHS-SMOD R2023A,
   2020, CC BY 4.0), made into a file of its own by tools/settlements.js: every 1 km square of the world
   with at least 500 people living close together (a "rural cluster" or more) is "in a town or village".
   The file (2 MB) is loaded only when the setting or the tag is used, from next to the page (SETTLEMENTS:
   where, its integrity value and the grid); the page's policy allows that one fetch ('self'). While it
   loads, a line under the choice says so, with a spinner; if it cannot be loaded, the line says that,
   and a search that needs it stops with that message. The squares are in the World Mollweide projection
   (a sphere of radius 6,378,137 m, as PROJ's ESRI:54009); squareOf works out the square of a place. */
const SETTLEMENT_CHOICES = ["any", "town", "country"];
/** Once loaded: for each row of squares, where its stretches of town squares start in `runs`
 *  (rowStart[row] to rowStart[row + 1]), as start and end column pairs. @type {{rowStart: Uint32Array, runs: Uint16Array} | null} */
let settlementMap = null;
/** The loading going on or done, or null before (and after it failed). @type {Promise<boolean> | null} */
let settlementLoading = null;
/* The choice in the form: "any", "town" (in a town or village) or "country" (in the countryside). */
function settlementChosen() {
  return document.querySelector("input[name=settlement]:checked")?.value || "any";
}
setRadio(
  "settlement",
  SETTLEMENT_CHOICES.includes(store.get("settlement")) ? store.get("settlement") : "any",
);
for (const r of document.querySelectorAll("input[name=settlement]"))
  r.addEventListener("change", () => {
    store.set("settlement", settlementChosen());
    if (settlementChosen() !== "any") loadSettlements();
  });
/* The line under the choice: loading (with a spinner), loaded, or why it could not be loaded. */
function settlementStatus(state, text = "") {
  const el = $("settlementStatus");
  el.hidden = state === "hidden";
  el.className = "settlement-status " + state;
  el.textContent = text;
}
/* Loads the settlement map once (also for the tag); resolves to true when it is there. */
function loadSettlements() {
  if (settlementMap) return Promise.resolve(true);
  if (settlementLoading) return settlementLoading;
  settlementStatus(
    "loading",
    `Loading the map of towns and villages (${(SETTLEMENTS.bytes / 1e6).toFixed(1)} MB)…`,
  );
  settlementLoading = (async () => {
    const res = await fetch(SETTLEMENTS.href, { integrity: SETTLEMENTS.integrity });
    if (!res.ok) throw new Error(`the server answered ${res.status}`);
    const bytes = new Uint8Array(
      await new Response(res.body.pipeThrough(new DecompressionStream("deflate"))).arrayBuffer(),
    );
    settlementMap = readSettlements(bytes, SETTLEMENTS.grid.rows);
    settlementStatus("done", "The map of towns and villages is loaded.");
    // locations found before it was loaded get their town or countryside now (for the tag)
    for (const l of results) if (typeof l.town !== "boolean") l.town = townAt(l.lat, l.lng);
    return true;
  })().catch(e => {
    settlementLoading = null;
    settlementStatus(
      "error",
      "The map of towns and villages could not be loaded" +
        (e && e.message ? ` (${cleanText(e.message, 80)})` : "") +
        ". Check your connection, then choose again.",
    );
    return false;
  });
  return settlementLoading;
}
/* Reads the unpacked file: per row, the number of stretches, then for each the gap since the last one
   and its length, as unsigned LEB128 numbers (see tools/settlements.js). */
function readSettlements(bytes, rows) {
  let at = 0;
  const next = () => {
    let n = 0,
      shift = 1,
      b;
    do {
      if (at >= bytes.length) throw new Error("the file ends early");
      b = bytes[at++];
      n += (b & 127) * shift;
      shift *= 128;
    } while (b & 128);
    return n;
  };
  const rowStart = new Uint32Array(rows + 1),
    pairs = [];
  for (let r = 0; r < rows; r++) {
    rowStart[r] = pairs.length;
    const n = next();
    let end = 0;
    for (let k = 0; k < n; k++) {
      const start = end + next();
      end = start + next();
      pairs.push(start, end);
    }
  }
  rowStart[rows] = pairs.length;
  if (at !== bytes.length) throw new Error("the file has data left over");
  return { rowStart, runs: Uint16Array.from(pairs) };
}
/* The square of the World Mollweide grid a place falls in: { row, col } (rows from the north). */
function squareOf(lat, lng) {
  const g = SETTLEMENTS.grid;
  const phi = (lat * Math.PI) / 180,
    lambda = (lng * Math.PI) / 180;
  // 2θ + sin 2θ = π sin φ, by Newton's method (at the poles θ = φ)
  let theta = phi;
  for (let i = 0; i < 50; i++) {
    const d = 2 + 2 * Math.cos(2 * theta);
    if (Math.abs(d) < 1e-12) break;
    const step = (2 * theta + Math.sin(2 * theta) - Math.PI * Math.sin(phi)) / d;
    theta -= step;
    if (Math.abs(step) < 1e-12) break;
  }
  const x = ((g.radius * 2 * Math.SQRT2) / Math.PI) * lambda * Math.cos(theta),
    y = g.radius * Math.SQRT2 * Math.sin(theta);
  return { row: Math.floor((g.y0 - y) / g.cell), col: Math.floor((x - g.x0) / g.cell) };
}
/* True when a place is in a town or village, false in the countryside; null before the map is loaded. */
function townAt(lat, lng) {
  if (!settlementMap) return null;
  const { row, col } = squareOf(lat, lng);
  if (row < 0 || row >= SETTLEMENTS.grid.rows) return false;
  const { rowStart, runs } = settlementMap;
  // the stretches of a row are in order: find the last one starting at or before the column
  let lo = rowStart[row] / 2,
    hi = rowStart[row + 1] / 2 - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (runs[mid * 2] <= col) lo = mid + 1;
    else hi = mid - 1;
  }
  return hi >= rowStart[row] / 2 && col < runs[hi * 2 + 1];
}
/* For the search (see checkPanorama): whether a panorama is where the choice says; loads the map first
   if needed. Resolves to true, false, or null when the map could not be loaded. */
async function settlementWanted(lat, lng, choice) {
  if (!choice || choice === "any") return true;
  if (!(await loadSettlements())) return null;
  return townAt(lat, lng) === (choice === "town");
}
/* In words, for the map name, summaries and the history: "" for any. */
const settlementWords = choice =>
  choice === "town" ? "in a town or village" : choice === "country" ? "in the countryside" : "";
/* The tag of a location with the tag on: "Town", "Countryside", or none when not known. */
const settlementTag = l => (l.town === true ? "Town" : l.town === false ? "Countryside" : "");
// The tag needs the map too: loaded when it is ticked (also when it was ticked on the last visit)
$("tagSettlement").addEventListener("change", () => {
  if ($("tagSettlement").checked) loadSettlements();
});
if (settlementChosen() !== "any" || store.get("tagSettlement", false) === true) loadSettlements();
