import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
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
import { Wordmark } from './src/ui';
import { colors, space } from './src/theme';

export default function App() {
  const [booting, setBooting] = useState(true);
  const [server, setServer] = useState<string | null>(null);
  const [initial, setInitial] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

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
    <>
      <StatusBar style="dark" />
      <Gallery
        server={server}
        onChangeServer={() => {
          setServer(null);
          setProblem(null);
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  boot: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space(5),
  },
  spinner: { marginTop: space(2) },
});
