// Portions adapted from raycast/extensions@3048c09 zed-recent-projects/src/search.tsx (MIT)
/** Search Agent Sessions on every Host, by what they need from you; archived ones on search. */
import { List } from "@raycast/api";
import { useState } from "react";
import { HostDropdown, hostFilterOf } from "./components/HostDropdown.tsx";
import { SessionItem } from "./components/SessionItem.tsx";
import { usePins } from "./components/usePins.ts";
import { sessionSections } from "./lib/rows.ts";
import { usePolaris, withPolaris } from "./polaris.tsx";

const SearchSessions = () => {
  const { views } = usePolaris();
  const pins = usePins();
  const [host, setHost] = useState("all");
  const [search, setSearch] = useState("");
  const [showingDetail, setShowingDetail] = useState(false);
  const detail = { showing: showingDetail, toggle: () => setShowingDetail((s) => !s) };

  const sections = sessionSections(views, {
    host: hostFilterOf(host, views),
    pinned: pins.pinned,
    searching: search.trim() !== "",
  });

  return (
    <List
      filtering
      onSearchTextChange={setSearch}
      isShowingDetail={showingDetail}
      searchBarPlaceholder="Search agent sessions"
      searchBarAccessory={
        views.length > 1 ? <HostDropdown views={views} onChange={setHost} /> : undefined
      }
    >
      <List.EmptyView
        title={search === "" ? "No agent sessions" : "No matching agent sessions"}
        description="Start one with New Agent Session."
      />
      {sections.map((section) => (
        <List.Section
          key={section.title}
          title={section.title}
          subtitle={String(section.rows.length)}
        >
          {section.rows.map((row) => (
            <SessionItem key={row.key} row={row} detail={detail} pins={pins} />
          ))}
        </List.Section>
      ))}
    </List>
  );
};

export default withPolaris(SearchSessions);
