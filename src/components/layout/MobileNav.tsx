import { useImport } from '../../app/providers/import';
import { href, useLocation } from '../../app/router';
import { Icon, type IconName } from '../shared/Icon';
import { Logo } from '../shared/media';
import { ThemeCycleButton } from './ThemeToggle';

const ITEMS: { to: string; label: string; icon: IconName; match: (p: string) => boolean }[] = [
  { to: '/', label: 'Journal', icon: 'journal', match: (p) => p === '/' || p.startsWith('/entry/') },
  { to: '/search', label: 'Search', icon: 'search', match: (p) => p === '/search' },
  { to: '/import', label: 'Import', icon: 'import', match: (p) => p.startsWith('/import') },
];

export function MobileNav() {
  const { path } = useLocation();
  const { step } = useImport();
  const importing = step.kind === 'running';
  return (
    <nav className="mobile-nav" aria-label="Primary">
      {ITEMS.map((item) => {
        const active = item.match(path);
        return (
          <a key={item.to} href={href(item.to)} className="mobile-nav__item" aria-current={active ? 'page' : undefined}>
            <Icon name={item.icon} size={22} />
            <span>{item.to === '/import' && importing ? 'Importing…' : item.label}</span>
            {item.to === '/import' && importing ? <span className="mobile-nav__dot" aria-hidden="true" /> : null}
          </a>
        );
      })}
    </nav>
  );
}

export function MobileTopBar() {
  return (
    <header className="mobile-top">
      <a href={href('/')} className="mobile-top__brand" aria-label="Journal home">
        <Logo />
      </a>
      <div className="mobile-top__actions">
        <ThemeCycleButton />
        <a className="icon-btn" href={href('/settings')} aria-label="Settings" title="Settings">
          <Icon name="settings" size={20} />
        </a>
      </div>
    </header>
  );
}
