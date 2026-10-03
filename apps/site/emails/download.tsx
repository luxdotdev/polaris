import { links, site } from "../components/links";
import {
  EmailButton,
  EmailLink,
  EmailNote,
  EmailScene,
  EmailShell,
  EmailText,
  EmailTitle,
} from "./_components";

export const downloadSubject = "Polaris for Mac";

/** Sent when someone on a phone asks for the Mac download; it holds no recipient data. */
export function DownloadEmail() {
  return (
    <EmailShell preview="Your link to download Polaris on your Mac.">
      <EmailScene />
      <EmailTitle>Polaris for Mac</EmailTitle>
      <EmailText>
        Here&apos;s the download you asked for. Open this email on your Mac to install Polaris.
      </EmailText>
      <EmailButton href={`${site.origin}${links.download}`}>Download for macOS</EmailButton>
      <EmailNote>For Macs with Apple silicon.</EmailNote>
      <EmailText>
        Polaris runs Claude Code and Codex side by side, on your Mac or any machine you can reach
        over SSH. It shows what every agent is doing, calls you only when one is stuck, and puts the
        riskiest changes first.
      </EmailText>
      <EmailText>
        It&apos;s free and open source:{" "}
        <EmailLink href={links.source}>view the source on GitHub</EmailLink>.
      </EmailText>
    </EmailShell>
  );
}

export default DownloadEmail;
