// The Cover Designer object workflows (issue #211): adding objects, selecting
// and stacking Layers, editing properties, nudging, aligning, the Cover
// shortcuts, and leaving with unsaved changes — all by keyboard alone over the
// seeded `oneBookThreeChapters` Library. Content is asserted through the
// Layers panel and the persisted scene, never pixel screenshots.
//
// The opening journey, Templates, Cover Size Presets, Background, layout aids,
// and Export live in `cover.spec.ts`; the small helpers here mirror that file.

import type { Locator, Page } from "@playwright/test";
import { DOT_PNG, IMAGE_FIXTURE_DIR } from "../support/fixtures/images";
import { pressUntilFocused, tabTo } from "../support/keyboard";
import { SEED_BOOK } from "../support/seed/names";
import { expect, test } from "../support/test";

test.use({ library: "oneBookThreeChapters" });

const editorText = (page: Page) => page.getByRole("textbox", { name: /^Text of / });
const designCover = (page: Page) => page.getByRole("button", { name: "Design Cover", exact: true });
const back = (page: Page) => page.getByRole("button", { name: "Back", exact: true });
const addText = (page: Page) => page.getByRole("button", { name: "Add Text", exact: true });
const addImage = (page: Page) => page.getByRole("button", { name: "Add Image", exact: true });
const addShape = (page: Page) => page.getByRole("button", { name: "Add Shape", exact: true });
const saveButton = (page: Page) => page.getByRole("button", { name: "Save Cover", exact: true });
const savedButton = (page: Page) => page.getByRole("button", { name: "Saved", exact: true });
/** React Aria labels the Font picker with its value too, so match it loosely. */
const font = (page: Page) => page.getByRole("button", { name: "Font" });
/** The Angle label also carries its degrees readout, so match it loosely. */
const angle = (page: Page) => page.getByRole("slider", { name: /Angle/ });

/** A Layers row is a plain button named by its layer label. */
const layer = (page: Page, name: string) => page.getByRole("button", { name, exact: true });
/** Each layer carries exactly one "Bring forward" button, so this counts layers. */
const layers = (page: Page) => page.getByRole("button", { name: "Bring forward", exact: true });
/** A labelled property control (the NumberField and checkbox labels wrap the input). */
const field = (page: Page, name: string) => page.getByLabel(name, { exact: true });

async function openBookEditor(page: Page) {
  await page.goto("/");
  const card = page.getByRole("grid", { name: "Books" }).getByRole("row");
  await expect(card).toHaveCount(1);
  await page.keyboard.press("1");
  await expect(card).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(editorText(page)).toBeFocused();
}

/** Opens the Cover Designer the way an author does: from the Book Editor. */
async function openCover(page: Page) {
  await openBookEditor(page);
  // Tab is trapped inside the editor, so Escape first hands focus to the
  // Chapter list pane, the last stop before the header controls.
  await page.keyboard.press("Escape");
  await tabTo(page, designCover(page), { max: 40 });
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/book\/[\w-]+\/cover$/);
  await expect(page.getByRole("heading", { name: "Cover Designer", level: 1 })).toBeVisible();
}

/** Tabs to a toolbar menu trigger and opens it. React Aria labels the menu from the trigger. */
async function openMenu(page: Page, trigger: Locator, max = 60) {
  await tabTo(page, trigger, { max });
  await page.keyboard.press("Enter");
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  return menu;
}

/** Moves inside an open menu to an item and picks it. */
async function pickMenuItem(page: Page, name: string | RegExp, max = 10) {
  const item = page.getByRole("menuitem", { name });
  await pressUntilFocused(page, "ArrowDown", item, { max });
  await page.keyboard.press("Enter");
}

/** Saves through the registered Cover shortcut. */
async function saveCover(page: Page) {
  await page.keyboard.press("ControlOrMeta+s");
  await expect(savedButton(page)).toBeVisible();
}

/** Tabs forward from the current position to a Layers row and selects it. */
async function selectLayer(page: Page, name: string, max = 70) {
  await tabTo(page, layer(page, name), { max });
  await page.keyboard.press("Enter");
}

/** Replaces the value of a labelled number field by keyboard. */
async function setField(page: Page, name: string, value: string, max = 70) {
  await tabTo(page, field(page, name), { max });
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type(value);
}

test.describe("adding objects @wf:cover-add-objects", () => {
  test("the Add Text and Add Shape menus add layers the Layers panel names", async ({ page }) => {
    await openCover(page);
    await expect(layers(page)).toHaveCount(2);

    // Add Text offers the Title, Subtitle, and Author Name blocks.
    await openMenu(page, addText(page));
    await expect(page.getByRole("menuitem", { name: "Title", exact: true })).toBeVisible();
    await pickMenuItem(page, "Subtitle");
    await expect(layer(page, "Subtitle")).toBeVisible();

    await openMenu(page, addText(page));
    await pickMenuItem(page, "Author Name", 3);
    await expect(layer(page, "Author Name")).toBeVisible();

    // Add Shape offers the rect/ellipse/line shapes, named by their kind.
    await openMenu(page, addShape(page));
    await pickMenuItem(page, "Rectangle");
    await expect(layer(page, "rect")).toBeVisible();

    await openMenu(page, addShape(page));
    await pickMenuItem(page, "Ellipse", 2);
    await expect(layer(page, "ellipse")).toBeVisible();

    await openMenu(page, addShape(page));
    await pickMenuItem(page, "Line", 3);
    await expect(layer(page, "line")).toBeVisible();

    await expect(layers(page)).toHaveCount(7);
    await saveCover(page);
    await page.reload();
    for (const name of ["Subtitle", "Author Name", "rect", "ellipse", "line"]) {
      await expect(layer(page, name)).toBeVisible();
    }
  });

  test("Add Image opens the file chooser and adds an Image layer @wf:cover-add-objects", async ({
    page,
  }) => {
    await openCover(page);
    const upload = addImage(page);
    await tabTo(page, upload, { max: 40 });

    const chooserPromise = page.waitForEvent("filechooser");
    await page.keyboard.press("Enter");
    const chooser = await chooserPromise;
    await chooser.setFiles(`${IMAGE_FIXTURE_DIR}/${DOT_PNG}`);

    await expect(layer(page, "Image")).toBeVisible();
    await expect(page.getByText("Filters", { exact: true })).toBeVisible();

    await saveCover(page);
    await page.reload();
    await expect(layer(page, "Image")).toBeVisible();
  });
});

test.describe("selecting a layer @wf:cover-select-layer", () => {
  test("Enter on a Layers row selects it and the Properties panel follows", async ({ page }) => {
    await openCover(page);
    // The fresh Cover selects the author layer; its Font is Arial.
    await selectLayer(page, SEED_BOOK.authorName);
    await expect(font(page)).toBeVisible();
    await expect(font(page)).toContainText("Arial");

    // Author is the top row, the title the next one.
    await selectLayer(page, SEED_BOOK.title, 6);
    await expect(font(page)).toContainText("Georgia");
  });

  test("visibility and lock toggles expose their state, reorder restacks, and all persist", async ({
    page,
  }) => {
    await openCover(page);
    await selectLayer(page, SEED_BOOK.authorName);

    const authorRow = layer(page, SEED_BOOK.authorName).locator("..");
    const visibility = authorRow.getByRole("button", { name: "Toggle visibility" });
    const lock = authorRow.getByRole("button", { name: "Toggle lock" });

    await tabTo(page, visibility, { max: 6 });
    await page.keyboard.press("Enter");
    await expect(visibility).toHaveAttribute("aria-pressed", "true");
    await tabTo(page, lock, { max: 2 });
    await page.keyboard.press("Enter");
    await expect(lock).toHaveAttribute("aria-pressed", "true");

    // Author is the top layer; sending it backward puts the title above it.
    const title = layer(page, SEED_BOOK.title);
    const author = layer(page, SEED_BOOK.authorName);
    const titleBefore = await title.boundingBox();
    const authorBefore = await author.boundingBox();
    expect(titleBefore?.y ?? 0).toBeGreaterThan(authorBefore?.y ?? 0);

    await tabTo(page, authorRow.getByRole("button", { name: "Send backward" }), {
      max: 4,
      backwards: true,
    });
    await page.keyboard.press("Enter");
    await expect
      .poll(async () => (await title.boundingBox())?.y ?? 0)
      .toBeLessThan((await author.boundingBox())?.y ?? 0);

    await saveCover(page);
    await page.reload();
    await expect(layer(page, SEED_BOOK.authorName).locator("..")).toBeVisible();
    await expect(
      layer(page, SEED_BOOK.authorName)
        .locator("..")
        .getByRole("button", { name: "Toggle visibility" })
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      layer(page, SEED_BOOK.authorName).locator("..").getByRole("button", { name: "Toggle lock" })
    ).toHaveAttribute("aria-pressed", "true");
    await expect
      .poll(async () => (await title.boundingBox())?.y ?? 0)
      .toBeLessThan((await author.boundingBox())?.y ?? 0);
  });
});

test.describe("editing properties @wf:cover-properties", () => {
  test("text properties — font, size, rotation, opacity, stroke, shadow — persist", async ({
    page,
  }) => {
    await openCover(page);
    await selectLayer(page, SEED_BOOK.title);

    await tabTo(page, font(page), { max: 70 });
    await page.keyboard.press("Enter");
    await pressUntilFocused(page, "ArrowDown", page.getByRole("option", { name: "Impact" }), {
      max: 12,
    });
    await page.keyboard.press("Enter");
    await expect(font(page)).toContainText("Impact");

    await setField(page, "Size", "50");
    await expect(field(page, "Size")).toHaveValue("50");
    await setField(page, "Rotation", "15");
    await expect(field(page, "Rotation")).toHaveValue("15");

    const opacity = field(page, "Opacity");
    await tabTo(page, opacity, { max: 40 });
    await page.keyboard.press("ArrowDown");
    await expect(opacity).toHaveValue("0.9");

    const stroke = field(page, "Stroke");
    await tabTo(page, stroke, { max: 70 });
    await page.keyboard.press(" ");
    await expect(stroke).toBeChecked();
    await page.keyboard.press("Tab");
    const shadow = field(page, "Shadow");
    await tabTo(page, shadow, { max: 4 });
    await page.keyboard.press(" ");
    await expect(shadow).toBeChecked();

    const curve = field(page, "Curve text");
    await tabTo(page, curve, { max: 40 });
    await page.keyboard.press(" ");
    await expect(curve).toBeChecked();
    const spread = page.getByRole("slider", { name: /°/ });
    await tabTo(page, spread, { max: 5 });
    await page.keyboard.press("ArrowRight");
    await expect(spread).toHaveValue("61");

    await saveCover(page);
    await page.reload();
    await selectLayer(page, SEED_BOOK.title);
    await expect(font(page)).toContainText("Impact");
    await expect(field(page, "Size")).toHaveValue("50");
    await expect(field(page, "Rotation")).toHaveValue("15");
    await expect(field(page, "Opacity")).toHaveValue("0.9");
    await expect(field(page, "Stroke")).toBeChecked();
    await expect(field(page, "Shadow")).toBeChecked();
    await expect(field(page, "Curve text")).toBeChecked();
    await expect(page.getByRole("slider", { name: /°/ })).toHaveValue("61");
  });

  test("a fill becomes a gradient whose stops can be added and removed", async ({ page }) => {
    await openCover(page);
    await selectLayer(page, SEED_BOOK.title);

    const linear = page.getByRole("button", { name: "Linear", exact: true });
    await tabTo(page, linear, { max: 70 });
    await page.keyboard.press("Enter");
    await expect(angle(page)).toBeVisible();

    await tabTo(page, angle(page), { max: 10 });
    await page.keyboard.press("ArrowRight");
    await expect(angle(page)).toHaveValue("91");

    await expect(page.getByRole("button", { name: "Remove stop" })).toHaveCount(2);
    await tabTo(page, page.getByRole("button", { name: "Add stop", exact: true }), { max: 30 });
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Remove stop" })).toHaveCount(3);
    await expect(page.getByRole("button", { name: "Remove stop" }).first()).toBeEnabled();

    await saveCover(page);
    await page.reload();
    await selectLayer(page, SEED_BOOK.title);
    await expect(angle(page)).toHaveValue("91");
    await expect(page.getByRole("button", { name: "Remove stop" })).toHaveCount(3);

    await tabTo(page, page.getByRole("button", { name: "Remove stop" }).first(), { max: 40 });
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Remove stop" })).toHaveCount(2);
  });

  test("an Image layer's filters change and persist", async ({ page }) => {
    await openCover(page);
    const upload = addImage(page);
    await tabTo(page, upload, { max: 40 });
    const chooserPromise = page.waitForEvent("filechooser");
    await page.keyboard.press("Enter");
    await (await chooserPromise).setFiles(`${IMAGE_FIXTURE_DIR}/${DOT_PNG}`);
    await expect(page.getByText("Filters", { exact: true })).toBeVisible();

    const brightness = page.getByRole("slider", { name: "Brightness", exact: true });
    await tabTo(page, brightness, { max: 70 });
    await page.keyboard.press("ArrowRight");
    await expect(brightness).toHaveValue("0.05");

    const blur = page.getByRole("slider", { name: "Blur", exact: true });
    await tabTo(page, blur, { max: 10 });
    await page.keyboard.press("ArrowRight");
    await expect(blur).toHaveValue("0.05");

    await saveCover(page);
    await page.reload();
    await selectLayer(page, "Image");
    await expect(page.getByRole("slider", { name: "Brightness", exact: true })).toHaveValue("0.05");
    await expect(page.getByRole("slider", { name: "Blur", exact: true })).toHaveValue("0.05");
  });
});

test.describe("nudging the selected object @wf:cover-nudge-position", () => {
  test("arrow keys nudge and the X/Y fields set the position, persisting", async ({ page }) => {
    await openCover(page);
    await selectLayer(page, SEED_BOOK.title);

    const x = field(page, "X");
    const x0 = Number(await x.inputValue());
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expect(x).toHaveValue(String(x0 + 2));
    await page.keyboard.press("Shift+ArrowRight");
    await expect(x).toHaveValue(String(x0 + 12));
    const y0 = Number(await field(page, "Y").inputValue());
    await page.keyboard.press("ArrowDown");
    await expect(field(page, "Y")).toHaveValue(String(y0 + 1));

    await setField(page, "X", "100");
    await expect(x).toHaveValue("100");
    await setField(page, "Y", "200");
    await expect(field(page, "Y")).toHaveValue("200");

    await saveCover(page);
    await page.reload();
    await selectLayer(page, SEED_BOOK.title);
    await expect(field(page, "X")).toHaveValue("100");
    await expect(field(page, "Y")).toHaveValue("200");
  });
});
test.describe("aligning the selected layer @wf:cover-align", () => {
  test("each Align button moves the layer to that edge and the last one persists", async ({
    page,
  }) => {
    await openCover(page);
    await selectLayer(page, SEED_BOOK.title);
    const x = field(page, "X");
    const y = field(page, "Y");

    // The buttons follow the toolbar order: left, hcenter, right, top, vcenter, bottom.
    const align = (name: string) => page.getByRole("button", { name, exact: true });
    await tabTo(page, align("Align left"), { max: 70 });
    await page.keyboard.press("Enter");
    await expect(x).toHaveValue("0");

    await tabTo(page, align("Center horizontally"), { max: 2 });
    await page.keyboard.press("Enter");
    await expect(x).toHaveValue("180");

    await tabTo(page, align("Align right"), { max: 2 });
    await page.keyboard.press("Enter");
    await expect(x).toHaveValue("360");

    await tabTo(page, align("Align top"), { max: 2 });
    await page.keyboard.press("Enter");
    await expect(y).toHaveValue("0");

    await tabTo(page, align("Center vertically"), { max: 2 });
    await page.keyboard.press("Enter");
    await expect(y).toHaveValue("1307");

    await tabTo(page, align("Align bottom"), { max: 2 });
    await page.keyboard.press("Enter");
    await expect(y).toHaveValue("2614");

    await saveCover(page);
    await page.reload();
    await selectLayer(page, SEED_BOOK.title);
    await expect(field(page, "X")).toHaveValue("360");
    await expect(field(page, "Y")).toHaveValue("2614");
  });
});

test.describe("Cover shortcuts @wf:cover-shortcuts @sc:cover.save @sc:cover.delete @sc:cover.undo @sc:cover.redo @sc:cover.duplicate", () => {
  test("Mod+D duplicates, Delete removes, Mod+Z and Mod+Shift+Z step the layer count", async ({
    page,
  }) => {
    await openCover(page);
    await page.keyboard.press("ControlOrMeta+d");
    await expect(layer(page, SEED_BOOK.title)).toBeVisible();
    const duplicates = layers(page);
    await expect(duplicates).toHaveCount(3);

    await page.keyboard.press("Delete");
    await expect(duplicates).toHaveCount(2);

    await page.keyboard.press("ControlOrMeta+z");
    await expect(duplicates).toHaveCount(3);

    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect(duplicates).toHaveCount(2);

    await saveCover(page);
    await page.reload();
    await expect(layers(page)).toHaveCount(2);
  });

  test("Delete and Backspace inside a property field edit it and never delete the layer", async ({
    page,
  }) => {
    await openCover(page);
    await selectLayer(page, SEED_BOOK.title);

    const size = field(page, "Size");
    await tabTo(page, size, { max: 70 });
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("50");
    await page.keyboard.press("Backspace");
    await expect(size).toHaveValue("5");
    await expect(layers(page)).toHaveCount(2);

    await page.keyboard.press("Delete");
    await expect(size).toHaveValue("5");
    await expect(layers(page)).toHaveCount(2);
  });
});

test.describe("leaving with unsaved changes @wf:cover-back-unsaved", () => {
  test("Back returns to the Book Editor and the unsaved change is not kept", async ({ page }) => {
    await openCover(page);
    await expect(savedButton(page)).toBeVisible();

    await openMenu(page, addText(page));
    await pickMenuItem(page, "Subtitle");
    await expect(saveButton(page)).toBeVisible();

    await tabTo(page, back(page), { max: 10, backwards: true });
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/book\/[\w-]+$/);
    await expect(editorText(page)).toBeVisible();

    // Reopening the Cover relands the saved scene: the unsaved layer is gone.
    await page.keyboard.press("Escape");
    await tabTo(page, designCover(page), { max: 40 });
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/book\/[\w-]+\/cover$/);
    await expect(layer(page, "Subtitle")).toHaveCount(0);
    await expect(layer(page, SEED_BOOK.title)).toBeVisible();
  });
});
