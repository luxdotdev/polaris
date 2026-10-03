export const bounds = {
  launchMs: 30_000,
  actionMs: 10_000,
  navigationMs: 20_000,
  caseMs: 90_000,
  totalMs: 330_000,
  terminateMs: 5_000,
} as const;

export const cases = [
  {
    id: "settings",
    html: "apps/desktop/src/renderer/features/settings/languages/integration.evidence.html",
    classification:
      "Actual Settings Page and typed scripted feeds; actual matching policy epochs. No authenticated Host or installation proof.",
  },
  {
    id: "editor",
    html: "apps/desktop/src/renderer/features/editor/lsp/evidence.html",
    classification:
      "Actual CodeMirror unsaved provider/cancellation assertions; scripted LanguageApi/Files. No executable provider or socket proof.",
  },
  {
    id: "resources",
    html: "apps/desktop/src/renderer/features/editor/refactors/evidence.html",
    classification:
      "Actual CodeMirror/UI and native strict IndexedDB reopen; scripted Host receipts/Files. Async discard injects localStorage write refusal. No crash/restart or production resource/socket proof.",
  },
] as const;
