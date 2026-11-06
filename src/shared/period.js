// Shared code: step 2, the period of the photos. Used by both tools in this repository; the build puts it into a page
// where that page's app.js says /*SHARED period.js*/ (see src/assemble.js). It uses names that
// app.js defines, as if it were written there.
/* ---------- step 2: what to look for ----------
   The period of the photos, which both tools offer. Each tool's app.js adds its own filters and wanted(). */
// The period of the photos: a month and year from, a month and year to, or "now" for the current month
// (the default, so it follows the calendar). Google gives each photo's date as "YYYY-MM". Street View
// started in May 2007 (agreed with the owner, October 2026): the period starts no earlier, so the
// default "Jan 2007" means May 2007. The "from" month is January by default, so choosing a year starts
// the period at the beginning of that year. Saved settings from before months could be chosen have
// only years: they read as January (from) and December (to).
const YEAR_FIRST = 2007,
  MONTH_FIRST = 5, // May 2007
  YEAR_LAST = Math.max(YEAR_FIRST, new Date().getFullYear());
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
for (const id of ["monthFrom", "monthTo"])
  MONTHS.forEach((name, i) =>
    $(id).append(makeElement("option", { value: String(i + 1), textContent: name })),
  );
for (const id of ["yearFrom", "yearTo"])
  for (let y = YEAR_FIRST; y <= YEAR_LAST; y++)
    $(id).append(makeElement("option", { value: String(y), textContent: String(y) }));
$("yearTo").append(makeElement("option", { value: "now", textContent: "Now" }));
/* "YYYY-MM" of a year and month. */
const yearMonth = (y, m) => `${y}-${String(m).padStart(2, "0")}`;
/* This month as "YYYY-MM". */
const thisMonth = () => yearMonth(new Date().getFullYear(), new Date().getMonth() + 1);
/* A saved or loaded "to" year: a year, or "now". */
const cleanYearTo = v => (v === "now" ? "now" : wholeNumber(v, YEAR_FIRST, YEAR_LAST, "now"));
/* The chosen period as { from, to } in "YYYY-MM", earliest first, with toNow when it ends now; null
   when the period is not ticked. */
function years() {
  if (!$("yearsOn").checked) return null;
  return periodOf({
    yearFrom: $("yearFrom").value,
    monthFrom: $("monthFrom").value,
    yearTo: $("yearTo").value,
    monthTo: $("monthTo").value,
  });
}
/* The period of settings ({ yearFrom, monthFrom, yearTo, monthTo }), as years() returns it. */
function periodOf(s) {
  let from = yearMonth(
    wholeNumber(s.yearFrom, YEAR_FIRST, YEAR_LAST, YEAR_FIRST),
    wholeNumber(s.monthFrom, 1, 12, 1),
  );
  if (from < yearMonth(YEAR_FIRST, MONTH_FIRST)) from = yearMonth(YEAR_FIRST, MONTH_FIRST);
  const toNow = cleanYearTo(s.yearTo) === "now";
  let to = toNow ? thisMonth() : yearMonth(cleanYearTo(s.yearTo), wholeNumber(s.monthTo, 1, 12, 12));
  if (from > to) [from, to] = [to, from];
  return { from, to, toNow: toNow && to === thisMonth() };
}
/* "May 2015" from "2015-05". */
const monthLabel = ym => `${MONTHS[+ym.slice(5, 7) - 1]} ${ym.slice(0, 4)}`;
/* A period in words: "May 2015 to now", "Jan 2010 to Dec 2014", "May 2015". */
function periodLabel(p, joiner = " to ") {
  if (!p.toNow && p.from === p.to) return monthLabel(p.from);
  return monthLabel(p.from) + joiner + (p.toNow ? "now" : monthLabel(p.to));
}
$("yearsOn").checked = store.get("yearsOn", false) === true;
$("yearsOn").onchange = () => {
  store.set("yearsOn", $("yearsOn").checked);
  updateYears();
  updateMapName();
};
$("yearFrom").value = String(
  wholeNumber(store.get("yearFrom", YEAR_FIRST), YEAR_FIRST, YEAR_LAST, YEAR_FIRST),
);
$("monthFrom").value = String(wholeNumber(store.get("monthFrom", 1), 1, 12, 1));
$("yearTo").value = String(cleanYearTo(store.get("yearTo", "now")));
$("monthTo").value = String(wholeNumber(store.get("monthTo", 12), 1, 12, 12));
for (const id of ["yearFrom", "monthFrom", "yearTo", "monthTo"])
  $(id).onchange = () => {
    store.set(id, id === "yearTo" ? cleanYearTo($(id).value) : +$(id).value);
    updateYears();
    updateMapName();
  };
/* The period can only be changed while "Photos taken in a certain period" is ticked; the "to" month
   not when the period ends now. */
function updateYears() {
  const off = !$("yearsOn").checked;
  for (const id of ["yearFrom", "monthFrom", "yearTo"]) $(id).disabled = off;
  $("monthTo").disabled = off || $("yearTo").value === "now";
}
updateYears();
/* True if a photo date ("2023-04", or only "2023") lies within the period ({ from, to } in "YYYY-MM").
   A date without a month counts if its year overlaps the period. Unknown dates do not. */
function inYears(date, p) {
  if (/^\d{4}-\d{2}$/.test(date)) return date >= p.from && date <= p.to;
  if (/^\d{4}$/.test(date)) return date >= p.from.slice(0, 4) && date <= p.to.slice(0, 4);
  return false;
}
