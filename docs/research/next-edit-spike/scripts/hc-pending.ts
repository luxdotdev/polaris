// Writes raw/hc/corpus.pending.md: every unlabelled buffer state in the corpus, shown or not.
import { corpus } from "./hc-corpus.ts";
import { loadSet, rawDir, review } from "./hc-lib.ts";

const cases = await loadSet("dev");
const pending = (await corpus()).filter((e) => e.label === "unlabelled");
await Bun.write(new URL("corpus.pending.md", rawDir), pending.map((e) => review(cases.find((c) => c.id === e.id)!, e.after, e.source)).join("\n"));
console.log(`${pending.length} unlabelled`);
