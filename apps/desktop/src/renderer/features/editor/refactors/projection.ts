import type {
  LanguagePositionEncoding,
  LanguageResourceOperation,
  LanguageTextEdit,
  LanguageTreeEditProposal,
} from "@polaris/protocol";
import { formattedText } from "../formatting/edits.ts";
import type { DraftDocument } from "./group.ts";
import { filePath, within } from "./plan.ts";

export class ProjectionBuilder {
  readonly documents: Map<string, DraftDocument>;
  readonly touched: Set<string>;
  readonly entries = new Map<string, "file" | "directory">();
  readonly root: string;
  constructor(
    proposal: LanguageTreeEditProposal,
    readonly originals: readonly DraftDocument[],
    readonly encoding: typeof LanguagePositionEncoding.Type
  ) {
    this.root = proposal.fence.context.checkout.path.replace(/\/$/, "");
    this.documents = new Map(originals.map((doc) => [doc.canonicalPath, doc]));
    this.touched = new Set(originals.map((doc) => doc.canonicalPath));

    for (const snapshot of proposal.resourceSnapshots) {
      for (const entry of snapshot.tree?.entries ?? []) {
        const path =
          snapshot.canonicalPath + (entry.relativePath === "" ? "" : "/" + entry.relativePath);

        this.entries.set(path, entry.kind);
      }
    }
  }

  text(uri: string, edits: readonly (typeof LanguageTextEdit.Type)[], version: number | null) {
    const path = filePath(uri, this.root);
    const doc = this.documents.get(path);

    if (!doc || (version !== null && version !== doc.version))
      throw new Error("Text document version is stale or missing.");
    this.documents.set(path, {
      ...doc,
      text: formattedText(doc.text, edits, this.encoding),
      dirty: true,
    });
    this.touched.add(path);
  }

  private remove(path: string) {
    for (const key of this.documents.keys())
      if (within(path, key)) {
        this.documents.delete(key);
        this.touched.add(key);
      }

    for (const key of this.entries.keys()) if (within(path, key)) this.entries.delete(key);
  }

  private destination(path: string, operation: typeof LanguageResourceOperation.Type): boolean {
    if (!this.entries.has(path)) return true;

    if (operation.kind === "delete") return true;

    if (operation.options?.overwrite) return true;

    if (operation.options?.ignoreIfExists) return false;
    throw new Error("Resource destination exists without overwrite permission.");
  }

  resource(operation: typeof LanguageResourceOperation.Type) {
    if (operation.kind === "rename") return this.rename(operation);
    const path = filePath(operation.uri, this.root);

    if (operation.kind === "delete") {
      if (!this.entries.has(path) && !operation.options?.ignoreIfNotExists)
        throw new Error("Delete source is absent.");

      if (
        this.entries.get(path) === "directory" &&
        !operation.options?.recursive &&
        [...this.entries.keys()].some((name) => name !== path && within(path, name))
      )
        throw new Error("Deleting a nonempty directory requires recursive permission.");
      this.remove(path);

      return;
    }

    if (!this.destination(path, operation)) return;
    this.remove(path);
    this.entries.set(path, "file");
    this.documents.set(path, {
      uri: operation.uri,
      canonicalPath: path,
      sourcePath: null,
      diskText: "",
      diskVersion: null,
      buffer: null,
      text: "",
      version: 0,
      draftRevision: 0,
      dirty: false,
    });
    this.touched.add(path);
  }

  private rename(operation: Extract<typeof LanguageResourceOperation.Type, { kind: "rename" }>) {
    const from = filePath(operation.oldUri, this.root);
    const to = filePath(operation.newUri, this.root);

    if (within(from, to) || within(to, from)) throw new Error("Self-containing rename.");

    if (!this.entries.has(from)) throw new Error("Rename source is absent.");

    if (!this.destination(to, operation)) return;
    const moving = [...this.documents.values()].filter((doc) => within(from, doc.canonicalPath));
    const entries = [...this.entries].filter(([path]) => within(from, path));
    this.remove(to);
    this.remove(from);

    for (const [path, kind] of entries) this.entries.set(to + path.slice(from.length), kind);

    for (const doc of moving) {
      const path = to + doc.canonicalPath.slice(from.length);
      this.documents.set(path, {
        ...doc,
        canonicalPath: path,
        uri: new URL("file://" + path).href,
      });
      this.touched.add(path);
    }
  }

  result() {
    const documents = [...this.documents.values()].map((doc) => {
      const original = this.originals.find((item) => item.canonicalPath === doc.sourcePath);

      if (!original || original.text === doc.text) return doc;
      const version = original.version + 1;
      const draftRevision = original.draftRevision + 1;

      return {
        ...doc,
        version,
        draftRevision,
        buffer: doc.buffer === null ? null : { version, draftRevision, text: doc.text },
      };
    });

    return { documents, touched: [...this.touched] };
  }
}
