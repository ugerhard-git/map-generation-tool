// Shared code: the settings file. Used by both tools in this repository; the build puts it into a page
// where that page's app.js says /*SHARED settings-file.js*/ (see src/assemble.js). It uses names that
// app.js defines, as if it were written there.
/* ---------- settings file ----------
   Every search setting saved as a file and loaded again, for later or for someone else: JSON, readable
   in any text editor, like
     { "format": SETTINGS_FORMAT ("map-generation-tool settings" here), "version": 1, "saved": "2026-10-25T19:30:00.000Z",
       "settings": { …SearchSettings… } }
   The settings are the shared description (currentSettings, cleanSettings, applySettings), so a new
   setting is in the file without changes here. Never the Google key. A loaded file is untrusted: it is
   read with size and format checks, and every setting goes through cleanSettings. SETTINGS_VERSION goes
   up only when a setting changes its meaning; cleanSettings then moves the old shape over. */
const SETTINGS_VERSION = 1,
  SETTINGS_MAX_BYTES = 100000; // a settings file is about 1 KB
/* The settings in the form as the text of a settings file. */
function settingsFileText() {
  const file = {
    format: SETTINGS_FORMAT,
    version: SETTINGS_VERSION,
    saved: new Date().toISOString(),
    settings: currentSettings(),
  };
  return JSON.stringify(file, null, 2) + "\n";
}
/* Reads the text of a settings file: { settings, notes } with the checked settings and what to tell
   the visitor about it, or { error } when it is not a usable settings file. */
function readSettingsFile(text) {
  if (typeof text !== "string" || text.length > SETTINGS_MAX_BYTES)
    return { error: "This file is too large to be a settings file." };
  let file;
  try {
    file = JSON.parse(text);
  } catch {
    return { error: "This is not a settings file: its contents could not be read." };
  }
  if (!file || typeof file !== "object" || Array.isArray(file))
    return { error: `This is not a settings file of ${TOOL_TITLE}.` };
  if (Array.isArray(file.customCoordinates))
    return { error: "This is a map file, not a settings file. Settings files end in .settings.json." };
  if (file.format === OTHER_TOOL.settingsFormat)
    return { error: `This is a settings file of ${OTHER_TOOL.name}, the other tool. Load it there.` };
  if (file.format !== SETTINGS_FORMAT || !Number.isInteger(file.version) || file.version < 1)
    return { error: `This is not a settings file of ${TOOL_TITLE}.` };
  const raw = file.settings;
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    return { error: "This settings file has no settings in it." };
  const settings = cleanSettings(raw);
  const notes = [];
  if (file.version > SETTINGS_VERSION)
    notes.push("It was saved by a newer version of this tool, so some settings may not have come across.");
  // (settings that older versions of this tool saved under another name are moved over, not "unknown")
  const unknown = Object.keys(raw).filter(
    k => !Object.hasOwn(settings, k) && !OLDER_SETTING_NAMES.includes(k),
  );
  if (unknown.length)
    notes.push(
      `Not used, as this tool does not know ${unknown.length === 1 ? "it" : "them"}: ` +
        unknown
          .slice(0, 8)
          .map(k => cleanText(k, 40))
          .join(", ") +
        (unknown.length > 8 ? ` and ${unknown.length - 8} more` : "") +
        ".",
    );
  const dropped = Array.isArray(raw.countries) ? raw.countries.length - settings.countries.length : 0;
  if (dropped > 0)
    notes.push(
      `${dropped === 1 ? "1 country was" : fmt(dropped) + " countries were"} left out: ${DROPPED_COUNTRY_WORDS}.`,
    );
  return { settings, notes };
}
/* Says something in the settings file dialog: an error, or (error = false) that it worked; "" clears it. */
function settingsMessage(text, error = true) {
  $("settingsMsg").textContent = text;
  $("settingsMsg").className = "msg " + (error ? "error" : "note");
  $("settingsMsg").hidden = !text;
}
$("settingsBtn").onclick = () => {
  settingsMessage("");
  openDialog("settingsFile");
};
$("settingsX").onclick = closeDialog;
$("settingsSave").onclick = () => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([settingsFileText()], { type: "application/json" }));
  a.download = fileBase(mapName()) + ".settings.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  settingsMessage(`Saved as ${a.download}.`, false);
};
$("settingsLoad").onclick = () => {
  if (running) return settingsMessage("Stop the search first, then load the settings.");
  $("settingsPick").click();
};
$("settingsPick").onchange = async () => {
  const f = $("settingsPick").files[0];
  $("settingsPick").value = ""; // so the same file can be chosen again
  if (!f) return;
  if (f.size > SETTINGS_MAX_BYTES) return settingsMessage("This file is too large to be a settings file.");
  let text;
  try {
    text = await f.text();
  } catch {
    return settingsMessage("The file could not be read.");
  }
  const r = readSettingsFile(text);
  if (r.error) return settingsMessage(r.error);
  if (running) return settingsMessage("Stop the search first, then load the settings.");
  applySettings(r.settings);
  closeDialog();
  showNote([`Settings loaded from ${cleanText(f.name, 100)}.`, ...r.notes].join(" "));
};
