// hunspell-asm's ESM entry hands the bundled runtime namespace to
// `getModuleLoader`, which calls it, so a bundler reaches a namespace object
// that is not callable. The CommonJS entry keeps the runtime callable, and the
// package resolves its browser build for both.
declare module "hunspell-asm/dist/cjs/index.js" {
  export * from "hunspell-asm";
}
