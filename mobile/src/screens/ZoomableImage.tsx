import React, { useCallback, useRef, useState } from 'react';
import {
  Animated,
  Image,
  StyleSheet,
} from 'react-native';
import {
  PanGestureHandler,
  PinchGestureHandler,
  State,
} from 'react-native-gesture-handler';

/**
 * Zooming starts at 1x; the picture can grow to MAX_SCALE. Pan is only live
 * while zoomed in, so the surrounding paged list keeps full control of swipes
 * at 1x. Handlers are plain event callbacks, which is how the compiler rule
 * expects refs to be read.
 */
const MAX_SCALE = 4;

export function ZoomableImage({
  source,
  width,
  height,
  accessibilityLabel,
}: {
  source: { uri: string };
  width: number;
  height: number;
  accessibilityLabel: string;
}) {
  const [scale] = useState(() => new Animated.Value(1));
  const [offsetX] = useState(() => new Animated.Value(0));
  const [offsetY] = useState(() => new Animated.Value(0));
  // Committed geometry, written only in event callbacks.
  const committed = useRef({ scale: 1, x: 0, y: 0 });
  const gesture = useRef({ startScale: 1, startX: 0, startY: 0 });
  const [zoomedIn, setZoomedIn] = useState(false);

  const clampScale = useCallback(
    (value: number) => Math.min(MAX_SCALE, Math.max(1, value)),
    [],
  );

  const maxOffset = useCallback(
    (forScale: number) => ({
      x: Math.max(0, (width * (forScale - 1)) / 2),
      y: Math.max(0, (height * (forScale - 1)) / 2),
    }),
    [height, width],
  );

  const clampX = useCallback(
    (x: number, forScale: number) => {
      const max = maxOffset(forScale).x;
      return Math.min(max, Math.max(-max, x));
    },
    [maxOffset],
  );

  const clampY = useCallback(
    (y: number, forScale: number) => {
      const max = maxOffset(forScale).y;
      return Math.min(max, Math.max(-max, y));
    },
    [maxOffset],
  );

  const apply = useCallback(
    (nextScale: number, nextX: number, nextY: number) => {
      const s = clampScale(nextScale);
      const x = clampX(nextX, s);
      const y = clampY(nextY, s);
      committed.current.scale = s;
      committed.current.x = x;
      committed.current.y = y;
      scale.setValue(s);
      offsetX.setValue(x);
      offsetY.setValue(y);
      setZoomedIn(s > 1.01);
    },
    [clampScale, clampX, clampY, offsetX, offsetY, scale],
  );

  const reset = useCallback(() => {
    apply(1, 0, 0);
  }, [apply]);

  const onPinchBegin = () => {
    gesture.current.startScale = committed.current.scale;
  };

  const onPinchEvent = (event: any) => {
    const e = event.nativeEvent;
    if (e.state === State.BEGAN || e.state === State.ACTIVE) {
      // e.scale is relative to the gesture's starting scale.
      apply(gesture.current.startScale * e.scale, committed.current.x, committed.current.y);
    }
  };

  const onPinchEnd = (event: any) => {
    if (event.nativeEvent.state !== State.END) return;
    if (committed.current.scale < 1.05) reset();
  };

  const onPanBegin = () => {
    gesture.current.startX = committed.current.x;
    gesture.current.startY = committed.current.y;
  };

  const onPanEvent = (event: any) => {
    const e = event.nativeEvent;
    if (e.state === State.BEGAN || e.state === State.ACTIVE) {
      apply(
        committed.current.scale,
        gesture.current.startX + e.translationX,
        gesture.current.startY + e.translationY,
      );
    }
  };

  const onPanEnd = (event: any) => {
    if (event.nativeEvent.state !== State.END) return;
    apply(committed.current.scale, committed.current.x, committed.current.y);
  };

  return (
    <PinchGestureHandler
      onBegan={onPinchBegin}
      onGestureEvent={onPinchEvent}
      onHandlerStateChange={onPinchEnd}
    >
      <PanGestureHandler
        enabled={zoomedIn}
        onBegan={onPanBegin}
        onGestureEvent={onPanEvent}
        onHandlerStateChange={onPanEnd}
      >
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            {
              transform: [{ scale }, { translateX: offsetX }, { translateY: offsetY }],
            },
          ]}
        >
          <Image
            source={source}
            style={{ width, height }}
            resizeMode="contain"
            fadeDuration={120}
            accessibilityLabel={accessibilityLabel}
          />
        </Animated.View>
      </PanGestureHandler>
    </PinchGestureHandler>
  );
}
