import "../../../styles.css";
import { useEffect, useState } from "react";
import { createAuthorityFixture } from "./authority.fixture.ts";
import { createRoot } from "react-dom/client";
import { LanguageSettingsPage } from "./index.ts";
import { createFixture, fixtureScopes } from "./fixture.ts";

const fixture = createFixture();

Object.assign(window, { fixture });

const regression = createAuthorityFixture();

const Evidence = () => {
  const [adapter, setAdapter] = useState(fixture.adapter);
  useEffect(() => {
    Object.assign(window, {
      regression: {
        ...regression,
        activate: () => setAdapter(regression.adapters.first),
        swap: () => setAdapter(regression.adapters.replacement),
      },
    });
  }, []);

  return (
    <div className="h-full overflow-auto">
      <LanguageSettingsPage adapter={adapter} scopes={fixtureScopes} />
    </div>
  );
};

const root = document.getElementById("root");

if (root) createRoot(root).render(<Evidence />);
