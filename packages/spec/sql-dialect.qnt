/** Host SQL selection is durable; provider generations and drafts remain Client-scoped. */
module sql_dialect {
  type Client = A | B
  type Scope = File | Workspace
  type Event = Select({ expected: int, scope: Scope, dialect: str }) | Adopt(Client) | RestartHost
  var revision: int
  var workspace: str
  var file: str
  var generations: Client -> int
  var drafts: Client -> str
  action init = all {
    revision' = 0, workspace' = "detected", file' = "detected",
    generations' = Map(A -> 1, B -> 1), drafts' = Map(A -> "unsaved-a", B -> "unsaved-b"),
  }
  val selected = if (file != "detected") file else workspace
  action apply(e: Event): bool = match e {
    | Select(request) => all {
      revision' = if (request.expected == revision) revision + 1 else revision,
      workspace' = if (request.expected == revision and request.scope == Workspace) request.dialect else workspace,
      file' = if (request.expected == revision and request.scope == File) request.dialect else file,
      generations' = generations, drafts' = drafts,
    }
    | Adopt(client) => all {
      revision' = revision, workspace' = workspace, file' = file,
      generations' = generations.set(client, generations.get(client) + 1), drafts' = drafts,
    }
    | RestartHost => all {
      revision' = revision, workspace' = workspace, file' = file,
      generations' = generations, drafts' = drafts,
    }
  }
  action step = {
    nondet e = Set(Select({ expected: revision, scope: Workspace, dialect: "mysql" }),
      Select({ expected: revision, scope: File, dialect: "sqlite" }),
      Select({ expected: revision, scope: File, dialect: "detected" }),
      Select({ expected: revision - 1, scope: File, dialect: "stale" }),
      Adopt(A), Adopt(B), RestartHost).oneOf()
    apply(e)
  }
  val safety = all { revision >= 0, selected != "stale", drafts == Map(A -> "unsaved-a", B -> "unsaved-b") }
}
module sql_dialect_test {
  import sql_dialect.* from "./sql-dialect"
  run precedenceTest = init.then(apply(Select({ expected: 0, scope: Workspace, dialect: "mysql" })))
    .expect(selected == "mysql").then(apply(Select({ expected: 1, scope: File, dialect: "sqlite" })))
    .then(apply(Adopt(A))).then(apply(Adopt(B))).then(apply(RestartHost))
    .expect(selected == "sqlite" and revision == 2 and safety)
    .then(apply(Select({ expected: 2, scope: File, dialect: "detected" }))).expect(selected == "mysql" and safety)
  run staleTest = init.then(apply(Select({ expected: 0, scope: File, dialect: "sqlite" })))
    .then(apply(Select({ expected: 0, scope: Workspace, dialect: "stale" })))
    .expect(selected == "sqlite" and workspace == "detected" and revision == 1 and safety)
}
