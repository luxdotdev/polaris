import "../../../test/dom.testing.ts";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, jest, test } from "bun:test";
import { DraftComposer } from "./DraftComposer.tsx";

afterEach(cleanup);

const composer = (onFiles?: (files: ReadonlyArray<File>, mode: string) => void) =>
  render(
    <DraftComposer
      harness="claude"
      picker={null}
      value=""
      onChange={() => undefined}
      onSubmit={() => undefined}
      placeholder="Ask for follow-up changes"
      canSubmit={false}
      attachments={[]}
      uploads={[]}
      onRemoveAttachment={() => undefined}
      onFiles={onFiles}
    />
  );

test("the paperclip opens the file picker, and the picked files are attached (ENG-505)", () => {
  const onFiles = jest.fn();
  const { getByRole, getByTestId } = composer(onFiles);
  const input = getByTestId("paperclip-input");
  const opened = jest.fn();

  input.addEventListener("click", opened);
  fireEvent.click(getByRole("button", { name: "Attach files" }));
  expect(opened).toHaveBeenCalledTimes(1);

  const file = new File(["png"], "shot.png", { type: "image/png" });

  fireEvent.change(input, { target: { files: [file] } });
  expect(onFiles).toHaveBeenCalledWith([file], "attach");
});

test("a composer that takes no files has no paperclip", () => {
  const { queryByRole } = composer();

  expect(queryByRole("button", { name: "Attach files" })).toBeNull();
});
