import assert from 'node:assert/strict';
import test from 'node:test';

import {
  OCD_PORT,
  cleanHost,
  findComputers,
  portFrom,
  subnetFrom,
} from '../src/discover.ts';

/** Runs `fn` with fetch replaced, restoring the real one even on failure. */
async function withFetch(fake, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = fake;
  try {
    return await fn();
  } finally {
    globalThis.fetch = real;
  }
}

test('a private address yields its /24, with or without a scheme and port', () => {
  assert.equal(subnetFrom('192.168.1.24:8090'), '192.168.1');
  assert.equal(subnetFrom('http://192.168.1.24:8090'), '192.168.1');
  assert.equal(subnetFrom('http://10.0.0.5/'), '10.0.0');
  assert.equal(subnetFrom('172.16.4.9'), '172.16.4');
  assert.equal(subnetFrom('172.31.255.1'), '172.31.255');
  assert.equal(subnetFrom(' 192.168.0.2 '), '192.168.0');
});

test('anything that is not private IPv4 is refused', () => {
  assert.equal(subnetFrom(null), null);
  assert.equal(subnetFrom(''), null);
  assert.equal(subnetFrom('localhost:8090'), null);
  assert.equal(subnetFrom('8.8.8.8'), null);
  assert.equal(subnetFrom('172.32.0.1'), null, '172.32 is outside the private range');
  assert.equal(subnetFrom('172.15.0.1'), null, '172.15 is outside the private range');
  assert.equal(subnetFrom('192.169.1.1'), null);
  assert.equal(subnetFrom('10.0.0.256'), null);
  assert.equal(subnetFrom('10.0.0'), null);
  assert.equal(subnetFrom('http://[::1]:8090'), null);
});

test('the port defaults to OCD\'s own and follows an explicit one', () => {
  assert.equal(portFrom(null), OCD_PORT);
  assert.equal(portFrom('192.168.1.4'), OCD_PORT);
  assert.equal(portFrom('192.168.1.4:9000'), 9000);
  assert.equal(portFrom('http://192.168.1.4:9000/api'), 9000);
});

test('cleanHost drops the scheme, the port and any path', () => {
  assert.equal(cleanHost('http://192.168.1.20:8090/api/photos'), '192.168.1.20');
  assert.equal(cleanHost('192.168.1.20'), '192.168.1.20');
  assert.equal(cleanHost(null), null);
});

test('a public hint never starts a scan', async () => {
  let calls = 0;
  const found = await withFetch(
    async () => {
      calls += 1;
      return { ok: true, json: async () => ({ current: '1.0.0' }) };
    },
    () => findComputers({ hint: '8.8.8.8' }),
  );
  assert.deepEqual(found, []);
  assert.equal(calls, 0, 'no socket may be opened for a public address');
});

test('the scan asks the hinted host first and returns only answering hosts', async () => {
  const asked = [];
  const found = await withFetch(
    async (url) => {
      asked.push(url);
      if (url.startsWith('http://192.168.1.20:')) {
        return { ok: true, json: async () => ({ current: '1.2.3' }) };
      }
      return { ok: false, json: async () => ({}) };
    },
    () =>
      findComputers({
        hint: '192.168.1.20:8090',
        onProgress: (done, total) => {
          assert.ok(done <= total);
          assert.equal(total, 254);
        },
      }),
  );

  assert.equal(asked.length, 254);
  assert.equal(asked[0], 'http://192.168.1.20:8090/api/version');
  assert.deepEqual(found, [
    { url: 'http://192.168.1.20:8090', version: '1.2.3', address: '192.168.1.20' },
  ]);
});

test('the scan uses the hint\'s port for every address', async () => {
  const asked = [];
  await withFetch(
    async (url) => {
      asked.push(url);
      return { ok: false, json: async () => ({}) };
    },
    () => findComputers({ hint: '10.0.0.7', port: 9090 }),
  );
  assert.ok(asked.every((url) => url.startsWith('http://10.0.0.') && url.includes(':9090/')));
});

test('an aborted scan stops without asking anything', async () => {
  let calls = 0;
  const ctl = new AbortController();
  ctl.abort();
  const found = await withFetch(
    async () => {
      calls += 1;
      return { ok: true, json: async () => ({ current: '1.0.0' }) };
    },
    () => findComputers({ hint: '192.168.1.20', signal: ctl.signal }),
  );
  assert.deepEqual(found, []);
  assert.equal(calls, 0);
});
