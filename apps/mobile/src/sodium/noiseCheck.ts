/**
 * Proves the relay's cryptography on whatever `sodium-universal` resolves to: on the phone,
 * the native `PolarisSodium` module. The Noise IK vector is cacophony's (public domain); the
 * known answers are sodium-native's, so a native result that differs fails here.
 */
import { relayAddress } from "@polaris/protocol/relay";
import {
  acceptHandshake,
  linkIdentity,
  linkProof,
  proveRelayKey,
  RelayInitiator,
  staticKeyPairFromSecret,
} from "@polaris/protocol/relay/party";
import Noise from "noise-handshake";
import CipherState from "noise-handshake/cipher";
import { generateKeyPair } from "noise-handshake/dh";

export interface CheckResult {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

/** haskell-cryptography/cacophony@8ee9d41 vectors/cacophony.txt, Noise_IK_25519_ChaChaPoly_BLAKE2b. */
const IK_VECTOR = {
  prologue: "4a6f686e2047616c74",
  initStatic: "e61ef9919cde45dd5f82166404bd08e38bceb5dfdfded0a34c8df7ed542214d1",
  initEphemeral: "893e28b9dc6ca8d611ab664754b8ceb7bac5117349a4439a6b0569da977c464a",
  initRemoteStatic: "31e0303fd6418d2f8c0e78b91f22e8caed0fbe48656dcf4767e4834f701b8f62",
  respStatic: "4a3acbfdb163dec651dfa3194dece676d437029c62a408b4c5ea9114246e4893",
  respEphemeral: "bbdb4cdbd309f1a1f2e1456967fe288cadd6f712d65dc7b7793d5e63da6b375b",
  handshakeHash:
    "1c8fa891cb414fedba6daa7c6f4ae0a6d98e5f9768cc9cecd27e805614943ee9c8a1b27fbfb76dc197255c8aa69f6b4285c423840b8bedf45e652ca64f797d81",
  messages: [
    [
      "4c756477696720766f6e204d69736573",
      "ca35def5ae56cec33dc2036731ab14896bc4c75dbb07a61f879f8e3afa4c7944ba83a447b38c83e327ad936929812f624884847b7831e95e197b2f797088efdd2f88f1db7e1fb0e99c64419097af91cee64e470f4b6fcd9298ce0b56fe20f86e13bf70439c538e3602a7127af71a29cc",
    ],
    [
      "4d757272617920526f746862617264",
      "95ebc60d2b1fa672c1f46a8aa265ef51bfe38e7ccb39ec5be34069f1448088439f069b267a06b3de3ecb1043bcb098e9af91d9c64748d998c7b47890871571",
    ],
    ["462e20412e20486179656b", "cd54383060e7a28434cca27fb1cc524cfbabeb18181589df219d07"],
    ["4361726c204d656e676572", "a856d3bf0246bfc476c655009cd1ed677b8dcc5b349ae8ef2a05f2"],
    [
      "4a65616e2d426170746973746520536179",
      "49063084b2c51f098337cb8a13739ac848f907e67cfb2cc8a8b60586467aa02fc7",
    ],
    [
      "457567656e2042f6686d20766f6e2042617765726b",
      "8b9709d23b47e4639df7678d7a21741eba4ef1e9c60383001c7435549c20f9d56f30e935d3",
    ],
  ],
} as const;

/** sodium-native's answers for the inputs in `knownAnswers`. */
const KNOWN = {
  linkPublicKey: "735f14e60705c2014a3762622709fd5d7a2e601a8499f35b328966a5e6217e8d",
  address: "GwD4ShTuWZA9z8mI_vsV1g",
  noisePublicKey: "3ebcb692149344dc54e58160cf90bed9eea1dd14e81c8e91de557af7d7afd915",
  proof: "09de5034095a2ba366d9e41e7be1eb452e055d2b4a2f839beb3ac3999a6ae61f",
  signature:
    "c1c09ea570fd8508e4775bb49e4d764b68e2b0093e9f35f445c123b5fe7058279045a01ec6590ae49f9f9c20cc980164c5821ac809d2c9fec1ed50b83589340b",
} as const;

const fromHex = (text: string): Uint8Array =>
  Uint8Array.from(text.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

const mismatch = (what: string, actual: Uint8Array, expected: string): string | null =>
  toHex(actual) === expected ? null : `${what}: expected ${expected}, got ${toHex(actual)}`;

const firstFailure = (checks: ReadonlyArray<() => string | null>): string | null => {
  for (const check of checks) {
    const failure = check();

    if (failure !== null) return failure;
  }

  return null;
};

/** Both sides of the vector's handshake, with its fixed ephemeral keys. */
const vectorParties = () => {
  const v = IK_VECTOR;
  const initiator = new Noise("IK", true, generateKeyPair(fromHex(v.initStatic)));
  const responder = new Noise("IK", false, generateKeyPair(fromHex(v.respStatic)));
  initiator.initialise(fromHex(v.prologue), fromHex(v.initRemoteStatic));
  responder.initialise(fromHex(v.prologue));
  // noise-handshake makes an ephemeral key only while `e` is null; a fixed one replays the vector.
  Object.assign(initiator, { e: generateKeyPair(fromHex(v.initEphemeral)) });
  Object.assign(responder, { e: generateKeyPair(fromHex(v.respEphemeral)) });

  return { initiator, responder };
};

const noiseVector = (): string | null => {
  const { initiator, responder } = vectorParties();
  const [m0, m1, ...transport] = IK_VECTOR.messages;

  if (m0 === undefined || m1 === undefined) return "the vector has no handshake";
  // recv keeps views into the message and zeroes them at the end; Buffer.slice is a view too.
  const init = initiator.send(fromHex(m0[0]));
  const received0 = responder.recv(Uint8Array.from(init));
  const reply = responder.send(fromHex(m1[0]));
  const received1 = initiator.recv(Uint8Array.from(reply));

  const handshake = firstFailure([
    () => mismatch("message 1", init, m0[1]),
    () => mismatch("message 1 payload", received0, m0[0]),
    () => mismatch("message 2", reply, m1[1]),
    () => mismatch("message 2 payload", received1, m1[0]),
    () => mismatch("initiator hash", initiator.hash, IK_VECTOR.handshakeHash),
    () => mismatch("responder hash", responder.hash, IK_VECTOR.handshakeHash),
  ]);

  if (handshake !== null) return handshake;

  // The spec's split: each side's `tx` encrypts to the peer, whose `rx` decrypts it.
  const send = [new CipherState(initiator.tx), new CipherState(responder.tx)];
  const receive = [new CipherState(responder.rx), new CipherState(initiator.rx)];

  return firstFailure(
    transport.map(([payload, ciphertext], i) => () => {
      const sealed = send[i % 2]?.encrypt(fromHex(payload)) ?? new Uint8Array();

      return (
        mismatch(`transport message ${i + 3}`, sealed, ciphertext) ??
        mismatch(
          `transport message ${i + 3} payload`,
          receive[i % 2]?.decrypt(sealed) ?? new Uint8Array(),
          payload
        )
      );
    })
  );
};

const relayChannel = (): string | null => {
  const device = staticKeyPairFromSecret(fromHex("11".repeat(32)));
  const host = staticKeyPairFromSecret(fromHex("22".repeat(32)));
  const initiator = new RelayInitiator(device, host.publicKey);
  const accepted = acceptHandshake(host, initiator.init, () => true);
  const session = initiator.finish(accepted.reply);
  const plaintext = Uint8Array.from({ length: 70_000 }, (_, i) => i % 251);
  const records = session.seal(plaintext);
  const opened = records.map((record) => accepted.session.open(record));
  const joined = new Uint8Array(opened.reduce((n, part) => n + part.byteLength, 0));
  opened.reduce((offset, part) => (joined.set(part, offset), offset + part.byteLength), 0);

  if (toHex(joined) !== toHex(plaintext)) return "a sealed stream did not open to its plaintext";
  const tampered = session.seal(Uint8Array.of(1, 2, 3))[0] ?? new Uint8Array();
  tampered[tampered.byteLength - 1] = (tampered[tampered.byteLength - 1] ?? 0) ^ 1;

  try {
    accepted.session.open(tampered);

    return "a tampered record opened";
  } catch {
    return null;
  }
};

const knownAnswers = async (): Promise<string | null> => {
  const secret = Uint8Array.from({ length: 32 }, (_, i) => i);
  const identity = linkIdentity(secret);
  const address = await relayAddress(identity.publicKey);
  const noise = staticKeyPairFromSecret(Uint8Array.from({ length: 32 }, (_, i) => 255 - i));

  return firstFailure([
    () => mismatch("link identity", identity.publicKey, KNOWN.linkPublicKey),
    () => (address === KNOWN.address ? null : `relay address: got ${address}`),
    () => mismatch("Noise public key", noise.publicKey, KNOWN.noisePublicKey),
    () => mismatch("link proof", linkProof(secret, noise.publicKey, address), KNOWN.proof),
    () =>
      mismatch(
        "relay key proof",
        proveRelayKey(identity, new Uint8Array(32).fill(7), "device"),
        KNOWN.signature
      ),
  ]);
};

const result = async (name: string, run: () => Promise<string | null> | string | null) => {
  try {
    const failure = await run();

    return { name, ok: failure === null, detail: failure ?? "ok" };
  } catch (error) {
    return { name, ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
};

export const runNoiseChecks = async (): Promise<ReadonlyArray<CheckResult>> => [
  await result("Noise IK 25519 ChaChaPoly BLAKE2b vector", noiseVector),
  await result("relay channel round trip and tamper", relayChannel),
  await result("relay identity, address and link proof known answers", knownAnswers),
];
