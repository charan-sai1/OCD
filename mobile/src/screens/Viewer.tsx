import React, { useState } from 'react';
import {
  FlatList,
  Image,
  Linking,
  Modal,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import Constants from 'expo-constants';
import { api, GridItem } from '../api';
import { bytes, colors, duration, radius, space, takenOn } from '../theme';

type Props = {
  server: string;
  items: GridItem[];
  start: number;
  onClose: () => void;
};

export function Viewer({ server, items, start, onClose }: Props) {
  const { width, height } = useWindowDimensions();
  const [current, setCurrent] = useState(start);
  const item = items[current] ?? items[start];

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(e.nativeEvent.contentOffset.x / width);
    if (next !== current && next >= 0 && next < items.length) setCurrent(next);
  };

  const play = () => {
    if (!item) return;
    Linking.openURL(api.original(server, item.key)).catch(() => {
      // The browser is the player in v1; if it cannot open, the preview stays.
    });
  };

  return (
    <Modal visible animationType="fade" onRequestClose={onClose} statusBarTranslucent>
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
            setCurrent(index);
          }}
          onMomentumScrollEnd={onScroll}
          showsHorizontalScrollIndicator={false}
          initialNumToRender={1}
          maxToRenderPerBatch={2}
          windowSize={3}
          renderItem={({ item: it }) => (
            <View style={{ width, height, alignItems: 'center', justifyContent: 'center' }}>
              <Image
                source={{ uri: api.thumb(server, it.key, 1600) }}
                style={{ width, height }}
                resizeMode="contain"
                fadeDuration={120}
              />
              {it.kind === 'video' ? (
                <Pressable onPress={play} style={styles.play} accessibilityRole="button">
                  <Text style={styles.playText}>▶  Play video</Text>
                </Pressable>
              ) : null}
            </View>
          )}
        />

        <View style={[styles.top, { paddingTop: (Constants.statusBarHeight ?? 0) + space(2) }]}>
          <Text style={styles.position}>
            {current + 1} / {items.length}
          </Text>
          <Pressable onPress={onClose} hitSlop={14} accessibilityRole="button">
            <Text style={styles.done}>Done</Text>
          </Pressable>
        </View>

        {item ? (
          <View style={styles.bottom}>
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
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.black },
  top: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 84,
    paddingHorizontal: space(5),
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  position: { color: 'rgba(255,255,255,0.75)', fontSize: 13, fontWeight: '600' },
  done: { color: colors.white, fontSize: 16, fontWeight: '600' },
  bottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: space(5),
    paddingTop: space(4),
    paddingBottom: space(8),
    backgroundColor: 'rgba(0,0,0,0.55)',
    gap: 3,
  },
  name: { color: colors.white, fontSize: 16, fontWeight: '600' },
  meta: { color: 'rgba(255,255,255,0.7)', fontSize: 13 },
  path: { color: 'rgba(255,255,255,0.45)', fontSize: 12 },
  play: {
    position: 'absolute',
    alignSelf: 'center',
    paddingHorizontal: space(5),
    paddingVertical: space(3),
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.92)',
  },
  playText: { color: colors.black, fontSize: 15, fontWeight: '700' },
});
