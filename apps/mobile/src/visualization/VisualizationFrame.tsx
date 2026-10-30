/**
 * One Visualization's frame (ADR 0089): a WebView limited to its own HTML string, no file access,
 * every navigation refused, and only schema-checked messages taken from it.
 */
import { buildFrameDocument, HostMessage } from "@polaris/visualization";
import { Match } from "effect";
import { useEffect, useMemo, useRef } from "react";
import { type StyleProp, type ViewStyle } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { useTheme } from "../theme/index.ts";
import { FRAME_SCHEME, frameTokens, hostMessageScript, navigationPolicy } from "./frame.ts";
import { clampHeight, parseFrameMessage, type Visualization } from "./model.ts";
import { fileStateStore, type VisualizationStateStore } from "./stateStore.ts";

export interface VisualizationFrameProps {
  readonly visualization: Visualization;
  readonly mode: "inline" | "expanded";
  /** A clamped height the frame reported (inline only). */
  readonly onHeight?: (height: number) => void;
  /** An https link the frame asks to open; the caller confirms first. */
  readonly onOpenLink: (url: string) => void;
  /** It tried to load another page and was refused (DESIGN.md, Stopped). */
  readonly onStopped: () => void;
  /** Called after the frame saved its `pv.state`. */
  readonly onState?: () => void;
  readonly store?: VisualizationStateStore;
  readonly style?: StyleProp<ViewStyle>;
}

export const VisualizationFrame = ({
  visualization,
  mode,
  onHeight,
  onOpenLink,
  onStopped,
  onState,
  store = fileStateStore,
  style,
}: VisualizationFrameProps) => {
  const { colours } = useTheme();
  const view = useRef<WebView<object>>(null);
  const coloursAtMount = useRef(colours);
  const { id, html, title } = visualization;

  // The document is built once per frame; theme changes go in as `pv:theme` below.
  const document = useMemo(
    () =>
      buildFrameDocument({
        html,
        title,
        mode,
        tokens: frameTokens(coloursAtMount.current),
        scheme: FRAME_SCHEME,
        state: store.read(id),
      }),
    [html, title, mode, id, store]
  );

  // A new document starts a new load, so it gets its own policy.
  const policy = useMemo(() => navigationPolicy(), [document]);

  useEffect(() => {
    if (coloursAtMount.current === colours) return;

    const message = HostMessage.make({
      type: "pv:theme",
      tokens: frameTokens(colours),
      scheme: FRAME_SCHEME,
    });

    view.current?.injectJavaScript(hostMessageScript(message));
  }, [colours]);

  const onMessage = ({ nativeEvent }: WebViewMessageEvent) => {
    const message = parseFrameMessage(nativeEvent.data);

    if (message === null) return;
    Match.value(message).pipe(
      Match.discriminatorsExhaustive("type")({
        "pv:height": ({ height }) => {
          const clamped = clampHeight(height);

          if (clamped !== null) onHeight?.(clamped);
        },
        "pv:open-link": ({ url }) => onOpenLink(url),
        "pv:state": ({ state }) => {
          store.write(id, state);
          onState?.();
        },
      })
    );
  };

  return (
    // The package types `WebView<P = undefined>` as `Props & P`, which is never without a `P`.
    <WebView<object>
      ref={view}
      source={{ html: document }}
      // Everything reaches `shouldStart`: a URL the whitelist fails is opened in Safari unasked.
      originWhitelist={["*"]}
      onShouldStartLoadWithRequest={(request) => {
        const start = policy.shouldStart(request);

        if (!start) onStopped();

        return start;
      }}
      onLoadEnd={() => policy.loaded()}
      onMessage={onMessage}
      onContentProcessDidTerminate={() => view.current?.reload()}
      javaScriptEnabled
      javaScriptCanOpenWindowsAutomatically={false}
      allowFileAccess={false}
      allowFileAccessFromFileURLs={false}
      allowUniversalAccessFromFileURLs={false}
      allowsLinkPreview={false}
      dataDetectorTypes="none"
      incognito
      cacheEnabled={false}
      setSupportMultipleWindows={false}
      scrollEnabled={mode === "expanded"}
      bounces={false}
      overScrollMode="never"
      showsVerticalScrollIndicator={mode === "expanded"}
      style={[{ backgroundColor: colours.panel }, style]}
      containerStyle={{ backgroundColor: colours.panel }}
    />
  );
};
