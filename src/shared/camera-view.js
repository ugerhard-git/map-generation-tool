// Shared code: the camera view: direction, tilt and zoom. Used by both tools in this repository; the build puts it into a page
// where that page's app.js says /*SHARED camera-view.js*/ (see src/assemble.js). It uses names that
// app.js defines, as if it were written there.
/* ---------- camera view ----------
   Where the camera faces at each location, how far it tilts (plan step 16) and how far it is zoomed in
   (plan step 20): along the road (the default; each tool says what that means, see roadHeading and
   VIEW_WORDS), at an angle to the car, or random; a tilt and a zoom for
   every location, or each random within a range. The car is the direction the Street View car faced when the photo was taken (Google's
   centerHeading, checked on real panoramas with the owner: it matches one of the arrows within a few
   degrees). The drawings show and set the angles with the mouse or by touch; the number fields beside
   them do the same by keyboard. locationView() turns the settings into each location's heading, pitch
   and zoom. */
const VIEW_DIRECTIONS = ["road", "car", "random"],
  TILT_MODES = ["fixed", "random"];
/* The angle fields: the angle to the car goes round (0–359), the tilts go from straight down to up. */
const ANGLE_FIELDS = {
  carAngle: { lo: 0, hi: 359, d: 0, wrap: true },
  // the range of a random direction, clockwise from "from" to "to"; 0° to 360° is the whole way round
  dirFrom: { lo: 0, hi: 359, d: 0, wrap: true },
  dirTo: { lo: 0, hi: 360, d: 360 },
  tilt: { lo: -90, hi: 90, d: 0 },
  tiltMin: { lo: -90, hi: 90, d: -20 },
  tiltMax: { lo: -90, hi: 90, d: 20 },
};
/* An angle as typed: "90", "-20", "−20°"; NaN if it is not one. */
function typedAngle(text) {
  const t = String(text).trim().replace(/°$/, "").replace("−", "-").replace(/\s/g, "");
  return /^-?\d{1,4}$/.test(t) ? Number(t) : NaN;
}
/* The angle in a field, kept within its range; the saved one (or the default) if none is typed. */
function angleField(id) {
  const f = ANGLE_FIELDS[id],
    n = typedAngle($(id).value);
  if (Number.isNaN(n)) return wholeNumber(store.get(id, f.d), f.lo, f.hi, f.d);
  if (f.wrap) return ((n % 360) + 360) % 360;
  return Math.min(f.hi, Math.max(f.lo, n));
}
/* The zoom, as in map-making.app's and GeoGuessr's map files and Google's Street View player: 0 is the
   widest view (lower numbers look the same), 1 about Street View's normal view, and each 1 more about
   twice as close; decimals zoom in between. Checked with the owner in map-making.app and GeoGuessr
   (October 2026), where 4 was only a little closer than 3, so 4 is the closest offered. */
const ZOOM_MODES = ["fixed", "random"]; // (ZOOM_MAX, the closest zoom, is in "helpers")
/* The zoom fields and their defaults: the zoom for every location, and the range of a random zoom. */
const ZOOM_FIELDS = { zoom: 0, zoomMin: 0, zoomMax: 2 };
/* A zoom as kept: a number from 0 to 4 with one decimal; d if it is not one. */
const cleanZoom = (v, d) => (typeof v === "number" && v >= 0 && v <= ZOOM_MAX ? Math.round(v * 10) / 10 : d);
/* A zoom as typed: "2", "1.5", "1,5"; NaN if it is not one. */
function typedZoom(text) {
  const t = String(text).trim().replace(",", ".");
  return /^\d{1,3}(\.\d{1,3})?$/.test(t) ? Math.round(Number(t) * 10) / 10 : NaN;
}
/* The zoom in a field, kept within 0 to 4; the saved one (or the default) if none is typed. */
function zoomField(id) {
  const n = typedZoom($(id).value);
  if (Number.isNaN(n)) return cleanZoom(store.get(id, ZOOM_FIELDS[id]), ZOOM_FIELDS[id]);
  return Math.min(ZOOM_MAX, n);
}
/* The camera view settings in the form: { direction, carAngle, dirFrom, dirTo, tiltMode, tilt, tiltMin,
   tiltMax, zoomMode, zoom, zoomMin, zoomMax }. */
function viewSettings() {
  return {
    direction: radioValue("viewDirection", VIEW_DIRECTIONS, "road"),
    carAngle: angleField("carAngle"),
    dirFrom: angleField("dirFrom"),
    dirTo: angleField("dirTo"),
    tiltMode: radioValue("tiltMode", TILT_MODES, "fixed"),
    tilt: angleField("tilt"),
    tiltMin: angleField("tiltMin"),
    tiltMax: angleField("tiltMax"),
    zoomMode: radioValue("zoomMode", ZOOM_MODES, "fixed"),
    zoom: zoomField("zoom"),
    zoomMin: zoomField("zoomMin"),
    zoomMax: zoomField("zoomMax"),
  };
}
/* An angle to the car in words: "right", "front left", or "" between the eight directions. */
function angleWord(a) {
  const words = ["front", "front right", "right", "back right", "back", "back left", "left", "front left"];
  return a % 45 === 0 ? words[a / 45] : "";
}
/* How wide the range of a random direction is, clockwise from dirFrom to dirTo: 1–360°. */
/* A tilt in words: "level", "10° up", "25° down". */
const tiltWord = t => (t === 0 ? "level" : t > 0 ? `${t}° up` : `${-t}° down`);
/* A signed angle as written on the page: "−20°", "20°". */
const signedDegrees = t => `${t < 0 ? "−" : ""}${Math.abs(t)}°`;
/* The camera view in words, for the summary and the history: "90° to the car (right), 10° up". */
function viewSummary(v) {
  const word = angleWord(v.carAngle);
  const dir =
    v.direction === "car"
      ? `${v.carAngle}° to ${VIEW_WORDS.front}${word ? ` (${word})` : ""}`
      : v.direction === "random"
        ? directionSpan(v) === 360
          ? "Random direction"
          : `Random direction, ${v.dirFrom}° to ${v.dirTo % 360}° from ${VIEW_WORDS.front}`
        : VIEW_WORDS.road;
  const lo = Math.min(v.tiltMin, v.tiltMax),
    hi = Math.max(v.tiltMin, v.tiltMax);
  const tilt =
    v.tiltMode === "random" ? `random tilt ${signedDegrees(lo)} to ${signedDegrees(hi)}` : tiltWord(v.tilt);
  const zoom =
    v.zoomMode === "random"
      ? `, random zoom ${Math.min(v.zoomMin, v.zoomMax)} to ${Math.max(v.zoomMin, v.zoomMax)}`
      : v.zoom
        ? `, zoom ${v.zoom}`
        : "";
  return `${dir}, ${tilt}${zoom}`;
}
/* True when the camera view is as it is without changes: along the road, level, zoom 0. */
const viewIsDefault = v =>
  v.direction === "road" &&
  v.carAngle === 0 &&
  v.dirFrom === ANGLE_FIELDS.dirFrom.d &&
  v.dirTo === ANGLE_FIELDS.dirTo.d &&
  v.tiltMode === "fixed" &&
  v.tilt === 0 &&
  v.tiltMin === ANGLE_FIELDS.tiltMin.d &&
  v.tiltMax === ANGLE_FIELDS.tiltMax.d &&
  v.zoomMode === "fixed" &&
  Object.entries(ZOOM_FIELDS).every(([id, d]) => v[id] === d);
// Saved settings
setRadio(
  "viewDirection",
  VIEW_DIRECTIONS.includes(store.get("viewDirection")) ? store.get("viewDirection") : "road",
);
setRadio("tiltMode", TILT_MODES.includes(store.get("tiltMode")) ? store.get("tiltMode") : "fixed");
for (const [id, f] of Object.entries(ANGLE_FIELDS)) {
  $(id).value = String(wholeNumber(store.get(id, f.d), f.lo, f.hi, f.d));
  // On leaving the field: keep the angle and show it as it will be used
  $(id).onchange = () => {
    const n = angleField(id);
    store.set(id, n);
    $(id).value = String(n);
    drawView();
  };
  // While typing: the drawing follows
  $(id).oninput = () => {
    if (!Number.isNaN(typedAngle($(id).value))) drawView();
  };
  // The arrow keys turn it, 5° at a time (1° with Shift)
  $(id).onkeydown = e => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    const step = (e.shiftKey ? 1 : 5) * (e.key === "ArrowUp" ? 1 : -1);
    $(id).value = String(angleField(id) + step);
    $(id).onchange();
  };
}
setRadio("zoomMode", ZOOM_MODES.includes(store.get("zoomMode")) ? store.get("zoomMode") : "fixed");
for (const [id, d] of Object.entries(ZOOM_FIELDS)) {
  $(id).value = String(cleanZoom(store.get(id, d), d));
  // On leaving the field: keep the zoom and show it as it will be used
  $(id).onchange = () => {
    const n = zoomField(id);
    store.set(id, n);
    $(id).value = String(n);
    drawZoom();
    updateMore();
  };
  // Its slider: dragging it types the zoom into the field
  $(id + "Slider").oninput = () => {
    $(id).value = $(id + "Slider").value;
    $(id).onchange();
  };
  // The arrow keys change it by 0.5 (0.1 with Shift)
  $(id).onkeydown = e => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    const step = (e.shiftKey ? 0.1 : 0.5) * (e.key === "ArrowUp" ? 1 : -1);
    $(id).value = String(Math.max(0, Math.round((zoomField(id) + step) * 10) / 10));
    $(id).onchange();
  };
}
for (const name of ["viewDirection", "tiltMode", "zoomMode"])
  for (const r of document.querySelectorAll(`input[name=${name}]`))
    r.onchange = () => {
      store.set(name, r.value);
      updateView();
    };
/* Greys out what does not apply: the angle to the car unless it is chosen; the fixed tilt or zoom or
   their ranges, whichever is not chosen. */
function updateView() {
  const v = viewSettings();
  $("carAngle").disabled = v.direction !== "car";
  $("dirFrom").disabled = $("dirTo").disabled = v.direction !== "random";
  $("directionBox").classList.toggle("off", v.direction === "road");
  $("directionBox").classList.toggle("random", v.direction === "random");
  $("tilt").disabled = v.tiltMode !== "fixed";
  $("tiltMin").disabled = $("tiltMax").disabled = v.tiltMode !== "random";
  $("tiltBox").classList.toggle("random", v.tiltMode === "random");
  $("zoom").disabled = v.zoomMode !== "fixed";
  $("zoomMin").disabled = $("zoomMax").disabled = v.zoomMode !== "random";
  $("zoomBox").classList.toggle("random", v.zoomMode === "random");
  for (const id of Object.keys(ZOOM_FIELDS)) $(id + "Slider").disabled = $(id).disabled;
  drawZoom();
  drawView();
}
/* Puts the zoom sliders' handles at the zooms in the fields and fills in the part chosen: from 0 to the
   zoom, or between the two ends of the range. */
function drawZoom() {
  const v = viewSettings();
  for (const id of Object.keys(ZOOM_FIELDS)) $(id + "Slider").value = String(v[id]);
  // a zoom's place on the track, allowing for the handle, which stays inside the track at both ends
  const at = z => `calc(${(z / ZOOM_MAX) * 100}% + ${(0.5 - z / ZOOM_MAX) * 20}px)`;
  const span = (el, lo, hi) => {
    el.style.left = lo ? at(lo) : "0";
    el.style.width = `calc(${at(hi)} - ${lo ? at(lo) : "0px"})`;
  };
  span($("zoomFill"), 0, v.zoom);
  span($("zoomRangeFill"), Math.min(v.zoomMin, v.zoomMax), Math.max(v.zoomMin, v.zoomMax));
}
/* A point on the tilt drawing's half circle for a tilt: right is level, up is +90°. */
const tiltPoint = (t, r = 80) => [r * Math.cos((t * Math.PI) / 180), -r * Math.sin((t * Math.PI) / 180)];
/* Turns the arrows and handles of the drawings to the angles in the fields. */
function drawView() {
  const v = viewSettings();
  $("directionArrow").setAttribute("transform", `rotate(${v.carAngle})`);
  // the range of a random direction: a slice of the circle, clockwise, between two handles
  const around = (a, r = 80) => [r * Math.sin((a * Math.PI) / 180), -r * Math.cos((a * Math.PI) / 180)];
  for (const [id, a] of [
    ["dirFromHandle", v.dirFrom],
    ["dirToHandle", v.dirTo],
  ]) {
    const [x, y] = around(a);
    $(id).setAttribute("cx", x.toFixed(1));
    $(id).setAttribute("cy", y.toFixed(1));
  }
  const span = directionSpan(v),
    [fx, fy] = around(v.dirFrom),
    [tx, ty] = around(v.dirFrom + span);
  $("directionRangeArc").setAttribute(
    "d",
    span === 360
      ? "M0,-80 A80,80 0 1,1 0,80 A80,80 0 1,1 0,-80 Z"
      : `M0,0 L${fx.toFixed(1)},${fy.toFixed(1)} A80,80 0 ${span > 180 ? 1 : 0},1 ${tx.toFixed(1)},${ty.toFixed(1)} Z`,
  );
  $("directionDial").setAttribute(
    "aria-label",
    v.direction === "random"
      ? `${VIEW_WORDS.above}; the camera points somewhere from ${v.dirFrom}° to ${v.dirTo % 360}°, clockwise`
      : `${VIEW_WORDS.above}; the camera points ${v.carAngle}°${angleWord(v.carAngle) ? " (" + angleWord(v.carAngle) + ")" : ""}`,
  );
  $("tiltArrow").setAttribute("transform", `rotate(${-v.tilt})`);
  const lo = Math.min(v.tiltMin, v.tiltMax),
    hi = Math.max(v.tiltMin, v.tiltMax);
  for (const [id, t] of [
    ["tiltMinHandle", v.tiltMin],
    ["tiltMaxHandle", v.tiltMax],
  ]) {
    const [x, y] = tiltPoint(t);
    $(id).setAttribute("cx", x.toFixed(1));
    $(id).setAttribute("cy", y.toFixed(1));
  }
  const [x1, y1] = tiltPoint(lo),
    [x2, y2] = tiltPoint(hi);
  $("tiltRangeArc").setAttribute(
    "d",
    `M0,0 L${x1.toFixed(1)},${y1.toFixed(1)} A80,80 0 0,0 ${x2.toFixed(1)},${y2.toFixed(1)} Z`,
  );
  $("tiltDial").setAttribute(
    "aria-label",
    VIEW_WORDS.side +
      "; " +
      (v.tiltMode === "random"
        ? `tilt from ${signedDegrees(lo)} to ${signedDegrees(hi)}`
        : `tilt ${tiltWord(v.tilt)}`),
  );
}
/* Where a pointer is on a drawing, in the drawing's own units (its centre is 0,0). */
function svgPoint(svg, e) {
  const m = svg.getScreenCTM();
  if (!m) return [0, 0];
  const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
  return [p.x, p.y];
}
/* Sets an angle field as if typed, so it is saved and the drawing follows. */
function setAngle(id, n) {
  $(id).value = String(Math.round(n));
  $(id).onchange();
  updateMore();
}
/* Lets a drawing follow the pointer: onPoint(x, y, first) for the press and every move until released.
   Dragging an arrow also chooses that option (an angle to the car, a fixed or random tilt). */
function dragOn(svg, onPoint) {
  let dragging = false;
  svg.addEventListener("pointerdown", e => {
    if ($("fields").disabled) return;
    dragging = true;
    svg.setPointerCapture(e.pointerId);
    onPoint(...svgPoint(svg, e), true);
    e.preventDefault();
  });
  svg.addEventListener("pointermove", e => {
    if (dragging) onPoint(...svgPoint(svg, e), false);
  });
  for (const end of ["pointerup", "pointercancel"]) svg.addEventListener(end, () => (dragging = false));
}
let directionHandle = "carAngle"; // what a drag on the car from above moves: the angle, or an end of the range
dragOn($("directionDial"), (x, y, first) => {
  const a = ((((Math.atan2(x, -y) * 180) / Math.PI) % 360) + 360) % 360;
  if (first) {
    if (radioValue("viewDirection", VIEW_DIRECTIONS, "road") === "road") {
      setRadio("viewDirection", "car");
      store.set("viewDirection", "car");
      updateView();
    }
    // in "random", the end of the range nearest to where the drag starts
    const gap = b => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
    directionHandle =
      radioValue("viewDirection", VIEW_DIRECTIONS, "road") === "car"
        ? "carAngle"
        : gap(angleField("dirFrom")) <= gap(angleField("dirTo") % 360)
          ? "dirFrom"
          : "dirTo";
  }
  // (the "to" end at the front is 360°, the whole way round, rather than 0°)
  setAngle(directionHandle, directionHandle === "dirTo" && Math.round(a) === 0 ? 360 : a);
});
let tiltHandle = "tilt"; // what a drag on the tilt drawing moves: the tilt, or one end of the range
dragOn($("tiltDial"), (x, y, first) => {
  const t = x <= 0 ? (y < 0 ? 90 : -90) : (Math.atan2(-y, x) * 180) / Math.PI;
  if (first)
    tiltHandle =
      radioValue("tiltMode", TILT_MODES, "fixed") === "fixed"
        ? "tilt"
        : Math.abs(t - angleField("tiltMin")) <= Math.abs(t - angleField("tiltMax"))
          ? "tiltMin"
          : "tiltMax";
  setAngle(tiltHandle, t);
});
updateView();

/* The camera view as the shared code sees it (the settings, the history, "More options" and the search):
   through this one name, so a tool without "Camera view" leaves this file out and says
   CAMERA_VIEW = null (Unofficial, since November 2026); the shared code then uses DEFAULT_VIEW. */
const CAMERA_VIEW = {
  /* The search's view, from the form (see searchSettingsNow). */
  view: viewSettings,
  /* Its part of currentSettings: the direction is kept as viewDirection. */
  settings: () => (({ direction, ...rest }) => ({ viewDirection: direction, ...rest }))(viewSettings()),
  /* Its part of cleanSettings: values from outside, checked. */
  clean: r => ({
    viewDirection: VIEW_DIRECTIONS.includes(r.viewDirection) ? r.viewDirection : "road",
    ...Object.fromEntries(
      Object.entries(ANGLE_FIELDS).map(([id, f]) => [id, wholeNumber(r[id], f.lo, f.hi, f.d)]),
    ),
    tiltMode: TILT_MODES.includes(r.tiltMode) ? r.tiltMode : "fixed",
    // (settings from before the zoom was kept get zoom 0, as the map files had then)
    zoomMode: ZOOM_MODES.includes(r.zoomMode) ? r.zoomMode : "fixed",
    ...Object.fromEntries(Object.entries(ZOOM_FIELDS).map(([id, d]) => [id, cleanZoom(r[id], d)])),
  }),
  /* Its part of applySettings: the form and what is saved. */
  apply: s => {
    setRadio("viewDirection", s.viewDirection);
    setRadio("tiltMode", s.tiltMode);
    store.set("viewDirection", s.viewDirection);
    store.set("tiltMode", s.tiltMode);
    setRadio("zoomMode", s.zoomMode);
    store.set("zoomMode", s.zoomMode);
    for (const id of [...Object.keys(ANGLE_FIELDS), ...Object.keys(ZOOM_FIELDS)]) {
      $(id).value = String(s[id]);
      store.set(id, s[id]);
    }
    updateView();
  },
  /* Its words in the history (see historyDetails): none for the defaults. */
  details: s => {
    const view = { ...s, direction: s.viewDirection };
    return viewIsDefault(view) ? [] : ["camera " + viewSummary(view).replace(/^./, c => c.toLowerCase())];
  },
  /* Its "More options" section (see "more options"). */
  more: {
    summary: () => viewSummary(viewSettings()),
    changed: () => !viewIsDefault(viewSettings()),
    reset: () => {
      setRadio("viewDirection", "road");
      setRadio("tiltMode", "fixed");
      store.set("viewDirection", "road");
      store.set("tiltMode", "fixed");
      setRadio("zoomMode", "fixed");
      store.set("zoomMode", "fixed");
      for (const [id, f] of Object.entries(ANGLE_FIELDS)) setControl(id, String(f.d));
      for (const [id, d] of Object.entries(ZOOM_FIELDS)) setControl(id, String(d));
      updateView();
    },
  },
};
