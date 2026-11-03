import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import {
  api,
  loadServer,
  messageFor,
  normalizeServer,
  saveServer,
} from './src/api';
import { Connect } from './src/screens/Connect';
import { Gallery } from './src/screens/Gallery';
import { Phone } from './src/screens/Phone';
import { Wordmark } from './src/ui';
import { colors, space } from './src/theme';

type Tab = 'drive' | 'phone';

export default function App() {
  const [booting, setBooting] = useState(true);
  const [server, setServer] = useState<string | null>(null);
  const [initial, setInitial] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [tab, setTab] = useState<Tab>('drive');

  useEffect(() => {
    (async () => {
      const saved = await loadServer();
      setInitial(saved);
      if (!saved) {
        setBooting(false);
        return;
      }
      try {
        await api.version(saved);
        setServer(saved);
      } catch (e) {
        setProblem(messageFor(e));
      } finally {
        setBooting(false);
      }
    })();
  }, []);

  const connect = useCallback(async (raw: string) => {
    const url = normalizeServer(raw);
    if (!url) return;
    setConnecting(true);
    setProblem(null);
    try {
      await api.version(url);
      await saveServer(url);
      setInitial(url);
      setServer(url);
      setTab('drive');
    } catch (e) {
      setProblem(messageFor(e));
    } finally {
      setConnecting(false);
    }
  }, []);

  if (booting) {
    return (
      <View style={styles.boot}>
        <StatusBar style="dark" />
        <Wordmark size={18} />
        <ActivityIndicator color={colors.muted} style={styles.spinner} />
      </View>
    );
  }

  if (!server) {
    return (
      <>
        <StatusBar style="dark" />
        <Connect
          initial={initial}
          busy={connecting}
          problem={problem}
          onConnect={connect}
        />
      </>
    );
  }

  return (
    <View style={styles.shell}>
      <StatusBar style="dark" />
      {tab === 'drive' ? (
        <Gallery
          server={server}
          onChangeServer={() => {
            setServer(null);
            setProblem(null);
          }}
        />
      ) : (
        <Phone
          server={server}
          onChangeServer={() => {
            setServer(null);
            setProblem(null);
          }}
        />
      )}
      <TabBar tab={tab} onChange={setTab} />
    </View>
  );
}

function TabBar({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  return (
    <View style={styles.tabs}>
      {(['drive', 'phone'] as const).map((t) => {
        const active = tab === t;
        return (
          <Pressable
            key={t}
            onPress={() => onChange(t)}
            style={styles.tab}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
          >
            <View style={[styles.dot, active && styles.dotActive]} />
            <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>
              {t === 'drive' ? 'Drive' : 'Phone'}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: colors.bg },
  tabs: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
    backgroundColor: colors.bg,
    paddingTop: space(2),
    paddingBottom: Platform.OS === 'ios' ? space(6) : space(2),
  },
  tab: { flex: 1, alignItems: 'center', gap: space(1), paddingVertical: space(0.5) },
  dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: 'transparent' },
  dotActive: { backgroundColor: colors.text },
  tabLabel: { fontSize: 12, fontWeight: '600', color: colors.faint },
  tabLabelActive: { color: colors.text },
  boot: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space(5),
  },
  spinner: { marginTop: space(2) },
});
