/**
 * Product identity. The display name is a working name: it comes from PUBLIC_APP_NAME in `.env`
 * at build time, and this is the only module that reads it. Components import BRAND instead of
 * spelling the name, and a unit test fails if the name is hard-coded anywhere under src/.
 *
 * Storage keys and the IndexedDB database name deliberately do NOT derive from the brand, so a
 * rename never orphans a user's journal (see src/data/db/database.ts).
 */
const injected = typeof __APP_NAME__ === 'string' ? __APP_NAME__.trim() : '';

export const BRAND = {
  name: injected || 'Journal',
  version: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0',
} as const;
