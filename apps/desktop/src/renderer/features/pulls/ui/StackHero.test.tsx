import "../../../test/dom.testing.ts";
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, test } from "bun:test";
import { STACK } from "../preview/stack.ts";
import { StackHero } from "./StackHero.tsx";

afterEach(cleanup);

const BASE = "release/2026.11-nj-homes-choice-next-eligibility-hardening-candidate";

test("a long base branch is cut to fit beside its slab, and read whole by assistive tech", () => {
  const view = render(<StackHero stack={{ ...STACK, trunk: BASE }} />);

  expect(view.getByTestId("stack-hero-base").textContent).toBe("release/2026.11-nj-hom…");
  expect(view.getByTestId("stack-hero").querySelector("svg")?.getAttribute("aria-label")).toEndWith(
    `, ${BASE}`
  );
});
