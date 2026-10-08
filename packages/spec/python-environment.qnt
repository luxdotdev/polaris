/** Host selection is durable configuration; Client generations and unsaved text remain ephemeral. */
module python_environment {
  type Client = A | B
  type Event = Select({ expected: int, path: str }) | Adopt(Client) | RestartHost | Edit({ client: Client, text: str })
  var revision: int
  var selected: str
  var observed: Client -> int
  var generations: Client -> int
  var drafts: Client -> str
  var ruffGeneration: int
  action init = all {
    revision' = 0, selected' = "detected", observed' = Map(A -> 0, B -> 0),
    generations' = Map(A -> 1, B -> 1), drafts' = Map(A -> "unsaved-a", B -> "unsaved-b"), ruffGeneration' = 1,
  }
  action apply(e: Event): bool = match e {
    | Select(request) => all {
      revision' = if (request.expected == revision) revision + 1 else revision,
      selected' = if (request.expected == revision) request.path else selected,
      observed' = observed, generations' = generations, drafts' = drafts, ruffGeneration' = ruffGeneration,
    }
    | Adopt(client) => all {
      revision' = revision, selected' = selected,
      observed' = observed.set(client, revision), generations' = generations.set(client, generations.get(client) + 1),
      drafts' = drafts, ruffGeneration' = ruffGeneration,
    }
    | RestartHost => all {
      revision' = revision, selected' = selected, observed' = observed,
      generations' = generations, drafts' = drafts, ruffGeneration' = ruffGeneration,
    }
    | Edit(request) => all {
      revision' = revision, selected' = selected, observed' = observed,
      generations' = generations, drafts' = drafts.set(request.client, request.text), ruffGeneration' = ruffGeneration,
    }
  }
  action step = {
    nondet e = Set(Select({ expected: revision, path: "venv" }), Select({ expected: revision, path: "detected" }), Select({ expected: revision - 1, path: "stale" }), Adopt(A), Adopt(B), RestartHost, Edit({ client: A, text: "changed-a" })).oneOf()
    apply(e)
  }
  val safety = all { revision >= 0, Set(A, B).forall(c => observed.get(c) <= revision), ruffGeneration == 1, selected != "stale" }
}
module python_environment_test {
  import python_environment.* from "./python-environment"
  run selectRestartTest = init.then(apply(Select({ expected: 0, path: "venv" }))).then(apply(Adopt(A))).then(apply(Adopt(B)))
    .expect(revision == 1 and selected == "venv" and drafts.get(A) == "unsaved-a" and drafts.get(B) == "unsaved-b" and ruffGeneration == 1 and safety)
  run staleAndPersistTest = init.then(apply(Select({ expected: 0, path: "venv" }))).then(apply(Select({ expected: 0, path: "stale" })))
    .then(apply(RestartHost)).expect(revision == 1 and selected == "venv" and safety)
    .then(apply(Select({ expected: 1, path: "detected" }))).then(apply(Adopt(A))).expect(revision == 2 and selected == "detected" and drafts.get(A) == "unsaved-a" and safety)
}
