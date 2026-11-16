/**
 * The Desktop App's sign-in return (RFC 8252 §7.3): a one-use listener on 127.0.0.1 for the
 * browser's redirect, open only while one sign-in runs.
 */
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { AccountsError, type Authorizer } from "@polaris/client/accounts";
import { Deferred, Effect } from "effect";

const page = (text: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Polaris</title><style>body{font:15px/1.5 system-ui,sans-serif;max-width:28rem;margin:4rem auto;padding:0 1rem}</style></head><body><p>${text}</p></body></html>`;

/** Neutral: the code exchange hasn't run yet, so this page can't say the sign-in worked. */
const RETURNED = page("You can close this tab and return to Polaris.");

const STRAY = page("Polaris isn't waiting for this sign-in. Start again from Polaris.");

const failed = (message: string) => new AccountsError({ reason: "sign-in-failed", message });

/** How long the browser has to come back before the sign-in gives up. */
export const SIGN_IN_TIMEOUT = "10 minutes";

export const loopbackAuthorizer = (openExternal: (url: string) => Promise<void>) =>
  Effect.gen(function* () {
    const returned = yield* Deferred.make<string>();
    /** The `state` of the sign-in `open` started; a return with any other is ignored. */
    let expected: string | null = null;

    const server = yield* Effect.acquireRelease(
      Effect.callback<ReturnType<typeof createServer>, AccountsError>((resume) => {
        const listener = createServer((request, response) => {
          const url = new URL(request.url ?? "/", "http://127.0.0.1");

          if (request.method !== "GET" || url.pathname !== "/callback") {
            response.writeHead(404).end();

            return;
          }

          const ours = expected !== null && url.searchParams.get("state") === expected;

          response
            .writeHead(ours ? 200 : 400, {
              "content-type": "text/html; charset=utf-8",
              "cache-control": "no-store",
            })
            .end(ours ? RETURNED : STRAY);

          // A stray local request can't end the sign-in: only the matching return does.
          if (ours) Deferred.doneUnsafe(returned, Effect.succeed(url.toString()));
        });

        listener.once("error", (error) => resume(Effect.fail(failed(error.message))));
        listener.listen(0, "127.0.0.1", () => resume(Effect.succeed(listener)));
      }),
      (listener) => Effect.sync(() => listener.close())
    );

    // SAFETY: a server listening on a TCP port reports an AddressInfo, never a pipe name.
    const { port } = server.address() as AddressInfo;

    return {
      redirectUri: `http://127.0.0.1:${port}/callback`,
      open: (url) =>
        Effect.sync(() => {
          expected = new URL(url).searchParams.get("state");
        }).pipe(
          Effect.andThen(
            Effect.tryPromise({
              try: () => openExternal(url),
              catch: () => failed("couldn't open the browser"),
            })
          ),
          Effect.andThen(Deferred.await(returned)),
          Effect.timeoutOrElse({
            duration: SIGN_IN_TIMEOUT,
            orElse: () => Effect.fail(failed("the browser didn't come back")),
          })
        ),
    } satisfies Authorizer;
  });
