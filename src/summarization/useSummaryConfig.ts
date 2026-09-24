import { useLiveQuery } from '../data/hooks';
import { loadSummaryConfig } from './service';
import type { SummaryProviderConfig } from './types';

export function useSummaryConfig(): { config: SummaryProviderConfig; loading: boolean } {
  const q = useLiveQuery(loadSummaryConfig, [], ['settings']);
  return { config: q.data ?? { kind: 'none' }, loading: q.loading && !q.data };
}
