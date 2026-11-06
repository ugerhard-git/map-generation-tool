// Shared code: the dialogs. Used by both tools in this repository; the build puts it into a page
// where that page's app.js says /*SHARED dialogs.js*/ (see src/assemble.js). It uses names that
// app.js defines, as if it were written there.
/* ---------- dialogs: welcome (shown once per browser) ---------- */
/* Opens a dialog (an element with class "dialog" around a "dialog-box"). While it is open, Escape and a
   click outside the box close it, and Tab keeps the keyboard inside the box. When it closes, the focus
   goes back to where it was. */
let openDialogEl = null,
  dialogBack = null;
function openDialog(id) {
  if (openDialogEl) closeDialog();
  dialogBack = document.activeElement;
  openDialogEl = $(id);
  openDialogEl.hidden = false;
  const box = openDialogEl.querySelector(".dialog-box");
  box.focus({ preventScroll: true });
  box.scrollTop = 0; // start reading at the top
}
function closeDialog() {
  if (!openDialogEl) return;
  openDialogEl.hidden = true;
  openDialogEl = null;
  if (dialogBack && dialogBack.focus && dialogBack !== document.body) dialogBack.focus();
}
document.addEventListener("click", e => {
  if (openDialogEl && e.target === openDialogEl) closeDialog(); // a click outside the box
});
document.addEventListener("keydown", e => {
  if (!openDialogEl) return;
  if (e.key === "Escape") closeDialog();
  if (e.key === "Tab") {
    // keep the keyboard inside the box: cycle through what can take the focus there
    const f = [...openDialogEl.querySelectorAll("button, input, select, textarea, a[href]")].filter(
      x => !x.disabled && !x.hidden && x.offsetParent !== null,
    );
    if (!f.length) return;
    const i = f.indexOf(document.activeElement);
    e.preventDefault();
    f[(i + (e.shiftKey ? f.length - 1 : 1) + f.length) % f.length].focus();
  }
});
$("maxDrawn").textContent = fmt(MAX_DRAWN); // the number in the welcome dialog
function openWelcome() {
  openDialog("welcome");
  store.set("welcomed", true);
}
$("welcomeX").onclick = closeDialog;
$("helpX").onclick = closeDialog;
$("helpOk").onclick = closeDialog;
$("welcomeOk").onclick = closeDialog;
$("howBtn").onclick = openWelcome;
if (!store.get("welcomed", false) && !FRAMED) openWelcome();
