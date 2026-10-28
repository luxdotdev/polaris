/** The parts of noise-handshake and sodium-universal the relay party uses; neither ships types. */
declare module "noise-handshake" {
  export interface NoiseKeyPair {
    readonly publicKey: Uint8Array;
    readonly secretKey: Uint8Array;
  }

  export default class Noise {
    constructor(pattern: "IK", initiator: boolean, staticKeyPair?: NoiseKeyPair);
    readonly s: NoiseKeyPair;
    readonly complete: boolean;
    readonly rs: Uint8Array | null;
    readonly tx: Uint8Array;
    readonly rx: Uint8Array;
    readonly hash: Uint8Array;
    initialise(prologue: Uint8Array, remoteStatic?: Uint8Array): void;
    send(payload?: Uint8Array): Uint8Array;
    recv(message: Uint8Array): Uint8Array;
  }
}

declare module "noise-handshake/cipher" {
  export default class CipherState {
    constructor(key: Uint8Array);
    encrypt(plaintext: Uint8Array, ad?: Uint8Array): Uint8Array;
    decrypt(ciphertext: Uint8Array, ad?: Uint8Array): Uint8Array;
    readonly nonce: number;
  }
}

declare module "noise-handshake/dh" {
  import type { NoiseKeyPair } from "noise-handshake";

  export function generateKeyPair(secretKey?: Uint8Array): NoiseKeyPair;
}

declare module "sodium-universal" {
  export const crypto_sign_PUBLICKEYBYTES: number;
  export const crypto_sign_SECRETKEYBYTES: number;
  export const crypto_sign_BYTES: number;
  export function crypto_sign_keypair(publicKey: Uint8Array, secretKey: Uint8Array): void;
  export function crypto_sign_detached(
    signature: Uint8Array,
    message: Uint8Array,
    secretKey: Uint8Array
  ): void;
  export function randombytes_buf(buffer: Uint8Array): void;
  export const crypto_sign_SEEDBYTES: number;
  export function crypto_sign_seed_keypair(
    publicKey: Uint8Array,
    secretKey: Uint8Array,
    seed: Uint8Array
  ): void;
  export function crypto_generichash(output: Uint8Array, input: Uint8Array, key?: Uint8Array): void;
}
