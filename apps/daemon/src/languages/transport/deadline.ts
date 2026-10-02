import { failure } from "./framing.ts";

/** Timers exist only for outstanding work and are cleared on every settlement. */
export async function bounded<A>(operation: Promise<A>, milliseconds: number): Promise<A> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      operation,
      new Promise<A>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(failure("timeout", "Language operation deadline exceeded")),
          milliseconds
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
