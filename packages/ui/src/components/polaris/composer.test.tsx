import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, jest, test } from "bun:test";

import { Composer } from "./composer";

afterEach(cleanup);

describe("Composer in shell mode", () => {
  test("shows Shell mode in the Working strip's place, with esc to leave", () => {
    const { getByTestId, queryByText } = render(
      <Composer harness="claude" model="" shell={{ where: "runs in ~/code/atlas" }} />
    );

    const strip = getByTestId("shell-strip").textContent;

    expect(strip).toStartWith("Shell mode· runs in ~/code/atlas");
    expect(strip).toEndWith("esc to leave");
    expect(queryByText(/is working/)).toBeNull();
  });

  test("a command queued behind a Working Turn keeps that Turn's Stop", () => {
    const onStop = jest.fn();

    const { getByRole, queryByText } = render(
      <Composer
        harness="claude"
        model=""
        working={{ elapsed: "12s", onStop }}
        shell={{ where: "runs after this turn, in ~/code/atlas" }}
      />
    );

    expect(queryByText("Claude Code is working")).toBeNull();
    fireEvent.click(getByRole("button", { name: /Stop/ }));
    expect(onStop).toHaveBeenCalledTimes(1);
  });
});
