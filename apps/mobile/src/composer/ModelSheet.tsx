/**
 * The model sheet the composer's chip opens (DESIGN.md, Mobile chrome redesign: Composer): the
 * session's Harness, its Model and effort, and the permission mode, on an instrument sheet.
 */
import type { Model } from "@polaris/protocol";
import { mobileType } from "@polaris/ui/tokens";
import type { ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { InstrumentSheet, SheetHeader, Well } from "../sheet";
import { type MobileColours, useTheme } from "../theme";
import { harnessName } from "../thread/labels.ts";
import { effortFor } from "./modelSheet.ts";
import type { ModelSheetInput } from "./useModelSheet.ts";

const Section = ({ title, children }: { readonly title: string; readonly children: ReactNode }) => {
  const { colours } = useTheme();

  return (
    <View style={styles.section}>
      <Text style={[styles.kicker, { color: colours.textFaint }]}>{title}</Text>
      <Well>{children}</Well>
    </View>
  );
};

const Option = ({
  title,
  detail,
  on,
  disabled = false,
  onPress,
}: {
  readonly title: string;
  readonly detail: string | null;
  readonly on: boolean;
  readonly disabled?: boolean;
  readonly onPress: () => void;
}) => {
  const { colours } = useTheme();

  return (
    <Pressable
      style={[styles.row, disabled ? styles.dim : null]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ selected: on, disabled }}
    >
      <View style={styles.rowText}>
        <Text style={[styles.title, { color: colours.textStrong }]}>{title}</Text>
        {detail === null ? null : (
          <Text style={[styles.detail, { color: colours.textSubtle }]} numberOfLines={2}>
            {detail}
          </Text>
        )}
      </View>
      <Text style={[styles.check, { color: colours.starlightText }, on ? null : styles.hidden]}>
        ✓
      </Text>
    </Pressable>
  );
};

const Efforts = ({ input, model }: { readonly input: ModelSheetInput; readonly model: Model }) => {
  const { colours } = useTheme();
  const current = effortFor(model, input.effort);
  const locked = input.change.kind === "blocked";

  return (
    <View style={styles.efforts}>
      {model.efforts.map((effort) => {
        const on = effort === current;

        return (
          <Pressable
            key={effort}
            disabled={locked || on}
            onPress={() => input.pickModel(model, effort)}
            accessibilityRole="button"
            accessibilityState={{ selected: on, disabled: locked }}
            style={[
              styles.effort,
              { borderColor: colours.hairline },
              on ? { backgroundColor: colours.fillSelected } : null,
              locked && !on ? styles.dim : null,
            ]}
          >
            <Text
              style={[styles.effortLabel, { color: on ? colours.textStrong : colours.textDefault }]}
            >
              {effort}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
};

const notes = (input: ModelSheetInput, colours: MobileColours) => {
  const lines = [
    input.change.kind === "blocked" ? input.change.reason : input.note,
    input.error,
  ].filter((line): line is string => line !== null);

  return lines.map((line) => (
    <Text
      key={line}
      style={[
        styles.note,
        { color: line === input.error ? colours.failedText : colours.textSubtle },
      ]}
    >
      {line}
    </Text>
  ));
};

export const ModelSheet = ({ input }: { readonly input: ModelSheetInput }) => {
  const { colours } = useTheme();
  const close = () => input.setOpen(false);
  const locked = input.change.kind === "blocked";

  return (
    <InstrumentSheet open={input.open} onClose={close} detents={["medium", "large"]}>
      <SheetHeader title={input.label} kicker="Model" onClose={close} />
      <ScrollView contentContainerStyle={styles.body}>
        <Section title="HARNESS">
          <Option title={harnessName(input.harness)} detail={null} on onPress={() => undefined} />
          {input.forkTo.map((option) => (
            <Option
              key={option.kind}
              title={option.name}
              detail={`Fork on ${option.name}`}
              on={false}
              onPress={() => input.forkOn(option.kind)}
            />
          ))}
        </Section>
        <Section title="MODEL">
          {input.models.length === 0 ? (
            <Text style={[styles.note, { color: colours.textSubtle }]}>
              {input.label} · this harness doesn't list its models
            </Text>
          ) : (
            input.models.map((model) => (
              <Option
                key={model.id}
                title={model.name}
                detail={model.description}
                on={model.id === input.model?.id}
                disabled={locked}
                onPress={() => {
                  if (model.id !== input.model?.id) input.pickModel(model, input.effort);
                }}
              />
            ))
          )}
          {notes(input, colours)}
        </Section>
        {input.model === null || input.model.efforts.length === 0 ? null : (
          <Section title="EFFORT">
            <Efforts input={input} model={input.model} />
          </Section>
        )}
        <Section title="PERMISSIONS">
          {input.permissions.map((option) => (
            <Option
              key={option.mode}
              title={option.label}
              detail={option.detail}
              on={option.mode === input.permission}
              onPress={() => input.pickPermission(option.mode)}
            />
          ))}
        </Section>
      </ScrollView>
    </InstrumentSheet>
  );
};

const styles = StyleSheet.create({
  body: { gap: 20, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 40 },
  section: { gap: 8 },
  kicker: { ...mobileType.index, fontSize: 11, letterSpacing: 0.8 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 48,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  rowText: { flex: 1, gap: 2 },
  title: { ...mobileType.heading, fontWeight: "500" },
  detail: { ...mobileType.footnote },
  check: { ...mobileType.label },
  hidden: { opacity: 0 },
  dim: { opacity: 0.45 },
  note: { ...mobileType.footnote, paddingHorizontal: 14, paddingVertical: 10 },
  efforts: { flexDirection: "row", flexWrap: "wrap", gap: 8, padding: 12 },
  effort: {
    height: 32,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  effortLabel: { ...mobileType.subhead, fontWeight: "500" },
});
