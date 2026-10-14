# mellum2-fim-frozen (mellum-frozen) — non-exact outputs at the scored step

## in01 insertion in-window 
expected:
```diff
@@ line 29
-          env: c
+          env: childEnv(),
```
predicted:
```diff
@@ line 29
-          env: c
+          env: childEnv(run.env),
```

## in04 insertion in-window 
expected:
```diff
@@ line 30
-      case 
+      case "setup":
+        return { taskId: id, text: `${id} setup failed · ${setupOutcome(attention.run)}`, rank: 4 };
```
predicted:
```diff
@@ line 30
-      case 
+      case "outcome":
```
