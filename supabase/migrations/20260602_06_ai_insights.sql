-- P12 (paso 2) — tabla ai_insights + opt-in en businesses.settings.
--
-- ai_insights almacena las sugerencias (no órdenes) que emite la capa de IA proactiva.
-- Reglas de diseño que se reflejan en el esquema:
--   * rationale jsonb NOT NULL  → garantía estructural del "porque X, Y, Z": sin justificación
--     con números, el insight no se inserta (principio 2 del plan p12).
--   * target_entity_type + target_entity_id + surface  → anclaje contextual: el insight sabe
--     dónde plantarse (fila de producto, cierre de caja, dashboard…), no en una tab "IA".
--   * target_entity_id es TEXT (no uuid) porque el ancla es polimórfica: uuid de producto/cliente/
--     proveedor, pero también códigos no-uuid como método de pago ('cash') o canal ('catalog'),
--     y NULL para insights globales. Sin FK por lo mismo (ancla polimórfica).
--   * status (new|seen|dismissed|acted) alimenta la anti-repetición: el assembler lee los últimos
--     insights + su status para no repetir lo descartado cada noche.
-- Seguridad: RLS por business_id vía get_business_id() (mismo patrón que audit_log). Sin acceso anon
-- (datos privados de negocio; el cron escribe como service_role, que saltea RLS). Grants solo a
-- authenticated + service_role.

CREATE TABLE IF NOT EXISTS "public"."ai_insights" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "status" "text" DEFAULT 'new'::"text" NOT NULL,
    "severity" "text" NOT NULL,
    "target_entity_type" "text" NOT NULL,
    "target_entity_id" "text",
    "surface" "text" NOT NULL,
    "title" "text" NOT NULL,
    "body" "text" NOT NULL,
    "rationale" "jsonb" NOT NULL,
    "source_model" "text",
    CONSTRAINT "ai_insights_status_check" CHECK (("status" = ANY (ARRAY['new'::"text", 'seen'::"text", 'dismissed'::"text", 'acted'::"text"]))),
    CONSTRAINT "ai_insights_severity_check" CHECK (("severity" = ANY (ARRAY['info'::"text", 'opportunity'::"text", 'anomaly'::"text"]))),
    CONSTRAINT "ai_insights_target_entity_type_check" CHECK (("target_entity_type" = ANY (ARRAY['product'::"text", 'payment'::"text", 'customer'::"text", 'supplier'::"text", 'stock'::"text", 'channel'::"text", 'global'::"text"]))),
    CONSTRAINT "ai_insights_surface_check" CHECK (("surface" = ANY (ARRAY['inventory_row'::"text", 'inventory'::"text", 'stats'::"text", 'dashboard'::"text", 'cash_close'::"text", 'pos'::"text", 'customers'::"text", 'suppliers'::"text", 'expenses'::"text", 'orders'::"text", 'global'::"text"])))
);

ALTER TABLE "public"."ai_insights" OWNER TO "postgres";

COMMENT ON TABLE "public"."ai_insights" IS 'Sugerencias de la IA proactiva (P12). rationale jsonb es obligatorio (porque X,Y,Z con numeros). target_entity_id es polimorfico (uuid|codigo|null), sin FK. status alimenta anti-repeticion.';

ALTER TABLE ONLY "public"."ai_insights"
    ADD CONSTRAINT "ai_insights_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."ai_insights"
    ADD CONSTRAINT "ai_insights_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;

-- feed principal (panel/badge): por negocio, filtrando estado, recientes primero
CREATE INDEX "ai_insights_business_status_created_idx" ON "public"."ai_insights" USING "btree" ("business_id", "status", "created_at" DESC);
-- render inline por superficie (ej. todos los insights activos de /inventory)
CREATE INDEX "ai_insights_business_surface_status_idx" ON "public"."ai_insights" USING "btree" ("business_id", "surface", "status");
-- anclaje por entidad (ej. insight de la fila del producto X) + anti-repeticion por entidad
CREATE INDEX "ai_insights_business_target_idx" ON "public"."ai_insights" USING "btree" ("business_id", "target_entity_type", "target_entity_id");

CREATE OR REPLACE TRIGGER "ai_insights_updated_at" BEFORE UPDATE ON "public"."ai_insights" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();

ALTER TABLE "public"."ai_insights" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "business isolation" ON "public"."ai_insights" USING (("business_id" = "public"."get_business_id"())) WITH CHECK (("business_id" = "public"."get_business_id"()));

-- Supabase auto-otorga grants a anon vía default privileges del esquema → revocarlos explícito
-- (datos privados de negocio; RLS ya bloquea anon, esto es defensa en profundidad — regla 34).
REVOKE ALL ON TABLE "public"."ai_insights" FROM "anon";
GRANT ALL ON TABLE "public"."ai_insights" TO "authenticated";
GRANT ALL ON TABLE "public"."ai_insights" TO "service_role";

-- Opt-in: clave booleana en businesses.settings (spread-merge, nunca reemplazar el objeto — regla 22).
-- No requiere cambio de esquema; se documenta la key. Ausente/false = IA proactiva apagada.
COMMENT ON COLUMN "public"."businesses"."settings" IS 'Configuración del negocio. Keys soportadas: currency (ISO 4217: ARS|USD|EUR|BRL|CLP|UYU|PEN|COP|MXN|PYG|BOB), logo_upload_path (path en storage para logo subido), ai_insights_enabled (boolean, opt-in de la IA proactiva P12 — feature de plan pago)';
