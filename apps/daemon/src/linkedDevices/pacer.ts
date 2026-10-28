/**
 * Keeps the Daemon's relay socket under the message and byte rates the relay
 * announced in its challenge, so a large reply is slowed rather than the socket
 * closed with 4429. Sends run in order through one chain.
 */
import type { RelayLimits } from "@polaris/protocol/relay";

/** Stay below the relay's rates by this factor. */
const HEADROOM = 0.8;

export class Pacer {
  private messages: number;
  private bytes: number;
  private last = performance.now();
  private chain: Promise<void> = Promise.resolve();

  constructor(private readonly limits: Pick<RelayLimits, "messagesPerSecond" | "bytesPerSecond">) {
    this.messages = this.messageRate;
    this.bytes = this.byteRate;
  }

  private get messageRate() {
    return this.limits.messagesPerSecond * HEADROOM;
  }

  private get byteRate() {
    return this.limits.bytesPerSecond * HEADROOM;
  }

  private refill(): void {
    const now = performance.now();
    const seconds = (now - this.last) / 1000;
    this.last = now;
    this.messages = Math.min(this.messageRate, this.messages + seconds * this.messageRate);
    this.bytes = Math.min(this.byteRate, this.bytes + seconds * this.byteRate);
  }

  /** Milliseconds until one message of `size` bytes fits; 0 when it fits now. */
  private wait(size: number): number {
    this.refill();
    const messageWait = this.messages >= 1 ? 0 : ((1 - this.messages) / this.messageRate) * 1000;

    const byteWait =
      this.bytes >= Math.min(size, this.byteRate)
        ? 0
        : ((Math.min(size, this.byteRate) - this.bytes) / this.byteRate) * 1000;

    return Math.ceil(Math.max(messageWait, byteWait));
  }

  private async take(size: number): Promise<void> {
    for (let ms = this.wait(size); ms > 0; ms = this.wait(size)) await Bun.sleep(ms);
    this.messages -= 1;
    this.bytes -= size;
  }

  /** Runs `send` for each message in order, after the ones queued before them. */
  enqueue(messages: ReadonlyArray<Uint8Array>, send: (message: Uint8Array) => void): Promise<void> {
    const run = async () => {
      for (const message of messages) {
        await this.take(message.byteLength);
        send(message);
      }
    };

    const next = this.chain.then(run);
    this.chain = next.catch(() => undefined);

    return next;
  }
}
