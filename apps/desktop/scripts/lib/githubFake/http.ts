/** The fake's request and response shapes, independent of Node's http and of fetch. */

export interface FakeRequest {
  readonly method: string;
  readonly path: string;
  readonly query: URLSearchParams;
  readonly headers: Headers;
  readonly body: string;
}

export interface FakeResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

/** What the fake answers with: plain JSON. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | ReadonlyArray<JsonValue>
  | { readonly [key: string]: JsonValue };

export const json = (
  status: number,
  value: JsonValue,
  headers: Readonly<Record<string, string>> = {}
): FakeResponse => ({
  status,
  headers: { "content-type": "application/json; charset=utf-8", ...headers },
  body: value === null ? "" : JSON.stringify(value),
});

export const notFound = () =>
  json(404, {
    message: "Not Found",
    documentation_url: "https://docs.github.com/rest",
    status: "404",
  });
