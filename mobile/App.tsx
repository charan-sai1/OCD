import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
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
import { useDriveSession } from './src/direct/session';
import { Backups } from './src/screens/Backups';
import { Devices } from './src/screens/Devices';
import { Photos } from './src/screens/Photos';
import { Settings } from './src/screens/Settings';
import { Space } from './src/screens/Space';
import { Wordmark } from './src/ui';
import { colors, space } from './src/theme';

type Tab = 'photos' | 'devices' | 'backups' | 'space' | 'settings';

const TABS: readonly Tab[] = ['photos', 'devices', 'backups', 'space', 'settings'];

const LABELS: Record<Tab, string> = {
  photos: 'Photos',
  devices: 'Devices',
  backups: 'Backups',
  space: 'Space',
  settings: 'Settings',
};

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
  // One drive session for the whole app: Photos, Devices, Backups and Space all
  // read the same connection, and the first usable volume opens by itself.
  const drive = useDriveSession();

  const [booting, setBooting] = useState(true);
  const [server, setServer] = useState<string | null>(null);
  const [initial, setInitial] = useState('');
  const [tab, setTab] = useState<Tab>('photos');
  const [phoneRevision, setPhoneRevision] = useState(0);

  useEffect(() => {
    (async () => {
      const saved = await loadServer();
      setInitial(saved);
      if (saved) {
        try {
          await api.version(saved);
          setServer(saved);
        } catch {
          // Keep the address in the form so the user can try again, but do not
          // pretend a computer answered. The other tabs still work.
          setServer(null);
        }
      }
      setBooting(false);
    })();
  }, []);

  const connectTo = useCallback(async (raw: string): Promise<string | null> => {
    const url = normalizeServer(raw);
    if (!url) return 'Type the address shown on the computer.';
    try {
      await api.version(url);
      await saveServer(url);
      setInitial(url);
      setServer(url);
      return null;
    } catch (e) {
      return messageFor(e);
    }
  }, []);

  const forgetComputer = useCallback(() => {
    void saveServer('');
    setInitial('');
    setServer(null);
  }, []);

  const phoneChanged = useCallback(() => {
    setPhoneRevision((n) => n + 1);
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

  return (
    <View style={styles.shell}>
      <StatusBar style="dark" />
      <View style={styles.screenWrap}>
        <View style={[styles.screen, tab !== 'photos' && styles.hidden]}>
          <Photos
            server={server}
            drive={drive}
            onOpenDevices={() => setTab('devices')}
            phoneRevision={phoneRevision}
          />
        </View>

        <View style={[styles.screen, tab !== 'devices' && styles.hidden]}>
          <Devices
            server={server}
            initialUrl={initial}
            connectTo={connectTo}
            forgetComputer={forgetComputer}
            drive={drive}
          />
        </View>

        <View style={[styles.screen, tab !== 'backups' && styles.hidden]}>
          <Backups
            server={server}
            drive={drive}
            onOpenDevices={() => setTab('devices')}
            onOpenSpace={() => setTab('space')}
            phoneRevision={phoneRevision}
            onPhoneChanged={phoneChanged}
          />
        </View>

        <View style={[styles.screen, tab !== 'space' && styles.hidden]}>
          <Space
            server={server}
            drive={drive}
            onOpenDevices={() => setTab('devices')}
            phoneRevision={phoneRevision}
            onDeleted={phoneChanged}
          />
        </View>

        <View style={[styles.screen, tab !== 'settings' && styles.hidden]}>
          <Settings server={server} onChangeServer={() => setTab('devices')} />
        </View>
      </View>

      <TabBar tab={tab} onChange={setTab} />
    </View>
  );
}

function TabBar({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.tabs,
        // The bar owns the home indicator / gesture bar so nothing sits under it.
        { paddingBottom: Math.max(insets.bottom, space(2)) },
      ]}
    >
      {TABS.map((t) => {
        const active = tab === t;
        return (
          <Pressable
            key={t}
            onPress={() => onChange(t)}
            style={styles.tab}
            accessibilityRole="tab"
            accessibilityLabel={LABELS[t]}
            accessibilityState={{ selected: active }}
          >
            <View style={[styles.dot, active && styles.dotActive]} />
            <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>
              {LABELS[t]}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: colors.bg },
  screenWrap: { flex: 1 },
  screen: { flex: 1 },
  hidden: { display: 'none' },
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
  tabLabel: { fontSize: 11, fontWeight: '600', color: colors.faint },
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
