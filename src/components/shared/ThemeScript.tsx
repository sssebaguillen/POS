import { THEME_STORAGE_KEY } from '@/lib/theme'

// Runs synchronously before first paint to set the `dark` class on <html>,
// eliminating the theme flash (FOUC). Reads the same stored preference the
// ThemeProvider uses, falling back to the OS `prefers-color-scheme`.
export function ThemeScript() {
  const script = `(function(){try{var k=${JSON.stringify(THEME_STORAGE_KEY)};var t=localStorage.getItem(k);if(t!=="dark"&&t!=="light"){t=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";}var e=document.documentElement;e.classList.toggle("dark",t==="dark");e.style.colorScheme=t;}catch(_){}})();`
  return <script dangerouslySetInnerHTML={{ __html: script }} />
}
