import apacheLicense from "./upstream-evidence/rust-lua-62c7a1e35f56406896d7aa7ca52d0cc0d272ac022b5d2796e7d6905db8a3636a.txt" with { type: "text" };
import mitLicense from "./upstream-evidence/rust-lua-23f18e03dc49df91622fe2a76176497404e46ced8a715d9d2b67a7446571cca3.txt" with { type: "text" };
import luaLicense from "./upstream-evidence/rust-lua-a0a65ffcdc8620548598ce8ac5ce1a7ec36edf3034a5df2d6593e49fcececa64.txt" with { type: "text" };
import rustDarwinArm64 from "./upstream-evidence/rust-analyzer-aarch64-apple-darwin.gz.json";
import rustLinuxArm64 from "./upstream-evidence/rust-analyzer-aarch64-unknown-linux-gnu.gz.json";
import rustDarwinX64 from "./upstream-evidence/rust-analyzer-x86_64-apple-darwin.gz.json";
import rustLinuxX64 from "./upstream-evidence/rust-analyzer-x86_64-unknown-linux-gnu.gz.json";
import rustLinuxX64Musl from "./upstream-evidence/rust-analyzer-x86_64-unknown-linux-musl.gz.json";
import luaDarwinArm64 from "./upstream-evidence/lua-language-server-3.19.1-darwin-arm64.tar.gz.json";
import luaDarwinX64 from "./upstream-evidence/lua-language-server-3.19.1-darwin-x64.tar.gz.json";
import luaLinuxArm64 from "./upstream-evidence/lua-language-server-3.19.1-linux-arm64.tar.gz.json";
import luaLinuxX64 from "./upstream-evidence/lua-language-server-3.19.1-linux-x64.tar.gz.json";

const rustNotices = {
  "notices/62c7a1e35f56406896d7aa7ca52d0cc0d272ac022b5d2796e7d6905db8a3636a.txt": apacheLicense,
  "notices/23f18e03dc49df91622fe2a76176497404e46ced8a715d9d2b67a7446571cca3.txt": mitLicense,
};

const luaNotices = {
  "notices/a0a65ffcdc8620548598ce8ac5ce1a7ec36edf3034a5df2d6593e49fcececa64.txt": luaLicense,
};

/** rust-analyzer and lua-language-server releases, with the licences retained beside them. */
export const rustLuaEvidence = {
  "rust-analyzer-aarch64-apple-darwin.gz": { manifest: rustDarwinArm64, notices: rustNotices },
  "rust-analyzer-aarch64-unknown-linux-gnu.gz": { manifest: rustLinuxArm64, notices: rustNotices },
  "rust-analyzer-x86_64-apple-darwin.gz": { manifest: rustDarwinX64, notices: rustNotices },
  "rust-analyzer-x86_64-unknown-linux-gnu.gz": { manifest: rustLinuxX64, notices: rustNotices },
  "rust-analyzer-x86_64-unknown-linux-musl.gz": {
    manifest: rustLinuxX64Musl,
    notices: rustNotices,
  },
  "lua-language-server-3.19.1-darwin-arm64.tar.gz": {
    manifest: luaDarwinArm64,
    notices: luaNotices,
  },
  "lua-language-server-3.19.1-darwin-x64.tar.gz": { manifest: luaDarwinX64, notices: luaNotices },
  "lua-language-server-3.19.1-linux-arm64.tar.gz": { manifest: luaLinuxArm64, notices: luaNotices },
  "lua-language-server-3.19.1-linux-x64.tar.gz": { manifest: luaLinuxX64, notices: luaNotices },
};
