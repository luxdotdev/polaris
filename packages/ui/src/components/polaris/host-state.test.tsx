import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, test } from "bun:test";

import { HostStateChip } from "./host-state";

afterEach(cleanup);

const LONG = "build-runner-ubuntu-2404-arm64.tail9f3c2.ts.net";

test("a long Host name truncates on its own, keeping its Connection State readable (ENG-499)", () => {
  const { getByTitle } = render(<HostStateChip host={LONG} state="reconnecting" since="1m" />);
  const name = getByTitle(LONG);

  expect(name.textContent).toBe(LONG);
  expect(name.className).toContain("truncate");
  expect(name.parentElement?.textContent).toBe(`${LONG} · reconnecting 1m`);
});
