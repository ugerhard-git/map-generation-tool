// Shared code: distributions of the visitor's own. Used by both tools in this repository; the build puts it into a page
// where that page's app.js says /*SHARED own-distributions.js*/ (see src/assemble.js). It uses names that
// app.js defines, as if it were written there.
/* ---------- your own distributions ----------
   Besides the built-in distributions (Vali's maps here), the visitor can share the locations in a distribution of their own (plan step 17):
   started from a Vali map ("Make your own from this map") or a preset, edited in the table of locations
   per country, as percentages (shares of the number of locations; the default) or as exact numbers (their
   sum is the number of locations), and saved as a preset in this browser. In the distribution list,
   "Your own" (value "own") is the one being edited and presets are "preset:<id>", under "Your maps".
   The history and the settings file keep the values themselves (setting "own"), never a preset id, so
   they still work where the preset does not exist. */
const OWN_MODES = ["percent", "number"],
  PRESETS_MAX = 30;
/* A share as kept: a percentage 0–100 with up to two decimals, or a whole number of locations. */
function cleanShare(v, mode) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return mode === "number" ? Math.min(TARGET_MAX, Math.round(n)) : Math.min(100, Math.round(n * 100) / 100);
}
/* A distribution of one's own, read from outside (saved, history, settings file): { mode, values, name }
   with values only for the countries offered (COUNTRIES) and above 0; null if it is not one. */
function cleanOwn(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const mode = OWN_MODES.includes(raw.mode) ? raw.mode : "percent";
  const values = {};
  // Only the countries offered are looked up, so names that are not countries (any number of them, in a
  // settings file) can neither crowd out the real shares nor slow the page down.
  if (raw.values && typeof raw.values === "object" && !Array.isArray(raw.values))
    for (const code of COUNTRIES)
      if (Object.hasOwn(raw.values, code) && cleanShare(raw.values[code], mode) > 0)
        values[code] = cleanShare(raw.values[code], mode);
  return { mode, values, name: cleanText(raw.name, 40).trim() };
}
/** The distribution being edited ("Your own"), or null. @type {{mode: string, values: Record<string, number>, name: string}|null} */
let own = cleanOwn(store.get("own", null));
const saveOwn = () => store.set("own", own);
/* The saved presets, checked: [{ id, name, mode, values }]. */
function loadPresets() {
  const raw = store.get("presets", []);
  if (!Array.isArray(raw)) return [];
  const out = [],
    ids = new Set();
  for (const p of raw.slice(0, PRESETS_MAX)) {
    const c = cleanOwn(p),
      id = cleanText(p?.id, 20);
    if (!c || !c.name || !/^[a-z0-9]{4,20}$/.test(id) || ids.has(id)) continue;
    ids.add(id);
    out.push({ id, ...c });
  }
  return out;
}
const savePresets = list => store.set("presets", list.slice(0, PRESETS_MAX));
/* Percentages for shares that add up to exactly 100 (two decimals; the largest takes the rounding). */
function toPercent(shares) {
  const entries = Object.entries(shares).filter(([, v]) => v > 0);
  const sum = entries.reduce((n, [, v]) => n + v, 0);
  if (!sum) return {};
  const out = Object.fromEntries(entries.map(([c, v]) => [c, Math.round((v / sum) * 10000) / 100]));
  const largest = entries.sort((a, b) => b[1] - a[1])[0][0];
  out[largest] = Math.round((out[largest] + 100 - Object.values(out).reduce((n, v) => n + v, 0)) * 100) / 100;
  return out;
}
