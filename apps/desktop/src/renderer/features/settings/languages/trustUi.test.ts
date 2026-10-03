import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as P from "@polaris/protocol";
import { Hosts } from "./Hosts.tsx";
import { fixtureSnapshot } from "./fixture.ts";

test("Settings renders an enabled explicit trust button before discovery succeeds", () => {
  const host = fixtureSnapshot(P.LanguageSettingsScope.cases.App.make({})).hosts[0];

  if (!host?.discovery) throw new Error("Missing fixture");

  const pending = {
    ...host,
    tools: [],
    discovery: null,
    trustCheckout: host.discovery.checkout,
    trust: P.LanguageTrust.make({ ...host.discovery.trust, trusted: false }),
    canSetTrust: true,
  };

  const markup = renderToStaticMarkup(
    createElement(Hosts, { hosts: [pending], busy: false, act: () => {} })
  );

  expect(markup).toContain("Trust this checkout");
  expect(markup).toContain("Project roots, SDK and interpreter have not been observed");
  expect(markup).not.toMatch(/<button[^>]*\sdisabled=""[^>]*>Trust this checkout/);

  const revoked = renderToStaticMarkup(
    createElement(Hosts, {
      hosts: [{ ...pending, canSetTrust: false }],
      busy: false,
      act: () => {},
    })
  );

  expect(revoked).toMatch(/<button[^>]*\sdisabled=""[^>]*>Trust this checkout/);
});
