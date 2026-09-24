import { useTheme, type ThemePreference } from '../../app/providers/theme';
import { Icon, type IconName } from '../shared/Icon';

const OPTIONS: { value: ThemePreference; label: string; icon: IconName }[] = [
  { value: 'system', label: 'Match system', icon: 'monitor' },
  { value: 'light', label: 'Light', icon: 'sun' },
  { value: 'dark', label: 'Dark', icon: 'moon' },
];

export function ThemeToggle() {
  const { preference, setPreference } = useTheme();
  return (
    <div className="theme-toggle" role="group" aria-label="Theme">
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          className="theme-toggle__btn"
          aria-pressed={preference === o.value}
          aria-label={`${o.label} theme`}
          title={o.label}
          onClick={() => setPreference(o.value)}
        >
          <Icon name={o.icon} size={17} />
        </button>
      ))}
    </div>
  );
}

/** Single button that cycles the theme (used in the compact mobile header). */
export function ThemeCycleButton() {
  const { preference, resolved, setPreference } = useTheme();
  const next: ThemePreference = preference === 'system' ? (resolved === 'dark' ? 'light' : 'dark') : preference === 'dark' ? 'light' : 'dark';
  return (
    <button type="button" className="icon-btn" aria-label={`Switch to ${next} theme`} title={`Switch to ${next} theme`} onClick={() => setPreference(next)}>
      <Icon name={resolved === 'dark' ? 'sun' : 'moon'} size={20} />
    </button>
  );
}
