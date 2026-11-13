/**
 * The buffer's lines against the file on disk: `git.blame` reads the disk, so an unsaved edit
 * moves lines. Edits since the disk text was last seen map a buffer line back to its disk line.
 */
import { ChangeSet, type Text } from "@codemirror/state";

export class DiskLines {
  private disk: Text;
  private since: ChangeSet;
  private version: string | null = null;

  constructor(doc: Text) {
    this.disk = doc;
    this.since = ChangeSet.empty(doc.length);
  }

  edit(changes: ChangeSet) {
    this.since = this.since.compose(changes);
  }

  /** A new disk version (a save, a reload): the buffer as it is now is the disk's text. */
  sync(version: string, doc: Text) {
    if (version === this.version) return;
    this.version = version;
    this.disk = doc;
    this.since = ChangeSet.empty(doc.length);
  }

  /** Whether `from`–`to` in the buffer was typed since the disk text: not on disk yet. */
  edited(from: number, to: number) {
    let hit = false;

    this.since.iterChangedRanges((_fromA, _toA, fromB, toB) => {
      if (fromB <= to && toB >= from) hit = true;
    });

    return hit;
  }

  /** The disk line at buffer position `from`; null when a restored draft hides how they differ. */
  lineOf(from: number, dirty: boolean): number | null {
    if (dirty && this.since.empty) return null;

    return this.disk.lineAt(this.since.invertedDesc.mapPos(from)).number;
  }
}
