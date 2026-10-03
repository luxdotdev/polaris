import type { ReactNode } from "react";
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
} from "react-email";
import { site } from "../components/links";
import { EmailTailwind } from "./_email-tailwind";

// Light ground on purpose: mail clients invert or ignore dark backgrounds unpredictably.
// Tokens are DESIGN.md's light set; Medium (500) is the heaviest weight; Starlight stays off links.
const font =
  '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Helvetica, Arial, sans-serif';

type ShellProps = { readonly preview: string; readonly children: ReactNode };

export function EmailShell({ preview, children }: ShellProps) {
  return (
    <Html lang="en">
      <Head>
        <meta name="color-scheme" content="light" />
        <meta name="supported-color-schemes" content="light" />
      </Head>
      <Preview>{preview}</Preview>
      <EmailTailwind>
        <Body className="mx-auto my-auto bg-[#fbfbfc] px-[16px]" style={{ fontFamily: font }}>
          <Container className="mx-auto my-[40px] max-w-[560px] rounded-[14px] bg-white px-[32px] pt-[28px] pb-[24px]">
            <Img
              src={`${site.origin}/email/polaris-mark.png`}
              width="32"
              height="32"
              alt="Polaris"
              className="my-0"
            />
            {children}
            <Hr className="mx-0 mt-[32px] mb-[20px] w-full border border-solid border-[#ededef]" />
            <Text className="m-0 text-[13px] leading-[20px] text-[#66686f]">
              You asked for this link on {new URL(site.origin).host}. We don&apos;t keep your
              address, and we won&apos;t email you again.
            </Text>
            <Text className="mt-[8px] mb-0 text-[13px] leading-[20px] text-[#66686f]">
              An open source project by lux.dev · © 2026 lux.dev LLC
            </Text>
          </Container>
        </Body>
      </EmailTailwind>
    </Html>
  );
}

type ChildrenProps = { readonly children: ReactNode };

type LinkProps = { readonly href: string; readonly children: ReactNode };

/** The dawn scene from the site and installer, cropped to a banner; decorative. */
export function EmailScene() {
  return (
    <Img
      src={`${site.origin}/email/dawn.png`}
      width="496"
      alt=""
      className="mt-[24px] mb-0 w-full rounded-[10px]"
      style={{ imageRendering: "pixelated", height: "auto" }}
    />
  );
}

export function EmailTitle({ children }: ChildrenProps) {
  return (
    <Heading className="mx-0 mt-[28px] mb-[12px] p-0 text-[24px] leading-[30px] font-medium tracking-[-0.015em] text-[#17181a]">
      {children}
    </Heading>
  );
}

export function EmailText({ children }: ChildrenProps) {
  return (
    <Text className="mt-0 mb-[16px] text-[15px] leading-[24px] text-[#333438]">{children}</Text>
  );
}

export function EmailNote({ children }: ChildrenProps) {
  return (
    <Text className="mt-0 mb-[16px] text-[13px] leading-[20px] text-[#66686f]">{children}</Text>
  );
}

/** The one primary action: an ink button, as on the light site (DESIGN.md, Marketing site). */
export function EmailButton({ href, children }: LinkProps) {
  return (
    <Section className="mt-[8px] mb-[16px]">
      <Button
        href={href}
        className="rounded-[6px] bg-[#17181a] px-[20px] py-[12px] text-[15px] font-medium text-white no-underline"
      >
        {children}
      </Button>
    </Section>
  );
}

export function EmailLink({ href, children }: LinkProps) {
  return (
    <Link href={href} className="text-[#17181a] underline">
      {children}
    </Link>
  );
}
