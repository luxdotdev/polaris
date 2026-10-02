import "../../../styles.css";
import { createRoot } from "react-dom/client";
import { LanguageSettingsPage } from "./index.ts";
import { createFixture, fixtureScopes } from "./fixture.ts";

const fixture = createFixture();

Object.assign(window, { fixture });

const root = document.getElementById("root");

if (root)
  createRoot(root).render(
    <div className="h-full overflow-auto">
      <LanguageSettingsPage adapter={fixture.adapter} scopes={fixtureScopes} />
    </div>
  );
