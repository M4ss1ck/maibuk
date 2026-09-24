// Node has no bundler: tests load the sql.js wasm straight from node_modules
// where the app bundle gets a `?url` asset (see vite.config.ts test.alias).
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export default require.resolve("sql.js/dist/sql-wasm.wasm");
