// This comment explains why the retry budget is three. We tried five and the
// queue backed up under load; we tried one and transient DNS failures dropped
// frames. Three was the number that survived.
export const retries = 3;

/* Block comments are held to the same cap. This one runs to three lines of
   prose, which is one more than the rule allows, so it is reported as a
   single violation covering the whole block. */
export const block = 1;

// A run of line comments is one group and one violation, not one per line.
// Line two.
// Line three.
// Line four.
export const run = 2;

// Pointers do not rescue a comment that is already over the cap.
// The prose above and below still counts toward the two-line limit,
// and this third prose line pushes it over.
// See docs/adr/0001-example.md
export const pointerDoesNotRescue = 3;
