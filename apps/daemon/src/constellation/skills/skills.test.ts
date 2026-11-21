import { expect, test } from "bun:test";
import { CONSTELLATION_SKILL_VERSION, constellationInstructions } from "./index.ts";
import { leadBinding, workerBinding } from "../../mcp/testing.ts";

test("Lead and worker instructions share one version and use the report-derived M2 loop", () => {
  const lead = constellationInstructions(leadBinding);
  const worker = constellationInstructions(workerBinding);

  for (const text of [lead, worker]) {
    expect(text).toStartWith(`Polaris Constellation skill · v${CONSTELLATION_SKILL_VERSION}`);
    expect(text).toContain("AGENTS.md");
    expect(text).toContain("Only the user grants approvals");
    expect(text).toContain("Never send keystrokes");
    expect(text).toContain("e32ec1e");
    expect(text).toContain("Reported");
  }

  expect(lead).toContain("Attempt revision");
  expect(lead).toContain("mergeConflictBase");
  expect(lead).toContain("accepted");
  expect(worker).toContain("notDone, followups, questions, outsideArea, decisions and summary");
  expect(worker).toContain("polaris lease");
  expect(worker).toContain("identical still-open questions");
});

test("both roles are told how to read and note on a Logbook, and the worker which Logbooks it may read", () => {
  const lead = constellationInstructions(leadBinding);
  const worker = constellationInstructions(workerBinding);

  expect(lead).toContain("logbook_read { task: A1 }, or every Task's without task");
  expect(lead).toContain("logbook_note { task: A1, text }");
  expect(worker).toContain("the Logbook of a Task yours depends on, and no other");
  expect(worker).toContain("logbook_note { text }");
  expect(worker).toContain("capped digest");
});
