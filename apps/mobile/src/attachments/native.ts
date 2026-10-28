/** The phone's image cache on disk: `<cache>/attachments/<id>`, which iOS may clear. */
import type { AttachmentId } from "@polaris/protocol";
import { Directory, File, Paths } from "expo-file-system";
import type { ImageCache } from "./load.ts";

const folder = () => {
  const dir = new Directory(Paths.cache, "attachments");

  dir.create({ intermediates: true, idempotent: true });

  return dir;
};

const fileOf = (id: AttachmentId) => new File(folder(), id);

export const diskCache: ImageCache = {
  uri: (id) => {
    const file = fileOf(id);

    return file.exists ? file.uri : null;
  },
  write: async (id, bytes) => {
    const file = fileOf(id);

    await file.write(bytes);

    return file.uri;
  },
};

/** An image the phone staged itself, kept so its message shows it at once. */
export const keepStaged = (id: AttachmentId, uri: string): Promise<void> => {
  const file = fileOf(id);

  return file.exists ? Promise.resolve() : new File(uri).copy(file).catch(() => undefined);
};
