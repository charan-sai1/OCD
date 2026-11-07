import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';
import {
  api,
  loadServer,
  messageFor,
  normalizeServer,
  saveServer,
} from './src/api';
import { Connect } from './src/screens/Connect';
import { DirectDrive } from './src/screens/DirectDrive';
import { Gallery } from './src/screens/Gallery';
import { Phone } from './src/screens/Phone';
import { isDriveModuleAvailable } from './src/direct/native';
import { Wordmark } from './src/ui';
import { colors, space } from './src/theme';

type Tab = 'drive' | 'phone' | 'usb';

export default function App() {
  // Every screen reads its insets from here, so the provider has to sit above
  // them; without it useSafeAreaInsets falls back to zero and headers collide
  // with the notch again. The gesture root belongs here for the same reason:
  // screens deep in the tree cannot open the gesture system on their own.
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <Root />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function Root() {
  // A phone with the drive module can work without a computer, so it opens on
  // the USB tab instead of a connect screen that cannot be satisfied.
  const canBrowseDrive = Platform.OS === 'android' && isDriveModuleAvailable;

  const [booting, setBooting] = useState(true);
  const [server, setServer] = useState<string | null>(null);
  const [initial, setInitial] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [tab, setTab] = useState<Tab>(canBrowseDrive ? 'usb' : 'drive');

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
        // A saved desktop is the main way in; land there, not on USB.
        setTab('drive');
      } catch (e) {
        setProblem(messageFor(e));
        // Show the address field and its error rather than silently landing on USB.
        setTab('drive');
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
      <View style={styles.shell}>
        <StatusBar style="dark" />
        {tab === 'usb' && Platform.OS === 'android' ? (
          <DirectDrive />
        ) : (
          <Connect
            initial={initial}
            busy={connecting}
            problem={problem}
            onConnect={connect}
            onUseDrive={canBrowseDrive ? () => setTab('usb') : undefined}
          />
        )}
        <TabBar tab={tab} onChange={setTab} />
      </View>
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
      ) : tab === 'usb' ? (
        <DirectDrive />
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
  const insets = useSafeAreaInsets();
  // Only show the USB tab on Android, where SAF browsing is wired up. iOS
  // gets its own route once Dev builds exist.
  const tabs: readonly Tab[] = Platform.OS === 'android' ? ['drive', 'phone', 'usb'] : ['drive', 'phone'];
  return (
    <View
      style={[
        styles.tabs,
        // The bar owns the home indicator / gesture bar so nothing sits under it.
        { paddingBottom: Math.max(insets.bottom, space(2)) },
      ]}
    >
      {tabs.map((t) => {
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
              {t === 'drive' ? 'Drive' : t === 'phone' ? 'Phone' : 'USB'}
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
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space(1),
    minHeight: 44,
    paddingVertical: space(0.5),
  },
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
