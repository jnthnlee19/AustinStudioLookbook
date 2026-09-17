import { randomUUID } from 'node:crypto';

// Serialize capacity-changing writes across function instances. Conditional blob
// writes prevent two customers from both claiming the last available place.
export async function withBookingWriteLock(store, callback) {
  const key = 'locks/booking-writes';
  const current = await store.getWithMetadata(key, { type: 'json' });
  const busy = () => Object.assign(new Error('Scheduling is being updated. Please try again in a moment.'), { status: 409 });
  if (current?.data?.expiresAt > Date.now()) throw busy();
  if (current && !current.etag) throw busy();
  const expiresAt = Date.now() + 5 * 60 * 1000;
  const lease = await store.setJSON(key, { token: randomUUID(), expiresAt }, current ? { onlyIfMatch: current.etag } : { onlyIfNew: true });
  if (!lease.modified || !lease.etag) throw busy();
  try {
    return await callback(() => { if (Date.now() >= expiresAt) throw busy(); });
  } finally {
    // Never release a newer owner's lock. A crashed function's lease expires.
    try {
      await store.setJSON(key, { expiresAt: 0 }, { onlyIfMatch: lease.etag });
    } catch (error) {
      console.error('Could not release booking write lease; it will expire.', error);
    }
  }
}
