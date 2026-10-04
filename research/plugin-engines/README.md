# Plugin engine probes (#407)

Throwaway harness for T1 (CSP reaches a blob Worker in a sandboxed frame), T2 (Tauri IPC from a sandboxed frame), and T3 (Remote DOM keystroke echo). Results: `docs/research/plugins-engine-verification.md` on main.

1. `pnpm install --ignore-workspace` a scratch dir with react@19.2.3, react-dom@19.2.3, @remote-dom/core, @remote-dom/react@1.2.2, @quilted/threads; `PROBE_DEPS=<dir> ./build.sh` writes `public/probe/`.
2. `node collector.mjs` (collector :8787, static probe :8788). Output in `out/<run>.json`.
3. Browsers: `node run-playwright.mjs chromium webkit firefox`.
4. Tauri Linux: `VITE_PLUGIN_PROBE=1 pnpm tauri build --debug --no-bundle --config '{"identifier":"com.massick.maibuk.probe","productName":"maibuk-probe"}'`, run `src-tauri/target/debug/maibuk`, read stderr for `__TAURI_INVOKE_KEY__` lines. The separate identifier keeps the probe off the author's Library and out of single-instance hand-off.
5. Android: `adb reverse tcp:8787 tcp:8787`, `VITE_PLUGIN_PROBE=1 pnpm tauri android build --debug --apk true --target x86_64`, install, launch, `adb logcat | grep INVOKE_KEY`.
6. `node summarize.mjs out/*.json`: T1 verdicts come from what the collector received, never from the page's errors.

`index.html` carries the `VITE_PLUGIN_PROBE` redirect on this branch only.
