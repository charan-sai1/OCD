import React, { useCallback, useEffect, useState } from 'react';
import {
  FlatList,
  Image,
  Modal,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useVideoPlayer, VideoView } from 'expo-video';
import { api, GridItem } from '../api';
import { TOUCH } from '../layout';
import { bytes, colors, duration, radius, space, takenOn } from '../theme';

type Props = {
  server: string;
  items: GridItem[];
  start: number;
  onClose: () => void;
};

export function Viewer({ server, items, start, onClose }: Props) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [position, setPosition] = useState({ index: start, playing: false });
  const { index: current, playing } = position;
  const item = items[current] ?? items[start];

  // Swiping or closing stops playback; nothing should keep streaming behind
  // the grid. This runs from the swipe handler rather than an effect so the
  // player is released in the same turn as the move.
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(e.nativeEvent.contentOffset.x / width);
    if (next !== current && next >= 0 && next < items.length) {
      setPosition({ index: next, playing: false });
    }
  };

  const close = () => {
    setPosition((p) => ({ ...p, playing: false }));
    onClose();
  };

  return (
    <Modal visible animationType="fade" onRequestClose={close} statusBarTranslucent>
      <StatusBar style="light" />
      <View style={styles.root}>
        <FlatList
          data={items}
          horizontal
          pagingEnabled
          keyExtractor={(it) => it.key}
          initialScrollIndex={start}
          getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
          onScrollToIndexFailed={({ index }) => {
            setPosition({ index, playing: false });
          }}
          onMomentumScrollEnd={onScroll}
          showsHorizontalScrollIndicator={false}
          initialNumToRender={1}
          maxToRenderPerBatch={2}
          windowSize={3}
          renderItem={({ item: it, index }) => (
            <View style={{ width, height, alignItems: 'center', justifyContent: 'center' }}>
              {it.kind === 'video' && index === current && playing ? (
                <VideoSlide
                  key={it.key}
                  source={api.original(server, it.key)}
                  width={width}
                  height={height}
                  onClose={() => setPosition((p) => ({ ...p, playing: false }))}
                />
              ) : (
                <>
                  <Image
                    source={{ uri: api.thumb(server, it.key, 1600) }}
                    style={{ width, height }}
                    resizeMode="contain"
                    fadeDuration={120}
                    accessibilityLabel={
                      it.kind === 'video' ? `Video still, ${it.name}` : `Photo, ${it.name}`
                    }
                  />
                  {it.kind === 'video' ? (
                    <Pressable
                      onPress={() => {
                        if (index === current) setPosition({ index, playing: true });
                      }}
                      style={({ pressed }) => [styles.play, pressed && { opacity: 0.8 }]}
                      accessibilityRole="button"
                      accessibilityLabel={`Play ${it.name}`}
                      accessibilityHint="Plays the video from the drive"
                    >
                      <Text style={styles.playText}>▶  Play video</Text>
                    </Pressable>
                  ) : null}
                </>
              )}
            </View>
          )}
        />

        {!playing ? (
          <>
            <View style={[styles.top, { paddingTop: insets.top + space(1) }]}>
              <Text style={styles.position}>
                {current + 1} / {items.length}
              </Text>
              <Pressable
                onPress={close}
                style={styles.done}
                accessibilityRole="button"
                accessibilityLabel="Close"
              >
                <Text style={styles.doneText}>Done</Text>
              </Pressable>
            </View>

            {item ? (
              <View style={[styles.bottom, { paddingBottom: insets.bottom + space(4) }]}>
                <Text style={styles.name} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={styles.meta}>
                  {[takenOn(item.shot), item.kind === 'video' ? duration(item.dur) : '', bytes(item.size)]
                    .filter(Boolean)
                    .join('  ·  ')}
                </Text>
                <Text style={styles.path} numberOfLines={1}>
                  {item.dir || 'Drive root'}
                </Text>
              </View>
            ) : null}
          </>
        ) : null}
      </View>
    </Modal>
  );
}

/**
 * VideoSlide plays the original straight from the computer over Wi-Fi. The
 * server answers range requests, so the native player can seek without
 * downloading the whole file first.
 */
function VideoSlide({
  source,
  width,
  height,
  onClose,
}: {
  source: string;
  width: number;
  height: number;
  onClose: () => void;
}) {
  const [problem, setProblem] = useState<string | null>(null);

  const player = useVideoPlayer(source, (p) => {
    p.timeUpdateEventInterval = 1;
    p.play();
  });

  const report = useCallback((message: string) => setProblem(message), []);

  useEffect(() => {
    const sub = player.addListener('statusChange', ({ status, error }) => {
      if (status === 'error') {
        report(
          error?.message
            ? `Could not play this video: ${error.message}`
            : 'Could not play this video. Check the drive is still connected.',
        );
      }
    });
    return () => {
      sub.remove();
    };
  }, [player, report]);

  return (
    <View style={[StyleSheet.absoluteFill, styles.videoRoot]}>
      <VideoView
        player={player}
        style={{ width, height }}
        nativeControls
        contentFit="contain"
        // textureView keeps the player under our own close button on Android;
        // a surfaceView would draw over it.
        surfaceType="textureView"
        accessibilityLabel="Video player"
      />
      <Pressable
        onPress={onClose}
        style={({ pressed }) => [styles.videoClose, pressed && { opacity: 0.7 }]}
        accessibilityRole="button"
        accessibilityLabel="Stop video and go back"
      >
        <Text style={styles.videoCloseText}>✕</Text>
      </Pressable>
      {problem ? (
        <View style={styles.videoProblem} accessibilityRole="alert">
          <Text style={styles.videoProblemText}>{problem}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.black },
  top: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: space(4),
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  position: { color: 'rgba(255,255,255,0.75)', fontSize: 13, fontWeight: '600' },
  done: {
    minHeight: TOUCH,
    minWidth: TOUCH,
    paddingHorizontal: space(2),
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneText: { color: colors.white, fontSize: 16, fontWeight: '600' },
  bottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: space(5),
    paddingTop: space(4),
    backgroundColor: 'rgba(0,0,0,0.55)',
    gap: 3,
  },
  name: { color: colors.white, fontSize: 16, fontWeight: '600' },
  meta: { color: 'rgba(255,255,255,0.7)', fontSize: 13 },
  path: { color: 'rgba(255,255,255,0.45)', fontSize: 12 },
  play: {
    position: 'absolute',
    alignSelf: 'center',
    minHeight: TOUCH,
    justifyContent: 'center',
    paddingHorizontal: space(5),
    paddingVertical: space(3),
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.92)',
  },
  playText: { color: colors.black, fontSize: 15, fontWeight: '700' },
  videoRoot: { backgroundColor: colors.black },
  videoClose: {
    position: 'absolute',
    top: space(2),
    right: space(2),
    width: TOUCH,
    height: TOUCH,
    borderRadius: TOUCH / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  videoCloseText: { color: colors.white, fontSize: 18, fontWeight: '700' },
  videoProblem: {
    position: 'absolute',
    left: space(4),
    right: space(4),
    bottom: space(6),
    padding: space(3),
    borderRadius: radius.md,
    backgroundColor: 'rgba(180,35,24,0.92)',
  },
  videoProblemText: { color: colors.white, fontSize: 13, lineHeight: 18 },
});
