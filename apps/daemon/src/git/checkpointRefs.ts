export const CHECKPOINT_REF_PREFIX = "refs/polaris/checkpoints/";

export const ENCODED_CHECKPOINT_REF_PREFIX = "refs/polaris/checkpoints-v2/";

interface CheckpointIdentity {
  readonly sessionId: string;
  readonly turnId: string;
  readonly label: "before" | "after";
}

const legacySafe = (sessionId: string, turnId: string): boolean => {
  const path = `${sessionId}/${turnId}`;

  if (sessionId === "" || turnId === "" || turnId.includes("/") || !path.isWellFormed())
    return false;

  if (
    path.split("").some((c) => c.charCodeAt(0) <= 32 || c.charCodeAt(0) === 127) ||
    /[~^:?*[\\]/.test(path) ||
    path.includes("..") ||
    path.includes("@{")
  )
    return false;

  return path
    .split("/")
    .every(
      (part) =>
        part !== "" &&
        !part.startsWith(".") &&
        !part.endsWith(".lock") &&
        Buffer.byteLength(part) <= 255
    );
};

// UTF-16 preserves opaque JS identities; bounded hex components also fit Git's filesystem paths.
const encode = (id: string): string =>
  Buffer.from(id, "utf16le")
    .toString("hex")
    .match(/.{1,128}/g)
    ?.join("/") ?? "-";

const decode = (parts: ReadonlyArray<string>): string | null => {
  if (parts.length === 1 && parts[0] === "-") return "";

  if (parts.length === 0 || parts.some((part) => !/^(?:[a-f0-9]{4}){1,32}$/.test(part)))
    return null;

  return Buffer.from(parts.join(""), "hex").toString("utf16le");
};

/** Existing valid refs stay readable; unsafe identities use a collision-free reversible namespace. */
export const checkpointRef = (
  sessionId: string,
  turnId: string,
  label: "before" | "after"
): string =>
  legacySafe(sessionId, turnId)
    ? `${CHECKPOINT_REF_PREFIX}${sessionId}/${turnId}/${label}`
    : `${ENCODED_CHECKPOINT_REF_PREFIX}${encode(sessionId)}/t/${encode(turnId)}/${label}`;

export const parseCheckpointRef = (ref: string): CheckpointIdentity | null => {
  const encoded = ref.startsWith(ENCODED_CHECKPOINT_REF_PREFIX);

  if (!encoded && !ref.startsWith(CHECKPOINT_REF_PREFIX)) return null;
  const prefix = encoded ? ENCODED_CHECKPOINT_REF_PREFIX : CHECKPOINT_REF_PREFIX;
  const parts = ref.slice(prefix.length).split("/");
  const label = parts.pop();

  if (label !== "before" && label !== "after") return null;

  if (encoded) {
    const marker = parts.indexOf("t");

    if (marker < 1) return null;
    const sessionId = decode(parts.slice(0, marker));
    const turnId = decode(parts.slice(marker + 1));

    return sessionId === null || turnId === null ? null : { sessionId, turnId, label };
  }

  const turnId = parts.pop();
  const sessionId = parts.join("/");

  return turnId === undefined || turnId === "" || sessionId === ""
    ? null
    : { sessionId, turnId, label };
};
