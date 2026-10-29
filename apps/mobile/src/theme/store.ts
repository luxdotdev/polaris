/** Appearance kept as JSON in the app's document directory (native only; tests use their own). */
import { File, Paths } from "expo-file-system";
import type { AppearanceStore } from "./appearance.ts";

const file = () => new File(Paths.document, "appearance.json");

export const fileAppearanceStore: AppearanceStore = {
  read: () => {
    const saved = file();

    return saved.exists ? saved.textSync() : null;
  },
  write: (text) => file().write(text),
};
