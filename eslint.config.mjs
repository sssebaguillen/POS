import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Agent worktrees — do not lint .claude/
    ".claude/**",
    // Scripts de skills de diseño (no son código de la app).
    ".agents/**",
    // Handoff de diseño (referencia Iconify standalone — no es código de la app,
    // no lo referencia src/). Su icons.js dispara el único error de lint que
    // dejaba el CI "Unit tests" en rojo en cada PR.
    "design_handoff_icon_migration/**",
    // Artefactos generados por Playwright (reporte/trace minificado, screenshots).
    "e2e/report/**",
    "e2e/screenshots/**",
    "test-results/**",
    "playwright-report/**",
  ]),
  {
    rules: {
      // Cerrada la clase de bug (2026-06-20): los fetch-on-mount migraron a React Query, el
      // gate de hidratación al hook useMounted (useSyncExternalStore), y el reset de paginación
      // a estado derivado. Los casos legítimos restantes (mounted pattern de localStorage,
      // reset-de-estado-al-abrir-modal, búsqueda con debounce, deep-link one-shot) llevan un
      // eslint-disable puntual y documentado. Ahora en `error`: un nuevo setState-en-efecto
      // accidental rompe el build/CI.
      "react-hooks/set-state-in-effect": "error",
    },
  },
]);

export default eslintConfig;
