import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, test } from "bun:test";

import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "../ui/dropdown-menu";
import { DropdownMenuEntries } from "./menu-entries";

afterEach(cleanup);

const REASON = "Needs a review approval from a code owner first";

test("a disabled entry keeps its label, and its long reason stays readable in full (ENG-499)", () => {
  const { getByText, getByTitle } = render(
    <DropdownMenu open>
      <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuEntries
          entries={[
            {
              kind: "item",
              label: "Merge",
              onSelect: () => undefined,
              disabled: true,
              reason: REASON,
            },
          ]}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );

  expect(getByText("Merge")).not.toBeNull();
  expect(getByTitle(REASON).textContent).toBe(REASON);
});
