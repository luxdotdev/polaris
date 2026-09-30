/** The fact line under "Nothing needs you" (Paper 5SH-1: "4 sessions working on 2 hosts"). */
import { plural } from "../../../shell/copy.ts";
import type { HostModel } from "../../../store/hostModel.ts";

export interface QuietInput {
  readonly hosts: number;
  readonly models: ReadonlyArray<HostModel>;
}

export const quietFact = ({ hosts, models }: QuietInput): string => {
  const sessions = models.flatMap((m) =>
    [...m.sessions.values()].filter((e) => e.session.state !== "archived")
  );

  const working = sessions.filter((e) => e.session.state === "working").length;
  const on = `on ${plural(hosts, "host")}`;

  if (working > 0) return `${plural(working, "session")} working ${on}`;

  if (sessions.length > 0) return `${plural(sessions.length, "session")} ${on}, none waiting`;

  return "No agent sessions yet";
};
