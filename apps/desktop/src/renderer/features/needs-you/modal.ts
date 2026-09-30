/**
 * Whether a modal (the jump menu, a dialog) is open anywhere in the window. Hover cards close
 * while one is: Radix portals modals to the body, so one observer of the body's children does.
 */
const MODAL = '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]';

const listeners = new Set<() => void>();

let open = false;

let observer: MutationObserver | null = null;

const check = () => {
  const next = document.querySelector(MODAL) !== null;

  if (next === open) return;
  open = next;

  for (const listener of listeners) listener();
};

export const modalOpen = {
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    observer ??= new MutationObserver(check);
    observer.observe(document.body, { childList: true });
    check();

    return () => {
      listeners.delete(listener);

      if (listeners.size > 0) return;
      observer?.disconnect();
      observer = null;
    };
  },
  get: () => open,
};
