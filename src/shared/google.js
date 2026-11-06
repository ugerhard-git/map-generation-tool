// Shared code: Google's Street View service. Used by both tools in this repository; the build puts it into a page
// where that page's app.js says /*SHARED google.js*/ (see src/assemble.js). It uses names that
// app.js defines, as if it were written there.
/* ---------- Google Street View ---------- */
// Google's Maps JavaScript API: unlike the free metadata web service, it can search official coverage
// only, and it returns a panorama's arrows with their road names. Copied from Lookout and extended. What
// a panorama must have to become a location is each tool's own (see "what a location must have").
let googleScript = null,
  keyRefused = false;
/* Loads Google's Maps JavaScript API once and resolves to its StreetViewService. Fails ("denied" or
   "unreachable") if the key is refused or nothing usable loads within 12 seconds. Google may also
   refuse the key later, on the first lookup: gm_authFailure then sets keyRefused. */
function loadGoogleScript(key) {
  return (googleScript ??= new Promise((resolve, reject) => {
    const giveUp = setTimeout(() => reject(new Error("unreachable")), 12000); // loaded nothing usable
    window.gm_authFailure = () => {
      keyRefused = true;
      reject(new Error("denied"));
    };
    window.__mapgenReady = () =>
      google.maps.importLibrary("streetView").then(lib => {
        clearTimeout(giveUp);
        resolve(new lib.StreetViewService());
      }, reject);
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&loading=async&callback=__mapgenReady`;
    s.onerror = () => reject(new Error("unreachable"));
    document.head.append(s);
  }));
}
/* Keep only well-formed values from a Street View answer. */
function cleanPano(r) {
  const status = cleanText(r.status, 40) || "NO_STATUS";
  if (status !== "OK") return { status, detail: cleanText(r.detail, 300) };
  if (!inRange(r.lat, -90, 90) || !inRange(r.lng, -180, 180))
    return { status: "MALFORMED", detail: "the answer had no usable position" };
  if (typeof r.panoId !== "string" || !/^[^\s<>"'`\\]{4,300}$/.test(r.panoId))
    return {
      status: "MALFORMED",
      detail: `the panorama ID had an unexpected form (${cleanText(String(r.panoId), 40)})`,
    };
  if (!Array.isArray(r.links)) return { status: "MALFORMED", detail: "the answer had no arrows" };
  const links = r.links
    .filter(l => l && inRange(l.heading, -360, 720))
    .slice(0, 20)
    .map(l => ({
      heading: ((l.heading % 360) + 360) % 360,
      description: cleanText(l.description, 120).trim(),
      pano: typeof l.pano === "string" && /^[^\s<>"'`\\]{4,300}$/.test(l.pano) ? l.pano : "",
    }));
  const date = cleanText(r.date, 10);
  return {
    status,
    lat: r.lat,
    lng: r.lng,
    panoId: r.panoId,
    copyright: cleanText(r.copyright),
    date: /^\d{4}(-\d{2})?$/.test(date) ? date : "",
    links,
    // the full image's height in pixels, which tells the camera (see BAD_CAMERA_HEIGHT); 0 if not given
    height: inRange(r.height, 1, 100000) ? Math.round(r.height) : 0,
    // the full image's width in pixels: twice the height for a whole 360° panorama; 0 if not given
    width: inRange(r.width, 1, 200000) ? Math.round(r.width) : 0,
    older: olderPhotos(r.time, r.panoId),
    carHeading: inRange(r.carHeading, -360, 720) ? ((r.carHeading % 360) + 360) % 360 : null,
  };
}
/* The other photos at the same spot, newest first: [{ pano, date: "YYYY-MM" }]. They come from the list
   Google's answers carry as `time`, which Google does not document (checked with the owner, October 2026),
   so it is read with care: an entry needs a panorama id and a date, and the date is found by its type,
   not by its name, which is a shortened name ("gD") that can change with any update of Google's script.
   Without the list, there are simply no other photos. */
function olderPhotos(time, current) {
  if (!Array.isArray(time)) return [];
  const out = [];
  for (const t of time.slice(0, 50)) {
    if (!t || typeof t !== "object") continue;
    const pano = t.pano;
    if (typeof pano !== "string" || pano === current || !/^[^\s<>"'`\\]{4,300}$/.test(pano)) continue;
    const when = Object.values(t).find(v => v instanceof Date && !isNaN(v));
    if (!when) continue;
    // Google gives the first day of the month, at midnight in the visitor's time zone, so the year and
    // month are read in local time.
    const date = `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, "0")}`;
    out.push({ pano, date });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}
/* Asks Google's script once; resolves to its raw answer and status, or status "NETWORK" after 15 s. */
function askGoogle(sv, request) {
  return new Promise(resolve => {
    const t = setTimeout(() => resolve({ status: "NETWORK" }), 15000); // never wait forever
    sv.getPanorama(request, (data, status) => {
      clearTimeout(t);
      resolve({ data, status: cleanText(status, 40) || "NO_STATUS" });
    });
  });
}
/* The nearest panorama within radius metres of a point from Google's sources (each tool's
   LOOKUP_SOURCES unless others are given), with its arrows. @returns {Promise<PanoAnswer>} */
async function lookup(p, radius, key, sources = LOOKUP_SOURCES) {
  const sv = await loadGoogleScript(key);
  const near = await askGoogle(sv, {
    location: { lat: p.lat, lng: p.lng },
    radius,
    sources,
    preference: "nearest",
  });
  if (near.status !== "OK" || !near.data?.location) return { status: near.status };
  let d = near.data;
  // The arrows normally come with the answer; if not, ask for that panorama by its id.
  if (!Array.isArray(d.links) && typeof d.location.pano === "string") {
    const byId = await askGoogle(sv, { pano: d.location.pano });
    if (byId.status === "OK" && byId.data) d = byId.data;
  }
  return cleanPano({
    status: "OK",
    lat: d.location?.latLng?.lat(),
    lng: d.location?.latLng?.lng(),
    panoId: d.location?.pano,
    copyright: d.copyright,
    date: d.imageDate,
    height: d.tiles?.worldSize?.height,
    width: d.tiles?.worldSize?.width,
    carHeading: d.tiles?.centerHeading,
    time: d.time,
    links: d.links,
  });
}
/* Official Google coverage says "© 2024 Google" (or "Google LLC"); photos from others name the uploader. */
const isOfficial = c =>
  c
    .replace(/[©\d\s]/g, "")
    .replace(/LLC|Inc\.?/gi, "")
    .replace(/[,.]/g, "") === "Google";
/* What a panorama's arrows say: whether a road name is shown and whether the coverage ends here. */
function arrowFacts(links) {
  return {
    noRoadName: links.every(l => !l.description),
    deadEnd: links.length === 1,
    intersection: links.length >= 3,
  };
}
