import license from "./upstream-evidence/notice-9.txt" with { type: "text" };
import notice from "./upstream-evidence/typescript-go-f5c708b59114507b8b27b48181b6883d106bbca0c1634bbee45b5e344237b66b.txt" with { type: "text" };
import darwinArm64 from "./upstream-evidence/typescript-go-darwin-arm64.json";
import darwinX64 from "./upstream-evidence/typescript-go-darwin-x64.json";
import linuxArm64 from "./upstream-evidence/typescript-go-linux-arm64.json";
import linuxX64 from "./upstream-evidence/typescript-go-linux-x64.json";

const notices = {
  "notices/a7d00bfd54525bc694b6e32f64c7ebcf5e6b7ae3657be5cc12767bce74654a47.txt": license,
  "notices/f5c708b59114507b8b27b48181b6883d106bbca0c1634bbee45b5e344237b66b.txt": notice,
};

/** TypeScript 7's native compiler per platform, with its LICENSE and NOTICE.txt retained beside it. */
export const typescriptGoEvidence = {
  "typescript-go-darwin-arm64": { manifest: darwinArm64, notices },
  "typescript-go-darwin-x64": { manifest: darwinX64, notices },
  "typescript-go-linux-arm64": { manifest: linuxArm64, notices },
  "typescript-go-linux-x64": { manifest: linuxX64, notices },
};
