// PROTOTYPE. Links the vendored libmoonshine.so from the v0.1.5 release and
// bakes its directory into the rpath so the binary runs without LD_LIBRARY_PATH.
fn main() {
    let lib = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../vendor/moonshine-linux/lib");
    let lib = lib.canonicalize().expect("run `node spike/dictation/fetch-models.mjs` first");
    println!("cargo:rustc-link-search=native={}", lib.display());
    println!("cargo:rustc-link-lib=dylib=moonshine");
    println!("cargo:rustc-link-arg=-Wl,-rpath,{}", lib.display());
}
