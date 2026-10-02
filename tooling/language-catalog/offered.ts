import type { Catalog, Integration, Tool } from "../../apps/daemon/src/languages/catalog/model";

export const offeredTools = (data: Catalog): ReadonlyArray<Tool> =>
  data.tools.filter((tool) => tool.disposition === "offered");

const artifactFailures = (data: Catalog): ReadonlyArray<string> =>
  offeredTools(data).flatMap((tool) => [
    ...(tool.artifacts.length === 0 ? [`${tool.id}: missing-artifacts`] : []),
    ...tool.artifacts.flatMap((artifact) =>
      artifact.format === "npm" && !artifact.bundle ? [`${tool.id}: missing-npm-bundle`] : []
    ),
  ]);

const companionFailures = (
  integration: Integration,
  managed: ReadonlyArray<string>
): ReadonlyArray<string> =>
  (integration.developerCompanions ?? []).flatMap((companion) => [
    ...(managed.includes(companion.id)
      ? [`${integration.id}: duplicate-managed-companion:${companion.id}`]
      : []),
    ...(integration.providers.some((provider) => provider.id === companion.provider)
      ? []
      : [`${integration.id}: unknown-companion-provider:${companion.provider}`]),
  ]);

export const referenceFailures = (data: Catalog): ReadonlyArray<string> => {
  const offered = new Set(offeredTools(data).map((tool) => tool.id));
  const failures = [...artifactFailures(data)];

  for (const integration of data.integrations) {
    const managed = [
      ...integration.providers.map((provider) => provider.tool),
      ...integration.companions,
      ...(integration.formatter.source === "managed" ? [integration.formatter.tool] : []),
    ];

    for (const id of managed)
      if (!offered.has(id)) failures.push(`${integration.id}: unoffered-reference:${id}`);

    failures.push(...companionFailures(integration, managed));

    if (integration.formatter.source === "managed") continue;

    const declared = integration.providers.some((provider) =>
      data.tools
        .find((tool) => tool.id === provider.tool)
        ?.requirements.some(
          (requirement) =>
            requirement.id === integration.formatter.tool && requirement.scope === "formatter"
        )
    );

    if (!declared) failures.push(`${integration.id}: undeclared-external-formatter`);
  }

  return failures;
};
