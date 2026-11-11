// Shared code: the search log. Used by both tools in this repository; the build puts it into a page where
// that page's app.js says /*SHARED search-log.js*/ (see src/assemble.js). It uses names that app.js
// defines, as if it were written there.
/* ---------- search log ----------
   For debugging and optimising (agreed with the owner, November 2026): with "Keep a log of the search"
   ticked under "Search" (off by default), the search notes what happens, one entry for each event: each
   random spot, Google's answer, whether the panorama was kept or why not (the counters it added to, see
   emptyStats), each panorama looked at along the coverage, failed lookups, countries giving up, and each
   run's start and end. "Download the search log" under the counters saves it as a JSON file, which can be
   read with a script.
   A search with millions of spots would make the log huge, so it keeps the first LOG_HEAD entries and the
   latest LOG_TAIL, and notes how many were left out in between; the counters every LOG_COUNTERS_EVERY ms
   are kept for the whole search. That is at most about 6 MB. The log is kept in memory only, until the
   next search (also not with an unfinished search), and never holds the Google key: the settings in it
   are currentSettings, which has none. */
const LOG_HEAD = 20000,
  LOG_TAIL = 20000,
  LOG_COUNTERS_EVERY = 30000; // ms
/** The log of the current or last search, or null.
 *  @type {{started: number, head: object[], tail: object[], tailAt: number, leftOut: number,
 *          counters: object[], countersAt: number} | null} */
let searchLog = null;
$("searchLog").checked = store.get("searchLog", false) === true;
$("searchLog").onchange = () => store.set("searchLog", $("searchLog").checked);
/* Notes one event in the log, if one is kept: e is what happened, data the details. */
function logEvent(e, data = {}) {
  const log = searchLog;
  if (!log) return;
  const now = Date.now();
  const entry = { t: now - log.started, e, ...data };
  if (log.head.length < LOG_HEAD) log.head.push(entry);
  else {
    // the latest LOG_TAIL entries, in a ring: tailAt is where the oldest of them is
    if (log.tail.length < LOG_TAIL) log.tail.push(entry);
    else {
      log.tail[log.tailAt] = entry;
      log.tailAt = (log.tailAt + 1) % LOG_TAIL;
      log.leftOut++;
    }
  }
  if (now - log.countersAt >= LOG_COUNTERS_EVERY) {
    log.countersAt = now;
    log.counters.push(logCounters());
  }
}
/* The counters now, for the log: the time, the locations found and the shared and tool's counters. */
const logCounters = () => {
  const counts = { ...stats };
  delete counts.failedInRow; // (it says nothing afterwards)
  return { t: Date.now() - (searchLog?.started || Date.now()), found: results.length, ...counts };
};
/* What the log keeps about a panorama: its id, place, date, image size, arrows, and whether it is Google's
   own (else who took it). */
const logPano = r => ({
  pano: r.panoId,
  lat: Math.round(r.lat * 1e6) / 1e6,
  lng: Math.round(r.lng * 1e6) / 1e6,
  date: r.date,
  ...(r.height ? { h: r.height, w: r.width } : {}),
  arrows: r.links.length,
  ...(isOfficial(r.copyright) ? {} : { by: cleanText(r.copyright, 60) }),
});
/* At the start of each run (a new search, "Fill the gap", continuing): a new log for a new search, or the
   run noted in the log of this one. Unticked, no log is kept. */
function startLog(isNew) {
  if (!$("searchLog").checked) searchLog = null;
  else if (isNew || !searchLog)
    searchLog = {
      started: Date.now(),
      head: [],
      tail: [],
      tailAt: 0,
      leftOut: 0,
      counters: [],
      countersAt: Date.now(),
    };
  logEvent("run", {
    tool: TOOL_NAME,
    at: new Date().toISOString(),
    found: results.length,
    target: currentTarget,
    settings: currentSettings(),
  });
  $("downloadLog").hidden = !searchLog;
}
/* At the end of each run: how it ended and the counters. */
function endLog(outcome) {
  if (!searchLog) return;
  logEvent("end", { outcome, gaveUp: [...gaveUp], stopped: stopRequested, error: fatal || undefined });
  searchLog.counters.push(logCounters());
}
/* The log as a file: a few lines about the search, then one line for each entry, so it reads well and a
   script can still read it as JSON. */
function logText() {
  const log = searchLog;
  const tail = [...log.tail.slice(log.tailAt), ...log.tail.slice(0, log.tailAt)];
  const entries = [...log.head, ...(log.leftOut ? [{ e: "left out", entries: log.leftOut }] : []), ...tail];
  const head = {
    format: "search log",
    tool: TOOL_NAME,
    started: new Date(log.started).toISOString(),
    browser: navigator.userAgent,
    limits: { first: LOG_HEAD, latest: LOG_TAIL, countersEvery: LOG_COUNTERS_EVERY },
    leftOut: log.leftOut,
  };
  return (
    JSON.stringify(head, null, 1).replace(/\n}$/, ",\n") +
    ' "counters": [\n' +
    log.counters.map(c => "  " + JSON.stringify(c)).join(",\n") +
    '\n ],\n "entries": [\n' +
    entries.map(e => "  " + JSON.stringify(e)).join(",\n") +
    "\n ]\n}\n"
  );
}
$("downloadLog").onclick = () => {
  if (!searchLog) return;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([logText()], { type: "application/json" }));
  a.download = fileBase(mapName()) + ".log.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
