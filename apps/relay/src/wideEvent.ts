/**
 * Wide events: one structured line per connection, written when it closes, plus
 * start and refusal lines. They carry counts and opaque connection IDs only:
 * no payloads, relay addresses, keys or network addresses.
 */

export interface ConnectionEvent {
  readonly event: "relay.connection";
  /** Random per connection; meaningless outside this line. */
  readonly conn: string;
  readonly role: "host" | "device" | null;
  readonly authenticated: boolean;
  readonly durationMs: number;
  readonly framesIn: number;
  readonly bytesIn: number;
  readonly framesOut: number;
  readonly bytesOut: number;
  readonly controlIn: number;
  readonly unreachable: number;
  readonly dropped: number;
  readonly closeCode: number;
  /** Why the relay closed it, or "peer" when the other end did. */
  readonly endedBy: string;
}

export interface RefusedEvent {
  readonly event: "relay.refused";
  readonly reason: string;
}

export interface StartEvent {
  readonly event: "relay.start";
  readonly port: number;
}

export type WideEvent = ConnectionEvent | RefusedEvent | StartEvent;

export type EmitWideEvent = (event: WideEvent) => void;

export const stdoutWideEvents: EmitWideEvent = (event) =>
  console.log(JSON.stringify({ time: new Date().toISOString(), ...event }));
