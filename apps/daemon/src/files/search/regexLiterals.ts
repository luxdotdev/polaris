/**
 * Required literals of a Rust `regex` pattern (the dialect fff greps with):
 * strings that every match must contain. Used to narrow a regex grep to the
 * files containing a literal before running the regex itself.
 *
 * Conservative on purpose: anything this parser doesn't fully understand
 * makes it return null (no narrowing), and anything it understands but can't
 * pin down (classes, `.`, escapes like `\w`, anchors, optional or repeated
 * parts, alternations without a shared substring) just ends a literal. Only
 * word characters (`[A-Za-z0-9_]`, and non-ASCII when case-sensitive) are
 * kept in literals, so the literal is always safe to hand to fff's plain
 * search as a single token.
 */

export interface RequiredLiteral {
  readonly text: string;
  /** Match it case-insensitively (it came from an `(?i)` part of the pattern). */
  readonly caseInsensitive: boolean;
}

interface Info {
  /** The node always matches exactly this literal (so it can join its neighbours). */
  readonly whole: RequiredLiteral | null;
  /** Literals every match of the node contains. */
  readonly required: ReadonlyArray<RequiredLiteral>;
}

const NOTHING: Info = { whole: null, required: [] };

class Unsupported extends Error {}

/** Escaped punctuation that stands for itself (Rust regex meta characters). */
const META_ESCAPES = new Set("\\.+*?()|[]{}^$#&-~".split(""));

/** Escapes that are a class or assertion, never a literal. */
const CLASS_ESCAPES = new Set("dDwWsSbBAz".split(""));

/** Escapes of a single control character: fine, but not a word character. */
const CONTROL_ESCAPES = new Set("ntrfva".split(""));

const isWordAscii = (c: string) => /^[A-Za-z0-9_]$/.test(c);

/**
 * Whether `c` may be part of a literal. Case-insensitive literals are ASCII
 * only and leave out k and s: Rust folds them with U+212A (Kelvin) and U+017F
 * (long s), which an ASCII case-insensitive search wouldn't find.
 */
const literalChar = (c: string, caseInsensitive: boolean): boolean => {
  if (caseInsensitive) return isWordAscii(c) && !"kKsS".includes(c);

  if (isWordAscii(c)) return true;
  const code = c.codePointAt(0)!;

  // Non-ASCII letters and digits; not whitespace or other separators.
  return code > 0x7f && /^[\p{L}\p{N}]$/u.test(c);
};

const MIN_SHARED = 3;

/** Longest literal whose substrings are compared across alternation branches. */
const MAX_SHARED_SCAN = 64;

const lower = (l: RequiredLiteral) => (l.caseInsensitive ? l.text.toLowerCase() : l.text);

/** Longest substrings (≥ MIN_SHARED) every branch requires. */
const sharedAcross = (
  branches: ReadonlyArray<ReadonlyArray<RequiredLiteral>>
): Array<RequiredLiteral> => {
  if (branches.some((b) => b.length === 0)) return [];
  const [first, ...rest] = branches;
  const anyInsensitive = branches.some((b) => b.some((l) => l.caseInsensitive));
  const norm = (l: RequiredLiteral) => (anyInsensitive ? l.text.toLowerCase() : l.text);
  let best: RequiredLiteral | null = null;

  for (const literal of first!) {
    const text = norm(literal).slice(0, MAX_SHARED_SCAN);

    for (let length = text.length; length >= MIN_SHARED; length--) {
      if (best !== null && length <= best.text.length) break;

      for (let start = 0; start + length <= text.length; start++) {
        const piece = text.slice(start, start + length);

        if (rest.every((branch) => branch.some((l) => norm(l).includes(piece)))) {
          best = { text: piece, caseInsensitive: anyInsensitive };
          break;
        }
      }
    }
  }

  return best === null ? [] : [best];
};

const join = (a: RequiredLiteral, b: RequiredLiteral): RequiredLiteral => ({
  text: a.text + b.text,
  caseInsensitive: a.caseInsensitive || b.caseInsensitive,
});

class Parser {
  private at = 0;
  private readonly chars: ReadonlyArray<string>;

  constructor(pattern: string) {
    this.chars = [...pattern];
  }

  parse(): Info {
    const info = this.alternation({ caseInsensitive: false });

    if (this.at !== this.chars.length) throw new Unsupported("trailing input");

    return info;
  }

  private peek(offset = 0): string | undefined {
    return this.chars[this.at + offset];
  }

  private next(): string {
    const c = this.chars[this.at++];

    if (c === undefined) throw new Unsupported("unexpected end");

    return c;
  }

  /** `a|b|c`. `flags` is shared with the group: `(?i)` inside it lasts to its end. */
  private alternation(flags: { caseInsensitive: boolean }): Info {
    const branches: Array<Info> = [this.concatenation(flags)];

    while (this.peek() === "|") {
      this.at++;
      branches.push(this.concatenation(flags));
    }

    if (branches.length === 1) return branches[0]!;
    const wholes = branches.map((b) => b.whole);
    const firstWhole = wholes[0];

    const sameWhole =
      firstWhole !== null &&
      firstWhole !== undefined &&
      wholes.every(
        (w) =>
          w !== null &&
          lower(w) === lower(firstWhole) &&
          w.caseInsensitive === firstWhole.caseInsensitive
      );

    return {
      whole: sameWhole ? firstWhole : null,
      required: sharedAcross(
        branches.map((b) => (b.whole === null ? b.required : [...b.required, b.whole]))
      ),
    };
  }

  private concatenation(flags: { caseInsensitive: boolean }): Info {
    const required: Array<RequiredLiteral> = [];
    let run: RequiredLiteral | null = null;
    let allWhole = true;
    let wholeText: RequiredLiteral | null = null;

    const endRun = () => {
      if (run !== null && run.text !== "") required.push(run);
      run = null;
    };

    for (;;) {
      const c = this.peek();

      if (c === undefined || c === "|" || c === ")") break;
      const item = this.repetition(this.atom(flags));

      if (item.whole !== null) {
        run = run === null ? item.whole : join(run, item.whole);
        wholeText = wholeText === null ? item.whole : join(wholeText, item.whole);
      } else {
        allWhole = false;
        endRun();
        required.push(...item.required);
      }
    }

    endRun();

    if (allWhole && wholeText !== null) return { whole: wholeText, required: [] };

    return { whole: null, required };
  }

  /** A quantifier after an atom, if any. */
  private repetition(atom: Info): Info {
    let min: number | null = null;
    let max: number | null = null;
    const c = this.peek();

    if (c === "*") {
      min = 0;
      this.at++;
    } else if (c === "+") {
      min = 1;
      this.at++;
    } else if (c === "?") {
      min = 0;
      max = 1;
      this.at++;
    } else if (c === "{") {
      const counted = this.counted();
      min = counted.min;
      max = counted.max;
    } else {
      return atom;
    }

    if (this.peek() === "?") this.at++; // lazy

    if (this.peek() === "*" || this.peek() === "+" || this.peek() === "{") {
      throw new Unsupported("stacked repetition");
    }

    if (min === 0) return NOTHING;
    const required = atom.whole === null ? atom.required : [...atom.required, atom.whole];

    if (atom.whole !== null && max === min) {
      return { whole: { ...atom.whole, text: atom.whole.text.repeat(min) }, required: [] };
    }

    return { whole: null, required };
  }

  private counted(): { min: number; max: number | null } {
    this.at++; // {

    const digits = () => {
      let text = "";

      while (/^[0-9]$/.test(this.peek() ?? "")) text += this.next();

      return text;
    };

    const low = digits();

    if (low === "") throw new Unsupported("counted repetition");
    let high: string | null = low;

    if (this.peek() === ",") {
      this.at++;
      high = digits();

      if (high === "") high = null;
    }

    if (this.next() !== "}") throw new Unsupported("counted repetition");
    const min = Number(low);
    const max = high === null ? null : Number(high);

    if (min > 1000 || (max !== null && (max < min || max > 1000))) {
      throw new Unsupported("repetition bounds");
    }

    return { min, max };
  }

  private literal(c: string, flags: { caseInsensitive: boolean }): Info {
    return literalChar(c, flags.caseInsensitive)
      ? { whole: { text: c, caseInsensitive: flags.caseInsensitive }, required: [] }
      : NOTHING;
  }

  private atom(flags: { caseInsensitive: boolean }): Info {
    const c = this.next();

    switch (c) {
      case "(":
        return this.group(flags);
      case "[":
        this.characterClass();

        return NOTHING;
      case "\\":
        return this.escape(flags);
      case ".":
      case "^":
      case "$":
        return NOTHING;
      case "*":
      case "+":
      case "?":
      case "{":
      case "}":
      case ")":
      case "|":
        // A repetition without an atom, or an unbalanced brace: let fff decide.
        throw new Unsupported(`unexpected ${c}`);
      default:
        return this.literal(c, flags);
    }
  }

  private escape(flags: { caseInsensitive: boolean }): Info {
    const c = this.next();

    if (META_ESCAPES.has(c)) return this.literal(c, flags);

    if (CLASS_ESCAPES.has(c) || CONTROL_ESCAPES.has(c)) return NOTHING;
    // \x, \u, \p, octal, \b{…}, …: supported by Rust, but not worth modelling.
    throw new Unsupported(`escape \\${c}`);
  }

  private group(outer: { caseInsensitive: boolean }): Info {
    const flags = { caseInsensitive: outer.caseInsensitive };

    if (this.peek() === "?") {
      this.at++;
      const c = this.peek();

      if (c === "P" || c === "<") {
        if (c === "P") this.at++;

        if (this.next() !== "<") throw new Unsupported("group name");

        while (this.peek() !== ">") {
          if (!/^[A-Za-z0-9_.[\]]$/.test(this.next())) throw new Unsupported("group name");
        }

        this.at++;
      } else {
        // Flags: (?flags) applies to the rest of the enclosing group, (?flags:…) is scoped.
        let negate = false;
        let setInsensitive: boolean | null = null;

        for (;;) {
          const f = this.next();

          if (f === ")" || f === ":") {
            if (setInsensitive !== null) flags.caseInsensitive = setInsensitive;

            if (f === ")") {
              outer.caseInsensitive = flags.caseInsensitive;

              // Zero-width: the literal around it carries on.
              return { whole: { text: "", caseInsensitive: false }, required: [] };
            }

            break;
          }

          if (f === "-") {
            if (negate) throw new Unsupported("flags");
            negate = true;
          } else if (f === "i") {
            setInsensitive = !negate;
          } else if (!"msUuR".includes(f)) {
            // `x` (verbose) changes what whitespace and `#` mean: don't narrow.
            throw new Unsupported(`flag ${f}`);
          }
        }
      }
    }

    const info = this.alternation(flags);

    if (this.next() !== ")") throw new Unsupported("unclosed group");

    return info;
  }

  /** Skips a bracketed class, including nested classes and `[:name:]`. */
  private characterClass(): void {
    if (this.peek() === "^") this.at++;

    if (this.peek() === "]") this.at++; // a leading ] is literal

    for (;;) {
      const c = this.next();

      if (c === "]") return;

      if (c === "\\") {
        const e = this.next();

        if (e === "x" || e === "u" || e === "U" || e === "p" || e === "P") {
          throw new Unsupported("class escape");
        }
      } else if (c === "[") {
        if (this.peek() === ":") {
          const close = this.chars.indexOf(":", this.at + 1);

          if (close < 0 || this.chars[close + 1] !== "]") throw new Unsupported("class name");
          this.at = close + 2;
        } else {
          this.characterClass();
        }
      }
    }
  }
}

/**
 * The literals every match of `pattern` contains, or null when the pattern
 * uses syntax this parser doesn't model (no narrowing then).
 */
export const requiredLiterals = (pattern: string): ReadonlyArray<RequiredLiteral> | null => {
  try {
    const info = new Parser(pattern).parse();

    return info.whole === null ? info.required : [...info.required, info.whole];
  } catch (cause) {
    if (cause instanceof Unsupported) return null;
    throw cause;
  }
};
