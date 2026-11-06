"use strict";
/*
 * Unofficial: the app code.
 *
 * The tool builds map-making.app maps of random unofficial Google Street View locations: everything
 * Google shows that Google did not take itself, such as photospheres, drone shots and road coverage
 * taken with other cameras. It is the second tool in this repository (see docs/plan.md, "A second tool:
 * Unofficial"): most of its code is shared with the Map Generation Tool and lives in src/shared/; the
 * build puts each shared file in where a line below says "SHARED <file>" (src/assemble.js). Read them as
 * part of this file. This file holds only what is this tool's own:
 *
 *   - its identity: name, saved settings ("unofficial.…"), every country and territory (COUNTRY_FACTS,
 *     made by the build from country-coder, the land map and Natural Earth's populations,
 *     src/countries.js);
 *   - its distributions: land area (the default), population, population density and equal shares,
 *     besides one's own;
 *   - its filters: whole 360° photos only, the smallest image, with or without arrows, uploaders to
 *     leave out or to keep only;
 *   - its tags: the uploader, arrows or no arrows;
 *   - what a panorama must have: not Google's own (see "what a location must have").
 *
 * HOW A SEARCH RUNS is the same as in the Map Generation Tool (see the overview at the top of src/app.js),
 * with one difference: Google's script can be asked for official coverage only, but not for unofficial
 * coverage only. So each lookup asks for the nearest panorama of any kind, and keeps it only if it is not
 * Google's own (isOfficial). Where official coverage is nearby, Google answers with that, and unofficial
 * coverage next to it stays hidden: such spots are counted as "official coverage instead". Google's
 * "outdoor" source cannot be used either, as it leaves out every photosphere (Google cannot tell whether
 * one is indoors), so indoor photos are found too.
 *
 * SAVED IN THE BROWSER (localStorage, each name starts with "unofficial.", see `store`): the same as in
 * the Map Generation Tool, without its filters and tags, and with full360, minHeight, arrows ("any",
 * "with" or "without"), uploaderMode ("any", "exclude" or "only"), uploaderNames, tagUploader and
 * tagArrows. The unfinished search is in the IndexedDB
 * database "unofficial". A visitor's own Google key is only kept in sessionStorage ("unofficial.key").
 */

/**
 * A Street View spot that made it into the results.
 * @typedef {object} Location
 * @property {number} lat
 * @property {number} lng
 * @property {number} heading    compass direction the camera faces, 0–360
 * @property {number} [pitch]    how far the camera looks up (+) or down (−), −90 to 90; 0 is level
 * @property {number} [zoom]     how far the camera is zoomed in, 0 (widest) to 4, one decimal
 * @property {string} panoId     Google's panorama id
 * @property {string} date       photo date "YYYY-MM" or "YYYY", or ""
 * @property {string} cc         two-letter country code
 * @property {string} uploader   who took the photo, as Google names them ("" when Google does not say)
 * @property {boolean} arrows    the photo has arrows to other photos (Street View lets one walk on)
 */
/**
 * One arrow of a panorama: the direction to a neighbouring panorama and the road name shown on it.
 * @typedef {object} Arrow
 * @property {number} heading    compass direction, 0–360
 * @property {string} description the road name on the arrow, or "" when none is shown
 * @property {string} pano       the id of the panorama the arrow leads to, or "" if Google did not say
 */
/**
 * Google's answer for one lookup, cleaned by cleanPano().
 * @typedef {object} PanoAnswer
 * @property {string} status     "OK", "ZERO_RESULTS", "UNKNOWN_ERROR", "NETWORK", "MALFORMED", …
 * @property {number} [lat]
 * @property {number} [lng]
 * @property {string} [panoId]
 * @property {string} [copyright] "© 2024 Google" for official coverage, else the uploader's name
 * @property {string} [date]
 * @property {Arrow[]} [links]
 * @property {number} [height]   the full image's height in pixels, or 0 when Google did not say
 * @property {number} [width]    the full image's width in pixels (twice the height for a whole 360°
 *                               photo), or 0 when Google did not say
 * @property {{pano: string, date: string}[]} [older] the other photos at the same spot, newest first
 * @property {number|null} [carHeading] the direction the photo's centre faces, 0–360 (Google's
 *                               tiles.centerHeading), or null when Google did not say
 * @property {string} [detail]   what was wrong with the answer, if anything
 */

/* ---------- data: this tool ----------
   What sets this tool apart from the Map Generation Tool (see src/app.js). The shared code uses these
   names. */
const TOOL_NAME = "Unofficial";
/* Settings saved in the browser are named STORE_PREFIX + name (see store); the unfinished search is kept
   in the IndexedDB database DB_NAME. Never changed, so visitors keep what they saved. */
const STORE_PREFIX = "unofficial.",
  DB_NAME = "unofficial";
/* Every country and territory with borders in the page: { code: { area, population, continent, parent } }, made by
   the build (src/countries.js) as COUNTRY_FACTS. Unofficial coverage can be anywhere, so all are offered,
   Antarctica too. */
const COUNTRIES = Object.keys(COUNTRY_FACTS).sort();
/* Countries left out of a settings file, in words. */
const DROPPED_COUNTRY_WORDS = "not known";
/* The settings file (see "settings file"): its format name and the tool in its messages. No settings have
   been renamed yet (OLDER_SETTING_NAMES). */
const SETTINGS_FORMAT = "unofficial settings",
  TOOL_TITLE = "Unofficial",
  OLDER_SETTING_NAMES = [];
/* The other tool in this repository: linked in the header, and named when its settings file is loaded here. */
const OTHER_TOOL = {
  name: "the Map Generation Tool",
  address: "../", // relative, so the link works wherever the two pages are published together
  settingsFormat: "map-generation-tool settings",
};
const RADIUS_DEFAULT = 1000; // metres around a random spot to look for a panorama
/* Random spots in a row without a new location before a country gives up: more than in the Map Generation
   Tool (2,000), as unofficial coverage is rarer and often hidden by Google's own (agreed with the owner,
   November 2026). */
const GIVE_UP_DEFAULT = 5000;
/* Google's sources for a lookup (see lookup): every source. "outdoor" would leave out every photosphere,
   as Google cannot tell whether one is indoors; "google" only gives official coverage. */
const LOOKUP_SOURCES = ["default"];
/* Words for the camera view (see "camera view"): "Along the road" is "As the photo faces" here, and the
   camera's angle is measured from the photo's centre (Google's centerHeading): for road coverage, where
   the car drove; for a photosphere, where the photographer had it face. */
const VIEW_WORDS = {
  road: "As the photo faces",
  front: "the photo's centre",
  above: "The photo from above",
  side: "The camera from the side",
};
/* The country each territory belongs to, for its country tag (see countryTags): from country-coder, as
   the build found it. Hong Kong keeps its own tag only, as in Lookout and the Map Generation Tool. */
const TERRITORY_OF = Object.fromEntries(
  COUNTRIES.filter(c => COUNTRY_FACTS[c].parent).map(c => [c, COUNTRY_FACTS[c].parent]),
);

/*SHARED data.js*/

/*SHARED helpers.js*/

/*SHARED random-spots.js*/

/*SHARED own-distributions.js*/

/* ---------- step 1: distributions ----------
   This tool's part of step 1 (the rest is in src/shared/where.js): the continents, and the built-in
   distributions that share the locations between the countries of the area: by land area (the default),
   population, population density (people per km² of land) or in equal shares. The land area and the
   population come with COUNTRY_FACTS (src/countries.js; the population from Natural Earth, made by
   tools/population.js). */
const DEFAULT_DISTRIBUTION = "land";
const DEFAULT_CONTINENT = "europe";
/* The built-in distributions and their names. */
const BUILT_IN = {
  land: "Land area",
  population: "Population",
  density: "Population density",
  equal: "Equal shares",
};
/* Shown in the country field's list when no country matches what was typed. */
const NO_COUNTRY_MATCHES = "No country or territory matches";
/* The continents: the UN regions that country-coder gives each place (src/countries.js). */
const CONTINENTS = {
  africa: "Africa",
  americas: "Americas",
  antarctica: "Antarctica",
  asia: "Asia",
  europe: "Europe",
  oceania: "Oceania",
};
/* A continent's name ("Europe"), or "" for a code that is not one. */
const continentName = code => (isContinent(code) ? CONTINENTS[code] : "");
/* True for the code of one of the continents. */
const isContinent = code => typeof code === "string" && Object.hasOwn(CONTINENTS, code);
for (const [code, name] of Object.entries(CONTINENTS))
  $("continent").append(makeElement("option", { value: code, textContent: name }));
/* Fills the "Share the locations by" list: your own distributions first, then the built-in ones. */
function renderDistributionChoices() {
  const el = $("distribution");
  const before = el.value || store.get("distribution", "");
  el.textContent = "";
  const option = (value, text) => makeElement("option", { value, textContent: text });
  const mine = makeElement("optgroup", { label: "Your maps" });
  if (own) mine.append(option("own", own.name ? `Your own: ${own.name}` : "Your own"));
  for (const p of loadPresets()) mine.append(option("preset:" + p.id, p.name));
  if (mine.children.length) el.append(mine);
  const builtIn = makeElement("optgroup", { label: "Built in" });
  for (const [value, name] of Object.entries(BUILT_IN)) builtIn.append(option(value, name));
  el.append(builtIn);
  const offered = [...el.options].map(o => o.value);
  el.value = offered.includes(before) ? before : DEFAULT_DISTRIBUTION;
}
/* The distribution chosen when nothing is changed: by land area. */
const defaultDistribution = () => DEFAULT_DISTRIBUTION;
/* A country's share in a built-in distribution: its land area in km², its population, its people per
   km² of land, or 1 for equal shares. A place without people (Bouvet Island) gets nothing by population. */
function builtInShare(code, distribution) {
  const f = COUNTRY_FACTS[code];
  if (distribution === "population") return f.population;
  if (distribution === "density") return f.population / f.area;
  if (distribution === "equal") return 1;
  return f.area;
}
/* The countries of the chosen area with their shares in the chosen built-in distribution (see
   areaWeights). A single country gets everything. */
function builtInWeights() {
  if (scope() === "countries" && chosenCountries.length === 1) return { [chosenCountries[0]]: 1 };
  const d = $("distribution").value;
  return Object.fromEntries(ownAreaCodes().map(c => [c, builtInShare(c, d)]));
}
/* The countries of the area: the chosen countries, the continent's countries, or every country but
   Antarctica for the whole world (it is a tenth of the earth's land, nearly all without any Street View;
   it can be chosen as a country or as a continent). */
function ownAreaCodes() {
  const s = scope();
  if (s === "countries") return chosenCountries.filter(c => COUNTRIES.includes(c));
  if (s === "continent") return COUNTRIES.filter(c => COUNTRY_FACTS[c].continent === $("continent").value);
  return COUNTRIES.filter(c => c !== "AQ");
}
/* The chosen distribution in words, for the map name, or "" when it does not matter (a single country) or
   is the default (land area). */
function distributionLabel() {
  if (!distributionUsed() || $("distribution").value === DEFAULT_DISTRIBUTION) return "";
  const mine = ownChosen();
  if (mine) return mine.name || "your own distribution";
  return (BUILT_IN[$("distribution").value] || "").toLowerCase();
}

/*SHARED where.js*/

/*SHARED period.js*/

/* ---------- step 2: filters ----------
   This tool's filters (the period is shared, src/shared/period.js): whole 360° photos only, the smallest
   image, with or without arrows, and the uploaders to leave out or to keep only. */
/* The smallest image offered, as its height in pixels (0: any size). Phones make photospheres of about
   2,000 to 4,000 pixels high; cameras made for 360° photos and Google's cars more. */
const MIN_HEIGHTS = [0, 2000, 4000, 6000, 8000];
const UPLOADER_MODES = ["any", "exclude", "only"];
/* Arrows: any photo, only photos with arrows to other photos (a series, such as road coverage or a walk),
   or only photos without (one on its own, such as a single photosphere). One choice, as the two exclude
   each other (CONTRIBUTING.md: "A simple interface"). */
const ARROW_CHOICES = ["any", "with", "without"];
for (const h of MIN_HEIGHTS)
  $("minHeight").append(
    makeElement("option", {
      value: String(h),
      textContent: h ? `At least ${fmt(h)} pixels high` : "Any size",
    }),
  );
/* The uploaders typed, one per comma: ["Jane Doe", "ACME Tours"]; at most 50, each up to 100 characters. */
const uploaderList = text =>
  [
    ...new Set(
      String(text)
        .split(",")
        .map(s => s.trim().slice(0, 100))
        .filter(Boolean),
    ),
  ].slice(0, 50);
/* What each location must have: { years: {from, to} | null, full360, minHeight, arrows, uploaderMode,
   uploaders }.
   Uploaders only count with names typed. */
function wanted() {
  const uploaders = uploaderList($("uploaderNames").value);
  const mode = radioValue("uploaderMode", UPLOADER_MODES, "any");
  return {
    years: years(),
    full360: $("full360").checked,
    minHeight: wholeNumber($("minHeight").value, 0, 100000, 0),
    arrows: radioValue("arrows", ARROW_CHOICES, "any"),
    uploaderMode: uploaders.length ? mode : "any",
    uploaders,
  };
}
$("full360").checked = store.get("full360", false) === true;
$("full360").onchange = () => {
  store.set("full360", $("full360").checked);
  updateMapName();
};
{
  const saved = wholeNumber(store.get("minHeight", 0), 0, 100000, 0);
  $("minHeight").value = String(MIN_HEIGHTS.includes(saved) ? saved : 0);
}
$("minHeight").onchange = () => {
  store.set("minHeight", +$("minHeight").value);
  updateMapName();
};
setRadio("arrows", ARROW_CHOICES.includes(store.get("arrows")) ? store.get("arrows") : "any");
for (const r of document.querySelectorAll("input[name=arrows]"))
  r.onchange = () => {
    store.set("arrows", r.value);
    updateMapName();
  };
setRadio(
  "uploaderMode",
  UPLOADER_MODES.includes(store.get("uploaderMode")) ? store.get("uploaderMode") : "any",
);
for (const r of document.querySelectorAll("input[name=uploaderMode]"))
  r.onchange = () => {
    store.set("uploaderMode", r.value);
    updateUploaders();
    updateMapName();
  };
$("uploaderNames").value = cleanText(store.get("uploaderNames", ""), 2000);
$("uploaderNames").oninput = () => {
  store.set("uploaderNames", $("uploaderNames").value.slice(0, 2000));
  updateMapName();
};
/* The names can only be typed while uploaders are left out or kept only. */
function updateUploaders() {
  $("uploaderNames").disabled = radioValue("uploaderMode", UPLOADER_MODES, "any") === "any";
}
updateUploaders();
/* Who took a photo, from its copyright as Google gives it ("© 2023 Jane Doe" -> "Jane Doe"). */
const uploaderOf = copyright =>
  cleanText(copyright, 200)
    .replace(/^\s*(©|\(c\)|copyright)\s*/i, "")
    .replace(/^\d{4}\s*/, "")
    .trim()
    .slice(0, 100);
/* True when an uploader is one of the names typed (without regard to upper and lower case). */
const uploaderIn = (name, list) => list.some(n => n.toLowerCase() === name.toLowerCase());
/* A list of names in words: "Jane Doe", "Jane Doe and ACME", "Jane Doe and 2 more". */
const namesLabel = list => (list.length <= 2 ? list.join(" and ") : `${list[0]} and ${list.length - 1} more`);
/* Short description of what is searched for, for the map name: "Whole 360°, May 2015 – now". */
function wantedLabel(w) {
  const parts = [];
  if (w.full360) parts.push("whole 360°");
  if (w.minHeight) parts.push(`at least ${fmt(w.minHeight)} px`);
  if (w.arrows === "with") parts.push("with arrows");
  if (w.arrows === "without") parts.push("no arrows");
  if (w.years) parts.push(periodLabel(w.years, " – "));
  if (w.uploaderMode === "exclude") parts.push("not by " + namesLabel(w.uploaders));
  if (w.uploaderMode === "only") parts.push("by " + namesLabel(w.uploaders));
  const text = parts.join(", ") || "unofficial coverage";
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/*SHARED how-many.js*/

/* ---------- map file tags: this tool ----------
   The tag options of this tool, and the tags of a location. The rest is in src/shared/tags.js. */
/* Which tags the export gets. The country is ticked unless the visitor unticked it; the others are not. */
const TAG_OPTIONS = {
  tagCountry: true,
  tagUploader: false,
  tagArrows: false,
  tagYear: false,
};
/* The tags of a location for the export, from the ticked options: "Malta", "Jane Doe", "2023". */
function tagsFor(l) {
  const tags = [];
  if ($("tagCountry").checked) tags.push(...countryTagsOf(l));
  if ($("tagUploader").checked && l.uploader) tags.push(l.uploader);
  // (every location gets one of the two, agreed with the owner, November 2026, so either can be filtered for)
  if ($("tagArrows").checked) tags.push(l.arrows ? "Arrows" : "No arrows");
  if ($("tagYear").checked && l.date) tags.push(dateTagOf(l));
  return tags;
}
/* This tool's tag options in words, for the summary of "Map file" (the country and date are shared). */
const TAG_WORDS = { tagUploader: "uploader", tagArrows: "arrows" };

/*SHARED tags.js*/

/*SHARED camera-view.js*/

/* ---------- more options: this tool ----------
   This tool's "More options" sections for its filters (see src/shared/more-options.js), and the line
   under step 2 that says what is looked for. */
/* True when anything is asked of a location, besides unofficial coverage. */
const anythingWanted = w =>
  !!w.years || w.full360 || w.minHeight > 0 || w.arrows !== "any" || w.uploaderMode !== "any";
/* The line under step 2 when nothing is asked. */
const ANY_LOCATION_WORDS = "Any unofficial location. Choose more in the sections below.";
/** @type {Record<string, {summary: () => string, changed: () => boolean, reset: () => void}>} */
const MORE_TOOL = {
  morePhotos: {
    summary: () => {
      const w = wanted();
      const bits = [w.years ? periodLabel(w.years) : "Any time"];
      if (w.full360) bits.push("whole 360° only");
      if (w.minHeight) bits.push(`at least ${fmt(w.minHeight)} pixels high`);
      if (w.arrows === "with") bits.push("with arrows");
      if (w.arrows === "without") bits.push("no arrows");
      return bits.join(", ");
    },
    changed: () =>
      $("yearsOn").checked ||
      +$("yearFrom").value !== YEAR_FIRST ||
      +$("monthFrom").value !== 1 ||
      $("yearTo").value !== "now" ||
      +$("monthTo").value !== 12 ||
      $("full360").checked ||
      $("minHeight").value !== "0" ||
      radioValue("arrows", ARROW_CHOICES, "any") !== "any",
    reset: () => {
      setControl("yearFrom", String(YEAR_FIRST));
      setControl("monthFrom", "1");
      setControl("yearTo", "now");
      setControl("monthTo", "12");
      setControl("yearsOn", false);
      setControl("full360", false);
      setControl("minHeight", "0");
      setRadio("arrows", "any");
      store.set("arrows", "any");
      updateMapName();
    },
  },
  moreUploaders: {
    summary: () => {
      const w = wanted();
      if (w.uploaderMode === "exclude") return "Not by " + namesLabel(w.uploaders);
      if (w.uploaderMode === "only") return "Only by " + namesLabel(w.uploaders);
      return "Any uploader";
    },
    // (names typed for anyone's photos are greyed out and do nothing, so they are not a change)
    changed: () => radioValue("uploaderMode", UPLOADER_MODES, "any") !== "any",
    reset: () => {
      setRadio("uploaderMode", "any");
      store.set("uploaderMode", "any");
      setControl("uploaderNames", "");
      updateUploaders();
      updateMapName();
    },
  },
};

/*SHARED more-options.js*/

/*SHARED locations-per-country.js*/

/*SHARED map.js*/

/*SHARED google.js*/

/* ---------- what a location must have ----------
   This tool's checks of a panorama, which the search (src/shared/run.js) asks: not Google's own, and the
   filters chosen. Also what is kept about a location, and the counters and words of this tool. */
/* This tool's counters, added to the shared ones (see emptyStats). */
const TOOL_STATS = {
  official: 0, // Google answered with its own coverage, which hides any unofficial coverage nearer than it
};
/* The counter of random spots with nothing found nearby, in the counters under the progress bar. */
const EMPTY_WORDS = "without any Street View nearby";
/* This tool's counters under the progress bar, after the shared ones. */
function toolTally(add) {
  if (stats.official) add(stats.official, "official coverage instead");
}
/* This tool's settings for a search, besides the shared ones (see searchSettingsNow): none. */
const toolSearchSettings = () => ({});
/* Google's sources for a lookup: every source (see LOOKUP_SOURCES). */
const lookupSources = () => LOOKUP_SOURCES;
/* Whether a panorama found for a country matches what is asked (want): not Google's own, a whole 360°
   photo and large enough if that is asked, with or without arrows, from the period, by the uploaders asked for. Resolves to
   { pano, facts }, to "official" (counted apart, as such spots hide unofficial coverage), or to null when
   it does not match. (Async like the Map Generation Tool's, which may look up an older photo.) */
async function panoramaWanted(r, code, key, want) {
  if (isOfficial(r.copyright)) return "official";
  const uploader = uploaderOf(r.copyright);
  if (
    (want.full360 && !(r.height > 0 && r.width === 2 * r.height)) ||
    (want.minHeight && r.height < want.minHeight) ||
    (want.arrows === "with" && !r.links.length) ||
    (want.arrows === "without" && r.links.length > 0) ||
    (want.years && !inYears(r.date, want.years)) ||
    (want.uploaderMode === "exclude" && uploaderIn(uploader, want.uploaders)) ||
    (want.uploaderMode === "only" && !uploaderIn(uploader, want.uploaders))
  )
    return null;
  return { pano: r, facts: arrowFacts(r.links) };
}
/* The checks after the one that the panorama lies in the country: none here. */
const laterChecks = () => true;
/* What this tool keeps about a location, besides the shared fields (see Location). */
const locationFields = r => ({ uploader: uploaderOf(r.copyright), arrows: r.links.length > 0 });
/* What a location has, in words, for its popup on the map. */
const locationFacts = l =>
  [l.uploader && "By " + l.uploader, l.arrows ? "Arrows" : "No arrows"].filter(Boolean);
/* Where the camera faces with "As the photo faces" (see locationView): the photo's centre, or any
   direction when Google does not say. */
const roadHeading = r => r.carHeading ?? Math.random() * 360;

/*SHARED run.js*/

/*SHARED continuing.js*/

/*SHARED time-left.js*/

/*SHARED shortfalls.js*/

/*SHARED export.js*/
/*SHARED map-file-size.js*/

/* ---------- settings: this tool ----------
   This tool's settings in the shared description of the settings (see "history of searches"): what the
   filters add to currentSettings, cleanSettings and applySettings, how the history describes them, and
   what an unfinished search keeps about each location. */
/* This tool's filter settings in the form now (see currentSettings). */
const toolSettings = () => ({
  full360: $("full360").checked,
  minHeight: wholeNumber($("minHeight").value, 0, 100000, 0),
  arrows: radioValue("arrows", ARROW_CHOICES, "any"),
  uploaderMode: radioValue("uploaderMode", UPLOADER_MODES, "any"),
  uploaderNames: $("uploaderNames").value.trim().slice(0, 2000),
});
/* This tool's filter settings read back from outside, checked (see cleanSettings). */
const cleanToolSettings = r => ({
  full360: r.full360 === true,
  minHeight: MIN_HEIGHTS.includes(r.minHeight) ? r.minHeight : 0,
  arrows: ARROW_CHOICES.includes(r.arrows) ? r.arrows : "any",
  uploaderMode: UPLOADER_MODES.includes(r.uploaderMode) ? r.uploaderMode : "any",
  uploaderNames: cleanText(r.uploaderNames, 2000).trim(),
});
/* Puts this tool's filter settings into the form and saves them (see applySettings). */
function applyToolSettings(s) {
  $("full360").checked = s.full360;
  store.set("full360", s.full360);
  $("minHeight").value = String(s.minHeight);
  store.set("minHeight", s.minHeight);
  setRadio("arrows", s.arrows);
  store.set("arrows", s.arrows);
  setRadio("uploaderMode", s.uploaderMode);
  store.set("uploaderMode", s.uploaderMode);
  $("uploaderNames").value = s.uploaderNames;
  store.set("uploaderNames", s.uploaderNames);
  updateUploaders();
}
/* A distribution read back from outside that is not one of your own: a built-in one, else the default. */
const cleanBuiltIn = d => (typeof d === "string" && Object.hasOwn(BUILT_IN, d) ? d : DEFAULT_DISTRIBUTION);
/* The built-in distribution of settings in words, for the history: "Land area". */
const builtInWords = s => BUILT_IN[s.distribution] || s.distribution;
/* What the chosen built-in distribution leaves countries out of, for the table of locations per country:
   "Not in the population figures, so they get none: Bouvet Island". */
const builtInName = () =>
  ["population", "density"].includes($("distribution").value)
    ? "the population figures"
    : "this distribution";
/* What settings ask of each location, as wanted() gives it for the form. */
const wantedOf = s => {
  const uploaders = uploaderList(s.uploaderNames);
  return {
    years: s.yearsOn ? periodOf(s) : null,
    full360: s.full360,
    minHeight: s.minHeight,
    arrows: s.arrows,
    uploaderMode: uploaders.length ? s.uploaderMode : "any",
    uploaders,
  };
};
/* More about settings in words, for the history: nothing here. */
const toolDetails = () => [];
/* This tool's fields of a location read back from an unfinished search, checked (see cleanLocation). */
const cleanLocationFields = l => ({ uploader: cleanText(l.uploader, 100), arrows: l.arrows === true });

/*SHARED history.js*/

/*SHARED settings-file.js*/

/*SHARED unfinished-search.js*/

/*SHARED dialogs.js*/
