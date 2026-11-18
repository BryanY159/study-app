// Which install steps to show first. Pure, so it's tested with a table of user agents.

export type Platform = 'ios-safari' | 'ios-other-browser' | 'android' | 'desktop-chromium' | 'desktop-other';

export interface PlatformInfo {
  platform: Platform;
  /** Already running as an installed app (home screen / standalone window). */
  installed: boolean;
}

export function detectPlatform(ua: string, maxTouchPoints: number, standalone: boolean): PlatformInfo {
  // iPadOS 13+ reports itself as a Mac; touch points give it away.
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1);
  let platform: Platform;
  if (ios) platform = /CriOS|FxiOS|EdgiOS|OPiOS|GSA\//.test(ua) ? 'ios-other-browser' : 'ios-safari';
  else if (/Android/.test(ua)) platform = 'android';
  else if (/Chrome\/|Chromium\/|Edg\//.test(ua)) platform = 'desktop-chromium';
  else platform = 'desktop-other';
  return { platform, installed: standalone };
}

export function browserPlatform(): PlatformInfo {
  const standalone =
    (navigator as Navigator & { standalone?: boolean }).standalone === true || (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches);
  return detectPlatform(navigator.userAgent, navigator.maxTouchPoints ?? 0, standalone);
}
