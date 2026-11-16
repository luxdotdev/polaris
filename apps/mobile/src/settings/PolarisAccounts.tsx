/**
 * Settings → Polaris accounts (DESIGN.md, Shared Sessions → Accounts): each Polaris account with
 * its Account Server and commit email, and Add Polaris account, on Polaris Cloud unless the user
 * names their own server. GitHub accounts for pull requests are a separate thing.
 */
import type { DeviceSignIn } from "@polaris/client/accounts";
import { mobileFont, mobileType } from "@polaris/ui/tokens";
import { ActionSheetIOS, Alert, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import {
  type AccountRow,
  accountRows,
  type PolarisAccounts,
  serverName,
} from "../accounts/index.ts";
import { useTheme } from "../theme";
import { CONTENT_TEXT_SCALE } from "../theme/textScale.ts";

const report = (title: string) => (failure: string | null) => {
  if (failure !== null) Alert.alert(title, failure);
};

const chooseEmail = (accounts: PolarisAccounts, row: AccountRow) =>
  ActionSheetIOS.showActionSheetWithOptions(
    {
      title: "Commit email",
      message: `Work you do in shared sessions as ${row.login} is credited to this address`,
      options: [...row.emails, "Cancel"],
      cancelButtonIndex: row.emails.length,
    },
    (index) => {
      const email = row.emails[index];

      if (email !== undefined)
        void accounts.setCommitEmail(row.id, email).then(report("Couldn't change the email"));
    }
  );

const accountActions = (accounts: PolarisAccounts, row: AccountRow) => {
  const actions: ReadonlyArray<readonly [string, () => void]> = [
    ...(row.emails.length > 0
      ? [["Commit email…", () => chooseEmail(accounts, row)] as const]
      : []),
    ...(row.signedOut
      ? [
          [
            "Sign in again",
            () => void accounts.signIn(row.origin).then(report("Couldn't sign in")),
          ] as const,
        ]
      : []),
    ["Sign out", () => void accounts.signOut(row.id).then(report("Couldn't sign out"))] as const,
  ];

  ActionSheetIOS.showActionSheetWithOptions(
    {
      title: `${row.login} · ${row.server}`,
      options: [...actions.map(([label]) => label), "Cancel"],
      destructiveButtonIndex: actions.length - 1,
      cancelButtonIndex: actions.length,
    },
    (index) => actions[index]?.[1]()
  );
};

const askForServer = (then: (server: string) => void) =>
  Alert.prompt(
    "Your own server",
    "The Account Server's https address, from whoever runs it for your team",
    [
      { text: "Cancel", style: "cancel" },
      { text: "Continue", onPress: (text?: string) => text?.trim() && then(text.trim()) },
    ],
    "plain-text",
    "",
    "url"
  );

const addAccount = (accounts: PolarisAccounts) => {
  const signIn = (server?: string) =>
    void (accounts.canUseBrowser ? accounts.signIn(server) : accounts.signInWithCode(server)).then(
      report("Couldn't sign in")
    );

  ActionSheetIOS.showActionSheetWithOptions(
    {
      title: "Add Polaris account",
      message: "Signs in with GitHub. Polaris accounts are for sharing sessions with teammates",
      options: ["Polaris Cloud", "Use your own server", "Use a code instead", "Cancel"],
      cancelButtonIndex: 3,
    },
    (index) => {
      if (index === 0) signIn();

      if (index === 1) askForServer(signIn);

      if (index === 2) void accounts.signInWithCode().then(report("Couldn't get a code"));
    }
  );
};

const codeActions = (accounts: PolarisAccounts, flow: DeviceSignIn) =>
  ActionSheetIOS.showActionSheetWithOptions(
    {
      title: `Code ${flow.userCode}`,
      options: ["Open the sign-in page", "Stop signing in", "Cancel"],
      destructiveButtonIndex: 1,
      cancelButtonIndex: 2,
    },
    (index) => {
      if (index === 0) void Linking.openURL(flow.verificationUri);

      if (index === 1) void accounts.cancelCode();
    }
  );

const Line = ({
  initial,
  title,
  line,
  last,
  onPress,
}: {
  readonly initial: string;
  readonly title: string;
  readonly line: string;
  readonly last: boolean;
  readonly onPress: () => void;
}) => {
  const { colours } = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${line}`}
      onPress={onPress}
      style={[
        styles.row,
        last ? null : { borderBottomColor: colours.hairline, borderBottomWidth: 1 },
      ]}
    >
      <View style={[styles.tile, { backgroundColor: colours.raised }]}>
        <Text style={[styles.initial, { color: colours.textDefault }]} maxFontSizeMultiplier={1}>
          {initial}
        </Text>
      </View>
      <View style={styles.text}>
        <Text
          style={[styles.title, { color: colours.textStrong }]}
          maxFontSizeMultiplier={CONTENT_TEXT_SCALE}
          numberOfLines={1}
        >
          {title}
        </Text>
        <Text
          style={[styles.line, { color: colours.textSubtle }]}
          maxFontSizeMultiplier={CONTENT_TEXT_SCALE}
          numberOfLines={2}
        >
          {line}
        </Text>
      </View>
    </Pressable>
  );
};

/** The code row while a device-code sign-in waits, or why it stopped. */
const codeLine = (flow: DeviceSignIn) =>
  flow.failure ?? `Enter it on ${serverName(flow.server)} in a signed-in browser`;

export const PolarisAccountsPanel = ({ accounts }: { readonly accounts: PolarisAccounts }) => {
  const { colours } = useTheme();
  const { state } = accounts;

  if (state === null) return null;
  const rows = accountRows(state.accounts);
  const flow = state.deviceSignIn;

  return (
    <View style={[styles.panel, { backgroundColor: colours.panel, borderColor: colours.hairline }]}>
      <Text
        style={[styles.kicker, { color: colours.textSubtle }]}
        accessibilityRole="header"
        accessibilityLabel="Polaris accounts"
        maxFontSizeMultiplier={CONTENT_TEXT_SCALE}
      >
        POLARIS ACCOUNTS
      </Text>
      {rows.map((row) => (
        <Line
          key={row.id}
          initial={row.initial}
          title={row.login}
          line={`${row.server} · ${row.line}`}
          last={false}
          onPress={() => accountActions(accounts, row)}
        />
      ))}
      {flow === null ? null : (
        <Line
          initial="#"
          title={`Code ${flow.userCode}`}
          line={codeLine(flow)}
          last={false}
          onPress={() => codeActions(accounts, flow)}
        />
      )}
      <Line
        initial="+"
        title="Add Polaris account"
        line={
          rows.length === 0
            ? "For sharing sessions with teammates"
            : "Polaris Cloud or your own server"
        }
        last
        onPress={() => addAccount(accounts)}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  panel: { borderRadius: 22, borderWidth: 1, paddingHorizontal: 12, paddingTop: 12 },
  kicker: {
    fontFamily: mobileFont.mono,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "500",
    letterSpacing: 0.88,
    paddingHorizontal: 4,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 13,
    paddingHorizontal: 4,
  },
  tile: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  initial: { ...mobileType.footnote, fontWeight: "500" },
  text: { flex: 1, minWidth: 0, gap: 1 },
  title: { ...mobileType.heading },
  line: { ...mobileType.footnote },
});
