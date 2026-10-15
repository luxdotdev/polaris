## hdd06 dead-code apps/desktop/src/renderer/features/jump/run.ts hash=2d726a72513684a5 cursorLine=43 
### history
@L1
-/** Carrying out a jump: select what was chosen (in Review with ⌘↵) or run the action. */
+/** Carrying out a jump: select what was chosen, or open it in Review with ⌘↵. */
@L6
-import { useApp, useCommands, useSelection, useShellActions } from "../../shell/hooks.ts";
+import { useApp, useSelection, useShellActions } from "../../shell/hooks.ts";
@L43
-    if (target.kind === "command") {
-      commands.run(target.id);
-
-      return;
-    }
-
+
### shown
@@ -41,3 +41,3 @@
 
-  return (target: JumpTarget, review: boolean) => {
+  return (target: JumpTarget) => {
     if (isReviewTarget(target)) {

### expected
@@ -36,3 +36,2 @@
   const actions = useShellActions();
-  const commands = useCommands();
   const { topBar } = useSelection();

