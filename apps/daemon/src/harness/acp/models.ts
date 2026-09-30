/**
 * Models and effort through ACP session config options: the `select` option in
 * the "model" category is the Model, the one in "thought_level" the effort.
 * A Harness that declares neither lists no Models and can't switch.
 */
import { Model } from "@polaris/protocol";
import { Predicate } from "effect";
import type * as P from "./protocol.ts";

type SelectOption = {
  readonly value: string;
  readonly name: string;
  readonly description?: string | null | undefined;
};

/** A select option's choices, groups flattened. */
export const choices = (option: P.ConfigOption): ReadonlyArray<SelectOption> =>
  (option.options ?? []).flatMap((entry) => ("group" in entry ? entry.options : [entry]));

const select = (options: ReadonlyArray<P.ConfigOption>, category: string) =>
  options.find((option) => option.category === category && option.type === "select");

export const modelOption = (options: ReadonlyArray<P.ConfigOption>) => select(options, "model");

export const effortOption = (options: ReadonlyArray<P.ConfigOption>) =>
  select(options, "thought_level");

/**
 * The Models a session offers. ACP gives the effort choices of the current
 * Model only, so every Model lists those.
 */
export const toModels = (options: ReadonlyArray<P.ConfigOption>): ReadonlyArray<Model> => {
  const model = modelOption(options);

  if (model === undefined) return [];
  const effort = effortOption(options);
  const efforts = effort === undefined ? [] : choices(effort).map((c) => c.value);

  const defaultEffort =
    effort !== undefined && Predicate.isString(effort.currentValue) ? effort.currentValue : null;

  return choices(model).map(
    (choice) =>
      new Model({
        id: choice.value,
        name: choice.name,
        description: choice.description ?? null,
        efforts,
        defaultEffort,
        isDefault: choice.value === model.currentValue,
      })
  );
};

/**
 * The `session/set_config_option` calls that move a session to `value`: none
 * when it's already there or the Harness doesn't offer the choice.
 */
export const configChange = (
  option: P.ConfigOption | undefined,
  value: string | null
): { readonly configId: string; readonly value: string } | null => {
  if (option === undefined || value === null || option.currentValue === value) return null;

  return choices(option).some((c) => c.value === value) ? { configId: option.id, value } : null;
};
