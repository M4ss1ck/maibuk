// The QuickJS detection probe (quickjs.test.ts): runs the real detector on one
// Chapter's text inside the engine and posts the kinds it found.
import { DEFAULT_ECHO_SETTINGS, findEchoes } from "../find-echoes";

const text = "The rain fell. The rain kept falling. Rain, rain, rain on the roof.";
const echoes = findEchoes(text, "en", DEFAULT_ECHO_SETTINGS);
self.postMessage({ kinds: echoes.map((echo) => `${echo.kind}:${echo.normalized}`) });
