import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { withBookingWriteLock } from '../netlify/functions/lib/booking-write-lock.mjs';

const records = new Map();
let revision = 0;
const store = {
  async get(key) { return structuredClone(records.get(key)?.data || null); },
  async getWithMetadata(key) { return structuredClone(records.get(key) || null); },
  async list({ prefix }) { return { blobs: [...records.keys()].filter(key => key.startsWith(prefix)).map(key => ({ key })) }; },
  async delete(key) { records.delete(key); },
  async setJSON(key, data, options = {}) {
    if (options.onlyIfNew && records.has(key)) return { modified: false };
    if (options.onlyIfMatch && records.get(key)?.etag !== options.onlyIfMatch) return { modified: false };
    const etag = String(++revision);
    records.set(key, { data: structuredClone(data), etag });
    return { modified: true, etag };
  }
};
globalThis.testBookingStore = store;
let source = await readFile(new URL('../netlify/functions/booking-api.mjs', import.meta.url), 'utf8');
source = source.replace('import { getStore } from "@netlify/blobs";', 'const getStore = () => globalThis.testBookingStore;');
source = source.replace('"./lib/booking-write-lock.mjs"', JSON.stringify(new URL('../netlify/functions/lib/booking-write-lock.mjs', import.meta.url).href));
source = source.replace("'../../assets/booking-schedule.mjs'", JSON.stringify(new URL('../assets/booking-schedule.mjs', import.meta.url).href));
const { default: handler } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const post = (action, data) => handler(new Request(`https://example.test/.netlify/functions/booking-api?action=${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }));
const booking = type => ({ type, date: '2026-09-16', time: '10:00', name: 'Test Customer', email: 'test@example.test', phone: '555-0100' });

test('API enforces shared capacity on submission and declined-request restoration', async () => {
  records.clear();
  const first = await post('request', booking('final'));
  assert.equal(first.status, 201);
  const { id } = await first.json();
  assert.equal((await post('request', booking('virtual'))).status, 201);
  assert.equal((await post('request', booking('final'))).status, 409);
  assert.equal((await post('status', { id, status: 'declined' })).status, 200);
  assert.equal((await post('request', booking('virtual'))).status, 201);
  assert.equal((await post('status', { id, status: 'confirmed' })).status, 409);
});
test('API rejects minute-level rule times and accepts half hours and all day', async () => {
  records.clear();
  const data = { kind: 'off', person: 'Jonathan', recurrence: 'once', startDate: '2026-09-16' };
  assert.equal((await post('rule', { ...data, startTime: '10:15', endTime: '11:00' })).status, 400);
  assert.equal((await post('rule', { ...data, startTime: '10:30', endTime: '11:00' })).status, 201);
  assert.equal((await post('rule', data)).status, 201);
  assert.equal((await post('request', booking('final'))).status, 201);
  assert.equal((await post('request', booking('virtual'))).status, 409);
});
test('simultaneous writers cannot both claim the last slot', async () => {
  records.clear();
  await post('request', booking('final'));
  const results = await Promise.all([post('request', booking('virtual')), post('request', booking('final'))]);
  assert.deepEqual(results.map(result => result.status).sort(), [201, 409]);
  assert.equal([...records.keys()].filter(key => key.startsWith('requests/')).length, 2);
});
test('write lock releases after failure and can recover an expired lease', async () => {
  records.clear();
  await assert.rejects(withBookingWriteLock(store, async () => { throw new Error('test failure'); }), /test failure/);
  assert.equal(await withBookingWriteLock(store, async () => 'ok'), 'ok');
  await store.setJSON('locks/booking-writes', { expiresAt: Date.now() - 1 });
  assert.equal(await withBookingWriteLock(store, async () => 'recovered'), 'recovered');
});

test('assignment persists and can be changed or cleared without changing status', async () => {
  records.clear();
  const { id } = await (await post('request', booking('final'))).json();
  assert.equal((await post('assign', { id, assignedTo: 'Jonathan' })).status, 200);
  assert.equal((await store.get(`requests/${id}`)).assignedTo, 'Jonathan');
  assert.equal((await post('assign', { id, assignedTo: 'Juan' })).status, 200);
  assert.equal((await store.get(`requests/${id}`)).assignedTo, 'Juan');
  assert.equal((await store.get(`requests/${id}`)).status, 'requested');
  assert.equal((await post('assign', { id, assignedTo: '' })).status, 200);
  assert.equal((await store.get(`requests/${id}`)).assignedTo, '');
  assert.equal((await post('assign', { id, assignedTo: 'Other' })).status, 400);
  assert.equal((await post('assign', { id })).status, 400);
  assert.equal((await post('assign', { id: 'missing', assignedTo: 'Juan' })).status, 404);
  await post('status', { id, status: 'declined' });
  assert.equal((await post('assign', { id, assignedTo: 'Juan' })).status, 409);
});

test('assignment prevents double booking while preserving room for unassigned requests', async () => {
  records.clear();
  const { id: first } = await (await post('request', booking('final'))).json();
  const { id: second } = await (await post('request', booking('virtual'))).json();
  assert.equal((await post('assign', { id: first, assignedTo: 'Jonathan' })).status, 200);
  assert.equal((await post('assign', { id: second, assignedTo: 'Jonathan' })).status, 409);
  assert.equal((await post('assign', { id: second, assignedTo: 'Missy' })).status, 200);
  const { id: discovery } = await (await post('request', { ...booking('discovery'), time: '11:00' })).json();
  assert.equal((await post('assign', { id: discovery, assignedTo: 'Juan' })).status, 200);
  assert.equal((await post('assign', { id: discovery, assignedTo: 'Missy' })).status, 409);
});

test('assignment respects partial meetings, Virtual Only, and physical front desk coverage', async () => {
  records.clear();
  const { id } = await (await post('request', booking('virtual'))).json();
  await post('rule', { kind: 'off', person: 'Jonathan', recurrence: 'once', startDate: '2026-09-16' });
  await post('rule', { kind: 'virtual', person: 'Missy', recurrence: 'once', startDate: '2026-09-16' });
  assert.equal((await post('assign', { id, assignedTo: 'Jonathan' })).status, 409);
  assert.equal((await post('assign', { id, assignedTo: 'Juan' })).status, 409);
  assert.equal((await post('assign', { id, assignedTo: 'Missy' })).status, 200);
  await post('rule', { kind: 'meeting', person: 'Missy', recurrence: 'once', startDate: '2026-09-16', startTime: '11:00', endTime: '11:30' });
  assert.equal((await post('assign', { id, assignedTo: 'Missy' })).status, 409);
  assert.equal((await post('assign', { id, assignedTo: '' })).status, 200);
});

test('a declined assigned request cannot be restored onto an unavailable consultant', async () => {
  records.clear();
  const { id } = await (await post('request', booking('final'))).json();
  await post('assign', { id, assignedTo: 'Jonathan' });
  await post('status', { id, status: 'declined' });
  await post('rule', { kind: 'off', person: 'Jonathan', recurrence: 'once', startDate: '2026-09-16' });
  assert.equal((await post('status', { id, status: 'confirmed' })).status, 409);
});
