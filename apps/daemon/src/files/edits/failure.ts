import { Schema } from "effect";

export class FileEditFailure extends Schema.TaggedError<FileEditFailure>()("FileEditFailure", {
  code: Schema.Literals([
    "invalid-operation",
    "disk-conflict",
    "unsupported-resource",
    "owner-mismatch",
    "stale-proposal",
    "drafts-not-durable",
    "operation-not-found",
    "receipt-conflict",
    "cancelled",
    "invalid-root",
  ]),
  message: Schema.String,
}) {}
