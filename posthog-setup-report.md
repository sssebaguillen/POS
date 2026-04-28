<wizard-report>
# PostHog post-wizard report

The wizard has completed a deep integration of PostHog analytics into Pulsar POS. The setup includes client-side initialization via `instrumentation-client.ts` (using the Next.js 15.3+ recommended approach), a server-side PostHog client at `src/lib/posthog-server.ts`, a reverse proxy through Next.js rewrites routing `/ingest/*` to the EU PostHog host, and environment variables stored in `.env.local`. Eleven business events are now tracked across eight source files, covering the full lifecycle from signup through sales, operator sessions, product management, expenses, and catalog orders. User identification is performed on login and signup so all events are correlated to the authenticated user.

| Event | Description | File |
|-------|-------------|------|
| `sale_completed` | A sale was successfully registered through the POS payment modal | `src/components/pos/PaymentModal.tsx` |
| `sale_receipt_printed` | Operator confirmed a sale and chose to print/preview the receipt | `src/components/pos/PaymentModal.tsx` |
| `user_signed_up` | A new business owner completed registration | `src/app/(auth)/register/page.tsx` |
| `user_logged_in` | A business owner logged in successfully | `src/app/(auth)/login/page.tsx` |
| `password_reset_requested` | A user requested a password reset email | `src/app/(auth)/login/page.tsx` |
| `operator_session_started` | An operator (or owner) authenticated and started a shift | `src/components/operator/OperatorSelectView.tsx` |
| `product_created` | A new product was created in the inventory | `src/components/products/ProductsPanel.tsx` |
| `product_deleted` | A product was deleted from the inventory | `src/components/products/ProductsPanel.tsx` |
| `expense_created` | A new expense was recorded | `src/components/expenses/ExpensesView.tsx` |
| `supplier_created` | A new supplier was created | `src/components/expenses/SuppliersPanel.tsx` |
| `catalog_order_sent` | A customer sent a catalog order via WhatsApp | `src/components/catalog/CartPanel.tsx` |

## Next steps

We've built some insights and a dashboard for you to keep an eye on user behavior, based on the events we just instrumented:

- **Dashboard — Analytics basics**: https://eu.posthog.com/project/167960/dashboard/647368
- **Daily sales** (line graph, sales count per day): https://eu.posthog.com/project/167960/insights/zjsZ2dUV
- **New business signups** (bar chart, weekly): https://eu.posthog.com/project/167960/insights/PoscgvHD
- **Onboarding funnel** (signup → operator session → first sale): https://eu.posthog.com/project/167960/insights/2HPM1hnz
- **Sale revenue trend** (area graph, sum of `total` per day): https://eu.posthog.com/project/167960/insights/9QTfQXSN
- **Catalog orders sent** (bar chart, weekly): https://eu.posthog.com/project/167960/insights/jQgmJ2JM

### Agent skill

We've left an agent skill folder in your project. You can use this context for further agent development when using Claude Code. This will help ensure the model provides the most up-to-date approaches for integrating PostHog.

</wizard-report>
