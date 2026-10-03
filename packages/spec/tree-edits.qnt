/** Root and two representative descendant ownership tokens; runtime manifests bound all entries. */
module tree_edits {
  type Phase = Pending | Forward | Applied | Backward | Restored
  type Token = Missing | Owned | External
  type Event = Prepare | Intent | Move | PersistApplied | UndoIntent | Restore | PersistRestored | ExternalSource | ExternalTarget | ExternalDescendant | Crash | Retry | Ack
  var prepared: bool
  var phase: Phase
  var source: Token
  var target: Token
  var revision: int
  var acknowledged: bool
  var sourceIntervened: bool
  var targetIntervened: bool
  var childSource: Token
  var childTarget: Token
  var otherSource: Token
  var otherTarget: Token
  var descendantIntervened: bool

  action init = all {
    prepared' = false, phase' = Pending, source' = Owned, target' = Missing,
    revision' = 0, acknowledged' = false, sourceIntervened' = false, targetIntervened' = false,
    childSource' = Owned, childTarget' = Missing, otherSource' = Owned, otherTarget' = Missing, descendantIntervened' = false
  }
  action unchanged = all {
    prepared' = prepared, phase' = phase, source' = source, target' = target,
    revision' = revision, acknowledged' = acknowledged,
    sourceIntervened' = sourceIntervened, targetIntervened' = targetIntervened,
        childSource' = childSource, childTarget' = childTarget, otherSource' = otherSource, otherTarget' = otherTarget, descendantIntervened' = descendantIntervened
  }
  action checkpoint(p: Phase): bool = all {
    prepared' = prepared, phase' = p, source' = source, target' = target,
    revision' = revision + 1, acknowledged' = acknowledged,
    sourceIntervened' = sourceIntervened, targetIntervened' = targetIntervened,
        childSource' = childSource, childTarget' = childTarget, otherSource' = otherSource, otherTarget' = otherTarget, descendantIntervened' = descendantIntervened
  }
  val before = source == Owned and target == Missing and childSource == Owned and childTarget == Missing and otherSource == Owned and otherTarget == Missing
  val after = source == Missing and target == Owned and childSource == Missing and childTarget == Owned and otherSource == Missing and otherTarget == Owned
  action publish(e: Event): bool = match e {
    | Prepare => if (not(prepared)) all {
        prepared' = true, phase' = phase, source' = source, target' = target,
        revision' = revision + 1, acknowledged' = acknowledged,
        sourceIntervened' = sourceIntervened, targetIntervened' = targetIntervened,
        childSource' = childSource, childTarget' = childTarget, otherSource' = otherSource, otherTarget' = otherTarget, descendantIntervened' = descendantIntervened
      } else unchanged
    | Intent => if (prepared and phase == Pending and before) checkpoint(Forward) else unchanged
    | Move => if (phase == Forward and before) all {
        prepared' = prepared, phase' = phase, source' = Missing, target' = Owned,
        revision' = revision, acknowledged' = acknowledged,
        sourceIntervened' = sourceIntervened, targetIntervened' = targetIntervened,
        childSource' = Missing, childTarget' = Owned, otherSource' = Missing, otherTarget' = Owned, descendantIntervened' = descendantIntervened
      } else unchanged
    | PersistApplied => if (phase == Forward and after) checkpoint(Applied) else unchanged
    | UndoIntent => if ((phase == Forward or phase == Applied or phase == Backward) and after) checkpoint(Backward) else unchanged
    | Restore => if (phase == Backward and after) all {
        prepared' = prepared, phase' = phase, source' = Owned, target' = Missing,
        revision' = revision, acknowledged' = acknowledged,
        sourceIntervened' = sourceIntervened, targetIntervened' = targetIntervened,
        childSource' = Owned, childTarget' = Missing, otherSource' = Owned, otherTarget' = Missing, descendantIntervened' = descendantIntervened
      } else unchanged
    | PersistRestored => if ((phase == Forward or phase == Backward) and before) checkpoint(Restored) else unchanged
    | ExternalSource => all {
        prepared' = prepared, phase' = phase, source' = External, target' = target,
        revision' = revision, acknowledged' = acknowledged,
        sourceIntervened' = true, targetIntervened' = targetIntervened,
        childSource' = childSource, childTarget' = childTarget, otherSource' = otherSource, otherTarget' = otherTarget, descendantIntervened' = descendantIntervened
      }
    | ExternalTarget => all {
        prepared' = prepared, phase' = phase, source' = source, target' = External,
        revision' = revision, acknowledged' = acknowledged,
        sourceIntervened' = sourceIntervened, targetIntervened' = true,
        childSource' = childSource, childTarget' = childTarget, otherSource' = otherSource, otherTarget' = otherTarget, descendantIntervened' = descendantIntervened
      }
    | ExternalDescendant => all {
        prepared' = prepared, phase' = phase, source' = source, target' = target,
        revision' = revision, acknowledged' = acknowledged,
        sourceIntervened' = sourceIntervened, targetIntervened' = targetIntervened,
        childSource' = childSource, childTarget' = External, otherSource' = otherSource, otherTarget' = otherTarget, descendantIntervened' = true
      }
    | Ack => if (phase == Applied) all {
        prepared' = prepared, phase' = phase, source' = source, target' = target,
        revision' = revision, acknowledged' = true,
        sourceIntervened' = sourceIntervened, targetIntervened' = targetIntervened,
        childSource' = childSource, childTarget' = childTarget, otherSource' = otherSource, otherTarget' = otherTarget, descendantIntervened' = descendantIntervened
      } else unchanged
    | Crash => unchanged
    | Retry => unchanged
  }
  action step = { nondet e = oneOf(Set(Prepare, Intent, Move, PersistApplied, UndoIntent, Restore, PersistRestored, ExternalSource, ExternalTarget, ExternalDescendant, Crash, Retry, Ack)); publish(e) }
  val safety = all {
    descendantIntervened implies childTarget == External,
    sourceIntervened implies source == External,
    targetIntervened implies target == External,
    (phase == Applied or phase == Backward or phase == Restored) implies prepared,
    acknowledged implies revision >= 3
  }
}
module tree_edits_test {
  import tree_edits.* from "./tree-edits"
  run crashBeforeReceiptTest = init.then(publish(Prepare)).then(publish(Intent)).then(publish(Move)).then(publish(Crash)).then(publish(Retry))
    .expect(phase == Forward and after and safety)
    .then(publish(UndoIntent)).then(publish(Restore)).then(publish(PersistRestored)).expect(phase == Restored and before and safety)
  run restoreCrashTest = init.then(publish(Prepare)).then(publish(Intent)).then(publish(Move)).then(publish(PersistApplied)).then(publish(UndoIntent)).then(publish(Restore)).then(publish(Crash))
    .expect(phase == Backward and before and safety)
    .then(publish(PersistRestored)).then(publish(Retry)).expect(phase == Restored and before and safety)
  run interventionTest = init.then(publish(Prepare)).then(publish(Intent)).then(publish(Move)).then(publish(ExternalSource)).then(publish(ExternalTarget)).then(publish(UndoIntent)).then(publish(Restore))
    .expect(source == External and target == External and phase == Forward and safety)
  run acknowledgementTest = init.then(publish(Ack)).expect(not(acknowledged))
    .then(publish(Prepare)).then(publish(Intent)).then(publish(Move)).then(publish(Ack)).expect(not(acknowledged))
    .then(publish(PersistApplied)).then(publish(Ack)).expect(acknowledged and safety)
}

module tree_descendants_test {
  import tree_edits.* from "./tree-edits"
  run descendantUndoGuardTest = init.then(publish(Prepare)).then(publish(Intent)).then(publish(Move)).then(publish(PersistApplied)).then(publish(ExternalDescendant)).then(publish(UndoIntent)).then(publish(Restore))
    .expect(childTarget == External and target == Owned and phase == Applied and safety)
  run rootReplacementGuardTest = init.then(publish(Prepare)).then(publish(Intent)).then(publish(ExternalSource)).then(publish(Move))
    .expect(source == External and target == Missing and childSource == Owned and safety)
}
