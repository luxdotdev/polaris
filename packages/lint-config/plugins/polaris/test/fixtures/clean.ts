// Two lines of prose is the cap, and this comment sits exactly on it,
// so it must not be reported.
export const capped = 1

// One line with a pointer underneath. The pointer is exempt.
// See docs/adr/0001-example.md
export const pointer = 2

// Ticket ids and URLs are references, not prose.
// ENG-167
// https://linear.app/polaris/issue/ENG-167
export const references = 3

// Directives are machine-readable and do not count.
// oxlint-disable-next-line no-console
// biome-ignore lint: fixture
// @ts-expect-error intentionally wrong
export const directives = 4

/**
 * JSDoc documents an API surface, which is a different job from explaining a
 * decision. However long it is, it is skipped entirely, because the rule is
 * about rationale hiding in source, not about documentation.
 */
export function documented(): void {}

const trailing = 5 // trailing comments are never grouped
const next = 6 // even when they run
const last = 7 // across several adjacent lines
export const trailers = trailing + next + last

// SAFETY: the parser validated this before branding, so the assertion is
// justified by a directive-style line that does not count as prose.
export const safety = "x" as string

/* A block comment on its own line, two lines of prose,
   still under the cap. */
export const block = 8

// Blank lines inside a comment don't count either.
//
// Still two lines of prose.
export const blanks = 9
