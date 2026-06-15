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
    // Artefactos generados por Playwright (reporte/trace minificado, screenshots).
    "e2e/report/**",
    "e2e/screenshots/**",
    "test-results/**",
    "playwright-report/**",
  ]),
  {
    rules: {
      // Mounted pattern (CLAUDE.md regla 25) y reset-de-estado-al-abrir-modal son
      // patrones deliberados del repo; la regla queda en warn hasta el refactor
      // selectivo post-beta (decisión 2026-06-12).
      "react-hooks/set-state-in-effect": "warn",
    },
  },
]);

export default eslintConfig;
