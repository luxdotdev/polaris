/**
 * Share, the owner's sheet (DESIGN.md "Shared Sessions", Share): a GitHub login, a role, and what
 * sharing allows, then the Invite on the Account Server and the Share on the Host. Mounted only
 * while open: it reads the accounts and relay providers.
 */
import type { HarnessKind, PlanLimit, ShareRole } from "@polaris/protocol";
import { mobileType } from "@polaris/ui/tokens";
import { Effect, Predicate, Stream } from "effect";
import { useEffect, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { type AccountsOutcome, usePolarisAccounts } from "../accounts/AccountsProvider.tsx";
import { useRelay } from "../relay/RelayProvider.tsx";
import type { HostConnection } from "../runtime/hostConnection.ts";
import { InstrumentSheet, SheetHeader } from "../sheet/index.tsx";
import { themedStyles, useTheme } from "../theme/index.ts";
import { CHROME_TEXT_SCALE, CONTENT_TEXT_SCALE } from "../theme/textScale.ts";
import { harnessLogin, loginWarning } from "./login.ts";
import { roleWord } from "./model.ts";
import {
  firstName,
  loginOf,
  type ShareCalls,
  shareConsequences,
  shareFailure,
  shareNotTaken,
  shareSession,
} from "./share.ts";

const ROLES: ReadonlyArray<ShareRole> = ["contributor", "commenter"];

const outcome = async <A,>(pending: Promise<AccountsOutcome<A>>) => {
  const result = await pending;

  if (!result.ok) throw new Error(result.message);

  return result.value;
};

const useShareCalls = (connection: HostConnection): ShareCalls => {
  const { call } = usePolarisAccounts();

  return {
    person: (accountId, login) => outcome(call((a) => a.person(accountId, login))),
    invite: (accountId, invite) => outcome(call((a) => a.createInvite(accountId, invite))),
    create: (share) =>
      connection.run((client) =>
        client["shares.create"](share).pipe(
          Effect.asVoid,
          Effect.mapError((error) => new Error(shareFailure(error, connection.name))),
          Effect.catchDefect(() => Effect.fail(new Error(shareNotTaken(connection.name))))
        )
      ),
  };
};

/** How long the sheet listens for the Host's Plan Limits, which `usage.watch` sends first. */
const LIMITS_MS = 1500;

/** The Host's Plan Limits, once, for what the Harness login is; empty until they arrive. */
const usePlanLimits = (connection: HostConnection) => {
  const [limits, setLimits] = useState<ReadonlyArray<PlanLimit>>([]);

  useEffect(() => {
    let open = true;

    void connection
      .run((client) => client["usage.watch"]({}).pipe(Stream.timeout(LIMITS_MS), Stream.runCollect))
      .then((items) => {
        const found = items.flatMap((item) =>
          Predicate.isTagged(item, "PlanLimitChanged") ? [item.limit] : []
        );

        if (open) setLimits(found);
      })
      .catch(() => undefined);

    return () => {
      open = false;
    };
  }, [connection]);

  return limits;
};

const Warning = ({ text }: { readonly text: string }) => {
  const styles = useStyles();

  return (
    <View style={styles.warning} accessibilityRole="text">
      <Text style={styles.body} maxFontSizeMultiplier={CONTENT_TEXT_SCALE}>
        {text}
      </Text>
    </View>
  );
};

const Body = ({ text }: { readonly text: string }) => {
  const styles = useStyles();

  return (
    <Text style={styles.body} maxFontSizeMultiplier={CONTENT_TEXT_SCALE}>
      {text}
    </Text>
  );
};

const ShareForm = ({
  connection,
  sessionId,
  title,
  harness,
}: {
  readonly connection: HostConnection;
  readonly sessionId: string;
  readonly title: string;
  readonly harness: HarnessKind;
}) => {
  const styles = useStyles();
  const { colours } = useTheme();
  const accounts = usePolarisAccounts();
  const relay = useRelay();
  const calls = useShareCalls(connection);
  const [login, setLogin] = useState("");
  const [role, setRole] = useState<ShareRole>("contributor");
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const limits = usePlanLimits(connection);
  const account = accounts.state?.accounts.find((held) => held.signedOutAt === null);
  const host = relay.hosts.find((linked) => linked.hostId === connection.hostId);

  if (account === undefined)
    return (
      <View style={styles.form}>
        <Body text="Sign in to a Polaris account in Settings to share sessions." />
      </View>
    );

  if (host === undefined)
    return (
      <View style={styles.form}>
        <Body
          text={`${connection.name} isn't linked through the relay, so it can't be shared from this phone.`}
        />
      </View>
    );

  const named = loginOf(login);
  const warning = loginWarning(role, harnessLogin(limits, harness), harness);
  const shown = named === "" ? "They" : `@${named}`;

  const share = async () => {
    setBusy(true);

    const via = {
      name: host.hostName,
      relayAddress: host.hostAddress,
      noiseKey: host.hostNoiseKey,
      relayUrl: host.relayUrl,
    };

    try {
      const person = await shareSession(
        { account, host: via, sessionId, title, login, role },
        calls
      );

      setSaid(`Invited ${firstName(person)} as a ${roleWord(role).toLowerCase()}.`);
      setLogin("");
    } catch (error) {
      setSaid(error instanceof Error ? error.message : "The invite wasn't sent");
    }

    setBusy(false);
  };

  return (
    <View style={styles.form}>
      <TextInput
        style={styles.input}
        value={login}
        onChangeText={setLogin}
        placeholder="GitHub login"
        placeholderTextColor={colours.textFaint}
        autoCapitalize="none"
        autoCorrect={false}
        maxFontSizeMultiplier={CONTENT_TEXT_SCALE}
      />
      <View style={styles.roles} accessibilityRole="radiogroup">
        {ROLES.map((each) => (
          <Pressable
            key={each}
            accessibilityRole="radio"
            accessibilityState={{ selected: each === role }}
            onPress={() => setRole(each)}
            style={[styles.role, each === role ? styles.roleOn : null]}
          >
            <Text style={styles.roleLabel} maxFontSizeMultiplier={CHROME_TEXT_SCALE}>
              {roleWord(each)}
            </Text>
          </Pressable>
        ))}
      </View>
      {shareConsequences(shown, role, harness).map((line) => (
        <Body key={line} text={line} />
      ))}
      {warning === null ? null : <Warning text={warning} />}
      <Body text={`Sharing as @${account.login}. The invite lasts 7 days.`} />
      {said === null ? null : <Body text={said} />}
      <Pressable
        accessibilityRole="button"
        disabled={busy || named === ""}
        onPress={() => void share()}
        style={[styles.button, busy || named === "" ? styles.disabled : null]}
      >
        <Text style={styles.buttonLabel} maxFontSizeMultiplier={CHROME_TEXT_SCALE}>
          {busy ? "Sharing…" : "Share"}
        </Text>
      </Pressable>
    </View>
  );
};

export const ShareSheet = ({
  open,
  connection,
  sessionId,
  title,
  harness,
  onClose,
}: {
  readonly open: boolean;
  readonly connection: HostConnection | null;
  readonly sessionId: string;
  readonly title: string;
  readonly harness: HarnessKind;
  readonly onClose: () => void;
}) => {
  if (!open || connection === null) return null;

  return (
    <InstrumentSheet open onClose={onClose}>
      <SheetHeader title="Share" onClose={onClose} />
      <ShareForm connection={connection} sessionId={sessionId} title={title} harness={harness} />
    </InstrumentSheet>
  );
};

const useStyles = themedStyles((c) => ({
  form: { gap: 12, paddingHorizontal: 16, paddingBottom: 20 },
  body: { ...mobileType.callout, color: c.textDefault },
  warning: {
    backgroundColor: c.panel,
    borderWidth: 1,
    borderColor: c.hairline,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  input: {
    ...mobileType.body,
    color: c.textStrong,
    backgroundColor: c.panel,
    borderWidth: 1,
    borderColor: c.hairline,
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 44,
  },
  roles: { flexDirection: "row", gap: 8 },
  role: {
    height: 32,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: c.hairline,
    justifyContent: "center",
  },
  roleOn: { borderColor: c.starlight },
  roleLabel: { ...mobileType.subhead, color: c.textDefault },
  button: {
    alignSelf: "flex-start",
    height: 40,
    paddingHorizontal: 20,
    borderRadius: 999,
    backgroundColor: c.starlight,
    justifyContent: "center",
  },
  disabled: { opacity: 0.45 },
  buttonLabel: { ...mobileType.label, color: c.ground },
}));
