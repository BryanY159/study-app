// The web app manifest (PWA). Used by vite.config.ts and checked by unit tests.
// Icons are generated from public/icons/app-icon.svg by scripts/make-icons.ts.

export const THEME_LIGHT = '#F5F6F8';

export const manifest = {
  name: 'Study',
  short_name: 'Study',
  description: 'Drills, mock exams and flashcards for the content packs you import. Works offline.',
  lang: 'en',
  start_url: './',
  scope: './',
  display: 'standalone' as const,
  orientation: 'any' as const,
  background_color: THEME_LIGHT,
  theme_color: THEME_LIGHT,
  icons: [
    { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
};
