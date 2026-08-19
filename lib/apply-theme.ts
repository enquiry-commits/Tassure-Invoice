import { THEME_TOKENS, resolveFontValue } from './theme-tokens';

/**
 * Sets each provided token as an inline CSS custom property on <html>,
 * which beats the :root{} default in globals.css for the same property —
 * so a fetch failure or slow network just falls back to the hardcoded
 * default look, never blank/broken. Used both by AppShell (apply the
 * saved theme on load) and the admin editor (live-preview on every edit,
 * before Save).
 */
export function applyThemeTokens(tokens: Record<string, string>) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  for (const def of THEME_TOKENS) {
    const value = tokens[def.key];
    if (value === undefined) continue;
    root.style.setProperty(def.cssVar, def.type === 'font' ? resolveFontValue(value) : value);
  }
}
