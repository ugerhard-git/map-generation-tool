// Shared code: the "More options" sections and help. Used by both tools in this repository; the build puts it into a page
// where that page's app.js says /*SHARED more-options.js*/ (see src/assemble.js). It uses names that
// app.js defines, as if it were written there.
/* ---------- more options and help ----------
   The first screen shows only what most visitors need (CONTRIBUTING.md: "A simple interface"); every
   other setting is in a closed "More options" section for its topic (<details class="more">). A closed
   section shows a one-line summary of what is set and marks it "changed" when it differs from the
   defaults; "Reset to defaults" puts them back. Which sections are open is saved ("openSections").
   Longer explanations are in help dialogs: a "?" button (data-help="x") opens the text in
   <template id="help-x"> of page.html. */
/* The sections; those for each tool's own filters (MORE_TOOL) come from its app.js.
   @type {Record<string, {summary: () => string, changed: () => boolean, reset: () => void}>} */
const MORE = {
  moreDistribution: {
    summary: () =>
      !distributionUsed()
        ? "Only used with several countries"
        : ownChosen()
          ? `${$("distribution").selectedOptions[0]?.textContent || ""}, ${ownChosen().mode === "number" ? "numbers" : "percentages"}`
          : $("distribution").selectedOptions[0]?.textContent || "",
    changed: () => $("distribution").value !== defaultDistribution(),
    reset: () => setControl("distribution", defaultDistribution()),
  },
  ...MORE_TOOL,
  // "Town or countryside" (see "town or countryside")
  moreSettlement: {
    summary: () => {
      const words = settlementWords(settlementChosen());
      return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Anywhere";
    },
    changed: () => settlementChosen() !== "any",
    reset: () => {
      setRadio("settlement", "any");
      store.set("settlement", "any");
    },
  },
  // "Camera view", in a tool that has it (see "camera view")
  ...(CAMERA_VIEW ? { moreView: CAMERA_VIEW.more } : {}),
  moreSearch: {
    summary: () =>
      [
        `${fmt(radius())} m around each spot`,
        parallel() !== PARALLEL && `${fmt(parallel())} lookups at once`,
        $("giveUpOn").checked ? `give up after ${fmt(giveUpAfter())} spots` : "never give up",
        $("searchLog").checked && "keeping a log",
      ]
        .filter(Boolean)
        .join(", "),
    changed: () =>
      radius() !== RADIUS_DEFAULT ||
      parallel() !== PARALLEL ||
      giveUpAfter() !== GIVE_UP_DEFAULT ||
      !$("giveUpOn").checked ||
      $("searchLog").checked,
    reset: () => {
      setControl("radius", fmt(RADIUS_DEFAULT));
      setControl("parallel", fmt(PARALLEL));
      setControl("giveUpAfter", fmt(GIVE_UP_DEFAULT));
      setControl("giveUpOn", true);
      setControl("searchLog", false);
    },
  },
  moreMapFile: {
    summary: () => {
      const name = $("mapName").value.trim() ? `"${$("mapName").value.trim()}"` : "Suggested name";
      const tags = Object.keys(TAG_OPTIONS)
        .filter(id => $(id).checked)
        .map(id =>
          id === "tagCountry"
            ? {
                both: "country",
                own: "country (territories by their own name)",
                parent: "country (territories by their country)",
              }[territoryValue($("territoryTag").value)]
            : id === "tagYear"
              ? $("tagDate").value === "month"
                ? "month and year"
                : "year"
              : TAG_WORDS[id],
        );
      const size = $("sizeLimitOn").checked ? `under ${fmt(sizeLimit())} MB` : "no size limit";
      return `${name}, ${tags.length ? "tags: " + tags.join(", ") : "no tags"}, ${size}`;
    },
    changed: () =>
      $("mapName").value.trim() !== "" ||
      Object.entries(TAG_OPTIONS).some(([id, d]) => $(id).checked !== d) ||
      $("tagDate").value !== "year" ||
      territoryValue($("territoryTag").value) !== "both" ||
      !$("sizeLimitOn").checked ||
      sizeLimit() !== SIZE_LIMIT_DEFAULT,
    reset: () => {
      setControl("mapName", "");
      for (const [id, d] of Object.entries(TAG_OPTIONS)) setControl(id, d);
      setControl("tagDate", "year");
      setControl("territoryTag", "both");
      setControl("sizeLimitOn", true);
      setControl("sizeLimit", fmt(SIZE_LIMIT_DEFAULT));
    },
  },
};
/* Sets a control as if the visitor had changed it, so its own handlers save it and update the page. */
function setControl(id, value) {
  const el = $(id);
  if (el.type === "checkbox") el.checked = value;
  else el.value = value;
  el.dispatchEvent(new Event(el.tagName === "SELECT" || el.type === "checkbox" ? "change" : "input"));
  if (el.type === "text") el.dispatchEvent(new Event("change"));
}
/* Updates the summary line and the "changed" mark of every section, and the line under step 2 that says
   what is looked for. */
function updateMore() {
  updateContinue();
  const w = wanted();
  $("whatSummary").textContent = anythingWanted(w)
    ? `Looking for: ${wantedLabel(w).replace(/^./, c => c.toLowerCase())}.`
    : ANY_LOCATION_WORDS;
  for (const [id, m] of Object.entries(MORE)) {
    const sum = $("sum" + id.slice(4));
    sum.textContent = m.summary();
    const changed = m.changed();
    $(id).classList.toggle("changed", changed);
    let mark = $(id).querySelector(".more-changed");
    if (!mark) {
      mark = makeElement("span", { className: "more-changed" }, "changed");
      sum.before(mark);
    }
    mark.hidden = !changed;
  }
}
// Any change in the settings updates the summaries
$("fields").addEventListener("input", updateMore);
$("fields").addEventListener("change", updateMore);
for (const btn of document.querySelectorAll("[data-reset]"))
  btn.onclick = () => {
    MORE[btn.dataset.reset].reset();
    updateMore();
  };
// The sections the visitor opened stay open on the next visit
{
  const saved = store.get("openSections", []);
  for (const id of Array.isArray(saved) ? saved : []) if (Object.hasOwn(MORE, id)) $(id).open = true;
  for (const id of Object.keys(MORE))
    $(id).addEventListener("toggle", () =>
      store.set(
        "openSections",
        Object.keys(MORE).filter(k => $(k).open),
      ),
    );
}
updateMore();
// Help: a "?" button opens its text in the help dialog
for (const btn of document.querySelectorAll("button.help")) btn.onclick = () => openHelp(btn.dataset.help);
/* Opens the help dialog with the text of <template id="help-…">: its first heading is the title. A
   button in it with data-help-link="…" opens another help text in its place (a longer list, and back). */
function openHelp(topic) {
  const t = document.getElementById("help-" + topic);
  if (!(t instanceof HTMLTemplateElement)) return;
  const body = t.content.cloneNode(true);
  const title = body.querySelector("h2");
  $("helpTitle").textContent = title ? title.textContent : "Help";
  if (title) title.remove();
  $("helpBody").replaceChildren(body);
  for (const link of $("helpBody").querySelectorAll("[data-help-link]"))
    link.onclick = () => openHelp(link.dataset.helpLink);
  // (from a link inside the help, the dialog stays open, at the top of the new text)
  if (openDialogEl === $("help")) $("helpBody").closest(".dialog-box").scrollTop = 0;
  else openDialog("help");
}
