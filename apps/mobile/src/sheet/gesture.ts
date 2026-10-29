/**
 * The sheet's drag: one pan over the whole sheet, simultaneous with the body's scroll. A frame
 * moves the sheet unless the scroll can take it: up once the sheet is at its tallest, down while
 * the body is scrolled. The sheet holds the scroll still while it moves.
 */
import { useNativeGesture, usePanGesture } from "react-native-gesture-handler";
import Animated, {
  cancelAnimation,
  scrollTo,
  type SharedValue,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useSharedValue,
} from "react-native-reanimated";
import { dragHeight, settle, type SheetRoom } from "./detents.ts";
import type { SheetMotion } from "./motion.ts";

interface Bounds {
  readonly top: number;
  readonly bottom: number;
}

export interface SheetGestureInput {
  readonly motion: SheetMotion;
  readonly heights: readonly number[];
  readonly room: SheetRoom;
  readonly dismissible: boolean;
}

interface DragState {
  /** The height the finger asks for, before the rubber band. */
  readonly requested: SharedValue<number>;
  /** Began inside the scrolling body. */
  readonly inBody: SharedValue<boolean>;
  /** The sheet moved during this drag; it settles on release. */
  readonly moved: SharedValue<boolean>;
  /** The last frame moved the sheet, so the release's velocity is the sheet's. */
  readonly sheetFrame: SharedValue<boolean>;
  /** Caught mid-animation by the touch. */
  readonly caught: SharedValue<boolean>;
  /** Where the scroll is held while the sheet moves. */
  readonly lock: SharedValue<number>;
}

const scrollTakes = (dy: number, atTallest: boolean, scrollY: number) => {
  "worklet";

  return dy < 0 ? atTallest : scrollY > 0.5;
};

export const useSheetGesture = ({ motion, heights, room, dismissible }: SheetGestureInput) => {
  const { visible, index, settleTo } = motion;
  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const scrollY = useSharedValue(0);
  const contentHeight = useSharedValue(0);
  const bounds = useSharedValue<Bounds>({ top: 0, bottom: 0 });

  const drag: DragState = {
    requested: useSharedValue(0),
    inBody: useSharedValue(false),
    moved: useSharedValue(false),
    sheetFrame: useSharedValue(false),
    caught: useSharedValue(false),
    lock: useSharedValue(0),
  };

  const tallest = heights[heights.length - 1] ?? 0;

  const onScroll = useAnimatedScrollHandler((event) => {
    scrollY.set(event.contentOffset.y);
  });

  const native = useNativeGesture({});

  const pan = usePanGesture({
    simultaneousWith: native,
    activeOffsetY: [-6, 6],
    failOffsetX: [-20, 20],
    onBegin: () => {
      "worklet";
      const target = heights[index.get()] ?? 0;

      drag.caught.set(index.get() >= 0 && Math.abs(visible.get() - target) > 0.5);
      cancelAnimation(visible);
    },
    onActivate: (event) => {
      "worklet";
      const { top, bottom } = bounds.get();

      drag.requested.set(visible.get());
      const scrollable = contentHeight.get() > bottom - top + 1;

      drag.inBody.set(scrollable && event.y >= top && event.y <= bottom);
      drag.moved.set(false);
      drag.lock.set(scrollY.get());
    },
    onUpdate: (event) => {
      "worklet";
      const dy = event.changeY;
      const atTallest = visible.get() >= tallest - 0.5;

      if (drag.inBody.get() && scrollTakes(dy, atTallest, scrollY.get())) {
        drag.requested.set(visible.get());
        drag.lock.set(scrollY.get());
        drag.sheetFrame.set(false);

        return;
      }

      drag.requested.set(drag.requested.get() - dy);
      visible.set(dragHeight(drag.requested.get(), tallest, room));
      drag.moved.set(true);
      drag.sheetFrame.set(true);

      if (drag.inBody.get()) scrollTo(scrollRef, 0, drag.lock.get(), false);
    },
    onDeactivate: (event) => {
      "worklet";

      if (index.get() < 0 || !drag.moved.get()) return;

      const velocity = drag.sheetFrame.get() ? event.velocityY : 0;

      drag.moved.set(false);
      drag.caught.set(false);
      settleTo(settle(heights, visible.get(), velocity, dismissible), -velocity);
    },
    onFinalize: () => {
      "worklet";

      // A tap that caught the sheet mid-flight lets it go on to its detent.
      if (index.get() >= 0 && drag.caught.get())
        settleTo({ kind: "detent", index: index.get() }, 0);

      drag.caught.set(false);
    },
  });

  return {
    pan,
    native,
    scrollRef,
    onScroll,
    /** The body's place in the sheet, from its `onLayout`. */
    setBounds: (top: number, height: number) => bounds.set({ top, bottom: top + height }),
    /** The body's content height, from `onContentSizeChange`. */
    setContentHeight: (height: number) => contentHeight.set(height),
  };
};
