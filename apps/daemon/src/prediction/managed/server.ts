/**
 * The managed model server (ADR 0048): one per Daemon, driven by `machine.ts`. It downloads
 * the build and the model on setup, starts the server on demand, restarts it with backoff,
 * stops it after 15 idle minutes and reports every change to its watchers.
 */
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { ManagedServerPhase, type ManagedServerStatus } from "@polaris/protocol";
import { Match } from "effect";
import {
  pickModel,
  platformAsset,
  serverArgs,
  type ManagedModel,
  type PinnedFile,
} from "./catalog.ts";
import {
  checkSpace,
  downloadFile,
  freeBytes,
  isDownloaded,
  ManagedSetupError,
  partPath,
  type Fetcher,
} from "./download.ts";
import { decideManaged, managedInitial, type ManagedEvent, type ManagedState } from "./machine.ts";
import {
  buildDir,
  extractBuild,
  healthy,
  pickPort,
  residentBytes,
  serverBinary,
  spawnServer,
  type ManagedProcess,
  type Spawn,
} from "./process.ts";

/** The clock: `after` runs `run` once in `ms` and answers the function that cancels it. */
export interface Timers {
  readonly after: (run: () => void, ms: number) => () => void;
}

export interface ManagedPorts {
  readonly platform: string;
  readonly arch: string;
  readonly ramBytes: number;
  readonly defaultDir: string;
  readonly fetch: Fetcher;
  readonly spawn: Spawn;
  readonly extract: (archive: string, dir: string) => Promise<void>;
  readonly health: (url: string, alias: string, signal: AbortSignal) => Promise<boolean>;
  readonly timers: Timers;
  readonly free: (dir: string) => Promise<number | null>;
  readonly port: () => Promise<number>;
  readonly rss: (pid: number) => Promise<number | null>;
  /** True when the machine is too small to serve (a Raspberry Pi-class Host). */
  readonly tooSmall: boolean;
  /** Tests pin small fixture files; the Daemon uses the catalog's. */
  readonly catalog: { readonly model: ManagedModel; readonly asset: PinnedFile | null } | null;
}

export const IDLE_UNLOAD_MS = 15 * 60 * 1000;

export const START_DEADLINE_MS = 180_000;

const HEALTH_INTERVAL_MS = 500;

const MAX_ATTEMPTS = 5;

const backoffMs = (attempt: number) => Math.min(30_000, 1000 * 2 ** (attempt - 1));

const LOG_LINES = 40;

const asSetupError = (error: Error) =>
  error instanceof ManagedSetupError
    ? error
    : new ManagedSetupError({ reason: "download-failed", message: error.message });

interface Progress {
  readonly file: "server" | "model";
  readonly receivedBytes: number;
  readonly totalBytes: number;
}

type Failure = Extract<ManagedServerPhase, { _tag: "Failed" }>;

const defaultPorts = (): ManagedPorts => ({
  platform: process.platform,
  arch: process.arch,
  ramBytes: 0,
  defaultDir: "",
  fetch: (url, init) => fetch(url, init),
  spawn: spawnServer,
  extract: extractBuild,
  health: healthy,
  timers: {
    after: (run, ms) => {
      const handle = setTimeout(run, ms);
      handle.unref();

      return () => clearTimeout(handle);
    },
  },
  free: freeBytes,
  port: pickPort,
  rss: residentBytes,
  tooSmall: false,
  catalog: null,
});

export class ManagedServer {
  private state: ManagedState = managedInitial();
  private readonly ports: ManagedPorts;
  private readonly model: ManagedModel;
  private readonly asset: PinnedFile | null;
  private dir: string;
  private port: number | null = null;
  private progress: Progress | null = null;
  private failure: Failure | null = null;
  private attempt = 0;
  private process: ManagedProcess | null = null;
  private download: AbortController | null = null;
  private starting: Promise<void> | null = null;
  private cancelIdle: (() => void) | null = null;
  private cancelRetry: (() => void) | null = null;
  private log: string[] = [];
  private readonly watchers = new Set<(status: ManagedServerStatus) => void>();
  /** Folders whose files were hashed this run, so status needn't hash 5 GB again. */
  private readonly verified = new Map<string, boolean>();

  constructor(ports: Partial<ManagedPorts> & Pick<ManagedPorts, "ramBytes" | "defaultDir">) {
    this.ports = { ...defaultPorts(), ...ports };
    this.model = this.ports.catalog?.model ?? pickModel(this.ports.ramBytes);
    this.asset = this.ports.catalog
      ? this.ports.catalog.asset
      : platformAsset(this.ports.platform, this.ports.arch);
    this.dir = this.ports.defaultDir;

    if (this.asset === null || this.ports.tooSmall) this.move({ type: "unsupported" });
  }

  private move(event: ManagedEvent) {
    const next = decideManaged(this.state, event);
    const changed = next.value !== this.state.value;
    this.state = next;

    if (changed || event.type === "setup") this.notify();
  }

  private notify() {
    if (this.watchers.size === 0) return;
    void this.status(this.dir).then((status) => {
      for (const watcher of this.watchers) watcher(status);
    });
  }

  private phase(): ManagedServerPhase {
    const cases = ManagedServerPhase.cases;

    return Match.value(String(this.state.value)).pipe(
      Match.when("unsupported", () =>
        cases.Unsupported.make({ reason: this.asset === null ? "platform" : "too-small" })
      ),
      Match.when("downloading", () =>
        this.progress === null ? cases.Verifying.make({}) : cases.Downloading.make(this.progress)
      ),
      Match.when("stopped", () => cases.Stopped.make({})),
      Match.when("starting", () => cases.Starting.make({})),
      Match.when("serving", () => cases.Serving.make({})),
      Match.when("backoff", () =>
        cases.Backoff.make({ attempt: this.attempt, retryInMs: backoffMs(this.attempt) })
      ),
      Match.when(
        "failed",
        () => this.failure ?? cases.Failed.make({ reason: "server-failed", message: "", log: [] })
      ),
      Match.orElse(() => cases.Absent.make({}))
    );
  }

  private resolveDir(dir: string | null) {
    return dir === null || dir.trim() === "" ? this.ports.defaultDir : dir;
  }

  /** A folder change outside a download or a run re-reads what is on disk. */
  private async adopt(dir: string) {
    if (!this.state.matches("absent") && !this.state.matches("stopped")) return;
    this.dir = dir;
    const present = await this.present(dir);

    if (present && this.state.matches("absent")) {
      this.move({ type: "setup" });
      this.move({ type: "downloaded" });
    } else if (!present && this.state.matches("stopped")) this.move({ type: "remove" });
  }

  /** Both files present with their pinned sizes; the model's hash is checked once per run. */
  private async present(dir: string) {
    if (this.asset === null) return false;

    if (!(await this.onDisk(dir))) return false;

    if (this.verified.get(dir) === true) return true;
    const ok = await isDownloaded(dir, this.model.file);
    this.verified.set(dir, ok);

    return ok;
  }

  /** The cheap check before each start: both files there, the model at its pinned size. */
  private async onDisk(dir: string) {
    const binary = Bun.file(serverBinary(dir));
    const model = Bun.file(join(dir, this.model.file.name));

    return (
      (await binary.exists()) && (await model.exists()) && model.size === this.model.file.sizeBytes
    );
  }

  ownsUrl(url: string) {
    return this.port !== null && url.replace(/\/$/, "") === this.url();
  }

  private url() {
    return `http://127.0.0.1:${this.port}`;
  }

  async status(dir: string | null = null): Promise<ManagedServerStatus> {
    const resolved = this.resolveDir(dir);
    await this.adopt(resolved);

    if (this.port === null && !this.state.matches("absent") && !this.state.matches("unsupported"))
      this.port = await this.ports.port();
    const running = this.state.matches("serving") || this.state.matches("starting");

    return {
      model: {
        id: this.model.id,
        name: this.model.name,
        sizeBytes: this.model.sizeBytes,
        serverBytes: this.asset?.sizeBytes ?? 0,
      },
      modelsDir: this.dir,
      freeBytes: await this.ports.free(this.dir),
      endpoint: this.port === null ? null : { kind: "openai", url: this.url() },
      phase: this.phase(),
      memoryBytes: running && this.process !== null ? await this.ports.rss(this.process.pid) : null,
    };
  }

  /** The endpoint the capability report lists, with the alias the server will answer to. */
  endpoint() {
    if (this.port === null || this.state.matches("absent") || this.state.matches("unsupported"))
      return null;

    return { kind: "openai" as const, url: this.url(), models: [this.model.alias], managed: true };
  }

  watch(listener: (status: ManagedServerStatus) => void) {
    this.watchers.add(listener);

    return () => {
      this.watchers.delete(listener);
    };
  }

  private fail(reason: Failure["reason"], message: string, log: ReadonlyArray<string> = []) {
    this.failure = ManagedServerPhase.cases.Failed.make({ reason, message, log: [...log] });
  }

  /** Downloads the build then the model; a file already verified in the folder is skipped. */
  async setup(dir: string | null = null): Promise<void> {
    const resolved = this.resolveDir(dir);
    await this.adopt(resolved);

    if (this.state.matches("unsupported") || this.state.matches("downloading")) return;

    if (this.state.matches("stopped")) return;
    this.dir = resolved;
    this.verified.delete(resolved);
    this.failure = null;
    const controller = new AbortController();
    this.download = controller;
    this.move({ type: "setup" });

    try {
      await this.fetchAll(resolved, controller.signal);
      this.verified.set(resolved, true);
      this.move({ type: "downloaded" });
    } catch (error) {
      if (controller.signal.aborted && this.state.matches("downloading")) {
        this.move({ type: "cancel" });

        return;
      }

      // SAFETY: everything the download path throws is an Error (ManagedSetupError or fs/fetch).
      const failure = asSetupError(error as Error);
      this.fail(failure.reason, failure.message);
      this.move({ type: "download-failed" });
    } finally {
      this.download = null;
      this.progress = null;
    }
  }

  private async fetchAll(dir: string, signal: AbortSignal) {
    if (this.asset === null) return;

    const asset = this.asset;

    const needed =
      ((await Bun.file(serverBinary(dir)).exists()) ? 0 : asset.sizeBytes * 4) +
      ((await Bun.file(join(dir, this.model.file.name)).exists()) ? 0 : this.model.file.sizeBytes);

    await checkSpace(dir, needed, this.ports.free);

    if (!(await Bun.file(serverBinary(dir)).exists())) {
      await this.fetchOne(dir, asset, "server", signal);
      await this.ports.extract(join(dir, asset.name), dir).catch((error: Error) => {
        throw new ManagedSetupError({
          reason: "download-failed",
          message: `Couldn't unpack the server build: ${error.message}`,
        });
      });
      await rm(join(dir, asset.name), { force: true });
    }

    await this.fetchOne(dir, this.model.file, "model", signal);
  }

  private fetchOne(dir: string, file: PinnedFile, kind: Progress["file"], signal: AbortSignal) {
    let last = -1;

    return downloadFile({
      file,
      dir,
      fetch: this.ports.fetch,
      signal,
      free: this.ports.free,
      onProgress: (receivedBytes) => {
        this.progress = { file: kind, receivedBytes, totalBytes: file.sizeBytes };
        // One notification per percent keeps a 5 GB download from flooding the stream.
        const percent = Math.floor((receivedBytes / file.sizeBytes) * 100);

        if (percent !== last) {
          last = percent;
          this.notify();
        }
      },
    });
  }

  cancel() {
    this.download?.abort();
  }

  /** Starts the server if it isn't up, and answers once it serves; concurrent callers share it. */
  start(): Promise<void> {
    if (this.state.matches("serving")) return Promise.resolve();

    if (this.starting !== null) return this.starting;

    if (!this.state.matches("stopped") && !this.state.matches("failed"))
      return Promise.reject(new Error(this.unavailable()));
    this.attempt = 0;
    this.starting = this.launch().finally(() => {
      this.starting = null;
    });

    return this.starting;
  }

  private unavailable() {
    return Match.value(String(this.state.value)).pipe(
      Match.when("absent", () => `${this.model.name} isn't downloaded yet`),
      Match.when("downloading", () => `${this.model.name} is still downloading`),
      Match.when("unsupported", () => "This machine can't run a managed model server"),
      Match.when("backoff", () => "The model server crashed and is about to restart"),
      Match.orElse(() => "The model server isn't available")
    );
  }

  private async launch(): Promise<void> {
    this.failure = null;
    this.move({ type: "demand" });

    if (!(await this.onDisk(this.dir))) {
      this.verified.delete(this.dir);
      const message = `${this.model.file.name} in ${this.dir} doesn't match its checksum`;
      this.fail("checksum-mismatch", message);
      this.move({ type: "exit", retry: false });
      throw new Error(message);
    }

    this.port ??= await this.ports.port();
    await new Promise<void>((resolve, reject) => this.spawn(resolve, reject));
  }

  private spawn(resolve: () => void, reject: (error: Error) => void) {
    const dir = buildDir(this.dir);

    const child = this.ports.spawn(
      serverBinary(this.dir),
      serverArgs(this.model, join(this.dir, this.model.file.name), this.port ?? 0),
      dir
    );

    this.process = child;
    this.log = [];
    void this.collectLog(child);
    const probe = new AbortController();
    let settled = false;

    const settle = (error: Error | null) => {
      if (settled) return;
      settled = true;
      probe.abort();
      cancelDeadline();

      if (error === null) resolve();
      else reject(error);
    };

    const cancelDeadline = this.ports.timers.after(() => {
      child.kill();
      this.fail(
        "server-failed",
        `${this.model.name} didn't answer within ${START_DEADLINE_MS / 1000} s`,
        this.log
      );
    }, START_DEADLINE_MS);

    void child.exited.then((code) => {
      if (this.process !== child) return;
      this.process = null;
      this.clearIdle();
      const stopping = this.state.matches("stopped");

      if (stopping) return settle(new Error("The model server was stopped"));
      this.attempt += 1;
      const retry = this.attempt < MAX_ATTEMPTS && this.failure === null;

      if (!retry && this.failure === null)
        this.fail(
          "server-failed",
          `${this.model.name} exited with ${code ?? "a signal"}`,
          this.log
        );
      this.move({ type: "exit", retry });

      if (retry)
        this.cancelRetry = this.ports.timers.after(() => {
          this.cancelRetry = null;
          // The port may have been taken meanwhile (the usual "address in use" exit); pick anew.
          void this.ports.port().then((port) => {
            this.port = port;
            this.move({ type: "retry" });
            this.spawn(resolve, reject);
          });
        }, backoffMs(this.attempt));
      else settle(new Error(this.failure?.message ?? "The model server failed"));
    });

    const poll = async () => {
      while (!probe.signal.aborted && this.process === child) {
        if (await this.ports.health(this.url(), this.model.alias, probe.signal)) {
          if (this.process !== child) return;
          this.attempt = 0;
          this.move({ type: "listening" });
          this.touch();
          settle(null);

          return;
        }

        await new Promise<void>((wake) => this.ports.timers.after(wake, HEALTH_INTERVAL_MS));
      }
    };

    void poll();
  }

  private async collectLog(child: ManagedProcess) {
    if (child.stderr === null) return;
    const decoder = new TextDecoder();
    let rest = "";

    try {
      for await (const chunk of child.stderr) {
        rest += decoder.decode(chunk, { stream: true });
        const lines = rest.split("\n");
        rest = lines.pop() ?? "";
        this.log = [...this.log, ...lines.filter((line) => line.trim() !== "")].slice(-LOG_LINES);
      }
    } catch {
      /* the process is gone */
    }
  }

  /** A request came in: the idle unload moves 15 minutes out. */
  touch() {
    if (!this.state.matches("serving")) return;
    this.clearIdle();
    this.cancelIdle = this.ports.timers.after(() => {
      this.cancelIdle = null;
      this.move({ type: "idle" });
      this.kill();
    }, IDLE_UNLOAD_MS);
  }

  private clearIdle() {
    this.cancelIdle?.();
    this.cancelIdle = null;
  }

  private kill() {
    const child = this.process;
    this.process = null;
    child?.kill();
  }

  stop() {
    this.cancelRetry?.();
    this.cancelRetry = null;
    this.clearIdle();
    this.move({ type: "stop" });
    this.kill();
  }

  /** Stops the server and deletes the model, its part file and the build. */
  async remove(dir: string | null = null): Promise<void> {
    const resolved = this.resolveDir(dir);
    this.cancel();
    this.stop();
    await rm(join(resolved, this.model.file.name), { force: true });
    await rm(partPath(resolved, this.model.file), { force: true });
    await rm(buildDir(resolved), { recursive: true, force: true });
    this.verified.delete(resolved);
    this.dir = resolved;
    this.move({ type: "remove" });
  }

  dispose() {
    this.cancel();
    this.stop();
    this.watchers.clear();
  }
}
