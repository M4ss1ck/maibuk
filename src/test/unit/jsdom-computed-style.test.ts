// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";

// jsdom caches computed style (#859). Each change below lands synchronously
// after a query has warmed that cache, the way a React commit inside `act`
// does, and the next query must already see it.

let button: HTMLButtonElement;

beforeEach(() => {
  document.head.innerHTML = "<style>.gone { display: none }</style>";
  document.body.innerHTML = `<div id="wrap"><button type="button">Save</button></div>`;
  button = screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;
  expect(getComputedStyle(button).display).toBe("inline-block");
});

afterEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
});

const queryButton = () => screen.queryByRole("button", { name: "Save" });

it("sees an inline display change on an ancestor", () => {
  document.getElementById("wrap")?.style.setProperty("display", "none");
  expect(queryButton()).toBeNull();
  document.getElementById("wrap")?.style.removeProperty("display");
  expect(queryButton()).toBe(button);
});

it("sees a style attribute change", () => {
  button.setAttribute("style", "visibility: hidden");
  expect(queryButton()).toBeNull();
  expect(getComputedStyle(button).visibility).toBe("hidden");
});

it("sees a class that a stylesheet hides", () => {
  button.classList.add("gone");
  expect(queryButton()).toBeNull();
  button.classList.remove("gone");
  expect(queryButton()).toBe(button);
});

it("sees the hidden attribute", () => {
  button.hidden = true;
  expect(queryButton()).toBeNull();
  expect(getComputedStyle(button).display).toBe("none");
});

it("sees a stylesheet inserted after the cache warmed", () => {
  const sheet = document.createElement("style");
  sheet.textContent = "button { display: none }";
  document.head.append(sheet);
  expect(queryButton()).toBeNull();
});

it("sees an accessible name changed by an attribute", () => {
  button.setAttribute("aria-label", "Discard");
  expect(queryButton()).toBeNull();
  expect(screen.getByRole("button", { name: "Discard" })).toBe(button);
});
