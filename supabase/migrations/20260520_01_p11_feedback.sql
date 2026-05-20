-- P11: User feedback (bug reports / sugerencias / otros).
-- Tabla privada por business, RPC para insertar (sin policy de INSERT directo),
-- bucket privado para screenshots, RPC para anexar links externos.

-- 1. Table -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.feedback (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id       uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  operator_id       uuid NULL REFERENCES public.operators(id) ON DELETE SET NULL,
  type              text NOT NULL CHECK (type IN ('bug','sugerencia','otro')),
  message           text NOT NULL CHECK (char_length(message) BETWEEN 10 AND 1000),
  contact_email     text NULL,
  route             text NULL,
  user_agent        text NULL,
  attachment_path   text NULL,
  github_issue_url  text NULL,
  telegram_sent_at  timestamptz NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS feedback_business_created_idx
  ON public.feedback (business_id, created_at DESC);

CREATE INDEX IF NOT EXISTS feedback_created_idx
  ON public.feedback (created_at DESC);

ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS feedback_select_own_business ON public.feedback;
CREATE POLICY feedback_select_own_business
  ON public.feedback
  FOR SELECT
  TO authenticated
  USING (business_id = public.get_business_id());

-- Sin policies de INSERT/UPDATE/DELETE — todo pasa por RPCs SECURITY DEFINER.

-- 2. RPC: create_feedback --------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_feedback(
  p_business_id      uuid,
  p_operator_id      uuid,
  p_type             text,
  p_message          text,
  p_contact_email    text DEFAULT NULL,
  p_route            text DEFAULT NULL,
  p_user_agent       text DEFAULT NULL,
  p_attachment_path  text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_caller_business_id uuid;
  v_row                public.feedback%ROWTYPE;
BEGIN
  v_caller_business_id := public.get_business_id();

  IF v_caller_business_id IS NULL OR p_business_id IS DISTINCT FROM v_caller_business_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Contexto de negocio inválido');
  END IF;

  IF p_type IS NULL OR p_type NOT IN ('bug','sugerencia','otro') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Tipo de feedback inválido');
  END IF;

  IF p_message IS NULL OR char_length(p_message) < 10 OR char_length(p_message) > 1000 THEN
    RETURN jsonb_build_object('success', false, 'error', 'El mensaje debe tener entre 10 y 1000 caracteres');
  END IF;

  IF p_operator_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.operators
      WHERE id = p_operator_id
        AND business_id = v_caller_business_id
        AND is_active = true
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Operador inválido');
    END IF;
  END IF;

  IF p_attachment_path IS NOT NULL
     AND p_attachment_path NOT LIKE (v_caller_business_id::text || '/%') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Ruta de adjunto inválida');
  END IF;

  INSERT INTO public.feedback (
    business_id, operator_id, type, message, contact_email,
    route, user_agent, attachment_path
  ) VALUES (
    v_caller_business_id, p_operator_id, p_type, p_message, NULLIF(btrim(p_contact_email), ''),
    NULLIF(btrim(p_route), ''), NULLIF(btrim(p_user_agent), ''), p_attachment_path
  )
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'success', true,
    'data', to_jsonb(v_row)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_feedback(uuid, uuid, text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_feedback(uuid, uuid, text, text, text, text, text, text) TO authenticated;

-- 3. RPC: attach_feedback_links -------------------------------------------

CREATE OR REPLACE FUNCTION public.attach_feedback_links(
  p_id                uuid,
  p_github_issue_url  text,
  p_telegram_sent_at  timestamptz
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_caller_business_id uuid;
  v_row                public.feedback%ROWTYPE;
BEGIN
  v_caller_business_id := public.get_business_id();

  IF v_caller_business_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'No autenticado');
  END IF;

  UPDATE public.feedback
  SET
    github_issue_url = COALESCE(p_github_issue_url, github_issue_url),
    telegram_sent_at = COALESCE(p_telegram_sent_at, telegram_sent_at)
  WHERE id = p_id
    AND business_id = v_caller_business_id
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Feedback no encontrado');
  END IF;

  RETURN jsonb_build_object('success', true, 'data', to_jsonb(v_row));
END;
$$;

REVOKE ALL ON FUNCTION public.attach_feedback_links(uuid, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.attach_feedback_links(uuid, text, timestamptz) TO authenticated;

-- 4. Storage bucket + policies --------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'feedback-attachments',
  'feedback-attachments',
  false,
  5242880, -- 5 MB
  ARRAY['image/png','image/jpeg','image/webp','image/gif']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Policy: el usuario autenticado solo puede subir bajo la carpeta de su business.
DROP POLICY IF EXISTS feedback_attachments_insert ON storage.objects;
CREATE POLICY feedback_attachments_insert
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'feedback-attachments'
    AND (storage.foldername(name))[1] = (
      SELECT business_id::text
      FROM public.profiles
      WHERE id = auth.uid()
    )
  );

-- Policy: lectura solo de adjuntos del propio business.
DROP POLICY IF EXISTS feedback_attachments_select ON storage.objects;
CREATE POLICY feedback_attachments_select
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'feedback-attachments'
    AND (storage.foldername(name))[1] = (
      SELECT business_id::text
      FROM public.profiles
      WHERE id = auth.uid()
    )
  );

-- Sin políticas de UPDATE/DELETE — adjuntos son inmutables.
