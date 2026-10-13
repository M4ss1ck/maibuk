use std::path::PathBuf;

/// Ensures `bundle.resources` resolves on a tree where the frontend build has
/// not run yet.
///
/// `tauri.conf.json` maps `../dist/plugins/` into the bundle as `plugins/`
/// (issue #444), where `resolve_builtin_plugin_folder` reads
/// `<resource>/plugins/<id>/`. Tauri validates those resource paths during the
/// build, so `cargo check`/`cargo test` and `pnpm dev` on a clean checkout (no
/// `dist/` yet) would otherwise fail. Create the folder with the empty shipped
/// list the app tolerates; the real build
/// (`scripts/build-builtin-plugins.ts`, run by `pnpm build` after Vite) writes
/// over it, and an existing `index.json` from that build is never touched.
fn ensure_builtin_plugins_folder() {
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap_or_else(|_| ".".to_string());
    let plugins_dir = PathBuf::from(manifest_dir).join("../dist/plugins");
    let _ = std::fs::create_dir_all(&plugins_dir);

    let index = plugins_dir.join("index.json");
    if !index.exists() {
        let _ = std::fs::write(&index, "{ \"plugins\": [] }\n");
    }
}

fn main() {
    ensure_builtin_plugins_folder();
    tauri_build::build()
}
