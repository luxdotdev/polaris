import "../../test/dom.testing.ts";
import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { Toaster } from "@polaris/ui";
import type { AppEvent, PolarisApi, RequestInput } from "../../../shared/api.ts";
import { connectClientSettingNotices } from "./clientSettings.ts";

afterEach(cleanup);

test("an agent change shows Undo and its action sends the exact request id", async () => {
  let send: (event: AppEvent) => void = () => {};

  const requests: Array<RequestInput<"clientSettings.undo">> = [];

  const api: PolarisApi = {
    request: (method, input) => {
      if (method === "clientSettings.undo") {
        // SAFETY: this fixture receives only the undo request fired by the toast below.
        requests.push(input as RequestInput<"clientSettings.undo">);
      }

      // SAFETY: clientSettings.undo returns null and is the only request in this fixture.
      return Promise.resolve({ ok: true, value: null }) as never;
    },
    subscribe: () => () => {},
    onAppEvent: (listener) => {
      send = listener;

      return () => {};
    },
  };

  const disconnect = connectClientSettingNotices(api);
  const view = render(<Toaster />);

  try {
    send({
      kind: "client-settings-changed",
      requestId: "theme-change",
      key: "theme",
      value: "light",
      previousValue: "dark",
    });
    const undo = await view.findByRole("button", { name: "Undo" });
    expect(view.getByText("Changed theme").textContent).toBe("Changed theme");
    fireEvent.click(undo);
    await waitFor(() => expect(requests).toEqual([{ requestId: "theme-change" }]));
  } finally {
    disconnect();
  }
});
