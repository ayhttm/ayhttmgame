import type { AvatarColor } from '../types/quiz.ts';

export const AVATAR_STYLES: Record<
  AvatarColor,
  { bg: string; text: string; ring: string; label: string }
> = {
  indigo: {
    bg: 'bg-indigo-600',
    text: 'text-white',
    ring: 'ring-indigo-400',
    label: 'คราม',
  },
  rose: {
    bg: 'bg-rose-600',
    text: 'text-white',
    ring: 'ring-rose-400',
    label: 'แดงทับทิม',
  },
  emerald: {
    bg: 'bg-emerald-600',
    text: 'text-white',
    ring: 'ring-emerald-400',
    label: 'มรกต',
  },
  amber: {
    bg: 'bg-amber-600',
    text: 'text-white',
    ring: 'ring-amber-400',
    label: 'อำพัน',
  },
  sky: {
    bg: 'bg-sky-600',
    text: 'text-white',
    ring: 'ring-sky-400',
    label: 'ฟ้าคราม',
  },
  violet: {
    bg: 'bg-violet-600',
    text: 'text-white',
    ring: 'ring-violet-400',
    label: 'ม่วงไวโอเลต',
  },
};

export const AVATAR_COLOR_LIST: AvatarColor[] = [
  'indigo',
  'rose',
  'emerald',
  'amber',
  'sky',
  'violet',
];

export interface OptionTheme {
  symbol: string;
  keyHint: string;
  baseBg: string;
  hoverBg: string;
  border: string;
  barBg: string;
}

export const OPTION_THEMES: OptionTheme[] = [
  {
    symbol: '▲',
    keyHint: '1',
    baseBg: 'bg-rose-600/95',
    hoverBg: 'hover:bg-rose-500',
    border: 'border-rose-400/50',
    barBg: 'bg-rose-500',
  },
  {
    symbol: '◆',
    keyHint: '2',
    baseBg: 'bg-blue-600/95',
    hoverBg: 'hover:bg-blue-500',
    border: 'border-blue-400/50',
    barBg: 'bg-blue-500',
  },
  {
    symbol: '●',
    keyHint: '3',
    baseBg: 'bg-amber-600/95',
    hoverBg: 'hover:bg-amber-500',
    border: 'border-amber-400/50',
    barBg: 'bg-amber-500',
  },
  {
    symbol: '■',
    keyHint: '4',
    baseBg: 'bg-emerald-600/95',
    hoverBg: 'hover:bg-emerald-500',
    border: 'border-emerald-400/50',
    barBg: 'bg-emerald-500',
  },
];
