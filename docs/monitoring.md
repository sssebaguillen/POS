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
