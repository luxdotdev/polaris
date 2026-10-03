import { test, expect } from "bun:test";
import { rejects } from "node:assert/strict";
import { createSelectionLedger } from "./selection-ledger.ts";

test("selection and entire language-server generation lifetimes exclude each other", async () => {
  const ledger = createSelectionLedger();
  const signal = new AbortController().signal;
  const identity = "sha256:" + "a".repeat(64);
  const launch = await ledger.reserveLaunch("fake", identity, signal);
  const peer = await ledger.reserveLaunch("fake", identity, signal);
  await rejects(ledger.reserveSelection("fake", signal), { reason: "conflict" });
  await launch.release();
  await rejects(ledger.reserveSelection("fake", signal), { reason: "conflict" });
  await peer.release();
  const selection = await ledger.reserveSelection("fake", signal);
  await rejects(ledger.reserveLaunch("fake", identity, signal), { reason: "conflict" });
  await selection.release();
  await rejects(selection.validate(signal), { reason: "conflict" });
  expect(ledger.stats()).toEqual({ selections: 0, launches: 0, disposed: false });
  ledger.dispose();
  await rejects(ledger.reserveLaunch("fake", identity, signal), { reason: "cancelled" });
});

test("ledger never steals or forgets a live generation and caps retained admission", async () => {
  const ledger = createSelectionLedger();
  const signal = new AbortController().signal;

  const reservations = await Promise.all(
    Array.from({ length: 64 }, () =>
      ledger.reserveLaunch("fake", "sha256:" + "a".repeat(64), signal)
    )
  );

  await rejects(ledger.reserveLaunch("fake", "sha256:" + "a".repeat(64), signal), {
    reason: "queue-full",
  });
  expect(() => ledger.dispose()).toThrow("awaited cleanup");
  await Promise.all(reservations.map((reservation) => reservation.release()));
  await Promise.all(reservations.map((reservation) => reservation.release()));
  expect(ledger.stats().launches).toBe(0);
  const held = await ledger.reserveLaunch("fake", "sha256:" + "a".repeat(64), signal);
  await rejects(ledger.reserveLaunch("fake", "sha256:" + "b".repeat(64), signal), {
    reason: "conflict",
  });
  await held.release();
  ledger.dispose();
});
