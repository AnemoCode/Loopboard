export interface Theme {
  name: 'light' | 'dark';
  background: string;
  text: string;
  mutedText: string;
  link: string;
  loop: string;
  shapeStroke: string;
  shapeFill: string;
  nodeStroke: string;
  positive: string;
  negative: string;
}

export const lightTheme: Theme = {
  name: 'light',
  background: '#ffffff',
  text: '#1c1917',
  mutedText: '#78716c',
  link: '#44403c',
  loop: '#4f46e5',
  shapeStroke: '#a8a29e',
  shapeFill: '#f5f5f4',
  nodeStroke: '#57534e',
  positive: '#15803d',
  negative: '#dc2626',
};

export const darkTheme: Theme = {
  name: 'dark',
  background: '#1c1b1a',
  text: '#f5f5f4',
  mutedText: '#a8a29e',
  link: '#d6d3d1',
  loop: '#a5b4fc',
  shapeStroke: '#78716c',
  shapeFill: '#292524',
  nodeStroke: '#d6d3d1',
  positive: '#4ade80',
  negative: '#f87171',
};

/** Curated swatches offered in the color picker (readable on light and dark canvases). */
export const PALETTE = [
  '#1c1917',
  '#78716c',
  '#dc2626',
  '#ea580c',
  '#ca8a04',
  '#16a34a',
  '#0d9488',
  '#2563eb',
  '#4f46e5',
  '#9333ea',
  '#db2777',
  '#ffffff',
];

export const FILL_PALETTE = [
  '#fef2f2',
  '#fff7ed',
  '#fefce8',
  '#f0fdf4',
  '#f0fdfa',
  '#eff6ff',
  '#eef2ff',
  '#faf5ff',
  '#fdf2f8',
  '#f5f5f4',
  '#ffffff',
];
