import { describe, expect, test } from "bun:test";
import { toastInsetBottom } from "./toastClearance.ts";

const viewport = { width: 1280, height: 720 };

describe("toastInsetBottom", () => {
  test("a composer under the toast column lifts the toasts above its top, so Send stays clear", () => {
    expect(toastInsetBottom({ top: 600, left: 340, right: 1264 }, viewport, 16)).toBe(128);
  });

  test("a composer left of the column, as with Output open, leaves the toasts where they are", () => {
    expect(toastInsetBottom({ top: 600, left: 340, right: 860 }, viewport, 16)).toBeNull();
  });

  test("the Output rail's inset moves the column left, onto a composer it used to clear", () => {
    expect(toastInsetBottom({ top: 600, left: 340, right: 860 }, viewport, 400)).toBe(128);
  });
});
