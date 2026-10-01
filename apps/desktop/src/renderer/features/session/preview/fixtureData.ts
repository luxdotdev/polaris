/** Static preview data: a Turn's patch and the Harnesses' own Model lists. */
export const PATCH = `diff --git a/prototypes/orchestrator-layout/serve.ts b/prototypes/orchestrator-layout/serve.ts
--- a/prototypes/orchestrator-layout/serve.ts
+++ b/prototypes/orchestrator-layout/serve.ts
@@ -1,7 +1,8 @@
 import { publish } from "./artifact";

-const ARTIFACT_URL = process.env.ARTIFACT_URL;
+const ARTIFACT_URL = "https://claude.ai/artifact/V6EMS2kK78";
+const API_TOKEN = process.env.API_TOKEN;

 export async function main() {
-  await publish(ARTIFACT_URL);
+  await publish(ARTIFACT_URL, { token: API_TOKEN });
 }
diff --git a/prototypes/orchestrator-layout/index.html b/prototypes/orchestrator-layout/index.html
--- a/prototypes/orchestrator-layout/index.html
+++ b/prototypes/orchestrator-layout/index.html
@@ -410,5 +410,7 @@
 <script type="module">
   import { variants } from "./variants.js";
+  document.addEventListener("keydown", (e) => { if (e.key === "ArrowRight") next(); });
+  document.addEventListener("keydown", (e) => { if (e.key === "ArrowLeft") previous(); });
   render(variants[0]);
 </script>
diff --git a/CONTEXT.md b/CONTEXT.md
--- a/CONTEXT.md
+++ b/CONTEXT.md
@@ -140,4 +140,4 @@
 **Orchestrator**:
-The view for launching and monitoring Agent Sessions.
+The view for launching, monitoring, and steering Agent Sessions.
 _Avoid_: Dashboard, agent manager
`;

/** Claude Code 2.1.286's and Codex 0.159.2's own lists, in their order. */
export const MODELS = {
  claude: [
    {
      id: "default",
      name: "Default (recommended)",
      description: null,
      efforts: ["low", "medium", "high", "xhigh", "max"],
      defaultEffort: null,
      isDefault: true,
    },
    {
      id: "opus",
      name: "Opus 5.5",
      description: null,
      efforts: ["low", "medium", "high", "xhigh", "max"],
      defaultEffort: null,
      isDefault: false,
    },
    {
      id: "claude-fable-5-1",
      name: "Fable 5.1",
      description: null,
      efforts: ["low", "medium", "high", "xhigh", "max"],
      defaultEffort: null,
      isDefault: false,
    },
    {
      id: "sonnet",
      name: "Sonnet 5.5",
      description: null,
      efforts: ["low", "medium", "high", "xhigh", "max"],
      defaultEffort: null,
      isDefault: false,
    },
    {
      id: "haiku",
      name: "Haiku 4.5",
      description: null,
      efforts: [],
      defaultEffort: null,
      isDefault: false,
    },
    {
      id: "claude-sonnet-5",
      name: "Sonnet 5",
      description: null,
      efforts: ["low", "medium", "high", "xhigh", "max"],
      defaultEffort: null,
      isDefault: false,
    },
    {
      id: "claude-opus-5",
      name: "Opus 5",
      description: null,
      efforts: ["low", "medium", "high", "xhigh", "max"],
      defaultEffort: null,
      isDefault: false,
    },
    {
      id: "claude-fable-5",
      name: "Fable 5",
      description: null,
      efforts: ["low", "medium", "high", "xhigh", "max"],
      defaultEffort: null,
      isDefault: false,
    },
    {
      id: "claude-opus-4-8",
      name: "Opus 4.8",
      description: null,
      efforts: ["low", "medium", "high", "xhigh", "max"],
      defaultEffort: null,
      isDefault: false,
    },
    {
      id: "claude-opus-4-7",
      name: "Opus 4.7",
      description: null,
      efforts: ["low", "medium", "high", "xhigh", "max"],
      defaultEffort: null,
      isDefault: false,
    },
    {
      id: "claude-opus-4-6",
      name: "Opus 4.6",
      description: null,
      efforts: ["low", "medium", "high", "max"],
      defaultEffort: null,
      isDefault: false,
    },
    {
      id: "claude-sonnet-4-6",
      name: "Sonnet 4.6",
      description: null,
      efforts: ["low", "medium", "high", "max"],
      defaultEffort: null,
      isDefault: false,
    },
  ],
  codex: [
    {
      id: "gpt-6.1-sol",
      name: "GPT-6.1-Sol",
      description: null,
      efforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
      defaultEffort: "low",
      isDefault: true,
    },
    {
      id: "gpt-6-astra",
      name: "GPT-6-Astra",
      description: null,
      efforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
      defaultEffort: "medium",
      isDefault: false,
    },
    {
      id: "gpt-6-sol",
      name: "GPT-6-Sol",
      description: null,
      efforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
      defaultEffort: "medium",
      isDefault: false,
    },
    {
      id: "gpt-6-luna",
      name: "GPT-6-Luna",
      description: null,
      efforts: ["low", "medium", "high", "xhigh", "max"],
      defaultEffort: "medium",
      isDefault: false,
    },
    {
      id: "gpt-5.6-sol",
      name: "GPT-5.6-Sol",
      description: null,
      efforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
      defaultEffort: "low",
      isDefault: false,
    },
    {
      id: "gpt-5.6-terra",
      name: "GPT-5.6-Terra",
      description: null,
      efforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
      defaultEffort: "medium",
      isDefault: false,
    },
    {
      id: "gpt-5.6-luna",
      name: "GPT-5.6-Luna",
      description: null,
      efforts: ["low", "medium", "high", "xhigh", "max"],
      defaultEffort: "medium",
      isDefault: false,
    },
    {
      id: "gpt-daybreak-blue-latest",
      name: "Daybreak Blue",
      description: null,
      efforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
      defaultEffort: "low",
      isDefault: false,
    },
    {
      id: "gpt-5.5",
      name: "GPT-5.5",
      description: null,
      efforts: ["low", "medium", "high", "xhigh"],
      defaultEffort: "medium",
      isDefault: false,
    },
  ],
} as const;
