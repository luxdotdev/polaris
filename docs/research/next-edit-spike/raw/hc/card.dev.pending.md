## him07 import apps/daemon/src/transport/serve.ts hash=ff7c1accbae74cb5 cursorLine=126
### history
@L101
-
+  PredictionServerLive,
@L126
-
+  "prediction.server",
### shown
@@ -123,4 +123,2 @@
   "prediction.context",
-  "inline.propose",
-  "prediction.complete",
   "prediction.server",

### expected
@@ -1,2 +1,3 @@
 import { PredictionCapabilityLive } from "../prediction/capability.ts";
+import { PredictionServerLive } from "../prediction/server.ts";
 /**


## hrf07 refactor apps/desktop/src/renderer/features/constellation/ui/ConstellationTab.tsx hash=10e6c2e144499a5e cursorLine=397
### history
@L8
-import { type KeyboardEvent, useMemo, useRef, useState } from "react";
+import { type KeyboardEvent, useMemo, useRef } from "react";
@L30
-import { leadKey, type LeadUi, patchLeadUi, useLeadUi } from "../state.ts";
+import { draftAbout, leadKey, type LeadUi, patchLeadUi, useLeadUi } from "../state.ts";
@L202
-  const [draft, setDraft] = useState<MessageDraft | null>(null);
+  const draftKey = leadKey(hostKey, c.leadSessionId);
+  const setDraft = (draft: MessageDraft | null) => patchLeadUi(draftKey, () => ({ draft }));
@L397
-        draft={draft}
+        draft={ui.draft}
### shown
@@ -397,3 +397,3 @@
         draft={ui.draft}
-        onClose={() => setDraft(null)}
+        onClose={() => patchLeadUi(draftKey, () => ({ draft: null }))}
       />

### expected
@@ -102,8 +102,3 @@
     },
-    onMessageLead: (row, authority) =>
-      setDraft({
-        title: `Message the lead about ${row.task.id}`,
-        authority,
-        text: `About ${row.task.id} (${row.task.title}): `,
-      }),
+    onMessageLead: (row, authority) => setDraft(draftAbout(row.task.id, row.task.title, authority)),
   };

