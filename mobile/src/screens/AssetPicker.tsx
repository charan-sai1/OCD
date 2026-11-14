import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import * as MediaLibrary from 'expo-media-library/legacy';

import { colors, duration, radius, space } from '../theme';
import { PrimaryButton } from '../ui';
import { Sheet } from './Sheet';

const COLS = 3;
const GAP = 2;
const PAGE = 120;

function mediaTypeParam(
  media: 'both' | 'image' | 'video',
): 'photo' | 'video' | ['photo', 'video'] {
  if (media === 'both') return ['photo', 'video'];
  return media === 'video' ? 'video' : 'photo';
}

/**
 * A plain camera-roll grid with tick boxes. It only chooses ids; the backup
 * engine still decides layout, duplicate handling, verification and catalog
 * updates, so a picked run behaves exactly like a condition-driven one.
 */
export function AssetPicker({
  media,
  initial,
  onClose,
  onConfirm,
}: {
  media: 'both' | 'image' | 'video';
  initial: string[];
  onClose: () => void;
  onConfirm: (ids: string[]) => void;
}) {
  const { width } = useWindowDimensions();
  const cell = Math.floor((width - GAP * (COLS - 1)) / COLS);

  const [assets, setAssets] = useState<MediaLibrary.Asset[]>([]);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(initial),
  );

  const loadingRef = useRef(false);

  const load = useCallback(
    async (after?: string) => {
      if (loadingRef.current) return;
      loadingRef.current = true;
      setLoading(true);
      try {
        const page = await MediaLibrary.getAssetsAsync({
          first: PAGE,
          after,
          mediaType: mediaTypeParam(media),
          sortBy: [['creationTime', false]] as [MediaLibrary.SortByKey, boolean][],
        });
        setAssets((prev) => (after ? [...prev, ...page.assets] : page.assets));
        setCursor(page.endCursor);
        setHasMore(page.hasNextPage);
        setError(null);
      } catch {
        setError('The camera roll could not be read. Check photo access and try again.');
        setHasMore(false);
      } finally {
        loadingRef.current = false;
        setLoading(false);
      }
    },
    [media],
  );

  // The picker mounts fresh on every open, so the first page is an external
  // read rather than derived state.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const confirm = () => {
    if (selected.size > 0) onConfirm([...selected]);
  };

  const footer = (
    <PrimaryButton
      label={
        selected.size === 0
          ? 'Choose at least one'
          : `Add ${selected.size.toLocaleString()} item${selected.size === 1 ? '' : 's'}`
      }
      onPress={confirm}
      disabled={selected.size === 0}
    />
  );

  return (
    <Sheet
      visible
      title="Choose items"
      subtitle="Tick the photos and videos to copy. Nothing on this phone is changed."
      onClose={onClose}
      footer={footer}
    >
      <View style={styles.bar}>
        <Text style={styles.count}>
          {selected.size > 0 ? `${selected.size.toLocaleString()} selected` : 'Nothing selected'}
        </Text>
        {selected.size > 0 ? (
          <Pressable
            onPress={() => setSelected(new Set())}
            accessibilityRole="button"
            accessibilityLabel="Clear selection"
            style={styles.clearHit}
          >
            <Text style={styles.clear}>Clear</Text>
          </Pressable>
        ) : null}
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <FlatList
        data={assets}
        keyExtractor={(item) => item.id}
        numColumns={COLS}
        columnWrapperStyle={{ gap: GAP }}
        contentContainerStyle={{ gap: GAP, paddingBottom: space(8) }}
        renderItem={({ item }) => {
          const isPicked = selected.has(item.id);
          const seconds = item.mediaType === 'video' ? item.duration : 0;
          return (
            <Pressable
              onPress={() => toggle(item.id)}
              accessibilityRole="button"
              accessibilityState={{ selected: isPicked }}
              accessibilityLabel={item.filename}
              style={{ width: cell, height: cell, backgroundColor: colors.surface }}
            >
              {item.uri ? (
                <Image
                  source={{ uri: item.uri }}
                  style={{ width: cell, height: cell }}
                  resizeMode="cover"
                />
              ) : null}
              {isPicked ? <View style={styles.pickedVeil} /> : null}
              <View
                style={[
                  styles.check,
                  isPicked && { backgroundColor: colors.text, borderColor: colors.text },
                ]}
              >
                {isPicked ? <Text style={styles.checkMark}>✓</Text> : null}
              </View>
              {seconds > 0 ? (
                <Text style={styles.badge}>{duration(seconds)}</Text>
              ) : null}
            </Pressable>
          );
        }}
        onEndReachedThreshold={0.6}
        onEndReached={() => {
          if (hasMore && !loadingRef.current && cursor) void load(cursor);
        }}
        initialNumToRender={36}
        maxToRenderPerBatch={36}
        windowSize={9}
        ListEmptyComponent={
          loading ? (
            <View style={styles.empty}>
              <ActivityIndicator color={colors.muted} />
            </View>
          ) : (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>No photos or videos here yet.</Text>
            </View>
          )
        }
        ListFooterComponent={
          loading && assets.length > 0 ? (
            <View style={styles.more}>
              <ActivityIndicator color={colors.muted} />
            </View>
          ) : undefined
        }
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space(4),
    paddingVertical: space(2),
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  count: { flex: 1, fontSize: 13, fontWeight: '600', color: colors.text },
  clearHit: {
    minHeight: 44,
    minWidth: 44,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  clear: { fontSize: 14, fontWeight: '600', color: colors.text },
  error: {
    marginHorizontal: space(4),
    marginTop: space(2),
    fontSize: 13,
    lineHeight: 18,
    color: colors.danger,
  },
  pickedVeil: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderWidth: 3,
    borderColor: colors.text,
  },
  check: {
    position: 'absolute',
    top: space(1.5),
    right: space(1.5),
    width: 22,
    height: 22,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.white,
    backgroundColor: 'rgba(0,0,0,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkMark: { color: colors.white, fontSize: 13, fontWeight: '800', marginTop: -1 },
  badge: {
    position: 'absolute',
    left: space(1.5),
    bottom: space(1.5),
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: radius.sm,
    backgroundColor: 'rgba(0,0,0,0.55)',
    color: colors.white,
    fontSize: 10,
    fontWeight: '600',
  },
  empty: { paddingTop: space(16), alignItems: 'center' },
  emptyText: { fontSize: 13, color: colors.muted },
  more: { paddingVertical: space(4), alignItems: 'center' },
});
