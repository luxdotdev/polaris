/** Host-only snapshots of installer state. No Trust, checkout, cursor or durable commits. */
module language_host_state {
  type Phase = NotDownloaded | Downloading | Installed | Failed
  type Signal = SetState({ tool: int, phase: Phase }) | Subscribe | Consume | Close
  type Host = { tools: int -> Phase, subscribed: bool, pending: List[int -> Phase] }
  pure val empty = { tools: Map(0 -> NotDownloaded, 1 -> NotDownloaded), subscribed: false, pending: [] }
  var hosts: int -> Host
  var durable: List[int]
  action init = all { hosts' = Map(0 -> empty, 1 -> empty), durable' = [] }
  pure def decide(h: Host, e: Signal): Host = match e {
    | SetState(update) => {
      val updated = h.tools.set(update.tool, update.phase)
      { ...h, tools: updated, pending: if (h.subscribed) [updated] else [] }
    }
    | Subscribe => { ...h, subscribed: true, pending: [h.tools] }
    | Consume => { ...h, pending: [] }
    | Close => { ...h, subscribed: false, pending: [] }
  }
  action publish(id: int, e: Signal): bool = all {
    hosts' = hosts.set(id, decide(hosts.get(id), e)), durable' = durable,
  }
  action step = {
    nondet id = Set(0, 1).oneOf()
    nondet tool = Set(0, 1).oneOf()
    nondet phase = Set(NotDownloaded, Downloading, Installed, Failed).oneOf()
    nondet e = Set(SetState({ tool: tool, phase: phase }), Subscribe, Consume, Close).oneOf()
    publish(id, e)
  }
  val safety = all {
    durable.length() == 0,
    Set(0, 1).forall(id => all {
      hosts.get(id).pending.length() <= 1,
      not(hosts.get(id).subscribed) implies hosts.get(id).pending.length() == 0,
      hosts.get(id).pending.foldl(true, (valid, snapshot) => valid and snapshot == hosts.get(id).tools),
    }),
  }
}

module language_host_state_test {
  import language_host_state.* from "./language-host-state"
  run snapshotCoalescingTest = init.then(publish(0, Subscribe))
    .expect(hosts.get(0).pending == [empty.tools])
    .then(publish(0, SetState({ tool: 0, phase: Downloading }))).then(publish(0, SetState({ tool: 0, phase: Installed })))
    .expect(hosts.get(0).pending == [Map(0 -> Installed, 1 -> NotDownloaded)] and hosts.get(1) == empty and safety)
    .then(publish(0, Consume)).expect(hosts.get(0).pending == [] and safety)
    .then(publish(0, Close)).then(publish(0, SetState({ tool: 0, phase: Failed })))
    .expect(hosts.get(0).pending == [] and safety)
}
