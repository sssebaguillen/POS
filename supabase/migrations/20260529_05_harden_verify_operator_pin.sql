-- 20260529_05_harden_verify_operator_pin.sql
-- Endurece verify_operator_pin contra brute-force de PIN (frente pendiente seccion 5 del doc 08).
-- Tres cambios, sin alterar el contrato de retorno del camino feliz (profile_id, name, role, permissions):
--   (a) Guard de tenant (assert_tenant) como primera sentencia -> regla 34 (defensa en profundidad:
--       impide que un autenticado sondee operadores de otro negocio pasando su business_id).
--   (b) Lockout durable: 5 intentos fallidos -> bloqueo 15 min. Protege incluso por el camino
--       autenticado (terminal compartida: un operador intentando adivinar el PIN de un companero).
--   (c) REVOKE EXECUTE de PUBLIC/anon + GRANT authenticated -> cierra el bypass anon directo a la
--       RPC (Supabase otorga EXECUTE a PUBLIC por defecto; el unico llamador legitimo es el route
--       de switch, que corre con la sesion autenticada del dueno).

ALTER TABLE public.operators
  ADD COLUMN IF NOT EXISTS failed_pin_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pin_locked_until    timestamptz;

CREATE OR REPLACE FUNCTION public.verify_operator_pin(p_business_id uuid, p_operator_id uuid, p_pin text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_operator      operators%rowtype;
  v_max_attempts  constant integer := 5;
  v_lock_minutes  constant integer := 15;
  v_attempts      integer;
  v_locked_until  timestamptz;
begin
  -- (a) El llamador debe ser dueno de este negocio (lanza 'Contexto de negocio invalido' si no).
  perform public.assert_tenant(p_business_id);

  select * into v_operator
  from operators
  where id = p_operator_id
    and business_id = p_business_id
    and is_active = true;

  if not found then
    return json_build_object('success', false, 'error', 'Operador no encontrado');
  end if;

  -- (b) Si esta bloqueado, rechazar sin chequear el PIN.
  if v_operator.pin_locked_until is not null and v_operator.pin_locked_until > now() then
    return json_build_object(
      'success', false,
      'locked', true,
      'locked_until', v_operator.pin_locked_until,
      'error', 'Demasiados intentos fallidos. Intenta nuevamente en unos minutos.'
    );
  end if;

  -- PIN incorrecto: incrementar el contador y bloquear si supera el umbral.
  if v_operator.pin != extensions.crypt(p_pin, v_operator.pin) then
    v_attempts := coalesce(v_operator.failed_pin_attempts, 0) + 1;
    v_locked_until := case
      when v_attempts >= v_max_attempts then now() + make_interval(mins => v_lock_minutes)
      else null
    end;

    update operators
       set failed_pin_attempts = v_attempts,
           pin_locked_until    = v_locked_until
     where id = v_operator.id;

    if v_locked_until is not null then
      return json_build_object(
        'success', false,
        'locked', true,
        'locked_until', v_locked_until,
        'error', 'Demasiados intentos fallidos. Intenta nuevamente en unos minutos.'
      );
    end if;

    return json_build_object('success', false, 'error', 'PIN incorrecto');
  end if;

  -- Exito: resetear contador/bloqueo si hacia falta.
  if coalesce(v_operator.failed_pin_attempts, 0) <> 0 or v_operator.pin_locked_until is not null then
    update operators set failed_pin_attempts = 0, pin_locked_until = null where id = v_operator.id;
  end if;

  return json_build_object(
    'success', true,
    'profile_id', v_operator.id,
    'name', v_operator.name,
    'role', v_operator.role,
    'permissions', v_operator.permissions
  );
end;
$function$;

REVOKE EXECUTE ON FUNCTION public.verify_operator_pin(uuid, uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.verify_operator_pin(uuid, uuid, text) TO authenticated;
