// Inter, woff2 only (Chrome/Edge). Vite inlines these as data: URIs in the
// single-file build, so the app needs no network for fonts.
import w400 from '@fontsource/inter/files/inter-latin-400-normal.woff2';
import w500 from '@fontsource/inter/files/inter-latin-500-normal.woff2';
import w600 from '@fontsource/inter/files/inter-latin-600-normal.woff2';
import w700 from '@fontsource/inter/files/inter-latin-700-normal.woff2';

const faces = { 400: w400, 500: w500, 600: w600, 700: w700 };
const css = Object.entries(faces)
  .map(([weight, url]) => `@font-face{font-family:Inter;font-style:normal;font-display:swap;font-weight:${weight};src:url(${url}) format('woff2')}`)
  .join('\n');
const style = document.createElement('style');
style.textContent = css;
document.head.appendChild(style);
