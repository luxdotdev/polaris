/** One reversible move; batches compose moves in order and restore in reverse order. */
module file_edits {
  type Phase = Pending | Forward | Applied | Backward | Restored
  type Token = Missing | Owned | External
  type Event = Prepare | Intent | Move | PersistApplied | UndoIntent | Restore | PersistRestored | ExternalSource | ExternalTarget | Crash | Retry | Ack
  var prepared: bool
  var phase: Phase
  var source: Token
  var target: Token
  var revision: int
  var acknowledged: bool
  var sourceIntervened: bool
  var targetIntervened: bool

  action init = all {
    prepared' = false, phase' = Pending, source' = Owned, target' = Missing,
    revision' = 0, acknowledged' = false, sourceIntervened' = false, targetIntervened' = false
  }
  action unchanged = all {
    prepared' = prepared, phase' = phase, source' = source, target' = target,
    revision' = revision, acknowledged' = acknowledged,
    sourceIntervened' = sourceIntervened, targetIntervened' = targetIntervened
  }
  action checkpoint(p: Phase): bool = all {
    prepared' = prepared, phase' = p, source' = source, target' = target,
    revision' = revision + 1, acknowledged' = acknowledged,
    sourceIntervened' = sourceIntervened, targetIntervened' = targetIntervened
  }
  val before = source == Owned and target == Missing
  val after = source == Missing and target == Owned
  action publish(e: Event): bool = match e {
    | Prepare => if (not(prepared)) all {
        prepared' = true, phase' = phase, source' = source, target' = target,
        revision' = revision + 1, acknowledged' = acknowledged,
        sourceIntervened' = sourceIntervened, targetIntervened' = targetIntervened
      } else unchanged
    | Intent => if (prepared and phase == Pending and before) checkpoint(Forward) else unchanged
    | Move => if (phase == Forward and before) all {
        prepared' = prepared, phase' = phase, source' = Missing, target' = Owned,
        revision' = revision, acknowledged' = acknowledged,
        sourceIntervened' = sourceIntervened, targetIntervened' = targetIntervened
      } else unchanged
    | PersistApplied => if (phase == Forward and after) checkpoint(Applied) else unchanged
    | UndoIntent => if ((phase == Forward or phase == Applied or phase == Backward) and after) checkpoint(Backward) else unchanged
    | Restore => if (phase == Backward and after) all {
        prepared' = prepared, phase' = phase, source' = Owned, target' = Missing,
        revision' = revision, acknowledged' = acknowledged,
        sourceIntervened' = sourceIntervened, targetIntervened' = targetIntervened
      } else unchanged
    | PersistRestored => if ((phase == Forward or phase == Backward) and before) checkpoint(Restored) else unchanged
    | ExternalSource => all {
        prepared' = prepared, phase' = phase, source' = External, target' = target,
        revision' = revision, acknowledged' = acknowledged,
        sourceIntervened' = true, targetIntervened' = targetIntervened
      }
    | ExternalTarget => all {
        prepared' = prepared, phase' = phase, source' = source, target' = External,
        revision' = revision, acknowledged' = acknowledged,
        sourceIntervened' = sourceIntervened, targetIntervened' = true
      }
    | Ack => if (phase == Applied) all {
        prepared' = prepared, phase' = phase, source' = source, target' = target,
        revision' = revision, acknowledged' = true,
        sourceIntervened' = sourceIntervened, targetIntervened' = targetIntervened
      } else unchanged
    | Crash => unchanged
    | Retry => unchanged
  }
  action step = { nondet e = oneOf(Set(Prepare, Intent, Move, PersistApplied, UndoIntent, Restore, PersistRestored, ExternalSource, ExternalTarget, Crash, Retry, Ack)); publish(e) }
  val safety = all {
    sourceIntervened implies source == External,
    targetIntervened implies target == External,
    (phase == Applied or phase == Backward or phase == Restored) implies prepared,
    acknowledged implies revision >= 3
  }
}
module file_edits_test {
  import file_edits.* from "./file-edits"
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
