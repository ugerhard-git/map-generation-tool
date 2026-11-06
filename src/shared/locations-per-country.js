// Shared code: the table of locations per country and the editor of your own distribution. Used by both tools in this repository; the build puts it into a page
// where that page's app.js says /*SHARED locations-per-country.js*/ (see src/assemble.js). It uses names that
// app.js defines, as if it were written there.
/* ---------- locations per country ----------
   Before a search: how many locations each country of the area will get (splitTotal of areaWeights).
   During and after a search: also how many were found. Not shown for a single country. */
/* Draws the table under the steps. */
function renderShares() {
  const box = $("sharesBox"),
    rows = $("shares"),
    note = $("sharesNote");
  const searched = running || searchTargets.size > 0;
  // Your own distribution, before a search: the table is where its shares are entered
  const editing = !searched && distributionUsed() && $("distribution").value === "own" && !!own;
  $("ownEditor").hidden = !editing;
  if (editing) {
    box.hidden = false;
    renderOwnTable();
    return;
  }
  $("sharesWantedHead").textContent = "Wanted";
  $("sharesFoundHead").textContent = "Found";
  const weights = searched ? null : areaWeights();
  const wantedBy = searched ? Object.fromEntries(searchTargets) : planTargets();
  const codes = Object.keys(wantedBy);
  box.hidden = scope() === "countries" && chosenCountries.length < 2 && !(searched && searchTargets.size > 1);
  if (box.hidden) return;
  const order = codes.sort(
    (a, b) => wantedBy[b] - wantedBy[a] || countryName(a).localeCompare(countryName(b)),
  );
  rows.textContent = "";
  let done = 0,
    short = 0;
  for (const code of order) {
    const tr = document.createElement("tr"),
      found = foundBy.get(code) || 0;
    const full = searched && found >= wantedBy[code] && !gaveUp.has(code);
    if (full) done++;
    let foundText = searched ? fmt(found) : "";
    if (full) tr.className = "done";
    else if (searched && noSpots.has(code)) {
      tr.className = "none";
      foundText = "no spots";
    } else if (searched && gaveUp.has(code)) {
      tr.className = "short";
      foundText = `${fmt(found)}, gave up`;
      short++;
    }
    for (const text of [countryName(code), fmt(wantedBy[code]), foundText]) {
      const td = document.createElement("td");
      td.textContent = text;
      tr.append(td);
    }
    rows.append(tr);
  }
  $("sharesSummary").textContent = searched
    ? `Locations per country: ${done} of ${codes.length} countries done${short ? `, ${short} gave up` : ""}`
    : `Locations per country: ${fmt(codes.length)} ${codes.length === 1 ? "country" : "countries"}`;
  // Before a search, say which countries get nothing, and why.
  let why = "";
  if (!searched) {
    const left = Object.keys(weights).filter(c => !wantedBy[c] || wantedBy[c] === 0);
    const notInMap = left.filter(c => !weights[c]),
      tooFew = left.filter(c => weights[c] > 0);
    const mapName = ownChosen() ? `"${distributionLabel()}"` : builtInName();
    if (!codes.length && notInMap.length)
      why = `None of these countries is in ${mapName}. Choose another map.`;
    else {
      if (notInMap.length)
        why += `Not in ${mapName}, so they get none: ${notInMap.map(countryName).join(", ")}. `;
      if (tooFew.length)
        why += `${fmt(tooFew.length)} more ${tooFew.length === 1 ? "country gets" : "countries get"} none: their share of ${fmt(target())} locations rounds down to 0.`;
    }
  }
  note.textContent = why.trim();
  note.hidden = !why;
}

/* The table as the editor of your own distribution: a field per country of the area (a share in %, or a
   number of locations) and what it comes to (the locations, or the share). */
function renderOwnTable() {
  const rows = $("shares"),
    pct = own.mode === "percent";
  setRadio("ownMode", own.mode);
  $("ownName").value = own.name;
  $("sharesWantedHead").textContent = pct ? "Share" : "Locations";
  $("sharesFoundHead").textContent = pct ? "Locations" : "Share";
  rows.textContent = "";
  for (const code of ownAreaCodes().sort((a, b) => countryName(a).localeCompare(countryName(b)))) {
    const input = makeElement("input", {
      type: "text",
      inputMode: pct ? "decimal" : "numeric",
      autocomplete: "off",
      className: "own-input",
      placeholder: "0",
      value: shareText(own.values[code] || 0),
    });
    input.dataset.code = code;
    input.setAttribute("aria-label", `${countryName(code)}: ${pct ? "share in percent" : "locations"}`);
    const share = makeElement("td", { className: "own-cell" }, input);
    if (pct) share.append(makeElement("span", { className: "own-unit" }, "%"));
    // one click takes the country out (sets it to 0)
    const clear = makeElement("button", { type: "button", className: "own-clear", textContent: "×" });
    clear.dataset.code = code;
    clear.setAttribute("aria-label", `Take ${countryName(code)} out (set to 0)`);
    share.append(clear);
    const figure = makeElement("td", { className: "own-figure" });
    figure.dataset.code = code;
    rows.append(makeElement("tr", {}, makeElement("td", {}, countryName(code)), share, figure));
  }
  $("sharesNote").hidden = true;
  updateOwnFigures();
}
/* A share as shown in its field: "12.5" (percent) or "1,000" (locations); "0" for none, so countries that
   a Vali map leaves out are clearly there to be given a share. */
const shareText = v => (!v ? "0" : own?.mode === "number" ? fmt(v) : String(v));
/* A share as typed: a percentage up to 100 with up to two decimals ("12.5", "12,5"), or a whole number of
   locations (with any thousands separator); 0 for an empty field; NaN if it is neither. */
function typedShare(text, mode) {
  const t = String(text).trim().replace(/%$/, "").trim();
  if (!t) return 0;
  if (mode === "number") return typedNumber(t) <= TARGET_MAX ? typedNumber(t) : NaN;
  if (!/^\d{1,3}([.,]\d{1,2})?$/.test(t)) return NaN;
  const n = Number(t.replace(",", "."));
  return n <= 100 ? n : NaN;
}
/* The sum of the shares of the area's countries. */
const ownSum = () => ownAreaCodes().reduce((n, c) => n + (own.values[c] || 0), 0);
/* Updates what the shares come to, the sum line and (for numbers) the number of locations, without
   rebuilding the fields, so typing is not interrupted. */
function updateOwnFigures() {
  const pct = own.mode === "percent",
    targets = planTargets(),
    sum = ownSum();
  for (const b of document.querySelectorAll("#shares .own-clear"))
    b.classList.toggle("none", !own.values[b.dataset.code]);
  for (const cell of document.querySelectorAll("#shares .own-figure")) {
    const v = own.values[cell.dataset.code] || 0;
    cell.textContent = pct
      ? fmt(targets[cell.dataset.code] || 0) // (a small share can round down to 0: the help says so)
      : sum
        ? `${((100 * v) / sum).toFixed(1)}%`
        : "–";
  }
  const round = Math.round(sum * 100) / 100;
  if (pct)
    $("ownSum").textContent = !sum
      ? "Give at least one country a share."
      : round === 100
        ? `Adds up to 100%: ${fmt(target())} locations, shared as above.`
        : `Adds up to ${round}%: shared in proportion.`;
  else
    $("ownSum").textContent =
      sum > TARGET_MAX
        ? `Adds up to ${fmt(sum)} locations, more than one search can find (${fmt(TARGET_MAX)}).`
        : `Adds up to ${fmt(sum)} locations.`;
  $("ownMake100").hidden = !pct || !sum || round === 100;
  // with numbers, their sum is the number of locations
  if (!pct && sum > 0 && sum <= TARGET_MAX && sum !== target()) {
    showNumber("target", sum);
    store.set("target", sum);
  }
  $("sharesSummary").textContent = `Locations per country: ${fmt(ownAreaCodes().length)} countries, ${
    pct ? "your shares" : "your numbers"
  }`;
  updateMore();
  updateMapName();
}
// Typing a share: kept at once (an invalid one is not), and shown cleanly on leaving the field
$("shares").addEventListener("input", e => {
  const input = e.target;
  if (!input.classList?.contains("own-input") || !own) return;
  const v = typedShare(input.value, own.mode);
  if (Number.isNaN(v)) return;
  if (v > 0) own.values[input.dataset.code] = cleanShare(v, own.mode);
  else delete own.values[input.dataset.code];
  saveOwn();
  updateOwnFigures();
});
// The × of a row: that country to 0
$("shares").addEventListener("click", e => {
  const b = e.target.closest?.(".own-clear");
  if (!b || !own) return;
  delete own.values[b.dataset.code];
  saveOwn();
  const input = document.querySelector(`#shares .own-input[data-code="${b.dataset.code}"]`);
  if (input) input.value = shareText(0);
  updateOwnFigures();
});
$("shares").addEventListener("change", e => {
  if (e.target.classList?.contains("own-input") && own)
    e.target.value = shareText(own.values[e.target.dataset.code] || 0);
});
/* Replaces the shares of the area's countries (others, from another area, are kept). */
function setAreaShares(values) {
  for (const c of ownAreaCodes()) delete own.values[c];
  Object.assign(own.values, values);
  saveOwn();
}
// Percentages and numbers: switching converts what is there
for (const r of document.querySelectorAll("input[name=ownMode]"))
  r.onchange = () => {
    if (!own || r.value === own.mode) return;
    const area = Object.fromEntries(ownAreaCodes().map(c => [c, own.values[c] || 0]));
    if (r.value === "number") setAreaShares(splitTotal(area, target()));
    else setAreaShares(toPercent(area));
    own.mode = r.value;
    saveOwn();
    renderShares();
  };
// Every country of the area to 0, to start from nothing (asks for a second click)
$("ownClearAll").onclick = () =>
  confirmClick($("ownClearAll"), "Set every share to 0? Click again", () => {
    setAreaShares({});
    renderShares();
  });
$("ownMake100").onclick = () => {
  setAreaShares(toPercent(Object.fromEntries(ownAreaCodes().map(c => [c, own.values[c] || 0]))));
  renderShares();
};
/* With numbers, a new number of locations scales them all (a preset becomes "Your own" first). */
function scaleOwnTo(total) {
  const mine = ownChosen();
  if (!mine) return;
  if (mine !== own) startOwn(mine, false);
  setAreaShares(splitTotal(Object.fromEntries(ownAreaCodes().map(c => [c, own.values[c] || 0])), total));
}
/* Makes "Your own" from a distribution (a copy) and chooses it; open: show the table to edit it in. */
function startOwn(from, open = true) {
  own = { mode: from.mode, values: { ...from.values }, name: from.name || "" };
  saveOwn();
  renderDistributionChoices();
  $("distribution").value = "own";
  whereChanged();
  if (open) showOwnEditor();
}
/* A button that asks for a second click within a few seconds before doing something that cannot be
   undone; ask is its text in the meantime. */
function confirmClick(button, ask, act) {
  const ASK_FOR = 4000; // ms the second click may take
  if (Date.now() - Number(button.dataset.askedAt || 0) < ASK_FOR) {
    delete button.dataset.askedAt;
    button.textContent = button.dataset.text;
    act();
    return;
  }
  button.dataset.text ||= button.textContent;
  button.dataset.askedAt = String(Date.now());
  button.textContent = ask;
  setTimeout(() => {
    if (Date.now() - Number(button.dataset.askedAt || 0) >= ASK_FOR) button.textContent = button.dataset.text;
  }, ASK_FOR);
}
/* Starts "Your own" with these shares (percentages); if it would replace unsaved edits of "Your own",
   the button asks for a second click first. */
function replaceOwn(button, values) {
  const make = () => startOwn({ mode: "percent", values, name: "" });
  const saved =
    !own ||
    loadPresets().some(p => p.name === own.name && JSON.stringify(p.values) === JSON.stringify(own.values));
  if (saved) make();
  else confirmClick(button, "Replace your own distribution? Click again", make);
}
$("ownFromMap").onclick = () => replaceOwn($("ownFromMap"), toPercent(areaWeights()));
// Equal shares for every country of the area, without choosing a map first (agreed with the owner,
// October 2026: it can be used at once; "Set all to 0" is there to start from nothing instead)
$("ownEqual").onclick = () =>
  replaceOwn($("ownEqual"), toPercent(Object.fromEntries(ownAreaCodes().map(c => [c, 1]))));
$("ownFromPreset").onclick = () => {
  const p = ownChosen();
  if (p) startOwn(p);
};
$("ownEdit").onclick = () => {
  searchTargets = new Map();
  hideShortfall();
  renderShares();
  showOwnEditor();
};
/* Opens the table of locations per country and scrolls to the editor, every time. */
function showOwnEditor() {
  $("sharesBox").open = true;
  $("ownEditor").scrollIntoView({ block: "start", behavior: "smooth" });
}
$("presetDelete").onclick = () =>
  confirmClick($("presetDelete"), "Delete it? Click again", () => {
    const id = $("distribution").value.slice("preset:".length);
    savePresets(loadPresets().filter(p => p.id !== id));
    renderDistributionChoices();
    $("distribution").value = defaultDistribution();
    whereChanged();
  });
$("ownSave").onclick = () => {
  const name = $("ownName").value.trim().slice(0, 40) || own?.name || "";
  if (!own) return;
  if (!name) {
    $("ownSaved").textContent = "Give the preset a name first.";
    $("ownSaved").hidden = false;
    $("ownName").focus();
    return;
  }
  const list = loadPresets(),
    same = list.find(p => p.name.toLowerCase() === name.toLowerCase());
  if (!same && list.length >= PRESETS_MAX) {
    $("ownSaved").textContent =
      `You have ${PRESETS_MAX} presets, the most this browser keeps: delete one first.`;
    $("ownSaved").hidden = false;
    return;
  }
  const entry = {
    id: same ? same.id : Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name,
    mode: own.mode,
    values: { ...own.values },
  };
  savePresets(same ? list.map(p => (p.id === same.id ? entry : p)) : [...list, entry]);
  own.name = name;
  saveOwn();
  renderDistributionChoices();
  $("ownSaved").textContent =
    `${same ? "Replaced" : "Saved as"} "${name}" under "Your maps" in the distribution list.`;
  $("ownSaved").hidden = false;
  updateMore();
};
/* Shows the actions that fit the distribution chosen: make your own from a Vali map; edit a copy of a
   preset or delete it; edit the shares of your own. Starting your own with equal shares is always there. */
function updateOwnActs() {
  const v = $("distribution").value,
    preset = v.startsWith("preset:"),
    mine = v === "own";
  $("ownFromMap").hidden = preset || mine;
  $("ownFromMap").disabled = !distributionUsed();
  $("ownEqual").disabled = !distributionUsed();
  $("ownFromPreset").hidden = $("presetDelete").hidden = !preset;
  $("ownEdit").hidden = !mine;
  $("ownEdit").disabled = !distributionUsed();
  // (says why they are greyed out when pointed at)
  for (const id of ["ownFromMap", "ownEqual", "ownEdit"])
    $(id).title = $(id).disabled ? "Choose two or more countries first" : "";
}
