import { useEffect, useRef, type ReactNode } from 'react';
import { useAppData } from '../../app/providers/data';
import { navigate, useLocation } from '../../app/router';
import { Icon } from '../shared/Icon';
import { MobileNav, MobileTopBar } from './MobileNav';
import { Sidebar } from './Sidebar';

export function focusGlobalSearch(): void {
  const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('[data-global-search]'));
  const visible = inputs.find((el) => el.offsetParent !== null);
  if (visible) {
    visible.focus();
    visible.select();
  } else {
    navigate('/search');
  }
}

export function AppShell({ children }: { children: ReactNode }) {
  const { storageMode } = useAppData();
  const loc = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  const lastPath = useRef(loc.path);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        focusGlobalSearch();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // On page change: start at the top and move focus to the page heading for screen readers.
  useEffect(() => {
    if (lastPath.current === loc.path) return;
    lastPath.current = loc.path;
    if (!loc.query.get('message') && !loc.query.get('image')) window.scrollTo({ top: 0 });
    const active = document.activeElement as HTMLElement | null;
    if (active?.dataset.globalSearch !== undefined) return;
    requestAnimationFrame(() => {
      const h1 = mainRef.current?.querySelector<HTMLElement>('h1');
      if (h1) {
        h1.setAttribute('tabindex', '-1');
        h1.focus({ preventScroll: true });
      }
    });
  }, [loc.path, loc.query]);

  return (
    <div className="app">
      <a className="skip-link" href="#main" onClick={(e) => {
        e.preventDefault();
        mainRef.current?.focus();
      }}>
        Skip to content
      </a>
      <Sidebar />
      <div className="app__main-col">
        <MobileTopBar />
        {storageMode === 'memory' ? (
          <div className="storage-banner" role="status">
            <Icon name="alert" size={16} />
            <span>This browser is blocking local storage, so nothing you import will be kept after you close this tab.</span>
          </div>
        ) : null}
        <main id="main" ref={mainRef} className="app__main" tabIndex={-1}>
          {children}
        </main>
      </div>
      <MobileNav />
    </div>
  );
}
