/**
 * The Desktop App's sign-in return (RFC 8252 §7.3): a one-use listener on 127.0.0.1 for the
 * browser's redirect, open only while one sign-in runs.
 */
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { AccountsError, type Authorizer } from "@polaris/client/accounts";
import { Deferred, Effect } from "effect";

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Polaris</title><style>body{font:15px/1.5 system-ui,sans-serif;max-width:28rem;margin:4rem auto;padding:0 1rem}</style></head><body><p>You're signed in to Polaris. You can close this tab.</p></body></html>`;

const failed = (message: string) => new AccountsError({ reason: "sign-in-failed", message });

/** How long the browser has to come back before the sign-in gives up. */
export const SIGN_IN_TIMEOUT = "10 minutes";

export const loopbackAuthorizer = (openExternal: (url: string) => Promise<void>) =>
  Effect.gen(function* () {
    const returned = yield* Deferred.make<string>();

    const server = yield* Effect.acquireRelease(
      Effect.callback<ReturnType<typeof createServer>, AccountsError>((resume) => {
        const listener = createServer((request, response) => {
          const url = new URL(request.url ?? "/", "http://127.0.0.1");

          if (request.method !== "GET" || url.pathname !== "/callback") {
            response.writeHead(404).end();

            return;
          }

          response
            .writeHead(200, {
              "content-type": "text/html; charset=utf-8",
              "cache-control": "no-store",
            })
            .end(PAGE);
          Deferred.doneUnsafe(returned, Effect.succeed(url.toString()));
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
        Effect.tryPromise({
          try: () => openExternal(url),
          catch: () => failed("couldn't open the browser"),
        }).pipe(
          Effect.andThen(Deferred.await(returned)),
          Effect.timeoutOrElse({
            duration: SIGN_IN_TIMEOUT,
            orElse: () => Effect.fail(failed("the browser didn't come back")),
          })
        ),
    } satisfies Authorizer;
  });
