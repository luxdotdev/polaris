import { describe, expect, test } from "bun:test";
import { decideAccess } from "./grants.ts";
import { NotGranted, Pairing, PairingId } from "./index.ts";

const pairing = (grant: Pairing["grant"]) =>
  new Pairing({
    id: PairingId.make("pair_1"),
    name: "Raycast",
    grant,
    createdAt: "2026-10-23T00:00:00Z",
    lastUsedAt: null,
    revokedAt: null,
  });

describe("decideAccess", () => {
  test("a token-less Client is never refused, whatever it asks", () => {
    expect(decideAccess(null, "files.read", null)).toBeNull();
    expect(decideAccess(null, "extensions.revoke", null)).toBeNull();
    expect(decideAccess(null, "dispatch", "SendTurn")).toBeNull();
  });

  test("an Extension passes with the Grant a request needs and is refused without it", () => {
    expect(decideAccess(pairing(["read"]), "subscribeHost", null)).toBeNull();
    expect(decideAccess(pairing(["read"]), "hello", null)).toBeNull();
    expect(decideAccess(pairing(["approve"]), "subscribeHost", null)).toEqual(
      new NotGranted({ what: "subscribeHost", needed: "read" })
    );
    expect(decideAccess(pairing(["read"]), "dispatch", "SendTurn")).toEqual(
      new NotGranted({ what: "dispatch:SendTurn", needed: "turn" })
    );
    expect(decideAccess(pairing(["read", "turn"]), "dispatch", "SendTurn")).toBeNull();
  });

  test("starting a session that is not supervised also needs approve", () => {
    expect(decideAccess(pairing(["start"]), "dispatch", "StartSession", "supervised")).toBeNull();
    expect(decideAccess(pairing(["start"]), "dispatch", "StartSession", "auto")).toEqual(
      new NotGranted({ what: "dispatch:StartSession", needed: "approve" })
    );
    expect(decideAccess(pairing(["start"]), "dispatch", "StartSession")).toEqual(
      new NotGranted({ what: "dispatch:StartSession", needed: "approve" })
    );
    expect(
      decideAccess(pairing(["start", "approve"]), "dispatch", "StartSession", "full-access")
    ).toBeNull();
    expect(decideAccess(pairing(["approve"]), "dispatch", "StartSession", "auto")).toEqual(
      new NotGranted({ what: "dispatch:StartSession", needed: "start" })
    );
    expect(decideAccess(null, "dispatch", "StartSession", "auto")).toBeNull();
  });

  test("what 0.3.0 keeps for Clients is refused to every Extension, naming no Grant", () => {
    const everything = pairing(["read", "approve", "turn", "start", "voice"]);
    expect(decideAccess(everything, "files.read", null)).toEqual(
      new NotGranted({ what: "files.read", needed: null })
    );
    expect(decideAccess(everything, "extensions.list", null)).toEqual(
      new NotGranted({ what: "extensions.list", needed: null })
    );
    expect(decideAccess(everything, "dispatch", "ArchiveSession")).toEqual(
      new NotGranted({ what: "dispatch:ArchiveSession", needed: null })
    );
  });

  test("an RPC or Command the mapping does not know is refused to Extensions", () => {
    expect(decideAccess(pairing(["read"]), "voice.transcribe", null)).toEqual(
      new NotGranted({ what: "voice.transcribe", needed: null })
    );
    expect(decideAccess(pairing(["turn"]), "dispatch", "Nope")).toEqual(
      new NotGranted({ what: "dispatch:Nope", needed: null })
    );
    expect(decideAccess(pairing(["turn"]), "dispatch", null)).toEqual(
      new NotGranted({ what: "dispatch:", needed: null })
    );
  });

  test("a refusal says which Grant is missing in words", () => {
    expect(new NotGranted({ what: "dispatch:SendTurn", needed: "turn" }).message).toBe(
      "dispatch:SendTurn needs the turn Grant"
    );
    expect(new NotGranted({ what: "files.read", needed: null }).message).toBe(
      "files.read is not available to Extensions"
    );
  });
});
