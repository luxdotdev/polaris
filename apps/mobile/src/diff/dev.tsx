/**
 * The full-screen diff over a fixed three-file patch as the app's root when Metro's environment
 * asks for it (`EXPO_PUBLIC_POLARIS_DIFF_PREVIEW=1`, or `=2` to open on the second file);
 * `-polarisDevTheme moonlit` on launch picks the theme.
 */
import { LineRange, RiskFinding, RiskFindingId } from "@polaris/protocol";
import { Predicate, Schema } from "effect";
import { useEffect, useState } from "react";
import { Platform, Settings } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import type { DiffFileInput } from "../review/diffRows.ts";
import { parsePatch } from "../review/patch.ts";
import { ThemeName, ThemeProvider, useTheme } from "../theme/index.ts";
import { FileDiffScreen } from "./FileDiffScreen.tsx";

const PATCH = [
  "diff --git a/src/serve.ts b/src/serve.ts",
  "--- a/src/serve.ts",
  "+++ b/src/serve.ts",
  "@@ -10,3 +10,3 @@ export const serve",
  ' import { publish } from "./artifact";',
  "-const URL = process.env.ARTIFACT_URL;",
  '+const URL = process.env.ARTIFACT_URL ?? "http://localhost:4000";',
  " publish(URL);",
  "diff --git a/src/artifact/upload.ts b/src/artifact/upload.ts",
  "--- a/src/artifact/upload.ts",
  "+++ b/src/artifact/upload.ts",
  "@@ -36,10 +36,13 @@ upload()",
  ' import { put } from "./store";',
  " ",
  "-export async function upload(req: Request) {",
  "+export async function upload(req: Request, limit = MAX_BYTES) {",
  "   const id = crypto.randomUUID();",
  "-  const body = await req.text();",
  "+  const body = await req.arrayBuffer();",
  "+  if (body.byteLength > limit) {",
  '+    return new Response("Artifact is larger than the upload limit", { status: 413 });',
  "+  }",
  "   await put(id, body);",
  "   return Response.json({ id, url: `${BASE}/a/${id}` });",
  " }",
  " ",
  " export const MAX_BYTES = 8 * 1024 * 1024;",
  "diff --git a/index.html b/index.html",
  "--- a/index.html",
  "+++ b/index.html",
  "@@ -1,3 +1,3 @@",
  " <!doctype html>",
  "-<title>Artifacts</title>",
  "+<title>Artifacts · Polaris</title>",
  " <body>",
  "",
].join("\n");

const FILES: ReadonlyArray<DiffFileInput> = parsePatch(PATCH).map((diff) => ({
  diff,
  added: diff.hunks.reduce((n, h) => n + h.additionLines, 0),
  removed: diff.hunks.reduce((n, h) => n + h.deletionLines, 0),
}));

const FINDINGS = [
  new RiskFinding({
    id: RiskFindingId.make("f1"),
    identity: "f1",
    source: "agent",
    ruleId: null,
    path: "src/artifact/upload.ts",
    lines: new LineRange({ start: 40, end: 40, side: "new" }),
    severity: "high",
    confidence: 0.82,
    title: "Upload has no size limit",
    reason:
      "The whole body is read before the size check below, so a large upload still lands in memory.",
    suggestion: null,
    status: "open",
    resolution: null,
  }),
];

const noop = () => undefined;

const launchTheme = (): ThemeName | null => {
  const value: unknown = Platform.OS === "ios" ? Settings.get("polarisDevTheme") : undefined;

  return Schema.is(ThemeName)(value) ? value : null;
};

const Preview = ({ start }: { readonly start: number }) => {
  const [index, setIndex] = useState(start);
  const { setTheme } = useTheme();

  useEffect(() => {
    const theme = launchTheme();

    if (theme !== null) setTheme(theme);
    // Launch arguments are read once.
  }, []);

  return (
    <FileDiffScreen
      files={FILES}
      index={index}
      onIndexChange={setIndex}
      findings={FINDINGS}
      onBack={noop}
      actions={{ harnessName: "Claude Code", askToFix: noop, askReviewer: noop }}
    />
  );
};

/** The preview root component, or null when the preview wasn't asked for. */
export const diffPreviewRoot = (): (() => React.JSX.Element) | null => {
  // Read whole: Expo inlines EXPO_PUBLIC_ variables only where they are named in full.
  const env: unknown = process.env.EXPO_PUBLIC_POLARIS_DIFF_PREVIEW;

  if (!__DEV__ || !Predicate.isString(env) || env === "") return null;
  const start = Math.max(0, Math.min(FILES.length - 1, Number(env) - 1 || 0));

  return () => (
    <SafeAreaProvider>
      <ThemeProvider>
        <Preview start={start} />
      </ThemeProvider>
    </SafeAreaProvider>
  );
};
