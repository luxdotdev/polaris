/** The sha256 of a text's UTF-8 bytes, as lowercase hex; Bun only (the test and the vendor script). */
export const sha256Hex = (text: string): string =>
  new Bun.CryptoHasher("sha256").update(text).digest("hex");
