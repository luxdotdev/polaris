export const zip =
  "https://github.com/luxdotdev/polaris/releases/download/v1.2.3/Polaris-1.2.3-arm64-mac.zip";

export const dmg =
  "https://github.com/luxdotdev/polaris/releases/download/v1.2.3/Polaris-1.2.3-arm64.dmg";

export const fixture = {
  tag_name: "v1.2.3",
  name: "Polaris 1.2.3",
  body: "Release notes",
  published_at: "2026-10-02T12:00:00Z",
  draft: false,
  prerelease: false,
  assets: [
    { name: "Polaris-1.2.3-arm64-mac.zip", state: "uploaded", browser_download_url: zip },
    { name: "Polaris-1.2.3-arm64.dmg", state: "uploaded", browser_download_url: dmg },
  ],
};
