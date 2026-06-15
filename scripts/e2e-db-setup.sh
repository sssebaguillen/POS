#!/usr/bin/env bash
set -euo pipefail

# ───────────────────────────────────────────────────────────────────────────
# Bootstrap del stack Supabase local para la suite E2E (local y CI).
#
# Las 129 migraciones NO replayean limpio desde cero (mezcla de timestamps de
# 8 y 14 dígitos: una migración toca `sale_items` antes de que exista). Por eso
# arrancamos el stack SIN migraciones y cargamos el `supabase/schema.sql`
# canónico, que sí carga 100% limpio de arriba a abajo.
#
# Deja el repo intacto: restaura supabase/migrations/ al terminar (trap).
# ───────────────────────────────────────────────────────────────────────────

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

MIG=supabase/migrations
BAK=supabase/.migrations-e2e-bak

restore_migrations() {
  if [ -d "$BAK" ]; then
    mkdir -p "$MIG"
    mv "$BAK"/* "$MIG"/ 2>/dev/null || true
    rmdir "$BAK" 2>/dev/null || true
  fi
}
trap restore_migrations EXIT

# Mover las migraciones aparte para que `supabase start` no las replaye.
if [ -d "$MIG" ] && [ -n "$(ls -A "$MIG" 2>/dev/null)" ]; then
  mkdir -p "$BAK"
  mv "$MIG"/* "$BAK"/ 2>/dev/null || true
fi

echo "▶ supabase start (sin migraciones)…"
supabase start

# Ya no se necesitan para esta sesión: restaurar el repo cuanto antes.
restore_migrations
trap - EXIT

echo "▶ cargando schema.sql canónico…"
# DB_URL = postgresql://postgres:postgres@127.0.0.1:54322/postgres
eval "$(supabase status -o env | sed 's/^/export /')"
# Reset del schema public para que el script sea idempotente (re-corridas locales).
# En CI la DB ya arranca vacía; esto no estorba.
psql "$DB_URL" -v ON_ERROR_STOP=1 -c \
  "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO postgres, anon, authenticated, service_role;" >/dev/null
psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/schema.sql >/dev/null

echo "✓ DB E2E lista (schema.sql cargado)."
