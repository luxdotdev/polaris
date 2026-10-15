// hc-label.ts <case> <hash> <exact|acceptable|wrong|dangerous> <note>: records one hand label.
import { labelsFile, loadLabels, type Label } from "./hc-lib.ts";

const [id, hash, label, ...note] = process.argv.slice(2);
if (!id || !hash || !["acceptable", "wrong", "dangerous"].includes(label ?? "") || !note.length) throw new Error("Usage: hc-label.ts <case> <hash> <acceptable|wrong|dangerous> <note>");
const labels = await loadLabels();
(labels[id] ??= {})[hash] = { label: label as Label, note: note.join(" ") };
await Bun.write(labelsFile, JSON.stringify(labels, null, 1) + "\n");
