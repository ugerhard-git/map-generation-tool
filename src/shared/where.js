// Shared code: step 1, where: the countries, the area and how its countries share the locations. Used by both tools in this repository; the build puts it into a page
// where that page's app.js says /*SHARED where.js*/ (see src/assemble.js). It uses names that
// app.js defines, as if it were written there.
/* ---------- step 1: where ----------
   Three ways to say where: chosen countries, a continent, or the whole world. Countries are added as
   chips through a field that suggests countries while typing (the same pattern as Lookout's kind
   picker). With more than one country, a distribution says how the locations are shared between them
   (each tool's own, see "step 1: distributions" in its app.js); see "locations per country". */
/** @type {{code: string, name: string, folded: string}[]} the countries offered, sorted by name */
const COUNTRY_CHOICES = COUNTRIES.map(code => {
  const name = countryName(code);
  return { code, name, folded: foldAccents(name) };
}).sort((a, b) => a.name.localeCompare(b.name));
/** @type {string[]} codes of the chosen countries, in the order they were added */
let chosenCountries = [],
  countryMatches = [],
  countryActive = -1;
const countryEl = $("country"),
  countryListEl = $("countryList");
/* Where to search: "countries", "continent" or "world". */
const scope = () => document.querySelector("input[name=scope]:checked")?.value || "countries";
/* The countries matching typed text, leaving out those already chosen: the country with that two-letter
   code ("de": Germany) first, then names starting with it, names with a word starting with it, names
   containing it. All for empty text. */
function matchCountries(text) {
  const q = foldAccents(text.trim());
  const open = COUNTRY_CHOICES.filter(c => !chosenCountries.includes(c.code));
  if (!q) return open;
  const byCode = [],
    starts = [],
    wordStarts = [],
    contains = [];
  for (const c of open) {
    if (c.code.toLowerCase() === q) byCode.push(c);
    else if (c.folded.startsWith(q)) starts.push(c);
    else if (c.folded.split(/[\s\-–(]+/).some(w => w.startsWith(q))) wordStarts.push(c);
    else if (c.folded.includes(q)) contains.push(c);
  }
  return [...byCode, ...starts, ...wordStarts, ...contains];
}
/* Shows the list of matching countries under the field. */
function showCountryList() {
  countryMatches = matchCountries(countryEl.value);
  countryListEl.textContent = "";
  if (!countryMatches.length) {
    const li = document.createElement("li");
    li.className = "none";
    li.setAttribute("role", "presentation");
    li.textContent = NO_COUNTRY_MATCHES;
    countryListEl.append(li);
  }
  countryMatches.forEach((c, i) => {
    const li = document.createElement("li");
    li.id = "country" + i;
    li.dataset.i = i;
    li.setAttribute("role", "option");
    li.setAttribute("aria-selected", "false");
    li.textContent = c.name;
    countryListEl.append(li);
  });
  countryListEl.hidden = false;
  countryEl.setAttribute("aria-expanded", "true");
  setCountryActive(countryMatches.length ? 0 : -1);
}
function setCountryActive(i) {
  countryActive = i;
  countryListEl
    .querySelectorAll("li[role=option]")
    .forEach(li => li.setAttribute("aria-selected", +li.dataset.i === i ? "true" : "false"));
  if (i >= 0) {
    countryEl.setAttribute("aria-activedescendant", "country" + i);
    $("country" + i)?.scrollIntoView({ block: "nearest" });
  } else countryEl.removeAttribute("aria-activedescendant");
}
function closeCountryList() {
  countryListEl.hidden = true;
  countryEl.setAttribute("aria-expanded", "false");
  countryEl.removeAttribute("aria-activedescendant");
  countryActive = -1;
}
/* Adds a country to the chosen ones and empties the field for the next one. */
function addCountry(code) {
  if (COUNTRIES.includes(code) && !chosenCountries.includes(code)) chosenCountries.push(code);
  countryEl.value = "";
  closeCountryList();
  whereChanged();
}
function removeCountry(code) {
  chosenCountries = chosenCountries.filter(c => c !== code);
  whereChanged();
  countryEl.focus();
}
/* Draws the chosen countries as chips; a click on one removes it. */
function renderCountryChips() {
  const chips = $("countryChips");
  chips.textContent = "";
  for (const code of chosenCountries) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip";
    b.textContent = countryName(code);
    b.setAttribute("aria-label", `Remove ${countryName(code)}`);
    b.onclick = () => removeCountry(code);
    chips.append(b);
  }
  chips.hidden = !chosenCountries.length;
  $("clearCountries").hidden = chosenCountries.length < 2;
  countryEl.placeholder = chosenCountries.length ? "Add another country" : "Start typing, for example Malta";
}
/* "Remove all countries" (asked for by the owner, November 2026): with two or more chosen, removes them
   all after asking, in a dialog that names them. */
$("clearCountries").onclick = () => {
  const n = chosenCountries.length,
    names = chosenCountries.map(countryName);
  $("clearCountriesText").textContent =
    n <= 8
      ? `This removes the ${fmt(n)} chosen countries: ${names.join(", ")}.`
      : `This removes the ${fmt(n)} chosen countries: ${names.slice(0, 6).join(", ")} and ${fmt(n - 6)} more.`;
  openDialog("clearCountriesDialog");
};
$("clearCountriesGo").onclick = () => {
  closeDialog();
  chosenCountries = [];
  whereChanged();
  countryEl.focus();
};
$("clearCountriesCancel").onclick = closeDialog;
$("clearCountriesX").onclick = closeDialog;
countryEl.addEventListener("input", showCountryList);
countryEl.addEventListener("focus", showCountryList);
countryEl.addEventListener("keydown", e => {
  // Backspace in the empty field removes the last chosen country.
  if (e.key === "Backspace" && !countryEl.value && chosenCountries.length) {
    chosenCountries.pop();
    whereChanged();
    return;
  }
  if (countryListEl.hidden) {
    if (e.key === "ArrowDown") showCountryList();
    return;
  }
  if (e.key === "ArrowDown") {
    e.preventDefault();
    setCountryActive(Math.min(countryMatches.length - 1, countryActive + 1));
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    setCountryActive(Math.max(0, countryActive - 1));
  } else if (e.key === "Enter") {
    // Pick the highlighted country instead of starting the search.
    e.preventDefault();
    if (countryActive >= 0) addCountry(countryMatches[countryActive].code);
  } else if (e.key === "Escape") {
    countryEl.value = "";
    closeCountryList();
  }
});
countryListEl.addEventListener("mousedown", e => {
  const li = e.target.closest("li[role=option]");
  if (li) {
    e.preventDefault(); // keep the focus in the field
    addCountry(countryMatches[+li.dataset.i].code);
  }
});
// Leaving the field: text that matches exactly one country (or a country's whole name) adds it;
// anything else is cleared.
countryEl.addEventListener("blur", () =>
  setTimeout(() => {
    if (countryListEl.hidden) return;
    const typed = countryEl.value.trim();
    const matches = matchCountries(typed);
    const exact = matches.find(c => c.folded === foldAccents(typed));
    if (typed && (exact || matches.length === 1)) addCountry((exact || matches[0]).code);
    else {
      countryEl.value = "";
      closeCountryList();
    }
  }, 120),
);

/* Shows the parts of step 1 that belong to the chosen area. */
function renderWhere() {
  const s = scope();
  $("countriesBox").hidden = s !== "countries";
  $("continentBox").hidden = s !== "continent";
  // A single country gets every location, so the distribution does not apply: greyed out, not hidden
  $("distribution").disabled = !distributionUsed();
  $("distributionNote").hidden = distributionUsed();
  updateOwnActs();
  renderCountryChips();
}
/* True when the locations are shared between countries, so the distribution matters. */
const distributionUsed = () => scope() !== "countries" || chosenCountries.length > 1;
/* After any change in step 1: save it, and update what depends on it. The table of locations per
   country then shows the new plan instead of the last search. */
function whereChanged() {
  if (!running) {
    searchTargets = new Map();
    hideShortfall();
  }
  store.set("scope", scope());
  store.set("countries", chosenCountries);
  store.set("continent", $("continent").value);
  renderDistributionChoices();
  store.set("distribution", $("distribution").value);
  renderWhere();
  renderShares();
  updateMapName();
  updateMore(); // the distribution's summary depends on the area
}
for (const r of document.querySelectorAll("input[name=scope]")) r.onchange = whereChanged;
$("continent").onchange = whereChanged;
$("distribution").onchange = whereChanged;

/* The countries of the chosen area with their shares (relative numbers, not counts): from a distribution
   of one's own, else from the tool's built-in distribution chosen (builtInWeights). */
function areaWeights() {
  const mine = distributionUsed() ? ownChosen() : null;
  if (mine) return Object.fromEntries(ownAreaCodes().map(c => [c, mine.values[c] || 0]));
  return builtInWeights();
}
/* The distribution chosen, if it is one of your own ("Your own" or a preset): { mode, values, name }. */
function ownChosen() {
  const v = $("distribution").value;
  if (v === "own") return own;
  if (v.startsWith("preset:")) return loadPresets().find(p => "preset:" + p.id === v) || null;
  return null;
}
/* How many locations each country of the area gets with the settings now: exact numbers from a
   distribution of one's own in numbers, else the number of locations shared out (splitTotal). */
function planTargets() {
  const mine = distributionUsed() ? ownChosen() : null;
  if (mine && mine.mode === "number")
    return Object.fromEntries(
      ownAreaCodes()
        .filter(c => mine.values[c] > 0)
        .map(c => [c, mine.values[c]]),
    );
  return splitTotal(areaWeights(), target());
}
/* Splits a total between countries in proportion to their shares, in whole numbers that add up to the
   total (largest remainder method: everyone gets the whole part of their exact share, and what is left
   goes one by one to the largest fractions). Only countries that get at least one are listed. */
function splitTotal(weights, total) {
  const entries = Object.entries(weights).filter(([, w]) => w > 0);
  const sum = entries.reduce((n, [, w]) => n + w, 0);
  if (!sum) return {};
  const parts = entries.map(([code, w]) => {
    const exact = (total * w) / sum;
    return { code, w, n: Math.floor(exact), rest: exact - Math.floor(exact) };
  });
  const left = total - parts.reduce((n, p) => n + p.n, 0);
  parts.sort((a, b) => b.rest - a.rest || b.w - a.w || a.code.localeCompare(b.code));
  for (let i = 0; i < left; i++) parts[i].n++;
  return Object.fromEntries(parts.filter(p => p.n > 0).map(p => [p.code, p.n]));
}
/* The area in words, for the map name: "Malta", "Germany, France", "5 countries", "Europe", "World". */
function areaLabel() {
  const s = scope();
  if (s === "world") return "World";
  if (s === "continent") return continentName($("continent").value) || "Continent";
  if (chosenCountries.length <= 3) return chosenCountries.map(countryName).join(", ");
  return `${chosenCountries.length} countries`;
}
{
  // Saved settings. Before several countries could be chosen, one country was saved as "country";
  // it is moved over to "countries" once.
  const old = store.get("country", null);
  if (typeof old === "string" && store.get("countries", null) === null) store.set("countries", [old]);
  try {
    localStorage.removeItem(STORE_PREFIX + "country");
  } catch {}
  const saved = store.get("countries", []);
  chosenCountries = Array.isArray(saved)
    ? [...new Set(saved.filter(c => typeof c === "string" && COUNTRIES.includes(c)))]
    : [];
  const savedScope = store.get("scope", "countries");
  const radio = document.querySelector(
    `input[name=scope][value="${["countries", "continent", "world"].includes(savedScope) ? savedScope : "countries"}"]`,
  );
  radio.checked = true;
  const savedContinent = store.get("continent", DEFAULT_CONTINENT);
  $("continent").value = isContinent(savedContinent) ? savedContinent : DEFAULT_CONTINENT;
  renderDistributionChoices();
  renderWhere();
}
