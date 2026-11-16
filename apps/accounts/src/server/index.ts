import { Context, Layer } from "effect";
import { HttpRouter, HttpServer } from "effect/http";
import { HttpApiBuilder } from "effect/http-api";
import { AccountsApi } from "../api/definition.ts";
import { HandlersLive } from "../api/handlers.ts";
import { AUTH_BASE_PATH, authFor } from "../auth/index.ts";
import type { AccountsConfig } from "../config.ts";
import type { Database } from "../db/index.ts";
import { pages } from "./pages.ts";
import { Accounts, ShareChanges } from "./services.ts";

/** One Account Server: Better Auth under `/api/auth`, the sign-in pages, and the `/v1` API. */
export const accountServer = (config: AccountsConfig, db: Database) => {
  const auth = authFor(config, db);

  const services = Context.make(Accounts, { config, db, auth }).pipe(
    Context.add(ShareChanges, ShareChanges.make())
  );

  const routes = HttpApiBuilder.layer(AccountsApi).pipe(
    Layer.provide(HandlersLive),
    Layer.provide([Layer.succeedContext(services), HttpServer.layerServices])
  );

  const api = HttpRouter.toWebHandler(routes);
  const page = pages(config, auth, db);

  const fetch = async (request: Request): Promise<Response> => {
    const path = new URL(request.url).pathname;

    if (path === AUTH_BASE_PATH || path.startsWith(`${AUTH_BASE_PATH}/`))
      return auth.handler(request);

    if (path === "/healthz") return new Response("ok");

    return (await page(request)) ?? api.handler(request, services);
  };

  return { fetch, auth, dispose: api.dispose };
};
