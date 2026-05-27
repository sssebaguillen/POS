# Monitoring — Pulsar POS

## Herramientas activas

| Herramienta | Qué mide | Cuándo revisar |
|---|---|---|
| Sentry | Errores silenciosos en producción | Solo cuando llega reporte por Telegram |
| Vercel Analytics | Pageviews, visitantes únicos | 1 vez por semana |
| Vercel Speed Insights | Web Vitals (LCP, CLS, FID) por ruta | 1 vez por semana |
| Supabase | Slow queries, salud de DB | Solo si hay quejas de lentitud |
| PostHog | Comportamiento de usuarios, eventos | Cuando querés entender uso real |
| GitHub Issues + Telegram | Bugs reportados por usuarios | Reactivo, llega solo |

---

## Checklist semanal (~10 min)

- [ ] Vercel Analytics — ¿pageviews normales? ¿alguna caída rara?
- [ ] Vercel Speed Insights — ¿alguna ruta degradó su LCP o CLS?
- [ ] Sentry Issues — ¿algún error nuevo sin reporte de usuario?
- [ ] GitHub Issues — ¿issues abiertos sin respuesta?

## Checklist mensual

- [ ] Supabase — revisar slow queries en el dashboard
- [ ] PostHog — ¿qué rutas se usan más? ¿alguna que nadie toca?
- [ ] Sentry — revisar si hay errores recurrentes de baja frecuencia

---

## Umbrales para escalar atención

- **Sentry**: más de 3 errores distintos en una semana → investigar aunque no haya reporte
- **Speed Insights**: LCP > 3s en alguna ruta → optimizar antes del siguiente deploy
- **Supabase**: query > 500ms recurrente → agregar índice o revisar RPC

---

## Cuándo agregar más herramientas

- **10+ usuarios** → configurar alertas automáticas en Sentry (hoy está en modo pasivo)
- **20+ usuarios** → evaluar Sentry Session Replay para bugs difíciles de reproducir
- **50+ usuarios** → Datadog o similar para tener todo en un solo lugar

---

## Notas

- `sendDefaultPii: false` en Sentry — no se envían emails ni IPs de usuarios
- El MCP de Sentry está configurado en Claude Code — se puede consultar errores directamente desde el chat
- Vercel Analytics y Speed Insights son pasivos, no requieren configuración adicional

---

## Jobs programados

### `refresh-daily-snapshots`

Base de P11.1. Esta Edge Function recalcula `daily_snapshots` para una fecha y debe correr 1 vez por noche.

- Función: `supabase/functions/refresh-daily-snapshots`
- RPC invocada: `refresh_all_daily_snapshots`
- Auth: `verify_jwt = false` + secreto propio `CRON_SECRET`
- Método: `POST`
- Body opcional:

```json
{
  "snapshotDate": "2026-05-27"
}
```

Si no se manda `snapshotDate`, refresca `ayer`.

Header requerido:

```text
Authorization: Bearer <CRON_SECRET>
```

Uso esperado:

- Scheduler nocturno en Supabase llamando la función
- Re-ejecución manual si hace falta recomputar un día puntual

Comandos útiles:

```bash
supabase db push
supabase secrets set CRON_SECRET=tu-secreto-seguro --project-ref zrnthcznbrplzpmxmkwk
supabase functions deploy refresh-daily-snapshots --project-ref zrnthcznbrplzpmxmkwk
```

Invocación manual remota:

```bash
curl -X POST \
  "https://zrnthcznbrplzpmxmkwk.supabase.co/functions/v1/refresh-daily-snapshots" \
  -H "Authorization: Bearer <CRON_SECRET>" \
  -H "Content-Type: application/json" \
  -d '{"snapshotDate":"2026-05-27"}'
```

Scheduler en producción (configurado):

- Extensiones habilitadas: `pg_cron`, `pg_net` (en `extensions` schema).
- Secret almacenado en Supabase Vault con `name = 'cron_secret_refresh_daily_snapshots'`.
- Job pg_cron: `refresh-daily-snapshots-nightly`, schedule `10 6 * * *` UTC (= 03:10 ART).
- El cron lee el secreto de `vault.decrypted_secrets` y hace `net.http_post` al endpoint con header `Authorization: Bearer <secret>`. El plaintext **no** queda en `cron.job`.

Operación:

```sql
-- Ver historial de ejecuciones recientes
SELECT runid, jobid, start_time, end_time, status, return_message
FROM cron.job_run_details
WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'refresh-daily-snapshots-nightly')
ORDER BY start_time DESC LIMIT 20;

-- Ver respuestas HTTP (cuerpos devueltos por la Edge Function)
SELECT id, created, status_code, content::text
FROM net._http_response ORDER BY id DESC LIMIT 20;

-- Disparar manualmente sin esperar el cron
SELECT net.http_post(
  url := 'https://zrnthcznbrplzpmxmkwk.supabase.co/functions/v1/refresh-daily-snapshots',
  headers := jsonb_build_object(
    'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret_refresh_daily_snapshots'),
    'Content-Type', 'application/json'
  ),
  body := '{}'::jsonb,
  timeout_milliseconds := 30000
);
```

Para rotar el secret: regenerar valor → `vault.update_secret(id, new_value, name, description)` + `supabase secrets set CRON_SECRET=<nuevo> --project-ref zrnthcznbrplzpmxmkwk`. El job no requiere cambios — lee dinámicamente del vault.
