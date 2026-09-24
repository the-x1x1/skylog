import type { Migration } from '../db/idb';

/**
 * Versioned schema. Never edit a migration that has shipped: append a new one.
 * Each migration's structural changes run first, then its optional data `upgrade`.
 */
export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: 'Initial schema: source data, derived entries, edits, imports, settings.',
    createStores: [
      {
        name: 'conversations',
        keyPath: 'id',
        indexes: [
          { name: 'bySourceKey', keyPath: ['source', 'sourceConversationId'], unique: true },
          { name: 'importBatchId', keyPath: 'importBatchId' },
        ],
      },
      {
        name: 'messages',
        keyPath: 'id',
        indexes: [{ name: 'conversationId', keyPath: 'conversationId' }],
      },
      {
        name: 'images',
        keyPath: 'id',
        indexes: [
          { name: 'entryId', keyPath: 'entryId' },
          { name: 'conversationId', keyPath: 'conversationId' },
        ],
      },
      { name: 'blobs', keyPath: 'key' },
      {
        name: 'entries',
        keyPath: 'id',
        indexes: [
          { name: 'conversationId', keyPath: 'conversationId', unique: true },
          { name: 'source', keyPath: 'source' },
          { name: 'chatDate', keyPath: 'chatDate' },
          { name: 'importedAt', keyPath: 'importedAt' },
          { name: 'tags', keyPath: 'tags', multiEntry: true },
          { name: 'collectionId', keyPath: 'collectionId' },
        ],
      },
      { name: 'edits', keyPath: 'entryId' },
      { name: 'collections', keyPath: 'id', indexes: [{ name: 'nameKey', keyPath: 'nameKey', unique: true }] },
      { name: 'imports', keyPath: 'id', indexes: [{ name: 'startedAt', keyPath: 'startedAt' }] },
      { name: 'settings', keyPath: 'key' },
    ],
  },
  {
    version: 2,
    description: 'Index entries by updatedAt and backfill summaryOutdated for entries written by v1.',
    createIndexes: [{ store: 'entries', index: { name: 'updatedAt', keyPath: 'updatedAt' } }],
    upgrade: async (tx) => {
      const entries = await tx.getAll<Record<string, unknown>>('entries');
      for (const e of entries) {
        let changed = false;
        if (typeof e.summaryOutdated !== 'boolean') {
          e.summaryOutdated = false;
          changed = true;
        }
        if (typeof e.updatedAt !== 'string') {
          e.updatedAt = typeof e.importedAt === 'string' ? e.importedAt : new Date(0).toISOString();
          changed = true;
        }
        if (changed) await tx.put('entries', e);
      }
    },
  },
];

export const SCHEMA_VERSION = MIGRATIONS.at(-1)?.version ?? 1;

export const ALL_STORES = [
  'conversations',
  'messages',
  'images',
  'blobs',
  'entries',
  'edits',
  'collections',
  'imports',
  'settings',
] as const;

export type StoreName = (typeof ALL_STORES)[number];
