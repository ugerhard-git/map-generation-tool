// Shared code: the map file tags both tools have. Used by both tools in this repository; the build puts it into a page
// where that page's app.js says /*SHARED tags.js*/ (see src/assemble.js). It uses names that
// app.js defines, as if it were written there.
/* ---------- map file tags ----------
   The tag options both tools have: the country (and how territories are tagged) and the date. Each tool's
   app.js lists its options (TAG_OPTIONS) and makes the tags (tagsFor) before this part runs. */
// The date in the tag: the year ("2023") or month and year ("04-2023", as agreed with the owner).
const TAG_DATES = ["year", "month"];
$("tagDate").value = TAG_DATES.includes(store.get("tagDate", "year")) ? store.get("tagDate", "year") : "year";
$("tagDate").onchange = () => store.set("tagDate", $("tagDate").value);
/* The date format can only be chosen while the date tag is ticked. */
function updateTagDate() {
  $("tagDate").disabled = !$("tagYear").checked;
  // (how territories are tagged only matters while countries are tagged: greyed out otherwise)
  $("territoryTag").disabled = !$("tagCountry").checked;
}
$("territoryTag").value = territoryValue(store.get("territoryTag", "both"));
$("territoryTag").addEventListener("change", () =>
  store.set("territoryTag", territoryValue($("territoryTag").value)),
);
$("tagCountry").addEventListener("change", updateTagDate);
for (const [id, d] of Object.entries(TAG_OPTIONS)) {
  const saved = store.get(id, d);
  $(id).checked = typeof saved === "boolean" ? saved : d;
  $(id).onchange = () => store.set(id, $(id).checked);
}
/* The country tags of a location, as chosen: its country, and for a territory its country's tag too. */
const countryTagsOf = l => countryTags(l.cc, territoryValue($("territoryTag").value));
/* The date tag of a location: "2023", or "04-2023" when month and year are chosen; "" without a date. */
const dateTagOf = l =>
  !l.date
    ? ""
    : $("tagDate").value === "month" && l.date.length === 7
      ? `${l.date.slice(5, 7)}-${l.date.slice(0, 4)}`
      : l.date.slice(0, 4);
$("tagYear").addEventListener("change", updateTagDate);
updateTagDate();
