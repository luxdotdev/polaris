/** Thrown by a raster parser on anything it can't read exactly; `measureRaster` turns it into null. */
export class Malformed extends Error {
  constructor() {
    super("malformed raster header");
  }
}

export const malformed = (): never => {
  throw new Malformed();
};

/** Bounds-checked big- and little-endian reads: a read past the end is `Malformed`, never 0. */
export class Bytes {
  private readonly dv: DataView;

  constructor(readonly data: Uint8Array) {
    this.dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }

  get length(): number {
    return this.data.length;
  }

  has(at: number, size: number): boolean {
    return Number.isSafeInteger(at) && at >= 0 && size >= 0 && at + size <= this.data.length;
  }

  private check(at: number, size: number): number {
    return this.has(at, size) ? at : malformed();
  }

  u8(at: number): number {
    return this.dv.getUint8(this.check(at, 1));
  }

  u16(at: number): number {
    return this.dv.getUint16(this.check(at, 2));
  }

  u16le(at: number): number {
    return this.dv.getUint16(this.check(at, 2), true);
  }

  u24le(at: number): number {
    this.check(at, 3);

    return this.u16le(at) | (this.u8(at + 2) << 16);
  }

  u32(at: number): number {
    return this.dv.getUint32(this.check(at, 4));
  }

  u32le(at: number): number {
    return this.dv.getUint32(this.check(at, 4), true);
  }

  u64(at: number): number {
    const value = this.dv.getBigUint64(this.check(at, 8));

    return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : malformed();
  }

  /** An unsigned big-endian field of 0, 1, 2, 4 or 8 bytes (ISO-BMFF's variable-width fields). */
  uint(at: number, size: number): number {
    if (size === 0) return 0;

    if (size === 1) return this.u8(at);

    if (size === 2) return this.u16(at);

    if (size === 4) return this.u32(at);

    return size === 8 ? this.u64(at) : malformed();
  }

  text(at: number, size: number): string {
    return String.fromCharCode(...this.data.subarray(this.check(at, size), at + size));
  }

  is(at: number, text: string): boolean {
    return this.has(at, text.length) && this.text(at, text.length) === text;
  }

  slice(start: number, end: number): Uint8Array {
    this.check(start, end - start);

    return this.data.subarray(start, end);
  }
}

/** MSB-first bit reads (the AV1 sequence header). */
export class Bits {
  private at = 0;

  constructor(private readonly data: Uint8Array) {}

  bit(): number {
    const byte = this.data[this.at >>> 3] ?? malformed();
    const bit = (byte >>> (7 - (this.at & 7))) & 1;

    this.at++;

    return bit;
  }

  read(count: number): number {
    let value = 0;

    for (let i = 0; i < count; i++) value = value * 2 + this.bit();

    return value;
  }

  /** AV1's `uvlc()`: leading zeros, then that many bits. */
  uvlc(): number {
    let zeros = 0;

    while (this.bit() === 0) if (++zeros >= 32) return malformed();

    return this.read(zeros);
  }
}
