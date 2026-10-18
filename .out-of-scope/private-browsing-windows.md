# Private browsing windows

The web build makes no promises about private or ephemeral browser windows
(Safari Private, Firefox Private, Chrome Incognito). Whatever a browser lets
the web build do in such a window works, and whatever it withholds is
simply absent. Maibuk neither detects these windows nor explains them.

The known case is the web Plugin Directory. In a Safari Private window, and in
any WebKit ephemeral session, `navigator.storage.getDirectory()` throws
`UnknownError` ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/getDirectory)).
`opfsRoot()` in `src/lib/platform/web/plugins.ts` catches that and returns
`null`, so:

- the Settings Plugins section lists no Plugins;
- Add Plugin and Add from folder throw `Plugin storage is not available`, which
  the Settings Plugins section shows as the generic "Could not add the
  Plugin." toast;
- a Built-in Reinstall or Replace returns `false` from `replaceFolder`.

## Why this is out of scope

A private window throws its storage away when it closes. The Library, Plugins,
Plugin Permissions, and settings all disappear with it. A writing app whose
whole job is keeping a manuscript safe has nothing useful to offer an author
there beyond a scratch session, and supporting the window properly would mean
more than one notice:

- a storage probe on every web adapter (OPFS, IndexedDB, localStorage), since
  each browser withholds a different subset in private mode, and the subset
  changes between releases;
- copy and a disabled state for each feature that loses its storage, not just
  Plugins;
- an E2E lane in an ephemeral context per engine to keep those states honest.

That cost buys nothing for the author who writes in a normal window, which is
every author Maibuk is built for. The current behavior already fails safe: no
storage means no Plugins run, never a half-installed one.

The E2E harness still has to know about the WebKit rule, because Playwright's
default context is ephemeral. That is test plumbing, not product support:
`needsPersistentContext` in `e2e/support/storage.ts` (pinned by
`src/test/unit/e2e-persistent-context.test.ts`) gives a WebKit test that seeds
the web Plugin Directory a persistent context.

## Prior requests

- #512: "Web Plugin Directory is silently absent in Safari Private windows"
