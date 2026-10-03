module language_identity {
  type Binding = { first: bool, identity: int, revoked: bool, live: bool, epoch: int }
  type Event = Hello({ connection: int, identity: int }) | Close(int) | Replace(int)
  pure val fresh = { first: true, identity: -1, revoked: false, live: true, epoch: 1 }
  var connections: int -> Binding
  action init = connections' = Map(0 -> fresh, 1 -> fresh)
  action publish(e: Event): bool = match e {
    | Hello(p) => {
      val c = connections.get(p.connection)
      connections' = connections.set(p.connection,
        if (not(c.live) or c.revoked) c
        else if (c.first) { ...c, first: false, identity: p.identity }
        else if (c.identity == p.identity) c
        else { ...c, revoked: true })
    }
    | Close(id) => connections' = connections.set(id, { ...connections.get(id), live: false, revoked: true })
    | Replace(id) => connections' = connections.set(id, { ...fresh, epoch: connections.get(id).epoch + 1 })
  }
  action step = {
    nondet id = Set(0, 1).oneOf()
    nondet identity = Set(-1, 0, 1, 2).oneOf()
    nondet e = Set(Hello({ connection: id, identity: identity }), Close(id), Replace(id)).oneOf()
    publish(e)
  }
  val safety = connections.keys().forall(id => {
    val c = connections.get(id)
    all { c.epoch > 0, not(c.live) implies c.revoked, c.first implies c.identity == -1 }
  })
}
module language_identity_test {
  import language_identity.* from "./language-identity"
  run immutableFirstHelloTest = init
    .then(publish(Hello({ connection: 0, identity: -1 })))
    .then(publish(Hello({ connection: 0, identity: 1 })))
    .expect(connections.get(0).identity == -1 and connections.get(0).revoked and safety)
  run isolatedReconnectTest = init
    .then(publish(Hello({ connection: 0, identity: 1 })))
    .then(publish(Hello({ connection: 1, identity: 2 })))
    .then(publish(Close(0)))
    .then(publish(Hello({ connection: 0, identity: 1 })))
    .expect(connections.get(0).revoked and connections.get(1).identity == 2)
    .then(publish(Replace(0)))
    .then(publish(Hello({ connection: 0, identity: 1 })))
    .expect(connections.get(0).identity == 1 and connections.get(0).epoch == 2 and safety)
}
