/** A pushed screen that follows a swipe from the left edge and goes back when it commits. */
import { midnight } from "@polaris/ui/tokens";
import { type ReactNode, useMemo, useRef } from "react";
import { Animated, PanResponder, StyleSheet, useWindowDimensions, View } from "react-native";
import { commitsSwipeBack, startsSwipeBack } from "./swipeBack.ts";

export const SwipeBack = ({
  onBack,
  children,
}: {
  readonly onBack: () => void;
  readonly children: ReactNode;
}) => {
  const { width } = useWindowDimensions();
  const x = useRef(new Animated.Value(0)).current;
  const latest = useRef({ onBack, width });
  latest.current = { onBack, width };

  const responder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponderCapture: (_e, g) => startsSwipeBack(g.x0, g.dx, g.dy),
        onPanResponderMove: (_e, g) => x.setValue(Math.max(0, g.dx)),
        onPanResponderRelease: (_e, g) => {
          const { onBack: back, width: w } = latest.current;

          if (!commitsSwipeBack(g.dx, g.vx, w)) {
            Animated.spring(x, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start();

            return;
          }

          Animated.timing(x, { toValue: w, duration: 180, useNativeDriver: true }).start(() => {
            back();
            x.setValue(0);
          });
        },
        onPanResponderTerminate: () =>
          Animated.spring(x, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start(),
      }),
    [x]
  );

  return (
    <View style={styles.fill}>
      <Animated.View
        style={[styles.fill, styles.screen, { transform: [{ translateX: x }] }]}
        {...responder.panHandlers}
      >
        {children}
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  fill: { flex: 1 },
  screen: { backgroundColor: midnight.bg },
});
