import * as P from "@polaris/protocol";
import { Predicate, Schema } from "effect";

export interface LanguageFeedbackSource {
  readonly hostId: P.HostId;
  readonly hostName: string;
  readonly languageName: string;
  readonly toolId: string;
}

/** E1/G2 feed confirmed items here; it neither starts tooling nor infers runtime readiness. */
export class LanguageInstallFeedback {
  private readonly jobs = new Map<
    string,
    { sequence: number; phase: P.LanguageInstallProgress["phase"] }
  >();
  constructor(private readonly notify: (title: string, message: string) => void) {}

  progress(source: LanguageFeedbackSource, progress: typeof P.LanguageInstallProgress.Type) {
    const valid = Schema.decodeUnknownSync(P.LanguageInstallProgress)(progress);

    if (valid.hostId !== source.hostId || valid.toolId !== source.toolId) return;
    const key = `${valid.hostId}:${valid.jobId}`;

    const previous = this.jobs.get(key);

    if ((previous?.sequence ?? -1) >= valid.sequence) return;
    this.jobs.delete(key);
    this.jobs.set(key, { sequence: valid.sequence, phase: valid.phase });

    if (this.jobs.size > 128) this.jobs.delete(this.jobs.keys().next().value ?? "");

    if (previous?.phase === valid.phase) return;
    this.notify(
      `${source.languageName} · ${source.hostName}`,
      `${valid.phase} · ${valid.version}${valid.message ? ` · ${valid.message}` : ""}`
    );
  }

  prerequisite(source: LanguageFeedbackSource, availability: P.LanguageAvailability) {
    const valid = Schema.decodeUnknownSync(P.LanguageAvailability)(availability);

    if (
      valid.hostId !== source.hostId ||
      valid.toolId !== source.toolId ||
      !Predicate.isTagged(valid.preflight, "Blocked")
    )
      return;
    this.notify(
      `${source.languageName} · ${source.hostName}`,
      `${valid.preflight.message} · Open Language integrations to refresh requirements. Syntax remains available.`
    );
  }

  dispose() {
    this.jobs.clear();
  }
}
