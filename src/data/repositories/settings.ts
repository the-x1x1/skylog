import { notifyChange } from '../db/changes';
import { getDb } from '../db/database';
import type { SettingRecord } from '../types';

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const db = await getDb();
  const rec = await db.read('settings', (tx) => tx.get<SettingRecord<T>>('settings', key));
  return rec ? rec.value : fallback;
}

export async function setSetting<T>(key: string, value: T): Promise<void> {
  const db = await getDb();
  await db.write('settings', (tx) => tx.put('settings', { key, value } satisfies SettingRecord<T>));
  notifyChange({ stores: ['settings'] });
}
