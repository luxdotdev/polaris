/** Live-only process-generation logs, with scaled bounds for exhaustive interleavings. */
module language_logs {
  type Server = { generation: int, ring: List[int], next: int, subscribed: bool, queue: List[int] }
  type Signal = Emit(int) | Subscribe(int) | Consume(int) | Unsubscribe(int) | Retire(int)
  pure val empty = { generation: 1, ring: [], next: 1, subscribed: false, queue: [] }
  var servers: int -> Server
  var durable: List[int]
  action init = all { servers' = Map(0 -> empty, 1 -> empty), durable' = [] }
  pure def tailBound(xs: List[int], bound: int): List[int] = if (xs.length() > bound) xs.tail() else xs
  pure def decide(s: Server, e: Signal): Server = match e {
    | Emit(_) => {
      val pending = if (s.subscribed) s.queue.append(s.next) else []
      val overflow = pending.length() > 3
      { ...s, ring: tailBound(s.ring.append(s.next), 2), next: s.next + 1,
        subscribed: s.subscribed and not(overflow), queue: if (overflow) [] else pending }
    }
    | Subscribe(_) => { ...s, subscribed: true, queue: s.ring }
    | Consume(_) => { ...s, queue: if (s.queue.length() > 0) s.queue.tail() else [] }
    | Unsubscribe(_) => { ...s, subscribed: false, queue: [] }
    | Retire(_) => { ...empty, generation: s.generation + 1 }
  }
  action publish(e: Signal): bool = {
    val id = match e { | Emit(i) => i | Subscribe(i) => i | Consume(i) => i | Unsubscribe(i) => i | Retire(i) => i }
    all { servers' = servers.set(id, decide(servers.get(id), e)), durable' = durable }
  }
  action step = {
    nondet id = Set(0, 1).oneOf()
    nondet e = Set(Emit(id), Subscribe(id), Consume(id), Unsubscribe(id), Retire(id)).oneOf()
    publish(e)
  }
  val safety = all {
    durable.length() == 0,
    Set(0, 1).forall(i => all {
      servers.get(i).ring.length() <= 2,
      servers.get(i).queue.length() <= 3,
      not(servers.get(i).subscribed) implies servers.get(i).queue.length() == 0,
      servers.get(i).queue.foldl(true, (valid, n) => valid and n < servers.get(i).next),
    }),
  }
}

module language_logs_test {
  import language_logs.* from "./language-logs"
  run backlogLiveAndIsolationTest = init.then(publish(Emit(0))).then(publish(Emit(0)))
    .then(publish(Emit(0))).then(publish(Subscribe(0)))
    .expect(servers.get(0).queue == [2, 3] and servers.get(1) == empty)
    .then(publish(Emit(0))).expect(servers.get(0).queue == [2, 3, 4] and safety)
    .then(publish(Emit(0))).expect(not(servers.get(0).subscribed) and safety)
  run retirementTest = init.then(publish(Emit(0))).then(publish(Subscribe(0)))
    .then(publish(Retire(0))).expect(servers.get(0).generation == 2 and servers.get(0).ring == [] and safety)
    .then(publish(Subscribe(0))).then(publish(Emit(0))).expect(servers.get(0).queue == [1] and safety)
    .then(publish(Unsubscribe(0))).expect(servers.get(0).queue == [] and safety)
}
