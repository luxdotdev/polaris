/**
 * The log tab's side of "Show language server log" (`.dagr/contracts/log-intent.md`): the
 * Command Palette and the status popover both ask through `openLanguageLog`.
 */
import { LANGUAGE_NAMES } from "../model/language.ts";
import { fileKey } from "../model/drafts.ts";
import { onOpenLanguageLog, type LanguageLogIntent } from "../intents/languageLog.ts";
import { showLogTab } from "./logTabs.ts";
import { statusStore } from "./store.ts";

const TS = "typescript-language-server";

/** The intent's server: the one asked for, else the file's first discovered provider. */
const providerOf = (intent: LanguageLogIntent) =>
  intent.providerId ??
  statusStore.getState().files[fileKey(intent.hostKey, intent.path)]?.providers[0]?.providerId ??
  null;

export const receiveLanguageLog = (intent: LanguageLogIntent) => {
  const providerId = providerOf(intent);

  if (providerId === null) return;
  showLogTab(
    { hostKey: intent.hostKey, checkout: intent.checkout, providerId },
    providerId === TS ? "TypeScript" : LANGUAGE_NAMES[intent.language],
    intent.workspaceId
  );
};

onOpenLanguageLog(receiveLanguageLog);
