import { LanguageSupport, StreamLanguage } from "@codemirror/language";

/** Go project directives are local syntax; no module downloads or toolchain execution. */
export const goProject = (name: "gomod" | "gowork") =>
  new LanguageSupport(
    StreamLanguage.define({
      name,
      token(stream) {
        if (stream.eatSpace()) return null;

        if (stream.match("//")) {
          stream.skipToEnd();

          return "comment";
        }

        if (stream.match(/"(?:[^"\\]|\\.)*(?:"|$)/)) return "string";

        if (
          stream.match(
            /\b(?:module|go|toolchain|require|replace|exclude|retract|use|tool|godebug)\b/
          )
        )
          return "keyword";

        if (stream.match(/v?\d[\w.+-]*/)) return "number";

        if (stream.match(/=>|[()[\],]/)) return "punctuation";

        if (stream.match(/[^\s()]+/)) return "string";
        stream.next();

        return null;
      },
      languageData: { commentTokens: { line: "//" } },
    })
  );
