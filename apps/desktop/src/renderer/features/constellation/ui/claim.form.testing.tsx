import { createRoot } from "react-dom/client";
import { useState } from "react";
import { CheckReceipt } from "@polaris/protocol";
import { installConstellationClient, type Outcome } from "../client.ts";
import { merged } from "../model/fold.ts";
import { buildRail, plainFacts, type TaskRow } from "../model/index.ts";
import { c1Record, handedUpAttempts } from "../preview/graph.ts";
import { Struct } from "effect";
import { ReviewArea } from "./claim.tsx";
import { placeOf } from "./claimActions.ts";

const refuse = () =>
  Promise.resolve<Outcome>({ ok: false, message: "Old claim refusal", fix: null });

installConstellationClient({
  review: refuse,
  dispatch: refuse,
  answer: refuse,
  message: refuse,
  setState: refuse,
});

const record = c1Record({ attempts: handedUpAttempts() });

const row = buildRail(record, plainFacts()).rows.find(
  (r): r is TaskRow => r.kind === "task" && r.task.id === "B1"
);

if (row?.attempt?.claim == null) throw new Error("The fixture requires B1's Claim");

const fixtureTask = row.task;

const initial = merged(row.attempt, {
  claim: Struct.assign(row.attempt.claim, {
    receipts: [CheckReceipt.cases.Reported.make({ label: "First receipt", text: "reported" })],
  }),
});

const Fixture = () => {
  const [attempt, setAttempt] = useState(initial);
  Object.assign(window, {
    replaceClaim: (head: string, bump: boolean) =>
      setAttempt((a) =>
        merged(a, {
          revision: a.revision + (bump ? 1 : 0),
          claim: Struct.assign(a.claim!, {
            head,
            receipts: [
              CheckReceipt.cases.Reported.make({ label: "New receipt", text: "reported" }),
            ],
          }),
        })
      ),
  });

  const claim = attempt.claim;

  if (claim == null) throw new Error("Missing Claim");

  return (
    <ReviewArea
      form={{
        hostKey: "fixture",
        record,
        task: fixtureTask,
        attempt,
        claim,
        mode: "accept",
        onMode: () => undefined,
        onClose: () => undefined,
        onOpenInReview: () => undefined,
        place: placeOf(attempt, null),
      }}
      mode="accept"
      facts={plainFacts()}
    />
  );
};

createRoot(document.getElementById("root")!).render(<Fixture />);
