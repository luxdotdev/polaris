/**
 * A fake `window.polaris` for renderer tests: it records every request and answers each
 * method as the test set it (ok with null otherwise). Install it in `beforeEach`.
 */
import type {
  IpcError,
  PolarisApi,
  RequestInput,
  RequestMethod,
  RequestOutput,
  Result,
} from "../../shared/api.ts";
import { standInBridge } from "../features/bridge.ts";

type Answerer<M extends RequestMethod> = (
  input: RequestInput<M>
) => Result<RequestOutput<M>> | Promise<Result<RequestOutput<M>>>;

type Call = { readonly [M in RequestMethod]: readonly [M, RequestInput<M>] }[RequestMethod];

export interface FakeBridge {
  /** Every request, in order. */
  readonly calls: ReadonlyArray<Call>;
  /** The inputs sent to `method`, in order. */
  readonly sent: <M extends RequestMethod>(method: M) => ReadonlyArray<RequestInput<M>>;
  /** The methods requested, in order. */
  readonly methods: () => ReadonlyArray<RequestMethod>;
  /** Answers `method` with `answerer` from now on. */
  readonly answer: <M extends RequestMethod>(method: M, answerer: Answerer<M>) => void;
  readonly answerOk: <M extends RequestMethod>(method: M, value: RequestOutput<M>) => void;
  readonly refuse: <M extends RequestMethod>(method: M, error: IpcError) => void;
}

/** Installs a fresh fake as the bridge; `standInBridge(null)` removes it. */
export const installFakeBridge = (): FakeBridge => {
  const calls: Array<Call> = [];
  const answers = new Map<RequestMethod, (input: never) => ReturnType<Answerer<RequestMethod>>>();

  const answer = <M extends RequestMethod>(method: M, answerer: Answerer<M>) => {
    answers.set(method, answerer);
  };

  standInBridge({
    // SAFETY: each method's answerer was set for that method, so its output is that method's.
    request: (async (method: RequestMethod, input: never) => {
      // SAFETY: the method and its input arrive together from a typed `request` call.
      calls.push([method, input] as Call);

      return (await answers.get(method)?.(input)) ?? { ok: true, value: null };
    }) as PolarisApi["request"],
    subscribe: () => () => undefined,
    onAppEvent: () => () => undefined,
  });

  return {
    calls,
    // SAFETY: a call's input is the input of the method it is paired with.
    sent: (method) => calls.flatMap(([m, input]) => (m === method ? [input as never] : [])),
    methods: () => calls.map(([m]) => m),
    answer,
    answerOk: (method, value) => answer(method, () => ({ ok: true, value })),
    refuse: (method, error) => answer(method, () => ({ ok: false, error })),
  };
};
