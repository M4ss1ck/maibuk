/* Inlined into the <head> of index.html to paint the first frame before the
   app loads. The only reader of the maibuk-boot-theme record: one guard loop
   over vars, never per-token code. The Embed route owns its theme through
   ?theme, so there the script paints only that mode and never the snapshot. */
(function bootTheme() {
  var mode = "system";
  var vars = {};
  var record;
  var dark;
  var keys;
  var i;
  var embed;
  try {
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
        }
      } catch (_err) {
        /* unreadable record: keep the defaults */
      }
    }
    dark = mode === "dark";
    if (mode === "system") {
      dark = !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
    }
    document.documentElement.classList.toggle("dark", dark);
    keys = Object.keys(vars);
    for (i = 0; i < keys.length; i++) {
      if (keys[i].indexOf("--") === 0 && typeof vars[keys[i]] === "string") {
        document.documentElement.style.setProperty(keys[i], vars[keys[i]]);
      }
    }
  } catch (_err) {
    /* storage or DOM unavailable: the app still boots */
  }
})();
