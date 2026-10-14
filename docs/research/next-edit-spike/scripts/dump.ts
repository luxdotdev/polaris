// Prints one case's final-step prompt for a format, and the target edit, for inspection.
import { changed, loadCases } from "./build.ts";
import { FORMATS, type Format } from "./prompts.ts";
const [id, fmt = "zeta", stepArg = "4"] = process.argv.slice(2);
const c = (await loadCases()).find((x) => x.id === id)!;
const s = c.steps[Number(stepArg)]!;
const b = FORMATS[fmt as Format](c, s);
console.log(b.prompt);
console.log("\n=== window", b.window, "cursor", s.cursorLine, s.cursorCol);
const cur = s.states.at(-1)!;
const [p, ea, eb] = changed(cur, c.expected);
console.log("=== target: lines", p, "-", ea, "->\n" + cur.slice(p, ea).map((l) => "-" + l).join("\n") + "\n" + c.expected.slice(p, eb).map((l) => "+" + l).join("\n"));
