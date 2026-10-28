/** A screen on the navigation stack; plain TypeScript so scripts can import it without JSX. */
export type Route =
  | { readonly screen: "tabs" }
  | { readonly screen: "hosts" }
  | { readonly screen: "thread"; readonly hostId: string; readonly sessionId: string }
  | { readonly screen: "constellation"; readonly hostId: string; readonly constellationId: string }
  | {
      readonly screen: "review";
      readonly hostId: string;
      readonly sessionId: string;
      readonly turnId: string | null;
    }
  | { readonly screen: "link" };
