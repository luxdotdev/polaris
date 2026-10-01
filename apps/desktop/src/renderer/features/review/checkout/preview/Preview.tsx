/**
 * The Review Checkout chip on fixtures, for screenshots against Paper R5 (8B5-0) and R4
 * (804-0): `#checkout/states` lists every state; `#checkout/menu-<scene>` opens one menu.
 */
import { Popover, TooltipProvider } from "@polaris/ui";
import { createRoot } from "react-dom/client";
import { createStore } from "zustand/vanilla";
import { createCommandRegistry } from "../../../../routes/commands.ts";
import { createNavigation } from "../../../../routes/navigation.ts";
import { AppProvider } from "../../../../shell/hooks.ts";
import { type AppState, type Connection, initialState } from "../../../../store/store.ts";
import { chipAction } from "../model/chip.ts";
import { ChipFace } from "../ui/ChipFace.tsx";
import { CheckoutMenu } from "../ui/CheckoutMenu.tsx";
import { MENUS, PULL, STATES } from "./fixtures.ts";

const noop = () => undefined;

const States = () => (
  <main data-testid="checkout-states" className="bg-bg text-text-default min-h-full px-16 py-12">
    <h1 className="text-display text-text-strong font-medium">Review checkout</h1>
    <p className="text-body text-text-subtle mt-2">
      Every state the chip beside the primary action can reach.
    </p>
    <div className="mt-8 flex flex-col">
      {STATES.map(({ name, view }) => (
        <div key={name} className="border-hairline flex items-start gap-8 border-t py-3">
          <p className="text-body text-text-strong w-44 shrink-0 pt-1.5 font-medium">{name}</p>
          <Popover>
            <ChipFace
              view={view}
              action={chipAction(view)}
              actionOpensMenu={false}
              onAction={noop}
            />
          </Popover>
        </div>
      ))}
    </div>
  </main>
);

const Menu = ({ scene }: { readonly scene: string }) => {
  const model = MENUS.get(scene);

  if (model === undefined) return <p>No scene {scene}</p>;

  return (
    <main className="bg-bg flex min-h-full justify-end px-10 pt-10">
      <Popover open>
        <ChipFace
          view={model.view}
          action={chipAction(model.view)}
          actionOpensMenu={false}
          onAction={noop}
        />
        <CheckoutMenu model={model} pull={PULL} onDone={noop} />
      </Popover>
    </main>
  );
};

export const mountCheckoutPreview = (root: HTMLElement, hash: string) => {
  const scene = hash.replace(/^#checkout\//, "");
  const store = createStore<AppState>(() => initialState);

  const connection: Connection = {
    store,
    openSession: () => () => undefined,
    setDensity: (density) => store.setState({ density }),
    setAppearance: ({ density, theme }) => store.setState({ density, theme }),
  };

  const navigation = createNavigation({ app: store, storage: null });
  const commands = createCommandRegistry({ mac: true });

  createRoot(root).render(
    <AppProvider value={{ connection, navigation, commands }}>
      <TooltipProvider>{scene === "states" ? <States /> : <Menu scene={scene} />}</TooltipProvider>
    </AppProvider>
  );

  return connection.setDensity;
};
