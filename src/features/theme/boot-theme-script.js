/* Inlined into the <head> of index.html to paint the first frame before the
   app loads. One guard loop over vars, never per-token code. The Embed route
   owns its theme through ?theme and never paints the snapshot. */
(function bootTheme() {
  var mode = "system";
  var vars = {};
  var record;
  var dark;
  var keys;
  var i, eink;
  var embed;
  var d;
  try {
    d = document.documentElement;
    if (location.pathname === "/embed") {
      embed = /[?&]theme=(light|dark|system)(?:&|$)/.exec(location.search);
      mode = embed ? embed[1] : "system";
    } else {
      try {
        record = JSON.parse(localStorage.getItem("maibuk-boot-theme"));
        if (
          record &&
          record.v === 1 &&
          /^(light|dark|system)$/.test(record.mode) &&
          record.vars &&
          typeof record.vars === "object" &&
          !Array.isArray(record.vars)
        ) {
          mode = record.mode;
          vars = record.vars;
          eink = record.eink === true;
        }
      } catch (_err) {
        /* unreadable record: keep the defaults */
      }
    }
    dark = mode === "dark";
    if (mode === "system") {
      dark = !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
    }
    d.classList.toggle("dark", dark);
    d.classList.toggle("eink", !!eink);
    if (eink) d.dataset.motion = "reduce";
    keys = Object.keys(vars);
    for (i = 0; i < keys.length; i++) {
      if (keys[i].indexOf("--") === 0 && typeof vars[keys[i]] === "string") {
        d.style.setProperty(keys[i], vars[keys[i]]);
      }
    }
  } catch (_err) {
    /* storage or DOM unavailable: the app still boots */
  }
})();
