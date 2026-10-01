/**
 * Domain values arrive over IPC by structured clone, which keeps their fields
 * but not their Schema classes, so the renderer types them as plain records.
 */
import type { AgentSession } from "@polaris/protocol";

export type Plain<T> = { readonly [K in keyof T]: T[K] };

export type SessionData = Plain<AgentSession>;

/** A domain value as its fields, so a copy (`{ ...v, state }`) is a record, not a class. */
export const asPlain = <T>(value: T): Plain<T> => value;
