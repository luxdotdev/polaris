import { expect, test } from "bun:test";
import type { FollowUp } from "../../routes/commands.ts";
import { clearFollowUp, loadFollowUp, paletteStore } from "./store.ts";

const looking = (answer: FollowUp): FollowUp => ({
  title: "Select Python interpreter",
  choices: [{ id: "looking", title: "Looking…", disabled: true, run: () => undefined }],
  load: async () => answer,
});

const answer: FollowUp = {
  title: "Select Python interpreter",
  choices: [{ id: "automatic", title: "Use automatic detection", run: () => undefined }],
};

test("a loading follow-up is replaced by its answer while it is still asked", async () => {
  const asked = looking(answer);

  paletteStore.setState({ followUp: asked });
  await loadFollowUp(asked);
  expect(paletteStore.getState().followUp).toBe(answer);
});

test("an answer that arrives after the palette moved on is dropped", async () => {
  const asked = looking(answer);

  paletteStore.setState({ followUp: asked });
  const loading = loadFollowUp(asked);

  clearFollowUp();
  await loading;
  expect(paletteStore.getState().followUp).toBeNull();
});
