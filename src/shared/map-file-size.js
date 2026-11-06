// Shared code: the size of the map file and making it smaller. Used by both tools in this repository; the build puts it into a page
// where that page's app.js says /*SHARED map-file-size.js*/ (see src/assemble.js). It uses names that
// app.js defines, as if it were written there.
/* ---------- map file size ----------
   The download button shows the map file's size. Over the size limit ("Keep the map file under", 20 MB by
   default, agreed with the owner, October 2026: the most some places take in one upload, such as
   Discord), the page offers to make it smaller once the search has stopped: each country keeps its share
   of the locations (splitTotal), and within each country either the locations closest to others are
   dropped, for an even spread (spreadPick), or random ones. The smaller set replaces the results, so the
   map shows what the file holds; "Undo" brings the full set back until the next search. MB here are
   1,000,000 bytes, the stricter reading, so a file under the limit also fits where 1 MB is 1,048,576. */
const MB = 1e6;
/* The size of the map file for these locations, in bytes (UTF-8, as downloaded). */
const fileBytes = (list = results) => new Blob([exportJson(list)]).size;
/* A size as the page writes it: "850 KB", "1.4 MB". */
const sizeText = bytes =>
  bytes < MB ? `${fmt(Math.max(1, Math.round(bytes / 1000)))} KB` : `${(bytes / MB).toFixed(1)} MB`;
/** The last size worked out, and for what (the size only changes with the results, the name and tags).
 *  @type {{key: string, bytes: number}} */
let sized = { key: "", bytes: 0 };
/** The full results before they were made smaller, for "Undo"; null when there is nothing to undo. */
let unpruned = null;
/* The offer is not shown again for the same map file once "Download anyway" was chosen. */
let pruneSkipped = "";
/* What the map file's size depends on, short: the results (count, first and last), the name, the tags. */
const sizeKey = () =>
  [
    results.length,
    results[0]?.panoId,
    results[results.length - 1]?.panoId,
    mapName(),
    $("tagDate").value,
    $("territoryTag").value,
    ...Object.keys(TAG_OPTIONS).map(id => $(id).checked),
  ].join("|");
/* The map file's size in bytes, worked out again only when something it depends on changed. */
function mapFileBytes() {
  const key = sizeKey();
  if (sized.key !== key) sized = { key, bytes: results.length ? fileBytes() : 0 };
  return sized.bytes;
}
/* Shows the size on the download button and, over the limit after a search, the offer to make it
   smaller. Working out the size of a large map takes a moment, so it waits until typing pauses. */
let sizeTimer = 0;
function sizeSoon() {
  clearTimeout(sizeTimer);
  sizeTimer = setTimeout(showSize, 300);
}
function showSize() {
  if (running || !results.length) {
    $("download").textContent = "Download map file";
    $("prune").hidden = true;
    return;
  }
  const bytes = mapFileBytes();
  $("download").textContent = `Download map file (${sizeText(bytes)})`;
  const limit = sizeLimit() * MB;
  const over = $("sizeLimitOn").checked && bytes > limit && pruneSkipped !== sized.key;
  if (over) {
    const keep = Math.floor(results.length * (limit / bytes) * 0.995);
    $("pruneTitle").textContent =
      `The map file is ${sizeText(bytes)}, over your limit of ${fmt(sizeLimit())} MB.`;
    $("pruneText").textContent =
      `Make it smaller by keeping about ${fmt(keep)} of the ${fmt(results.length)} locations. Each country keeps its share.`;
  }
  $("prune").hidden = !over;
}
/* Picks k of a country's locations spread as evenly as possible: the largest spacing at which there are
   still k locations, each at least that far from all the others kept, is found by halving the range of
   spacings; at each spacing, the locations are taken in a random order and kept if no kept one is that
   close (a grid of cells as large as the spacing finds the near ones quickly). Positions are points in
   space on the earth's surface, so the grid needs no care at the poles or across 180°. */
function spreadPick(list, k) {
  if (k >= list.length) return list.slice();
  if (k <= 0) return [];
  const R = 6371008.8; // the earth's mean radius in metres
  const pts = list.map(l => {
    const la = toRadians(l.lat),
      lo = toRadians(l.lng);
    return [R * Math.cos(la) * Math.cos(lo), R * Math.cos(la) * Math.sin(lo), R * Math.sin(la)];
  });
  const order = list.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  // A grid cell's key: a hash of its three numbers, so it stays a safe whole number however small the
  // cells are. Two cells may share a key; that only means a few more distances are measured.
  const cellKey3 = (x, y, z) => Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791);
  // The locations kept at spacing d (metres), in the random order
  const keptAt = d => {
    const grid = new Map(),
      kept = [];
    const cell = v => Math.floor((v + R) / d);
    for (const i of order) {
      const [x, y, z] = pts[i];
      const cx = cell(x),
        cy = cell(y),
        cz = cell(z);
      let near = false;
      for (let a = -1; a <= 1 && !near; a++)
        for (let b = -1; b <= 1 && !near; b++)
          for (let c = -1; c <= 1 && !near; c++)
            for (const j of grid.get(cellKey3(cx + a, cy + b, cz + c)) || []) {
              const [u, v, w] = pts[j];
              if ((u - x) ** 2 + (v - y) ** 2 + (w - z) ** 2 < d * d) {
                near = true;
                break;
              }
            }
      if (near) continue;
      const key = cellKey3(cx, cy, cz);
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(i);
      kept.push(i);
    }
    return kept;
  };
  // From 1 m (found locations are at least 100 m apart, but a set from elsewhere may be closer) to
  // farther than any two can be
  let lo = 1,
    hi = 2 * R,
    best = order;
  while (hi / lo > 1.01) {
    const d = Math.sqrt(lo * hi); // halving the range on a log scale: spacings go from metres to 1,000s of km
    const kept = keptAt(d);
    if (kept.length >= k) {
      lo = d;
      best = kept;
    } else hi = d;
  }
  // (more than k at the largest spacing found: those first in the random order are kept)
  return best.slice(0, k).map(i => list[i]);
}
/* k of the locations at random. */
function randomPick(list, k) {
  const copy = list.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, k);
}
/* The locations to keep so the map file fits the limit: each country keeps its share of a smaller total;
   the total starts from the average size of a location and is lowered until the file fits. In the
   order they were found. */
function prunedResults(way, limit) {
  const byCountry = new Map();
  for (const l of results) {
    if (!byCountry.has(l.cc)) byCountry.set(l.cc, []);
    byCountry.get(l.cc).push(l);
  }
  const counts = Object.fromEntries([...byCountry].map(([c, list]) => [c, list.length]));
  let total = Math.floor(results.length * (limit / fileBytes()) * 0.995);
  for (let round = 0; round < 8 && total > 0; round++) {
    const keep = new Set();
    for (const [c, k] of Object.entries(splitTotal(counts, total)))
      for (const l of (way === "random" ? randomPick : spreadPick)(byCountry.get(c), k)) keep.add(l);
    const kept = results.filter(l => keep.has(l));
    const bytes = fileBytes(kept);
    if (bytes <= limit) return kept;
    total = Math.floor(total * (limit / bytes) * 0.99);
  }
  return [];
}
/* Puts a set of locations in place of the results: counts, the duplicate checks and the map follow. */
function replaceResults(list) {
  results = list;
  foundBy = new Map();
  for (const l of list) foundBy.set(l.cc, (foundBy.get(l.cc) || 0) + 1);
  cells = new Map();
  seenPanos = new Set();
  for (const l of list) remember(l);
  if (layer) layer.clearLayers();
  for (const l of list.slice(0, MAX_DRAWN)) drawLocation(l);
}
/* "Make it smaller": replaces the results with the smaller set; the full set is kept for "Undo". */
$("pruneGo").onclick = () => {
  if (running || !results.length) return;
  const way =
      document.querySelector("input[name=pruneWay]:checked")?.value === "random" ? "random" : "spread",
    before = results.length;
  $("pruneGo").disabled = true;
  paint("Making the map file smaller…");
  // (after the status line is shown: the work takes a moment with many locations)
  setTimeout(() => {
    const kept = prunedResults(way, sizeLimit() * MB);
    $("pruneGo").disabled = false;
    if (!kept.length) return paint("The map file could not be made small enough.");
    unpruned = {
      results,
      searchTargets: new Map(searchTargets),
      currentTarget,
      unfinished: results.length < currentTarget,
      stoppedKey,
    };
    stoppedKey = ""; // the smaller set is the result: no continuing it
    hideShortfall();
    replaceResults(kept);
    searchTargets = new Map(foundBy);
    currentTarget = kept.length;
    clearSavedSearch(); // the smaller set is the result now, not a search to continue
    $("prunedText").textContent =
      `Kept ${fmt(kept.length)} of ${fmt(before)} locations, ${way === "random" ? "at random" : "evenly spread"}; each country kept its share.`;
    $("pruned").hidden = false;
    paint(`Made smaller: ${fmt(kept.length)} locations. Download the map file when you are ready.`);
    updateContinue();
  }, 30);
};
/* "Undo": the full results again (the offer to make it smaller comes back). */
$("pruneUndo").onclick = () => {
  if (!unpruned || running) return;
  const u = unpruned;
  unpruned = null;
  replaceResults(u.results);
  searchTargets = u.searchTargets;
  currentTarget = u.currentTarget;
  if (u.unfinished) saveSearch(); // it can be continued again
  stoppedKey = u.stoppedKey;
  $("pruned").hidden = true;
  pruneSkipped = "";
  paint(`Back to all ${fmt(results.length)} locations.`);
  updateContinue();
};
$("pruneSkip").onclick = () => {
  pruneSkipped = sized.key;
  $("prune").hidden = true;
  $("download").click();
};
/* Forgets what can be undone, as a new search or "Clear" starts afresh. */
function forgetPrune() {
  unpruned = null;
  pruneSkipped = "";
  $("pruned").hidden = true;
  $("prune").hidden = true;
}
// The name and tags change the size
$("moreMapFile").addEventListener("input", sizeSoon);
$("moreMapFile").addEventListener("change", sizeSoon);

$("clear").onclick = () => {
  stoppedKey = "";
  forgetPrune();
  hideShortfall();
  clearSavedSearch();
  results = [];
  stats = emptyStats();
  searchTargets = new Map();
  foundBy = new Map();
  if (layer) layer.clearLayers();
  paint("Ready.");
  updateContinue();
};
paint();
