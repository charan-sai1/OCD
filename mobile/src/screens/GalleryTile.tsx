import { memo, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { api, GridItem } from '../api';
import { colors, takenOn } from '../theme';

export const Tile = memo(function Tile({
  item,
  server,
  size,
  onPress,
  onLongPress,
  onShare,
  selecting = false,
  selected = false,
  onToggleSelect,
}: {
  item: GridItem;
  server: string;
  size: number;
  onPress: () => void;
  onLongPress?: () => void;
  onShare?: () => void;
  selecting?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
}) {
  const [failed, setFailed] = useState(false);
  const label = [
    item.kind === 'video' ? 'Video' : 'Photo',
    item.name,
    item.kind === 'video' && item.dur ? formatDur(item.dur) : '',
    takenOn(item.shot),
    item.dir || 'Drive root',
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress ?? onShare}
      accessibilityRole="imagebutton"
      accessibilityLabel={label}
      accessibilityHint="Opens the full view"
      style={({ pressed }) => [
        { width: size, height: size, backgroundColor: colors.surface },
        pressed && { opacity: 0.72 },
      ]}
    >
      {!failed ? (
        <Image
          source={{ uri: api.thumb(server, item.key, 400) }}
          style={{ width: size, height: size }}
          resizeMode="cover"
          onError={() => setFailed(true)}
          fadeDuration={120}
        />
      ) : (
        <View style={styles.noPreview}>
          <Text style={styles.noPreviewText}>
            {item.kind === 'video' ? 'Video' : 'No preview'}
          </Text>
        </View>
      )}
      {item.kind === 'video' ? (
        <View style={styles.videoBadge}>
          <Text style={styles.videoText}>▶ {formatDur(item.dur)}</Text>
        </View>
      ) : null}

      {selecting ? (
        <Pressable
          onPress={(e) => {
            e.stopPropagation();
            onToggleSelect?.();
          }}
          style={[styles.selectBadge, selected && styles.selectBadgeOn]}
          accessibilityRole="checkbox"
          accessibilityState={{ selected }}
          accessibilityLabel={selected ? `Unselect ${item.name}` : `Select ${item.name}`}
        >
          {selected ? <Text style={styles.selectBadgeText}>✓</Text> : null}
        </Pressable>
      ) : onShare ? (
        <Pressable
          onPress={(e) => {
            e.stopPropagation();
            onShare();
          }}
          style={styles.shareButton}
          accessibilityRole="button"
          accessibilityLabel={`Share ${item.name}`}
        >
          <Text style={styles.shareText}>⤴</Text>
        </Pressable>
      ) : null}
    </Pressable>
  );
});

function formatDur(seconds: number | undefined): string {
  if (!seconds || seconds <= 0) return '';
  const s = Math.round(seconds);
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

const styles = StyleSheet.create({
  noPreview: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noPreviewText: { fontSize: 11, color: colors.faint },
  videoBadge: {
    position: 'absolute',
    right: 5,
    bottom: 5,
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
    backgroundColor: 'rgba(0,0,0,0.62)',
  },
  videoText: { color: colors.white, fontSize: 10, fontWeight: '700' },
  shareButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(17, 19, 21, 0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shareText: { color: colors.white, fontSize: 15, fontWeight: '700' },
  selectBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(17,19,21,0.55)',
    borderWidth: 2,
    borderColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectBadgeOn: {
    backgroundColor: colors.text,
  },
  selectBadgeText: {
    color: colors.white,
    fontSize: 14,
    fontWeight: '700',
  },
});
