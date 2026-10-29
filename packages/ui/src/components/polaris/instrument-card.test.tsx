import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, test } from "bun:test";

import { Popover } from "../ui/popover";
import { InstrumentCard, InstrumentPopoverContent, Kicker } from "./instrument-card";

afterEach(cleanup);

const slot = (name: string) => document.querySelector<HTMLElement>(`[data-slot="${name}"]`);

describe("InstrumentCard", () => {
  test("only the body scrolls: the header and status line sit outside it", () => {
    render(
      <Popover open>
        <InstrumentPopoverContent
          header={{ title: "Polaris planning", state: "6 workers", control: <button>Cost</button> }}
          hero={<svg aria-label="orrery" />}
          wells={[<p key="a">Spend</p>, <p key="b">Workers</p>]}
          footer={{ status: "As of 22:25 · revision 37", action: <button>Compact now</button> }}
        />
      </Popover>
    );

    const body = slot("instrument-body");

    expect(body?.textContent).toBe("SpendWorkers");
    expect(body?.contains(slot("instrument-hero"))).toBe(true);
    expect(body?.contains(slot("instrument-header"))).toBe(false);
    expect(body?.contains(slot("instrument-footer"))).toBe(false);
    expect(slot("instrument-footer")?.textContent).toBe("As of 22:25 · revision 37Compact now");
  });

  test("the hero is capped at 160px unless the caller raises it", () => {
    const { rerender } = render(
      <InstrumentCard header={{ title: "Stack" }} hero={<div />} wells={[<p key="a">x</p>]} />
    );

    expect(slot("instrument-hero")?.style.maxHeight).toBe("160px");

    rerender(
      <InstrumentCard
        header={{ title: "Constellation" }}
        hero={<div />}
        heroMaxHeight={280}
        wells={[<p key="a">x</p>]}
      />
    );

    expect(slot("instrument-hero")?.style.maxHeight).toBe("280px");
  });

  test("a kicker joins its parts with a middle dot", () => {
    render(<Kicker parts={["Sessions", 4]} />);

    expect(slot("kicker")?.textContent).toBe("Sessions · 4");
  });
});
