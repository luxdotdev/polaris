/**
 * What a managed model server is made of (ADR 0049): the pinned llama.cpp build per
 * platform and the two next-edit models, each with its publisher URL, size and SHA-256.
 */
import type { ManagedModelFacts, ManagedModelId } from "@polaris/protocol";

export interface PinnedFile {
  readonly name: string;
  readonly url: string;
  readonly sizeBytes: number;
  readonly sha256: string;
}

/** llama.cpp release b11429 (the v0.6.0 stable build, commit d812350, MIT). */
export const LLAMA_BUILD = "b11429";

const release = (asset: string) =>
  `https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_BUILD}/${asset}`;

/** Keyed by `${platform}-${arch}` as Bun's `process` reports them; glibc Linux only. */
export const LLAMA_ASSETS = {
  "darwin-arm64": {
    name: `llama-${LLAMA_BUILD}-bin-macos-arm64.tar.gz`,
    url: release(`llama-${LLAMA_BUILD}-bin-macos-arm64.tar.gz`),
    sizeBytes: 11_971_406,
    sha256: "740288ec6887be94280a5dfa25b5e23a78285cab104519e6c7e218904ee82459",
  },
  "linux-x64": {
    name: `llama-${LLAMA_BUILD}-bin-ubuntu-x64.tar.gz`,
    url: release(`llama-${LLAMA_BUILD}-bin-ubuntu-x64.tar.gz`),
    sizeBytes: 17_693_462,
    sha256: "f6d25dde8f51133143d1453da4fd5f73b145127177612a283bf7995957af3392",
  },
  "linux-arm64": {
    name: `llama-${LLAMA_BUILD}-bin-ubuntu-arm64.tar.gz`,
    url: release(`llama-${LLAMA_BUILD}-bin-ubuntu-arm64.tar.gz`),
    sizeBytes: 13_682_895,
    sha256: "ed44c0f79c3d02424f62bdc87e106318b0b89f49050e2e80c5f352723d14e00b",
  },
} satisfies Readonly<Record<string, PinnedFile>>;

const isAssetKey = (key: string): key is keyof typeof LLAMA_ASSETS => key in LLAMA_ASSETS;

export interface ManagedModel extends ManagedModelFacts {
  readonly file: PinnedFile;
  /** What the endpoint reports as the model id, so placement recognises the format. */
  readonly alias: string;
  readonly licence: string;
  readonly publisher: string;
}

const huggingFace = (repo: string, file: string) =>
  `https://huggingface.co/${repo}/resolve/main/${file}`;

export const MODELS: Readonly<Record<ManagedModelId, ManagedModel>> = {
  "zeta-2.1": {
    id: "zeta-2.1",
    name: "Zeta 2.1",
    alias: "zeta-2.1-q4_k_m",
    sizeBytes: 5_071_410_080,
    serverBytes: 0,
    memoryBytes: 8_700_000_000,
    licence: "Apache-2.0",
    publisher: "mradermacher/zeta-2.1-GGUF (base zed-industries/zeta-2.1)",
    file: {
      name: "zeta-2.1.Q4_K_M.gguf",
      url: huggingFace("mradermacher/zeta-2.1-GGUF", "zeta-2.1.Q4_K_M.gguf"),
      sizeBytes: 5_071_410_080,
      sha256: "f031e71d3a467f23457964f7168b9158189a91231efc28cc8b91e6ea473dd71b",
    },
  },
  "sweep-next-edit-1.5b": {
    id: "sweep-next-edit-1.5b",
    name: "Sweep Next-Edit 1.5B",
    alias: "sweep-next-edit-1.5b-q8_0",
    sizeBytes: 1_537_269_856,
    serverBytes: 0,
    memoryBytes: 2_600_000_000,
    licence: "Apache-2.0",
    publisher: "sweepai/sweep-next-edit-1.5B",
    file: {
      name: "sweep-next-edit-1.5b.q8_0.v2.gguf",
      url: huggingFace("sweepai/sweep-next-edit-1.5B", "sweep-next-edit-1.5b.q8_0.v2.gguf"),
      sizeBytes: 1_537_269_856,
      sha256: "1321ea5e5d7529e60f9770c6a0b3a965f89542d16cf4ae51bab267f6a88150da",
    },
  },
};

/** Sweep on every machine (owner, 2026-10-15); Zeta only when the user opted in. */
export const DEFAULT_MODEL: ManagedModelId = "sweep-next-edit-1.5b";

export const modelFor = (
  id: ManagedModelId | null,
  models: Readonly<Record<ManagedModelId, ManagedModel>> = MODELS
): ManagedModel => models[id ?? DEFAULT_MODEL];

export const platformAsset = (platform: string, arch: string): PinnedFile | null => {
  const key = `${platform}-${arch}`;

  return isAssetKey(key) ? LLAMA_ASSETS[key] : null;
};

/** The spike's flags: prompt reuse and n-gram speculation, one slot, everything on the GPU. */
export const serverArgs = (model: ManagedModel, modelPath: string, port: number) => [
  "--model",
  modelPath,
  "--alias",
  model.alias,
  "--host",
  "127.0.0.1",
  "--port",
  String(port),
  "-c",
  "8192",
  "-np",
  "1",
  "-ngl",
  "99",
  "--cache-reuse",
  "256",
  "--spec-type",
  "ngram-simple",
  "--spec-ngram-simple-size-n",
  "8",
  "--spec-ngram-simple-size-m",
  "48",
];
