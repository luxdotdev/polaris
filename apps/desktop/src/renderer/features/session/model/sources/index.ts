/**
 * The web sources a Turn used (DESIGN.md, Sources pill): each page it fetched and each search
 * it ran, with the links the search returned. Inputs and results are decoded at the boundary.
 */
import { Option, Predicate, Schema } from "effect";
import type { ItemView } from "../items.ts";
import type { ToolOutput } from "../toolCalls/index.ts";

export interface SourceLink {
  readonly title: string;
  readonly url: string;
  readonly domain: string;
}

export type Source =
  | {
      readonly kind: "fetch";
      readonly id: string;
      readonly url: string;
      readonly domain: string;
    }
  | {
      readonly kind: "search";
      readonly id: string;
      readonly query: string;
      readonly links: ReadonlyArray<SourceLink>;
    };

type ToolView = Extract<ItemView, { kind: "tool" }>;

const NonBlank = Schema.String.check(Schema.isPattern(/\S/));

const decodeFetch = Schema.decodeUnknownOption(Schema.Struct({ url: NonBlank }));

const decodeQuery = Schema.decodeUnknownOption(Schema.Struct({ query: NonBlank }));

const Hit = Schema.Struct({ title: Schema.String, url: NonBlank });

/** Claude Code's WebSearch result: the hits, between lines of the model's commentary. */
const decodeHits = Schema.decodeUnknownOption(
  Schema.Struct({
    results: Schema.Array(
      Schema.Union([Schema.String, Schema.Struct({ content: Schema.Array(Hit) })])
    ),
  })
);

/** A URL's host without `www.`; the URL itself when it doesn't parse. */
export const domainOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

const linksOf = (output: ToolOutput): ReadonlyArray<SourceLink> =>
  Option.match(decodeHits(output), {
    onNone: () => [],
    onSome: ({ results }) =>
      results.flatMap((r) =>
        Predicate.isString(r)
          ? []
          : r.content.map((hit) => ({
              title: hit.title.trim() === "" ? domainOf(hit.url) : hit.title,
              url: hit.url,
              domain: domainOf(hit.url),
            }))
      ),
  });

/** A finished web call's source; null for any other item. */
export const sourceOf = (item: ItemView): Source | null => {
  if (item.kind !== "tool" || item.live || item.status !== "completed") return null;

  return fromTool(item);
};

const fromTool = (item: ToolView): Source | null => {
  if (item.toolKind === "fetch" || item.name === "WebFetch")
    return Option.match(decodeFetch(item.input), {
      onNone: () => null,
      onSome: ({ url }) => ({ kind: "fetch", id: item.id, url, domain: domainOf(url) }),
    });

  if (item.toolKind === "web-search" || item.name === "WebSearch")
    return Option.match(decodeQuery(item.input), {
      onNone: () => null,
      onSome: ({ query }) => ({
        kind: "search",
        id: item.id,
        query,
        links: linksOf(item.output),
      }),
    });

  return null;
};

/** The pill's label: "1 source", "3 sources". */
export const sourcesLabel = (sources: ReadonlyArray<Source>): string =>
  sources.length === 1 ? "1 source" : `${sources.length} sources`;

/** The distinct domains the sources came from, in first-use order: the pill's dots. */
export const sourceDomains = (sources: ReadonlyArray<Source>): ReadonlyArray<string> => [
  ...new Set(
    sources.flatMap((s) => (s.kind === "fetch" ? [s.domain] : s.links.map((l) => l.domain)))
  ),
];
