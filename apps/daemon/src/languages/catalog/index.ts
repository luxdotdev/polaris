import { Schema } from "effect";
import data from "./catalog.json";
import { Catalog } from "./model";

export const catalog = Schema.decodeUnknownSync(Catalog)(data);

export { Artifact, Catalog, Integration, Platform, Requirement, Tool } from "./model";

export { selectArtifact, preflight, versionSatisfies } from "./selection";

export { verifyIntegrity, auditArtifact, safeArchivePath } from "./verification";
