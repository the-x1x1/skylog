import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ImportBatch, ImportOptions, Source } from '../../data/types';
import type { DetectionResult } from '../../importers/core/detect';
import type { ImportPreview, ImportProgress } from '../../importers/core/types';
import { createImportSession, type ImportSession } from '../../importers/worker/client';
import { recoverInterruptedWork } from '../../data/recovery';
import { loadSummaryConfig } from '../../summarization/service';
import { useLocation } from '../router';

export type ImportStep =
  | { kind: 'choose'; error?: string }
  | { kind: 'opening'; fileName: string }
  | { kind: 'pick-source'; fileName: string; detection: DetectionResult }
  | { kind: 'previewing'; fileName: string }
  | { kind: 'preview'; preview: ImportPreview; ambiguous: boolean }
  | { kind: 'running'; preview: ImportPreview; progress: ImportProgress | null; cancelling: boolean }
  | { kind: 'done'; batch: ImportBatch };

interface ImportContextValue {
  step: ImportStep;
  options: ImportOptions;
  setOptions: (o: ImportOptions) => void;
  openFile: (file: File) => Promise<void>;
  chooseSource: (source: Source, fileName: string) => Promise<void>;
  start: (preview: ImportPreview) => Promise<void>;
  cancel: () => void;
  reset: (error?: string) => void;
}

const ImportContext = createContext<ImportContextValue | null>(null);

/**
 * Owns the import session for the whole app, so an import keeps running while the user browses
 * other pages. Closing the tab mid-import asks for confirmation.
 */
export function ImportProvider({ children }: { children: ReactNode }) {
  const [step, setStep] = useState<ImportStep>({ kind: 'choose' });
  const [options, setOptions] = useState<ImportOptions>({ generateSummaries: false, importImages: true, skipExisting: true, autoTag: true });
  const sessionRef = useRef<ImportSession | null>(null);

  const session = () => {
    if (!sessionRef.current) sessionRef.current = createImportSession();
    return sessionRef.current;
  };

  const reset = useCallback((error?: string) => {
    sessionRef.current?.dispose();
    sessionRef.current = null;
    setStep({ kind: 'choose', error });
  }, []);

  const openFile = useCallback(
    async (file: File) => {
      setStep({ kind: 'opening', fileName: file.name });
      try {
        const { detection, preview } = await session().open(file);
        if (preview && !detection.ambiguous) setStep({ kind: 'preview', preview, ambiguous: false });
        else setStep({ kind: 'pick-source', fileName: file.name, detection });
      } catch (err) {
        reset(err instanceof Error ? err.message : String(err));
      }
    },
    [reset],
  );

  const chooseSource = useCallback(
    async (source: Source, fileName: string) => {
      setStep({ kind: 'previewing', fileName });
      try {
        const preview = await session().preview(source);
        setStep({ kind: 'preview', preview, ambiguous: true });
      } catch (err) {
        reset(err instanceof Error ? err.message : String(err));
      }
    },
    [reset],
  );

  const start = useCallback(
    async (preview: ImportPreview) => {
      setStep({ kind: 'running', preview, progress: null, cancelling: false });
      try {
        const summaryConfig = await loadSummaryConfig();
        const batch = await session().start({ source: preview.source, options, summaryConfig }, (progress) =>
          setStep((s) => (s.kind === 'running' ? { ...s, progress } : s)),
        );
        setStep({ kind: 'done', batch });
      } catch (err) {
        reset(err instanceof Error ? err.message : String(err));
        // The worker may have died mid-import; settle anything it left running or pending.
        void recoverInterruptedWork().catch(() => undefined);
      }
    },
    [options, reset],
  );

  const cancel = useCallback(() => {
    setStep((s) => (s.kind === 'running' ? { ...s, cancelling: true } : s));
    sessionRef.current?.cancel();
  }, []);

  // Once you've seen a finished import (or an error) and leave the Import page, the next visit
  // starts fresh; the report stays in Import history. An import that finishes while you're
  // elsewhere still shows its result when you come back.
  const { path } = useLocation();
  const lastPath = useRef(path);
  useEffect(() => {
    const left = lastPath.current === '/import' && path !== '/import';
    lastPath.current = path;
    if (left && (step.kind === 'done' || (step.kind === 'choose' && step.error))) reset();
  }, [path, step, reset]);

  const running = step.kind === 'running';
  useEffect(() => {
    if (!running) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [running]);

  useEffect(() => () => sessionRef.current?.dispose(), []);

  const value = useMemo(
    () => ({ step, options, setOptions, openFile, chooseSource, start, cancel, reset }),
    [step, options, openFile, chooseSource, start, cancel, reset],
  );
  return <ImportContext.Provider value={value}>{children}</ImportContext.Provider>;
}

export function useImport(): ImportContextValue {
  const ctx = useContext(ImportContext);
  if (!ctx) throw new Error('useImport outside ImportProvider');
  return ctx;
}
