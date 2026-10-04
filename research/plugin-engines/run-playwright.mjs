// Runs the probe page in Playwright Chromium, WebKit, and Firefox against the collector.
import { chromium, firefox, webkit } from "@playwright/test";
const engines = { chromium, webkit, firefox };
const which = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(engines);
for (const name of which) {
  const browser = await engines[name].launch();
  const page = await browser.newPage();
  page.on("console", (m) => m.type() === "error" && console.log(`[${name} console] ${m.text()}`));
  const run = `pw-${name}-${Date.now()}`;
  await page.goto(`http://127.0.0.1:8788/probe/index.html?run=${run}`);
  await page.waitForFunction(() => document.title === "probe done", null, { timeout: 600000 });
  console.log(`${name}: ${browser.version()} run=${run}`);
  console.log(await page.locator("#log").textContent());
  await browser.close();
}
