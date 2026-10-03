const { chromium } = require("@playwright/test");
const fs = require("fs"),
  vm = require("vm"),
  assert = require("assert/strict");
const path = require("node:path").join(__dirname, "plugin-permission-flow.prototype.html");
fs.mkdirSync("/tmp/plugin-permission-flow/critique", { recursive: true });
const html = fs.readFileSync(path, "utf8");
const copyScript = html.match(/<script>\n([\s\S]*?)<\/script>/)[1];
vm.runInNewContext(
  copyScript.split(/let lang\s*=/)[0] +
    ";if(JSON.stringify(Object.keys(copy.en).sort())!==JSON.stringify(Object.keys(copy.es).sort()))throw Error('Locale keys differ')"
);
const model = html.match(/<script id="model">([\s\S]*?)<\/script>/)[1];
vm.runInNewContext(
  model +
    `
let probe=initial();probe=transition(probe,{type:'approve',files:'A',grants:probe.required});probe=transition(probe,{type:'change',requireOptional:true});if(probe.enabled||!probe.required.includes('network:api.example.com'))throw Error('new required access');
let s=initial();
if(s.enabled||!needsReview(s))throw Error('new');s=transition(s,{type:'approve',files:'A',grants:[]});if(s.enabled||s.approved)throw Error('required approval bypass');
s=transition(s,{type:'approve',files:'A',grants:s.requested});
s=transition(s,{type:'change'});if(s.enabled||!needsReview(s)||!s.notice)throw Error('changed same permissions');s=transition(s,{type:'dismissNotice'});if(s.notice||!needsReview(s))throw Error('dismiss must retain review requirement');
s=transition(s,{type:'approve',files:'A',grants:s.requested});if(s.enabled)throw Error('stale approval');
s=initial('builtin');s=transition(s,{type:'grant',permission:'library:read',allowed:false});s=transition(s,{type:'call',permission:'library:read'});if(s.call!=='stopped'||s.enabled)throw Error('required revocation');s=transition(s,{type:'toggle'});if(s.enabled)throw Error('required re-enable bypass');
s=transition(s,{type:'updateAvailable'});if(s.grants.includes('library:read')||s.update)throw Error('auto update');
s=transition(s,{type:'change'});s=transition(s,{type:'updateAvailable'});if(!s.modified||!s.update)throw Error('modified update');s=transition(s,{type:'replace'});if(s.modified||s.update||s.grants.includes('library:read'))throw Error('replacement');
s=initial();s=transition(s,{type:'approve',files:s.files,grants:s.requested});s=transition(s,{type:'resetSettings'});if(s.enabled||s.approved||s.credentials||s.settings||!s.library)throw Error('settings reset');
s=initial('builtin');s=transition(s,{type:'resetLibrary'});if(s.library||!s.credentials||!s.enabled||!s.settings)throw Error('library reset');
s=initial();s=transition(s,{type:'approve',files:'A',grants:s.required});s=transition(s,{type:'dev',enabled:true});s=transition(s,{type:'change'});if(!s.enabled)throw Error('dev reload');s=transition(s,{type:'call',permission:'network:api.example.com'});if(s.call!=='denied')throw Error('dev permission bypass');s=transition(s,{type:'dev',enabled:false});if(s.enabled)throw Error('exit dev');
`,
  { structuredClone }
);
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1200, height: 1100 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("file://" + path);
  await page.getByRole("button", { name: "Review and enable", exact: true }).click();
  assert.equal(await page.getByRole("checkbox").first().isChecked(), true);
  assert.equal(await page.getByRole("checkbox").first().isDisabled(), true);
  assert.match(await page.getByRole("checkbox").first().getAttribute("type"), /checkbox/);
  await page.getByRole("button", { name: "Approve this copy and enable", exact: true }).click();
  assert.equal(await page.locator("#status").textContent(), "Enabled");
  await page.getByRole("button", { name: "Manage permissions", exact: true }).click();
  const optional = page.getByRole("checkbox", {
    name: "Connect to api.example.com · Optional",
    exact: true,
  });
  await optional.check();
  await optional.uncheck();
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#status").textContent(), "Enabled");
  await page.getByRole("button", { name: "Manage permissions", exact: true }).click();
  await page.getByRole("button", { name: "Disable Plugin and revoke access", exact: true }).click();
  assert.equal(await page.locator("#status").textContent(), "Off");
  await page.getByRole("button", { name: "Review and enable", exact: true }).click();
  await page.getByRole("button", { name: "Approve this copy and enable", exact: true }).click();
  await page.getByRole("button", { name: "Change files and access", exact: true }).click();
  assert.equal(await page.locator("#changedNotice").isVisible(), true);
  assert.equal(await page.locator("#dialog").isVisible(), false);
  await page.getByRole("button", { name: "Dismiss", exact: true }).click();
  assert.equal(await page.locator("#changedNotice").isVisible(), false);
  assert.equal(await page.locator("#status").textContent(), "Review required");
  await page.getByRole("button", { name: "Review and enable", exact: true }).click();
  assert.match(
    await page.locator("#dialogBody").textContent(),
    /Added: Connect to uploads.example.com/
  );
  assert.match(await page.locator("#dialogBody").textContent(), /Removed: Use credentials/);
  await page.screenshot({ path: "/tmp/plugin-permission-flow/critique/required-review-light.png" });
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#enable").evaluate((e) => e === document.activeElement), true);
  await page.selectOption("#scenario", "3");
  await page.locator("#next").click();
  await page.locator("#next").click();
  await page.getByRole("button", { name: "Approve this copy and enable", exact: true }).click();
  await page.locator("#next").click();
  await page.locator("#next").click();
  const beforeKeep = await page.locator("#state").textContent();
  await page.getByRole("button", { name: "Keep my copy", exact: true }).click();
  assert.equal(await page.locator("#state").textContent(), beforeKeep);
  assert.equal(await page.locator("#update").isVisible(), true);
  await page.getByRole("button", { name: "Try a permitted-namespace call", exact: true }).click();
  assert.equal(await page.locator("#dialog").isVisible(), false);
  for (let i = 0; i < 9; i++) {
    await page.selectOption("#scenario", String(i));
    while (!(await page.locator("#next").isDisabled())) {
      await page.locator("#next").click();
      if (await page.locator("#dialog").isVisible()) {
        await page.keyboard.press("Escape");
      }
    }
  }
  await page.selectOption("#language", "es");
  await page.selectOption("#scenario", "5");
  await page.locator("#next").click();
  assert.match(await page.locator("#dialogBody").textContent(), /Ejecutar programas/);
  await page.keyboard.press("Escape");
  await page.emulateMedia({ colorScheme: "dark" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "/tmp/plugin-permission-flow/critique/spanish-dark-phone.png",
    fullPage: true,
  });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  const req = await browser.newPage({ viewport: { width: 1200, height: 1100 } });
  req.on("pageerror", (e) => errors.push(e.message));
  await req.goto("file://" + path);
  await req.getByRole("button", { name: "Review and enable", exact: true }).click();
  await req.getByRole("button", { name: "Approve this copy and enable", exact: true }).click();
  await req
    .getByRole("button", { name: "Make an optional permission required", exact: true })
    .click();
  assert.equal(await req.locator("#status").textContent(), "Review required");
  await req.getByRole("button", { name: "Review and enable", exact: true }).click();
  assert.match(
    await req.locator("#dialogBody").textContent(),
    /Now required: Connect to api\.example\.com · Required/
  );
  const nowReq = req.getByRole("checkbox", { name: /Now required: Connect to api\.example\.com/ });
  assert.equal(await nowReq.isChecked(), true);
  assert.equal(await nowReq.isDisabled(), true);
  await req.screenshot({ path: "/tmp/plugin-permission-flow/critique/now-required-light.png" });
  assert.deepEqual(errors, []);
  await browser.close();
  console.log(
    "PASS: required defaults, blocked incomplete approval, required revocation disables, re-enable review, optional revocation preserves enabled state; pure transitions, nine walkthroughs, permission diff, optional-to-required (Now required, locked), Escape/focus return, Spanish, narrow layout; no browser errors."
  );
})();
