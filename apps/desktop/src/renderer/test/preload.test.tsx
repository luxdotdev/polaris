// No DOM helper import here on purpose: this file stands in for a test that loads a component first.
import { Popover, PopoverContent, PopoverTrigger } from "@polaris/ui";
import { act, cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, expect, test } from "bun:test";

afterEach(cleanup);

test("a popover opens even when the first file to load it never imported the DOM helper", () => {
  render(
    <Popover>
      <PopoverTrigger>Open</PopoverTrigger>
      <PopoverContent>Inside</PopoverContent>
    </Popover>
  );
  const page = within(document.body);

  act(() => {
    fireEvent.click(page.getByText("Open"));
  });

  expect(page.getByText("Inside").textContent).toBe("Inside");
});
