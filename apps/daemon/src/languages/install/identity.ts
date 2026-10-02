import { Schema } from "effect";
import type { ExactArtifact } from "./types.ts";
import { digest } from "./validation.ts";

const JsonArray = Schema.Array(Schema.Json);

function canonical(value: typeof Schema.Json.Type): typeof Schema.Json.Type {
  if (Schema.is(JsonArray)(value)) return value.map(canonical);

  if (Schema.is(Schema.JsonObject)(value))
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key]!)])
    );

  return value;
}

export const artifactIdentity = (
  exact: Pick<ExactArtifact, "hostId" | "platform" | "descriptor" | "artifact">
) =>
  digest(
    JSON.stringify(
      canonical({
        hostId: exact.hostId,
        platform: exact.platform,
        descriptor: exact.descriptor,
        artifactId: exact.artifact.id,
      })
    )
  );
