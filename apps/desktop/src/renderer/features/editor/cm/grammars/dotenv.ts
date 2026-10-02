import { LanguageSupport, StreamLanguage, type StreamParser } from "@codemirror/language";

interface State {
  quote: string | null;
  value: boolean;
}

const quoted = (stream: Parameters<StreamParser<State>["token"]>[0], state: State) => {
  let escaped = false;
  let next: string | void;

  while ((next = stream.next()) !== undefined) {
    if (next === state.quote && !escaped) {
      state.quote = null;
      break;
    }

    escaped = next === "\\" && !escaped;
  }

  return "string";
};

const valueToken = (stream: Parameters<StreamParser<State>["token"]>[0], state: State) => {
  if (/["']/.test(stream.peek() ?? "")) {
    state.quote = stream.next() ?? null;

    return quoted(stream, state);
  }

  if (stream.match(/\$\{[^}]*\}/)) return "variableName";

  if (stream.match(/[^\s#"'$]+/)) return "string";
  stream.next();

  return "string";
};

/** Assignment syntax only; dotenv values are never parsed or executed as shell. */
const parser: StreamParser<State> = {
  name: "dotenv",
  startState: () => ({ quote: null, value: false }),
  token(stream, state) {
    if (state.quote !== null) return quoted(stream, state);

    if (stream.sol()) state.value = false;

    if (stream.eatSpace()) return null;

    if (stream.peek() === "#") {
      stream.skipToEnd();

      return "comment";
    }

    if (!state.value && stream.match(/export\b/)) return "keyword";

    if (!state.value && stream.match(/[A-Za-z_][\w.-]*(?=\s*=)/)) return "propertyName";

    if (!state.value && stream.eat("=")) {
      state.value = true;

      return "operator";
    }

    if (state.value) return valueToken(stream, state);
    stream.next();

    return null;
  },
  languageData: { commentTokens: { line: "#" } },
};

export const dotenv = () => new LanguageSupport(StreamLanguage.define(parser));
