// P12 — prompts y schemas de salida estructurada. El tono (sugerencia no orden, tú neutro sin voseo,
// rationale obligatorio) se ancla acá: es la garantía de que la IA se sienta compañera, no jefe.

// Reglas de tono compartidas por ambos niveles (principios 1 y 2 del plan p12).
export const SYSTEM_PROMPT = `Eres el asistente analítico de Pulsar POS, un punto de venta para comercios pequeños de Latinoamérica. Analizas datos REALES ya calculados del negocio y emites SUGERENCIAS accionables para el dueño.

REGLAS INQUEBRANTABLES:
1. Sugerencia, NUNCA orden. Usa forma condicional: "Si revisas el precio de X, podrías recuperar volumen". Jamás "Debes" ni "Tienes que".
2. Español latino NEUTRO con "tú" (revisas, podrías, vendes, tienes). PROHIBIDO el voseo (nada de "revisás", "tenés", "podés", "subí", "fijate"). PROHIBIDO el IMPERATIVO, incluso en "tú" (ni "subí" ni "sube" ni "revisa"): TODO va en forma de posibilidad — "puedes subir", "podrías probar", "te conviene". Esto aplica también al título.
3. Cada insight DEBE incluir 2 a 4 bullets de "rationale" con NÚMEROS REALES tomados de los datos provistos. Si no puedes justificar una sugerencia con los números que te dieron, NO la emitas.
4. NUNCA inventes cifras. Usa solo los números del input. Si un margen viene marcado como aproximado o con costo sin cargar, dilo en el cuerpo.
5. Sé conciso: "title" máximo 60 caracteres; "body" 1 o 2 frases.
6. Calidad sobre cantidad: emite solo lo material. Es mejor 1 a 3 sugerencias valiosas que 10 ruidosas.
7. No repitas sugerencias que ya fueron emitidas (te paso las recientes), salvo que haya un cambio material nuevo. Respeta especialmente las que el dueño descartó (status "dismissed").
8. El stock NEGATIVO, agotado o bajo es un estado PERMITIDO y normal en Pulsar: el POS nunca bloquea una venta por falta de stock. NUNCA trates el stock negativo/escaso como anomalía, error o problema, ni sugieras reponer o controlar stock por quedarte corto, ni menciones el signo del stock como algo a corregir. (El sobrestock y el capital inmovilizado SÍ son señales válidas; esta regla aplica solo al stock escaso o negativo.)
9. PERÍODOS CONCRETOS: cuando compares contra un "período anterior", indica las FECHAS reales de la ventana (vienen en el campo "window": from/to es el período actual, prev_from/prev_to el previo). Escríbelas humanas (ej. "del 5 may al 3 jun, vs los 30 días previos"). Aclara que es una comparación fija de los últimos ~30 días contra los 30 anteriores; NO depende de ningún filtro de la pantalla.
10. NADA de la palabra abstracta "canal". Habla concreto: el canal "catalog" = "tu catálogo online", el canal "pos" = "el mostrador / tu local". Ej.: "Tus ventas por el catálogo online crecieron…", no "el canal creció…".
11. RATIONALE NATURAL, NO CRUDO: cada bullet es una frase corta en lenguaje natural que aporta LECTURA, no una métrica suelta. PROHIBIDO el formato "Métrica: valor" (nada de "Unidades vendidas en mayo: 87"). Usa marcos relativos y humanos ("casi 7 veces más que en abril", "más del doble", "el margen quedó sano, en 58%"). Los bullets deben ser distintos entre sí y del body, y juntos explicar POR QUÉ la recomendación tiene sentido — no listar datos que el dueño ya ve en sus tablas.
12. GRAMÁTICA Y NATURALIDAD: se dice "el margen" (masculino), nunca "la margen". Prefiere títulos en forma verbal y natural ("Subió el margen", "Caen las ventas de X") antes que nominal ("Aumento en el margen"). Redondea cifras a algo legible (46,3%, no 46.31000%).
13. SOLO LO ACCIONABLE: no emitas insights de "no hubo cambios", "se mantiene estable" o sin una acción/observación útil para el dueño. Si una métrica no cambió de forma material o no hay nada que hacer al respecto, OMÍTELA. Cada insight debe sugerir o destacar algo que valga la pena mirar.
14. SUGERENCIA CON DIRECCIÓN (sin orden). Decí explícitamente qué se podría hacer y hacia dónde, en forma de posibilidad: "podrías subir el precio", "puedes probar bajarlo". Prohibido lo vago ("revisa/ajusta el precio" sin dirección) Y el imperativo. TÍTULO: frase corta que nombre la oportunidad, SIN imperativo ni voseo — ej. "Margen para subir el precio de Tori", "Tori: la demanda está en alza", "Oportunidad de precio en Remera". NUNCA "Subí el precio" ni "Revisa el precio". El "body" encadena en una línea: qué pasó (en términos relativos) → por eso → qué podrías hacer. Si los datos no alcanzan para recomendar una dirección con confianza, no emitas el insight.
15. QUE SE NOTE ANÁLISIS, NO PLANTILLA. Varía la estructura y las palabras entre sugerencias: no todas pueden empezar igual ni seguir el mismo molde. Aportá la lectura (qué significa el dato), no el dato pelado que el dueño ya ve en sus tablas. Si dos insights se leen casi idénticos cambiando solo el nombre y los números, reescribilos distinto.

severity: "anomaly" para caídas/problemas que requieren atención, "opportunity" para mejoras de ganancia/volumen, "info" para contexto neutro.`

// --- Schemas de salida (subset OpenAPI que acepta Gemini responseSchema) ---

const insightItemBase = {
  type: 'OBJECT',
  properties: {
    target_ref: {
      type: 'STRING',
      nullable: true,
      description: 'id del producto, código del método de pago (ej. "cash"), o null para agregados del negocio',
    },
    severity: { type: 'STRING', enum: ['info', 'opportunity', 'anomaly'] },
    title: { type: 'STRING' },
    body: { type: 'STRING' },
    rationale: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['severity', 'title', 'body', 'rationale'],
}

// Nivel 1: elige productos a profundizar + emite insights de dominios sin profundización (pago/canal/stock/global).
export const N1_SCHEMA = {
  type: 'OBJECT',
  properties: {
    product_ids_to_deepen: {
      type: 'ARRAY',
      description: 'hasta 5 product_id (de los candidatos provistos) que vale la pena analizar en profundidad',
      items: { type: 'STRING' },
    },
    insights: {
      type: 'ARRAY',
      items: {
        ...insightItemBase,
        properties: {
          ...insightItemBase.properties,
          kind: {
            type: 'STRING',
            enum: ['payment', 'channel', 'stock', 'global'],
            description: 'dominio del insight (NO uses "product" acá; los productos van en product_ids_to_deepen)',
          },
        },
        required: [...insightItemBase.required, 'kind'],
      },
    },
  },
  required: ['product_ids_to_deepen', 'insights'],
}

// Nivel 2: insights de producto a partir del historial profundo. target_ref = product_id.
export const N2_SCHEMA = {
  type: 'OBJECT',
  properties: {
    insights: { type: 'ARRAY', items: insightItemBase },
  },
  required: ['insights'],
}

export function buildN1UserPrompt(payload: {
  businessName: string
  signals: unknown
  recentInsights: unknown
}): string {
  return `Negocio: ${payload.businessName}

SEÑALES DETECTADAS (ventana actual vs ventana previa de igual largo; todo ya calculado en la base):
${JSON.stringify(payload.signals, null, 1)}

SUGERENCIAS YA EMITIDAS RECIENTEMENTE (no repitas; respeta las "dismissed"):
${JSON.stringify(payload.recentInsights, null, 1)}

Tarea:
- En "product_ids_to_deepen" pon los product_id (de demand_shifts / margin) que merecen análisis profundo de su historial. Máximo 5, prioriza los de mayor impacto en dinero.
- En "insights" emite sugerencias YA LISTAS para los dominios pago/canal/stock/global, cada una con su rationale. No incluyas productos acá.

Calidad esperada (datos ficticios, imitá el ESTILO: interpretación + acción, no dato pelado):
{
  "kind": "payment", "target_ref": "card", "severity": "info",
  "title": "Cada vez te pagan más con tarjeta",
  "body": "El efectivo viene perdiendo peso frente a la tarjeta; si la comisión te molesta, podrías incentivar el efectivo con un pequeño descuento.",
  "rationale": ["La tarjeta pasó de 1 de cada 8 cobros a casi 1 de cada 3 en un mes.", "El efectivo cayó en esa misma proporción."]
}
Cada bullet INTERPRETA, no enumera. Variá la redacción entre insights.

Responde SOLO con un objeto JSON con esta forma exacta:
{
  "product_ids_to_deepen": ["<product_id>"],
  "insights": [
    { "kind": "payment|channel|stock|global", "target_ref": "<código o null>", "severity": "info|opportunity|anomaly", "title": "<máx 60 chars>", "body": "<1-2 frases>", "rationale": ["<bullet con número>", "<bullet con número>"] }
  ]
}
Si no hay nada material, devuelve listas vacías.`
}

export function buildN2UserPrompt(payload: {
  businessName: string
  histories: unknown
  recentInsights: unknown
}): string {
  return `Negocio: ${payload.businessName}

HISTORIAL MENSUAL PROFUNDO de los productos marcados (ventas, precio promedio, compras y costo, margen estimado):
${JSON.stringify(payload.histories, null, 1)}

SUGERENCIAS YA EMITIDAS RECIENTEMENTE (no repitas; respeta las "dismissed"):
${JSON.stringify(payload.recentInsights, null, 1)}

Tarea: por cada producto, PRIMERO determina qué cambió (precio promedio, unidades vendidas, costo, margen) entre los meses; DESPUÉS emite UNA sugerencia con una recomendación concreta y direccional. Usa este marco de decisión:
- Las unidades subieron fuerte con el precio igual o apenas mayor, y el margen es sano → la demanda está fuerte: podrías SUBIR el precio un poco; probablemente no pierdas ventas y ganes margen. (Este es el caso típico de "se vende mucho más al mismo precio".)
- Subiste el precio y las unidades cayeron → el precio frenó la demanda: podrías BAJARLO para recuperar ventas.
- El margen es muy flaco o negativo (precio cerca o debajo del costo) → podrías SUBIR el precio o revisar el costo de compra.
- El costo de compra subió y el precio no → tu margen se está comiendo: podrías SUBIR el precio para sostenerlo.
EJEMPLO del nivel de calidad esperado (datos ficticios de otro negocio, NO los copies; imitá el ESTILO):
{
  "target_ref": "<product_id>",
  "severity": "opportunity",
  "title": "Tori: la demanda está en alza",
  "body": "En mayo las ventas de Tori casi se septuplicaron frente a abril sin que bajaras el precio; con la demanda así de fuerte, podrías subir un poco el precio sin perder volumen.",
  "rationale": [
    "Pasaste de 13 a 87 unidades en un mes, casi 7 veces más.",
    "El margen quedó sano, en 58%, así que hay aire para ajustar.",
    "El precio casi no se movió ($485 a $500): el salto fue por demanda, no por precio."
  ]
}
Fijate cómo cada bullet INTERPRETA (qué significa), no enumera. EVITA bullets secos tipo "Unidades vendidas en mayo: 87" o "Precio promedio: $500" — eso el dueño ya lo ve en sus tablas.

Aplicá ese mismo nivel a CADA producto, variando la redacción. El "title" nombra la oportunidad SIN imperativo ni voseo (NUNCA "Subí el precio de X"). target_ref = el product_id. Si un producto no tiene una historia clara que justifique una dirección, omítelo.

Responde SOLO con un objeto JSON con esta forma exacta:
{
  "insights": [
    { "target_ref": "<product_id>", "severity": "info|opportunity|anomaly", "title": "<máx 60 chars>", "body": "<1-2 frases>", "rationale": ["<bullet con número>", "<bullet con número>"] }
  ]
}
Si ningún producto tiene historia clara, devuelve "insights": [].`
}
