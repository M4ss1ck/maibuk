/* The Reader Frame's placeholder script (#653). The Frame's only host channel
   is `window.maibuk.port`: the Worker sends `{ kind: "open", entry, language }`
   when the Frame is ready, and this script posts `{ kind: "back" }` when the
   author presses the Back to Shelf button or Escape. A classic script, because a
   relative `import` cannot resolve in an opaque origin.

   The reading surface (pdf.js and the format parsers) lands later; until then
   this page names the Document it was given and gets out of the way. */
(() => {
  const STRINGS = {
    en: {
      back: "Back to Shelf",
      empty: "No Document open",
      note: "The reading surface arrives in a later update.",
    },
    es: {
      back: "Volver al estante",
      empty: "Ningún documento abierto",
      note: "La superficie de lectura llega en una actualización posterior.",
    },
  };

  const port = window.maibuk && window.maibuk.port;
  const back = document.getElementById("back");
  const title = document.getElementById("title");
  const note = document.getElementById("note");

  let language = "en";
  let entry = null;

  function strings() {
    return STRINGS[language.split(/[-_]/)[0]] || STRINGS.en;
  }

  function render() {
    const labels = strings();
    document.documentElement.lang = language;
    if (back) back.textContent = labels.back;
    if (title) title.textContent = entry && entry.title ? entry.title : labels.empty;
    if (note) note.textContent = labels.note;
  }

  render();
  if (!port) return;

  port.onmessage = (event) => {
    const data = event.data;
    if (!data || typeof data !== "object") return;
    if (data.kind === "open") {
      entry = data.entry || null;
      if (typeof data.language === "string") language = data.language;
      render();
      return;
    }
    if (data.kind === "language" && typeof data.language === "string") {
      language = data.language;
      render();
    }
  };
  port.start();

  function leave() {
    port.postMessage({ kind: "back" });
  }

  if (back) back.addEventListener("click", leave);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      leave();
    }
  });

  port.postMessage({ kind: "ready" });
})();
