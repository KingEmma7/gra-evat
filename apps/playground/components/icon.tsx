import type { CSSProperties } from 'react';

type Name =
  | 'arrow'
  | 'plus'
  | 'trash'
  | 'up'
  | 'down'
  | 'check'
  | 'copy'
  | 'code'
  | 'print'
  | 'refund'
  | 'external'
  | 'check-circle';
const paths: Record<Name, string> = {
  arrow: 'M4 12h16m-6-6 6 6-6 6',
  plus: 'M12 5v14M5 12h14',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5m4-5v5',
  up: 'm6 14 6-6 6 6',
  down: 'm6 10 6 6 6-6',
  check: 'm5 12 4 4L19 6',
  copy: 'M9 9h11v11H9zM5 15H3V3h12v2',
  code: 'm8 6-6 6 6 6m8-12 6 6-6 6m-3-14-2 16',
  print: 'M6 9V3h12v6M6 17H3V9h18v8h-3M6 14h12v7H6zM17 12h1',
  refund: 'M4 4v6h6M4 10a8 8 0 1 1 1 8',
  external: 'M14 3h7v7m0-7L10 14M10 3H3v18h18v-7',
  'check-circle': 'M22 11.1V12a10 10 0 1 1-5.9-9.1M22 4 12 14l-3-3',
};

export function Icon({
  name,
  size = 18,
  style,
}: {
  name: Name;
  size?: number;
  style?: CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={style}
    >
      <path d={paths[name]} />
    </svg>
  );
}
