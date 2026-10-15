## fin10 insertion apps/daemon/src/engine/testing.ts hash=fa43eb6a5622b547 cursorLine=299 
### history
@L313
-
+    Layer.provide(options.checkpoints ?? Layer.empty),
@L299
-
+  /** Default: the fake, which writes no
### shown
@@ -299,2 +299,4 @@
   /** Default: the fake, which writes no
+   * commits, branches, or tags. */
+  readonly git?: Layer.Layer<Git>;
 }) => {

### expected
@@ -298,3 +298,4 @@
   readonly reviewCheckoutGit?: Layer.Layer<ReviewCheckoutGit>;
-  /** Default: the fake, which writes no
+  /** Default: the fake, which writes no refs; `CheckpointsLive` snapshots real repositories. */
+  readonly checkpoints?: Layer.Layer<Checkpoints>;
 }) => {

