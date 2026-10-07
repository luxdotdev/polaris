import manifest0 from "./upstream-evidence/node-darwin-arm64.json";
import notice0 from "./upstream-evidence/notice-1.txt" with { type: "text" };
import manifest1 from "./upstream-evidence/node-darwin-x64.json";
import manifest2 from "./upstream-evidence/node-linux-arm64.json";
import manifest3 from "./upstream-evidence/node-linux-x64.json";
import manifest4 from "./upstream-evidence/typescript-language-server-npm.json";
import notice1 from "./upstream-evidence/notice-2.txt" with { type: "text" };
import notice2 from "./upstream-evidence/notice-3.txt" with { type: "text" };
import notice3 from "./upstream-evidence/notice-4.txt" with { type: "text" };
import notice4 from "./upstream-evidence/notice-5.txt" with { type: "text" };
import notice5 from "./upstream-evidence/notice-6.txt" with { type: "text" };
import notice6 from "./upstream-evidence/notice-7.txt" with { type: "text" };
import notice7 from "./upstream-evidence/notice-8.txt" with { type: "text" };
import manifest5 from "./upstream-evidence/typescript-npm.json";
import notice8 from "./upstream-evidence/notice-9.txt" with { type: "text" };

export const upstreamEvidence = {
  "node-darwin-arm64": {
    manifest: manifest0,
    notices: {
      "notices/148eacf7863ef4329224a29398623077200a27194aa075569faf4a0a85566ca5.txt": notice0,
    },
  },
  "node-darwin-x64": {
    manifest: manifest1,
    notices: {
      "notices/148eacf7863ef4329224a29398623077200a27194aa075569faf4a0a85566ca5.txt": notice0,
    },
  },
  "node-linux-arm64": {
    manifest: manifest2,
    notices: {
      "notices/148eacf7863ef4329224a29398623077200a27194aa075569faf4a0a85566ca5.txt": notice0,
    },
  },
  "node-linux-x64": {
    manifest: manifest3,
    notices: {
      "notices/148eacf7863ef4329224a29398623077200a27194aa075569faf4a0a85566ca5.txt": notice0,
    },
  },
  "typescript-language-server-npm": {
    manifest: manifest4,
    notices: {
      "notices/899d21038f87dd6243dd33b7ee82a078e639d4325a427c01e64d8116315b9680.txt": notice1,
      "notices/c2cfccb812fe482101a8f04597dfc5a9991a6b2748266c47ac91b6a5aae15383.txt": notice2,
      "notices/cdf4d87ae0a6c160227263bf4e39a0a10e30e89ae7256e0f7ac7bde0836552c6.txt": notice3,
      "notices/2c36ca617013001df8690cc63e2392760edd23fef948274100f051f7168b995d.txt": notice4,
      "notices/a2010f343487d3f7618affe54f789f5487602331c0a8d03f49e9a7c547cf0499.txt": notice5,
      "notices/291d324119550df1624f0af60388393fe36b02bc5e61d9a236afab1801b33042.txt": notice6,
      "notices/c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4.txt": notice7,
    },
  },
  "typescript-npm": {
    manifest: manifest5,
    notices: {
      "notices/a7d00bfd54525bc694b6e32f64c7ebcf5e6b7ae3657be5cc12767bce74654a47.txt": notice8,
    },
  },
};
