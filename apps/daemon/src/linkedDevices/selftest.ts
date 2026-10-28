/**
 * The Relay route's part of `polaris selftest`: libsodium (sodium-native, embedded by
 * `bun build --compile` through a patched loader) runs a Noise handshake and a sealed
 * record both ways. Returns the line to print.
 */
import {
  acceptHandshake,
  generateRelayIdentity,
  generateStaticKeyPair,
  proveRelayKey,
  RelayInitiator,
} from "@polaris/protocol/relay/party";
import { authMessage, verifyEd25519 } from "@polaris/protocol/relay";

export const relaySelfTest = async (): Promise<{ readonly ok: boolean; readonly line: string }> => {
  try {
    const identity = generateRelayIdentity();
    const nonce = crypto.getRandomValues(new Uint8Array(32));
    const signature = proveRelayKey(identity, nonce, "host");

    if (!(await verifyEd25519(identity.publicKey, authMessage(nonce, "host"), signature)))
      return { ok: false, line: "libsodium: the key proof did not verify" };
    const host = generateStaticKeyPair();
    const initiator = new RelayInitiator(generateStaticKeyPair(), host.publicKey);
    const accepted = acceptHandshake(host, initiator.init, () => true);
    const device = initiator.finish(accepted.reply);
    const plaintext = new TextEncoder().encode("polaris selftest");
    const [record] = device.seal(plaintext);
    const opened = record === undefined ? null : accepted.session.open(record);

    return opened !== null && new TextDecoder().decode(opened) === "polaris selftest"
      ? { ok: true, line: "libsodium: ok" }
      : { ok: false, line: "libsodium: a sealed record did not open" };
  } catch (error) {
    return { ok: false, line: `libsodium: unavailable (${String(error)})` };
  }
};
