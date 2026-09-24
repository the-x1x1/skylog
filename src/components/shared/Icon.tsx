import type { SVGProps } from 'react';

/** A small hand-picked stroke icon set (24×24, currentColor). */
const PATHS = {
  journal: 'M4 5.5c2.6-1.2 5.3-1.2 8 .7 2.7-1.9 5.4-1.9 8-.7v13c-2.6-1.2-5.3-1.2-8 .7-2.7-1.9-5.4-1.9-8-.7zM12 6.2v13',
  search: 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM20 20l-4.7-4.7',
  import: 'M12 3.5v11M7.5 10l4.5 4.5 4.5-4.5M4 15.5v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3',
  settings: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4',
  sun: 'M12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zM12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z',
  monitor: 'M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM9 21h6M12 17v4',
  chevronLeft: 'M15 5l-7 7 7 7',
  chevronRight: 'M9 5l7 7-7 7',
  chevronDown: 'M5 9l7 7 7-7',
  close: 'M6 6l12 12M18 6 6 18',
  expand: 'M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7',
  download: 'M12 4v11M7.5 10.5 12 15l4.5-4.5M5 20h14',
  edit: 'M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16zM13.5 6.5l4 4',
  refresh: 'M20 11a8 8 0 0 0-14.3-4.3L4 8.5M4 4v4.5h4.5M4 13a8 8 0 0 0 14.3 4.3L20 15.5M20 20v-4.5h-4.5',
  image: 'M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM4 16l4.5-4.5a1.5 1.5 0 0 1 2.1 0L16 17M14 14l1.5-1.5a1.5 1.5 0 0 1 2.1 0L20 15M15 9.5a1.5 1.5 0 1 0 0-.01',
  imageOff: 'M4 4l16 16M9.5 4H19a1 1 0 0 1 1 1v9.5M20 19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5M4 16l4.5-4.5a1.5 1.5 0 0 1 2.1 0L16 17',
  message: 'M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-7l-4.5 3.5V16H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  alert: 'M12 4 2.8 19.5h18.4zM12 10v4.5M12 17.2v.3',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5.5M12 7.8v.3',
  trash: 'M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5',
  arrowRight: 'M5 12h14M13 6l6 6-6 6',
  arrowUpRight: 'M7 17 17 7M8 7h9v9',
  layers: 'M12 3.5 3 8.5l9 5 9-5zM3 13l9 5 9-5',
  tag: 'M3.5 12.5V4.5a1 1 0 0 1 1-1h8l8 8a1.4 1.4 0 0 1 0 2l-7 7a1.4 1.4 0 0 1-2 0zM8 8.2v.3',
  history: 'M3.5 12a8.5 8.5 0 1 0 2.5-6L3.5 8.5M3.5 4v4.5H8M12 7.5V12l3 2',
  archive: 'M4 4h16v4H4zM5.5 8v11a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V8M10 12h4',
  quote: 'M9.5 7C6.5 8 5 10.5 5 14v3h5v-5H7.5c0-2 .8-3.5 2.6-4.3zM18.5 7c-3 1-4.5 3.5-4.5 7v3h5v-5h-2.5c0-2 .8-3.5 2.6-4.3z',
  list: 'M9 6h11M9 12h11M9 18h11M4.5 6v.2M4.5 12v.2M4.5 18v.2',
  flag: 'M5 21V4M5 4h11l-2 4 2 4H5',
  steps: 'M4 7h4l3 5-3 5H4M13 12h7M16 9l3 3-3 3',
  file: 'M13 3.5H7a1 1 0 0 0-1 1v15a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V8.5zM13 3.5v5h5',
  external: 'M14 4h6v6M20 4l-8.5 8.5M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  more: 'M5 12v.2M12 12v.2M19 12v.2',
  upload: 'M12 15.5v-11M7.5 9 12 4.5 16.5 9M4 15.5v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3',
  lock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3',
  sparkPen: 'M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17zM15 5l.8-2M19 9l2-.8',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 20, strokeWidth = 1.75, ...rest }: { name: IconName; size?: number; strokeWidth?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
