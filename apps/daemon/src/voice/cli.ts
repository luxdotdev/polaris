/**
 * `polaris voice key set|clear|status`: the voice provider's key in the Host's
 * secure storage, without the Daemon running. `set` reads the key from stdin
 * (hidden when it is a terminal) so it never shows in argv or shell history.
 */
import { Effect, Layer, Match, Redacted } from "effect";
import { HostSecrets } from "../secrets/index.ts";
import { setKey, voiceSettings } from "./keys.ts";

export interface VoiceCliIo {
  /** The key as typed or piped, or null when nothing came. */
  readonly readKey: () => Promise<string | null>;
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

const USAGE = "usage: polaris voice key <set|clear|status>";

const STORE_NAMES = { keychain: "the macOS Keychain", file: "~/.polaris/secrets" } as const;

/** Reads one line from a terminal without echoing it, else all of stdin. */
const readHidden = async (): Promise<string | null> => {
  const stdin = process.stdin;

  if (!stdin.isTTY) {
    const text = await Bun.stdin.text();

    return text.trim() === "" ? null : text;
  }

  process.stderr.write("Deepgram key (input hidden): ");
  stdin.setRawMode(true);

  return new Promise((resolve) => {
    let typed = "";

    const onData = (data: Buffer) => {
      for (const char of data.toString("utf8")) {
        if (char === "\r" || char === "\n" || char === "\u0003" || char === "\u0004") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", onData);
          process.stderr.write("\n");
          resolve(char === "\u0003" || typed === "" ? null : typed);

          return;
        }

        typed = char === "\u007f" ? typed.slice(0, -1) : typed + char;
      }
    };

    stdin.on("data", onData);
    stdin.resume();
  });
};

export const defaultVoiceCliIo: VoiceCliIo = {
  readKey: readHidden,
  out: (line) => console.log(line),
  err: (line) => console.error(line),
};

const keyCommand = (action: string, io: VoiceCliIo) =>
  Match.value(action).pipe(
    Match.when("status", () =>
      Effect.map(voiceSettings("deepgram"), (settings) => {
        io.out(
          settings.keySet
            ? `Deepgram key: set, in ${STORE_NAMES[settings.store]}`
            : "Deepgram key: not set"
        );

        return 0;
      })
    ),
    Match.when("clear", () =>
      Effect.map(setKey("deepgram", null), () => {
        io.out("Deepgram key removed");

        return 0;
      })
    ),
    Match.when("set", () =>
      Effect.gen(function* () {
        const typed = yield* Effect.promise(() => io.readKey());

        if (typed === null) {
          io.err("polaris voice key set: no key given");

          return 2;
        }

        const settings = yield* setKey("deepgram", Redacted.make(typed));
        io.out(`Deepgram key saved in ${STORE_NAMES[settings.store]}`);

        return 0;
      })
    ),
    Match.orElse(() =>
      Effect.sync(() => {
        io.err(USAGE);

        return 2;
      })
    )
  );

export const runVoiceCommand = (
  args: ReadonlyArray<string>,
  io: VoiceCliIo = defaultVoiceCliIo,
  secrets: Layer.Layer<HostSecrets> = HostSecrets.layer
): Promise<number> => {
  const [noun, action] = args;

  if (noun !== "key" || action === undefined) {
    io.err(USAGE);

    return Promise.resolve(2);
  }

  return Effect.runPromise(
    keyCommand(action, io).pipe(
      Effect.catchTag("VoiceError", (error) =>
        Effect.sync(() => {
          io.err(`polaris voice key ${action}: ${error.message}`);

          return 1;
        })
      ),
      Effect.provide(secrets)
    )
  );
};
