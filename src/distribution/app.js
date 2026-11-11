// Distribution: the page's app code. Agreed with the owner in November 2026.
//
// How it works: the visitor chooses one map-making.app map file (JSON). Every location in it gets a
// country (see "counting"), and the page shows how many locations each country, territory or continent
// has and its share of all of them, in one of three views:
//
//   countries   every country and territory on its own (Puerto Rico apart from the United States)
//   folded      territories counted with their country, except those in KEEP_SEPARATE (the owner's choice)
//   continents  where each location lies: a territory counts on its own continent (Réunion: Africa)
//
// The table of the view shown downloads as CSV, in the number format of the visitor's spreadsheet; all
// views download together as an Excel file with one tab each (Google Sheets keeps the tabs when it imports
// one). Nothing is sent anywhere: the page has no map, no Google and talks to no server.
//
// Unlike the two other tools, this page does not use src/shared/: the shared code is about searches
// (settings, history, the map, Google), and the few helpers this page needs are written here.
//
// Shared state: `map` (the file read, or null) and `sort` (the column the table is sorted by).
// Saved in the browser (localStorage, "distribution." + name): `view` and `numberFormat`.

/* ---------- constants ---------- */
const STORE_PREFIX = "distribution.";
const VIEWS = ["countries", "folded", "continents"];
const NUMBER_FORMATS = ["auto", "point", "comma"];
/* Territories that stay on their own when territories are counted with their country (the owner's
   choice, November 2026): France's overseas departments (Guadeloupe, Martinique, French Guiana, Réunion,
   Mayotte), Hong Kong, Macao, Åland and Svalbard. Taiwan is a country of its own in the data. */
const KEEP_SEPARATE = ["GP", "MQ", "GF", "RE", "YT", "HK", "MO", "AX", "SJ"];
/* The continents, in the order Vali lists them, and their names. */
const CONTINENT_NAMES = {
  europe: "Europe",
  asia: "Asia",
  africa: "Africa",
  northamerica: "North America",
  southamerica: "South America",
  oceania: "Oceania",
  antarctica: "Antarctica",
};
/* The row for locations without a country: at sea, far from every coast, and without a country code in
   the file. Always listed last. */
const UNKNOWN_NAME = "No country";
/* Larger files are refused before reading: a map of 130,000 locations is about 25 MB. */
const MAX_FILE_BYTES = 500 * 1000 * 1000;

/* ---------- helpers ---------- */
/* The page element with this id. */
const $ = id => document.getElementById(id);
/* A number with thousands separators: 12345 -> "12,345". */
const fmt = n => n.toLocaleString("en");
/* Settings saved in this browser, under "distribution." + name. get() returns the default d when nothing is
   saved or storage is blocked (private windows); set() quietly does nothing then. */
const store = {
  get(k, d) {
    try {
      const v = localStorage.getItem(STORE_PREFIX + k);
      return v === null ? d : JSON.parse(v);
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(STORE_PREFIX + k, JSON.stringify(v));
    } catch {}
  },
};
/* A new element with properties and children: makeElement("b", {}, "text"). Copied from Lookout. */
const makeElement = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  n.append(...kids);
  return n;
};
/* A name made safe for a file name: "Malta: Dead ends" -> "malta-dead-ends" ("map" if nothing is left). */
const fileBase = name =>
  String(name)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "map";
let regionNames;
try {
  regionNames = new Intl.DisplayNames(["en"], { type: "region" });
} catch {}
/* The English name of a country code: from the build's data, else the browser's, else the code. */
function placeName(code) {
  if (!code) return UNKNOWN_NAME;
  if (Object.hasOwn(PLACES, code)) return PLACES[code].name;
  try {
    const n = regionNames && regionNames.of(code);
    return n && n !== code ? n : code;
  } catch {
    return code;
  }
}
/* The country or territory at a position, from country-coder (offline, simplified borders that reach out
   to sea). Territory level, so Réunion is RE rather than France. undefined far out at sea. */
function countryAt(lat, lng) {
  try {
    const c = window.countryCoder?.iso1A2Code([lng, lat], { level: "territory" });
    return typeof c === "string" && /^[A-Z]{2}$/.test(c) ? c : undefined;
  } catch {
    return undefined;
  }
}
/* A continent's name, or "" for none. */
const continentName = c => (Object.hasOwn(CONTINENT_NAMES, c) ? CONTINENT_NAMES[c] : "");

/* ---------- step 1: reading the map file ---------- */

/**
 * The locations of a map-making.app map file. Accepts the list map-making.app exports ([{ lat, lng,
 * countryCode, … }]) and GeoGuessr's shape ({ name, customCoordinates: [...] }), which the two other tools
 * write. Locations without a valid position are skipped and counted.
 * @param {string} text the file's content
 * @returns {{ error: string } | { name: string, locations: { lat: number, lng: number, code: string }[],
 *   skipped: number }}
 */
function readMap(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { error: "This file is not a JSON file. Choose the JSON file that map-making.app exports." };
  }
  const list = Array.isArray(data)
    ? data
    : data && Array.isArray(data.customCoordinates)
      ? data.customCoordinates
      : null;
  if (!list)
    return {
      error:
        "This file has no list of locations. Choose a map file that map-making.app exports as JSON, not a settings file.",
    };
  const locations = [];
  let skipped = 0;
  for (const l of list) {
    const lat = l && l.lat,
      lng = l && l.lng;
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      skipped++;
      continue;
    }
    const code = typeof l.countryCode === "string" ? l.countryCode.trim().toUpperCase() : "";
    locations.push({ lat, lng, code: /^[A-Z]{2}$/.test(code) ? code : "" });
  }
  if (!locations.length)
    return {
      error: skipped
        ? "None of the locations in this file has a valid position."
        : "This map has no locations yet.",
    };
  const name =
    data && !Array.isArray(data) && typeof data.name === "string" ? data.name.trim().slice(0, 200) : "";
  return { name, locations, skipped };
}

/* ---------- counting ---------- */

/**
 * The country of one location. The file's country code comes first: map-making.app takes it from Google,
 * and it is right at land borders, where country-coder's simplified borders are not. The position fills
 * in a missing code, and makes a country code more exact where it lies in one of that country's
 * territories (a location coded US in Puerto Rico counts as PR), so the "on its own" view is right
 * either way.
 * @returns {{ code: string, continent: string, from: "file" | "position" | "none" }}
 */
function placeOf(location) {
  const here = countryAt(location.lat, location.lng);
  const hereContinent = here && Object.hasOwn(PLACES, here) ? PLACES[here].continent : "";
  if (location.code) {
    const code =
      here && Object.hasOwn(PLACES, here) && PLACES[here].country === location.code ? here : location.code;
    const continent = Object.hasOwn(PLACES, code) ? PLACES[code].continent : hereContinent;
    return { code, continent, from: "file" };
  }
  if (here) return { code: here, continent: hereContinent, from: "position" };
  return { code: "", continent: "", from: "none" };
}

/**
 * Counts the locations per country and per continent.
 * @returns {{ total: number, codes: Record<string, number>, continents: Record<string, number>,
 *   continentPlaces: Record<string, string[]>, fromFile: number, fromPosition: number, unknown: number }}
 */
function countPlaces(locations) {
  const codes = {},
    continents = {},
    places = {};
  const from = { file: 0, position: 0, none: 0 };
  for (const l of locations) {
    const p = placeOf(l);
    from[p.from]++;
    codes[p.code] = (codes[p.code] || 0) + 1;
    continents[p.continent] = (continents[p.continent] || 0) + 1;
    if (p.code) (places[p.continent] ??= new Set()).add(p.code);
  }
  const continentPlaces = Object.fromEntries(Object.entries(places).map(([c, s]) => [c, [...s]]));
  return {
    total: locations.length,
    codes,
    continents,
    continentPlaces,
    fromFile: from.file,
    fromPosition: from.position,
    unknown: from.none,
  };
}

/* The country a place counts with when territories are counted with their country. */
const foldedCode = code =>
  Object.hasOwn(PLACES, code) && PLACES[code].country && !KEEP_SEPARATE.includes(code)
    ? PLACES[code].country
    : code;

/**
 * @typedef {{ name: string, code: string, continent: string, count: number, share: number,
 *   includes: { name: string, count: number }[], places: number | null, unknown: boolean }} Row
 * One row of a view: a country, territory or continent (or the locations without one, `unknown`). `share`
 * is a fraction of all locations (0.25 for 25%); `includes` lists the territories counted in (folded
 * view); `places` the countries and territories of a continent.
 */

/**
 * The rows of a view, unsorted.
 * @param {ReturnType<typeof countPlaces>} tally
 * @param {"countries" | "folded" | "continents"} view
 * @returns {Row[]}
 */
function viewRows(tally, view) {
  const row = (fields, count) => ({
    name: "",
    code: "",
    continent: "",
    includes: [],
    places: 0,
    unknown: false,
    ...fields,
    count,
    share: tally.total ? count / tally.total : 0,
  });
  if (view === "continents")
    return Object.entries(tally.continents).map(([c, count]) =>
      row(
        c
          ? { name: continentName(c), code: c, places: (tally.continentPlaces[c] || []).length }
          : { name: "No continent", places: null, unknown: true },
        count,
      ),
    );
  const groups = {};
  for (const [code, count] of Object.entries(tally.codes)) {
    const key = view === "folded" && code ? foldedCode(code) : code;
    const g = (groups[key] ??= { count: 0, includes: [] });
    g.count += count;
    if (key !== code) g.includes.push({ name: placeName(code), count });
  }
  return Object.entries(groups).map(([code, g]) =>
    row(
      {
        name: placeName(code),
        code,
        continent: code && Object.hasOwn(PLACES, code) ? continentName(PLACES[code].continent) : "",
        includes: g.includes.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
        unknown: !code,
      },
      g.count,
    ),
  );
}

/* The columns of each view: the row field, the heading, and how it is shown and exported. */
const COLUMNS = {
  countries: [
    { key: "name", label: "Country or territory", type: "text" },
    { key: "code", label: "Code", type: "text" },
    { key: "continent", label: "Continent", type: "text" },
    { key: "count", label: "Locations", type: "int" },
    { key: "share", label: "Share", type: "percent" },
  ],
  folded: [
    { key: "name", label: "Country", type: "text" },
    { key: "code", label: "Code", type: "text" },
    { key: "continent", label: "Continent", type: "text" },
    { key: "count", label: "Locations", type: "int" },
    { key: "share", label: "Share", type: "percent" },
    { key: "includes", label: "Territories counted in", type: "list", unsortable: true },
  ],
  continents: [
    { key: "name", label: "Continent", type: "text" },
    { key: "places", label: "Countries and territories", type: "int" },
    { key: "count", label: "Locations", type: "int" },
    { key: "share", label: "Share", type: "percent" },
  ],
};
/* "Puerto Rico (120), Guam (4)" */
const includesText = list => list.map(i => `${i.name} (${i.count})`).join(", ");

/**
 * The rows sorted by a column; the row without a country is always last. Ties go by name.
 * @param {Row[]} rows
 * @param {{ key: string, descending: boolean }} by
 */
function sortRows(rows, by) {
  const dir = by.descending ? -1 : 1;
  const byName = (a, b) => a.name.localeCompare(b.name, "en");
  return [...rows].sort((a, b) => {
    if (a.unknown !== b.unknown) return a.unknown ? 1 : -1;
    const x = a[by.key],
      y = b[by.key];
    const c = typeof x === "number" ? x - y : String(x).localeCompare(String(y), "en");
    return c * dir || byName(a, b);
  });
}

/* ---------- step 3: CSV ---------- */

/* "comma" when the browser's language writes 1.5 as "1,5" (German, say), else "point". */
function browserNumberFormat() {
  try {
    const parts = new Intl.NumberFormat(navigator.languages?.[0] || navigator.language).formatToParts(1.5);
    return parts.find(p => p.type === "decimal")?.value === "," ? "comma" : "point";
  } catch {
    return "point";
  }
}
/* The number format the CSV uses: the one chosen, or the browser's for "auto". */
const csvNumberFormat = choice => (choice === "point" || choice === "comma" ? choice : browserNumberFormat());

/**
 * A view's table as CSV text, for a spreadsheet: one heading row, then one row per country or continent,
 * in the order given. Shares are percentages with two decimals ("12.34" in a column "Share (%)"), without
 * a % sign, so a spreadsheet in any language reads them as numbers; counts have no thousands separators.
 * With the "comma" format, decimals use a comma and columns are split by semicolons, as spreadsheets in
 * German and many other languages expect. Lines end in CRLF, as RFC 4180 says.
 * @param {Row[]} rows
 * @param {keyof COLUMNS} view
 * @param {"point" | "comma"} format
 */
function csvText(rows, view, format) {
  const sep = format === "comma" ? ";" : ",";
  const cell = v => {
    const s = String(v);
    // Quoted when needed; a text starting with = + - @ gets a ' so a spreadsheet does not run it as a
    // formula (no such names exist in the data, but the file may be passed on).
    const safe = /^[=+\-@]/.test(s) ? "'" + s : s;
    return /["\r\n]/.test(safe) || safe.includes(sep) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const value = (row, col) => {
    const v = row[col.key];
    if (col.type === "percent") {
      const t = (v * 100).toFixed(2);
      return format === "comma" ? t.replace(".", ",") : t;
    }
    if (col.type === "list") return includesText(v);
    return v ?? "";
  };
  const head = COLUMNS[view].map(c => (c.type === "percent" ? c.label + " (%)" : c.label));
  const lines = [head, ...rows.map(r => COLUMNS[view].map(c => value(r, c)))];
  return lines.map(l => l.map(cell).join(sep)).join("\r\n") + "\r\n";
}

/* ---------- step 3: Excel file ---------- */
/* An .xlsx file is a zip archive of XML files (Office Open XML). Written here rather than with a library,
   as the page needs only plain tables: text, whole numbers and percentages, a bold heading row that stays
   in view, and column widths. The archive is stored without compression, which keeps the code short; the
   file is small anyway (a few tens of KB). */

/* CRC-32 of the bytes, as zip archives need it. */
let crcTable;
function crc32(bytes) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const b of bytes) crc = crcTable[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * A zip archive of the files, stored without compression.
 * @param {{ name: string, text: string }[]} files
 * @returns {Uint8Array}
 */
function zipFiles(files) {
  const enc = new TextEncoder();
  const parts = [],
    central = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name),
      data = enc.encode(f.text),
      crc = crc32(data);
    // The local header: signature, version 2.0, flags (bit 11: names are UTF-8), stored, time 0, date
    // 1 January 1980, CRC, sizes, name length, no extra field.
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true);
    local.setUint16(8, 0, true);
    local.setUint16(10, 0, true);
    local.setUint16(12, 0x21, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    parts.push(new Uint8Array(local.buffer), name, data);
    // The same in the central directory, with where the local header starts.
    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(4, 20, true);
    entry.setUint16(6, 20, true);
    entry.setUint16(8, 0x0800, true);
    entry.setUint16(10, 0, true);
    entry.setUint16(12, 0, true);
    entry.setUint16(14, 0x21, true);
    entry.setUint32(16, crc, true);
    entry.setUint32(20, data.length, true);
    entry.setUint32(24, data.length, true);
    entry.setUint16(28, name.length, true);
    entry.setUint32(42, offset, true);
    central.push(new Uint8Array(entry.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const centralSize = central.reduce((n, p) => n + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of all) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/* Text made safe for XML: the five special characters as entities, and characters XML cannot hold
   (control characters) left out. */
const xmlText = s =>
  String(s)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, "")
    .replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]);
/* The column letters of a 0-based column number: 0 -> A, 26 -> AA. */
const columnLetters = n =>
  (n >= 26 ? columnLetters(Math.floor(n / 26) - 1) : "") + String.fromCharCode(65 + (n % 26));

/**
 * @typedef {{ name: string, columns: { label: string, type: string, width: number }[],
 *   rows: (string | number)[][], heading?: boolean }} Sheet
 * One tab of the Excel file: its name (at most 31 characters), its columns and its rows. With `heading`
 * (the default), the first row is the column labels, in bold, and stays in view when scrolling.
 */

/**
 * An Excel workbook (.xlsx) with one tab per sheet.
 * @param {Sheet[]} sheets
 * @returns {Uint8Array}
 */
function xlsxFile(sheets) {
  const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
  const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  // Cell styles: 0 normal, 1 bold (headings), 2 percentage with two decimals (Excel's built-in format 10).
  const STYLE = { heading: 1, percent: 2 };
  const cell = (ref, value, type, style) => {
    const s = style ? ` s="${style}"` : "";
    if (typeof value === "number" && Number.isFinite(value) && type !== "text")
      return `<c r="${ref}"${s}><v>${value}</v></c>`;
    return `<c r="${ref}" t="inlineStr"${s}><is><t xml:space="preserve">${xmlText(value)}</t></is></c>`;
  };
  const sheetXml = sheet => {
    const heading = sheet.heading !== false;
    const rows = heading ? [sheet.columns.map(c => c.label), ...sheet.rows] : sheet.rows;
    const data = rows
      .map((row, r) => {
        // (an empty value, such as a continent's count of countries in the row without one, is no cell)
        const cells = row.flatMap((v, c) => {
          if (v === null || v === "") return [];
          const col = sheet.columns[c] || { type: "text" };
          const style = heading && r === 0 ? STYLE.heading : col.type === "percent" ? STYLE.percent : 0;
          return cell(columnLetters(c) + (r + 1), v, heading && r === 0 ? "text" : col.type, style);
        });
        return `<row r="${r + 1}">${cells.join("")}</row>`;
      })
      .join("");
    const cols = sheet.columns
      .map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width}" customWidth="1"/>`)
      .join("");
    const pane = heading ? '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' : "";
    return (
      XML +
      `<worksheet ${NS} xmlns:r="${REL}"><sheetViews><sheetView workbookViewId="0">${pane}</sheetView></sheetViews>` +
      `<cols>${cols}</cols><sheetData>${data}</sheetData></worksheet>`
    );
  };
  const files = [
    {
      name: "[Content_Types].xml",
      text:
        XML +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        sheets
          .map(
            (s, i) =>
              `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
          )
          .join("") +
        "</Types>",
    },
    {
      name: "_rels/.rels",
      text:
        XML +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        `<Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    {
      name: "xl/workbook.xml",
      text:
        XML +
        `<workbook ${NS} xmlns:r="${REL}"><sheets>` +
        sheets
          .map(
            (s, i) => `<sheet name="${xmlText(s.name.slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`,
          )
          .join("") +
        "</sheets></workbook>",
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      text:
        XML +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        sheets
          .map(
            (s, i) =>
              `<Relationship Id="rId${i + 1}" Type="${REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
          )
          .join("") +
        `<Relationship Id="rId${sheets.length + 1}" Type="${REL}/styles" Target="styles.xml"/></Relationships>`,
    },
    {
      name: "xl/styles.xml",
      text:
        XML +
        `<styleSheet ${NS}>` +
        '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
        '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
        '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
        '<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
        '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
        '<xf numFmtId="10" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>' +
        '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>',
    },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, text: sheetXml(s) })),
  ];
  return zipFiles(files);
}

/* The tabs of the Excel file: the three views, each sorted by locations (most first), and "About" with
   where the numbers come from. Shares are exact fractions shown as percentages, so they add up. */
function workbookSheets(tally, info) {
  const WIDTHS = { name: 34, code: 8, continent: 16, count: 12, share: 10, includes: 60, places: 24 };
  const NAMES = { countries: "Countries", folded: "Territories counted in", continents: "Continents" };
  const views = VIEWS.map(view => ({
    name: NAMES[view],
    columns: COLUMNS[view].map(c => ({
      label: c.label,
      type: c.type === "list" ? "text" : c.type,
      width: WIDTHS[c.key],
    })),
    rows: sortRows(viewRows(tally, view), { key: "count", descending: true }).map(r =>
      COLUMNS[view].map(c => (c.type === "list" ? includesText(r[c.key]) : r[c.key])),
    ),
  }));
  const about = [
    ["Map", info.name || "(no name)"],
    ["File", info.fileName],
    ["Locations", tally.total],
    ["Country from the map file", tally.fromFile],
    ["Country from the position", tally.fromPosition],
    ["No country found", tally.unknown],
    ["Skipped (no valid position)", info.skipped],
    ["Counted on its own in every view", KEEP_SEPARATE.map(placeName).join(", ")],
    ["Made on", info.date],
    ["Made with", "Distribution, a tool of the Map Generation Tool"],
  ];
  return [
    ...views,
    {
      name: "About",
      heading: false,
      columns: [
        { label: "", type: "text", width: 34 },
        { label: "", type: "int", width: 60 },
      ],
      rows: about,
    },
  ];
}

/* ---------- the page ---------- */

/** @type {null | { name: string, fileName: string, skipped: number, tally: ReturnType<typeof countPlaces> }} */
let map = null;
let sort = { key: "count", descending: true };

/* The view chosen. */
const currentView = () => {
  const v = document.querySelector("input[name=view]:checked")?.value;
  return VIEWS.includes(v) ? v : "countries";
};
/* The rows of the view shown, in the order shown. */
function shownRows() {
  const view = currentView();
  const by = COLUMNS[view].some(c => c.key === sort.key && !c.unsortable)
    ? sort
    : { key: "count", descending: true };
  return sortRows(viewRows(map.tally, view), by);
}

/* ---------- step 1: choosing a file ---------- */
async function loadFile(file) {
  $("fileError").hidden = true;
  if (!file) return;
  if (file.size > MAX_FILE_BYTES) return showError("This file is too large: map files are much smaller.");
  $("fileInfo").hidden = false;
  $("fileInfo").textContent = "Reading " + file.name + "…";
  let text;
  try {
    text = await file.text();
  } catch {
    return showError("This file could not be read. Try choosing it again.");
  }
  const read = readMap(text);
  if (read.error) return showError(read.error);
  map = {
    name: read.name,
    fileName: file.name.slice(0, 200),
    skipped: read.skipped,
    tally: countPlaces(read.locations),
  };
  render();
}
function showError(text) {
  map = null;
  $("fileInfo").hidden = true;
  $("fileError").textContent = text;
  $("fileError").hidden = false;
  render();
}
$("file").addEventListener("change", () => {
  loadFile($("file").files[0]);
  $("file").value = ""; // so choosing the same file again reads it again
});
// A file dropped anywhere on the page is read; the browser would open it otherwise.
window.addEventListener("dragover", e => {
  e.preventDefault();
  $("drop").classList.add("over");
});
window.addEventListener("dragleave", e => {
  if (!e.relatedTarget) $("drop").classList.remove("over");
});
window.addEventListener("drop", e => {
  e.preventDefault();
  $("drop").classList.remove("over");
  loadFile(e.dataTransfer?.files?.[0]);
});

/* ---------- step 2: the view ---------- */
const VIEW_HINTS = {
  countries: "Territories such as Puerto Rico or Greenland are listed on their own.",
  folded:
    "Territories such as Puerto Rico count with their country. France's overseas departments, Hong Kong, Macao, Åland and Svalbard stay on their own.",
  continents: "Each location counts where it lies: Réunion in Africa, French Guiana in South America.",
};
for (const r of document.querySelectorAll("input[name=view]"))
  r.addEventListener("change", () => {
    store.set("view", currentView());
    render();
  });

/* ---------- step 3: downloads ---------- */
/* Lets the browser download the content as a file. */
function download(content, fileName, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = makeElement("a", { href: url, download: fileName });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
const downloadBase = () => fileBase(map.name || map.fileName.replace(/\.json$/i, "")) + "-distribution";
$("downloadCsv").addEventListener("click", () => {
  if (!map) return;
  const format = csvNumberFormat($("numberFormat").value);
  // The byte order mark tells Excel the file is UTF-8 (Åland, Curaçao); Google Sheets ignores it.
  download(
    "\ufeff" + csvText(shownRows(), currentView(), format),
    `${downloadBase()}-${currentView()}.csv`,
    "text/csv;charset=utf-8",
  );
});
$("downloadXlsx").addEventListener("click", () => {
  if (!map) return;
  const info = {
    name: map.name,
    fileName: map.fileName,
    skipped: map.skipped,
    date: new Date().toISOString().slice(0, 10),
  };
  download(
    xlsxFile(workbookSheets(map.tally, info)),
    downloadBase() + ".xlsx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
});
$("numberFormat").addEventListener("change", () => store.set("numberFormat", $("numberFormat").value));

/* ---------- the table ---------- */
/* A share for the table: "12.34%", and "<0.01%" for a share too small to show (not "0.00%"). */
const shareText = s => (s > 0 && s < 0.00005 ? "<0.01%" : (s * 100).toFixed(2) + "%");

function render() {
  const view = currentView();
  $("viewHint").textContent = VIEW_HINTS[view];
  $("downloadCsv").disabled = $("downloadXlsx").disabled = !map;
  $("empty").hidden = !!map;
  $("result").hidden = !map;
  if (!map) return;
  const t = map.tally;
  const places = Object.keys(t.codes).filter(Boolean).length;
  $("fileInfo").hidden = false;
  $("fileInfo").textContent =
    `${map.name ? `“${map.name}”: ` : ""}${fmt(t.total)} location${t.total === 1 ? "" : "s"} in ` +
    `${fmt(places)} ${places === 1 ? "country or territory" : "countries and territories"}.` +
    (map.skipped ? ` ${fmt(map.skipped)} skipped: no valid position.` : "");
  $("resultTitle").textContent = {
    countries: "Countries and territories",
    folded: "Countries",
    continents: "Continents",
  }[view];
  const notes = [`${fmt(t.total)} locations.`];
  if (t.fromPosition)
    notes.push(`The map file gave no country for ${fmt(t.fromPosition)}: found from their position.`);
  if (t.unknown) notes.push(`${fmt(t.unknown)} lie far out at sea, in no country.`);
  $("resultSummary").textContent = notes.join(" ");

  const columns = COLUMNS[view];
  const by = columns.some(c => c.key === sort.key && !c.unsortable)
    ? sort
    : { key: "count", descending: true };
  const headRow = makeElement("tr");
  for (const c of columns) {
    const numeric = c.type === "int" || c.type === "percent";
    const th = makeElement("th", { scope: "col", className: numeric ? "num" : "" });
    if (c.unsortable) th.textContent = c.label;
    else {
      const active = by.key === c.key;
      th.setAttribute("aria-sort", active ? (by.descending ? "descending" : "ascending") : "none");
      const b = makeElement(
        "button",
        { type: "button", className: "sort" + (active ? " active" : "") },
        c.label,
        makeElement(
          "span",
          { className: "arrow", ariaHidden: "true" },
          active ? (by.descending ? " ▼" : " ▲") : "",
        ),
      );
      // Numbers sort with the most first, names from A.
      b.addEventListener("click", () => {
        sort =
          by.key === c.key ? { key: c.key, descending: !by.descending } : { key: c.key, descending: numeric };
        render();
      });
      th.append(b);
    }
    headRow.append(th);
  }
  $("tableHead").replaceChildren(headRow);
  const body = sortRows(viewRows(t, view), by).map(r =>
    makeElement(
      "tr",
      { className: r.unknown ? "unknown" : "" },
      ...columns.map(c => {
        const v = r[c.key];
        const text =
          v === null
            ? ""
            : c.type === "percent"
              ? shareText(v)
              : c.type === "int"
                ? fmt(v)
                : c.type === "list"
                  ? includesText(v)
                  : v;
        return makeElement("td", { className: c.type === "int" || c.type === "percent" ? "num" : "" }, text);
      }),
    ),
  );
  $("tableBody").replaceChildren(...body);
}

/* ---------- start ---------- */
{
  const saved = store.get("view", "countries");
  const r = document.querySelector(
    `input[name=view][value="${VIEWS.includes(saved) ? saved : "countries"}"]`,
  );
  if (r) r.checked = true;
  const format = store.get("numberFormat", "auto");
  $("numberFormat").value = NUMBER_FORMATS.includes(format) ? format : "auto";
  $("numberFormatAuto").textContent =
    "As in this browser (" +
    (browserNumberFormat() === "comma" ? "1234,5, semicolons" : "1234.5, commas") +
    ")";
  render();
}
