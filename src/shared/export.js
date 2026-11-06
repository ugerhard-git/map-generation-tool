// Shared code: the map-making.app file. Used by both tools in this repository; the build puts it into a page
// where that page's app.js says /*SHARED export.js*/ (see src/assemble.js). It uses names that
// app.js defines, as if it were written there.
/* ---------- export ---------- */
/* The results in map-making.app's format: { name, customCoordinates: [{ lat, lng, heading, pitch, zoom,
   panoId, countryCode, extra?: { tags } }] }. The tags follow the options ticked at the time of export. */
function exportJson(list = results) {
  return JSON.stringify({
    name: mapName(),
    customCoordinates: list.map(l => {
      const o = {
        lat: +l.lat.toFixed(7),
        lng: +l.lng.toFixed(7),
        heading: +l.heading.toFixed(1),
        pitch: +(l.pitch || 0).toFixed(1),
        zoom: +(l.zoom || 0).toFixed(1),
        panoId: l.panoId,
        countryCode: l.cc,
      };
      const tags = tagsFor(l);
      if (tags.length) o.extra = { tags };
      return o;
    }),
  });
}
$("download").onclick = () => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([exportJson()], { type: "application/json" }));
  a.download = fileBase(mapName()) + ".json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
$("copy").onclick = async () => {
  try {
    await navigator.clipboard.writeText(exportJson());
    $("copy").textContent = "Copied";
  } catch {
    $("copy").textContent = "Copy failed";
  }
  setTimeout(() => ($("copy").textContent = "Copy"), 1500);
};
