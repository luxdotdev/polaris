/**
 * Runs a frame document's scripts as classic scripts, in order, in one `node:vm` context over a
 * happy-dom window: like a browser, they share one global lexical scope (happy-dom alone doesn't).
 */
import vm from "node:vm";
import { Window } from "happy-dom";

/** What a test reads back out of the frame: its JSON. */
export type Json =
  | string
  | number
  | boolean
  | null
  | ReadonlyArray<Json>
  | { readonly [key: string]: Json };

export interface RunFrame {
  readonly window: Window;
  /** What each script threw, in order; a throw doesn't stop the scripts after it. */
  readonly errors: ReadonlyArray<string>;
  /** Messages the frame posted, parsed from the native bridge's JSON. */
  readonly posted: Array<unknown>;
  /** A global the scripts left, as JSON (functions dropped); undefined when there is none. */
  readonly global: (name: string) => Json | undefined;
  /** An expression's value in the frame, as JSON; undefined when it is undefined. */
  readonly evaluate: (expression: string) => Json | undefined;
  /** Runs statements in the frame (wrapped in a block, so their declarations stay local). */
  readonly run: (statements: string) => void;
}

export const runFrame = (document: string): RunFrame => {
  const window = new Window();
  const posted: Array<unknown> = [];
  const context = vm.createContext(window);
  const bridge = { postMessage: (text: string) => posted.push(JSON.parse(text)) };
  Object.assign(window, { ReactNativeWebView: bridge });
  window.document.write(document);
  const errors: Array<string> = [];

  for (const script of window.document.querySelectorAll("script")) {
    try {
      vm.runInContext(script.textContent ?? "", context);
    } catch (error) {
      errors.push(String(error));
    }
  }

  window.document.dispatchEvent(new window.Event("DOMContentLoaded"));

  const evaluate = (expression: string): Json | undefined => {
    const text = String(vm.runInContext(`JSON.stringify({ v: (${expression}) })`, context));

    // SAFETY: JSON.parse of JSON.stringify output is JSON; `v` is absent when the value was undefined.
    return (JSON.parse(text) as { readonly v?: Json }).v;
  };

  return {
    window,
    errors,
    posted,
    global: (name) => evaluate(`typeof ${name} === "undefined" ? undefined : ${name}`),
    evaluate,
    run: (statements) => {
      vm.runInContext(`{ ${statements} }`, context);
    },
  };
};
