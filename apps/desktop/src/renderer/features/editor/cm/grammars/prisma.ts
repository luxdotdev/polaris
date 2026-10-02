import { LanguageSupport, StreamLanguage, type StreamParser } from "@codemirror/language";

import { tags } from "@lezer/highlight";

interface State {
  blockComment: boolean;
}

const blockComment = (stream: Parameters<StreamParser<State>["token"]>[0], state: State) => {
  state.blockComment = true;

  while (!stream.eol()) {
    if (stream.match("*/")) {
      state.blockComment = false;
      break;
    }

    stream.next();
  }
};

const parser: StreamParser<State> = {
  name: "prisma",
  startState: () => ({ blockComment: false }),
  token(stream, state) {
    if (stream.eatSpace()) return null;

    if (state.blockComment || stream.match("/*")) {
      blockComment(stream, state);

      return "comment";
    }

    if (stream.match("//")) {
      stream.skipToEnd();

      return "comment";
    }

    if (stream.match(/"(?:[^"\\]|\\.)*(?:"|$)/)) return "string";

    if (stream.match(/@@?[\w.]+/)) return "annotation";

    if (stream.match(/\b(?:model|enum|datasource|generator|type|view)\b/))
      return "definitionKeyword";

    if (stream.match(/\b(?:true|false|null)\b/)) return "atom";

    if (
      stream.match(
        /\b(?:String|Int|BigInt|Float|Decimal|Boolean|DateTime|Json|Bytes|Unsupported)\b/
      )
    )
      return "typeName";

    if (stream.match(/-?\d+(?:\.\d+)?/)) return "number";

    if (stream.match(/[A-Za-z_]\w*(?=\s*\()/)) return "functionName";

    if (stream.match(/[A-Z]\w*/)) return "typeName";

    if (stream.match(/[A-Za-z_]\w*/)) return "propertyName";

    if (stream.match(/[{}()[\],.?=:]/)) return "punctuation";
    stream.next();

    return null;
  },
  tokenTable: { functionName: tags.function(tags.variableName) },
  languageData: { commentTokens: { line: "//", block: { open: "/*", close: "*/" } } },
};

export const prisma = () => new LanguageSupport(StreamLanguage.define(parser));
