-- =====================================================================
-- ACTUALIZACIÓN 8 · Documento de identidad, nacionalidad y «no quiere firmar»
-- Pegar ENTERO en Supabase → SQL Editor → New query → Run.
-- No borra nada. Se puede ejecutar más de una vez.
-- =====================================================================
alter table clientes add column if not exists tipo_documento text;      -- DNI, NIE, Pasaporte, Otro
alter table clientes add column if not exists numero_documento text;
alter table clientes add column if not exists nacionalidad text;        -- código ISO del país
alter table clientes add column if not exists consentimiento_rechazado_en timestamptz;
create index if not exists clientes_numero_documento on clientes (upper(numero_documento));

-- Nuevo tipo de registro: el cliente no quiere firmar
alter table consentimientos drop constraint if exists consentimientos_tipo_check;
alter table consentimientos add constraint consentimientos_tipo_check
  check (tipo in ('firma','papel','retirada','rechazo'));

create or replace function aplicar_consentimiento() returns trigger language plpgsql
security definer set search_path = public as $$
begin
  update clientes set
    consentimiento_salud = new.acepta_salud,
    consentimiento_salud_en = case when new.acepta_salud then new.firmado_en else null end,
    salud = case when new.acepta_salud then salud else null end,
    consentimiento_comunicaciones = new.acepta_comunicaciones,
    consentimiento_rechazado_en = case when new.tipo = 'rechazo' then new.firmado_en else null end
  where id = new.cliente_id;
  return new;
end $$;

-- Ejemplos: documento y nacionalidad para los clientes de ejemplo
update clientes set
  nacionalidad = coalesce(nacionalidad, pais_telefono),
  tipo_documento = coalesce(tipo_documento, case when coalesce(pais_telefono,'ES') = 'ES' then 'DNI' else 'Pasaporte' end),
  numero_documento = coalesce(numero_documento,
    case when coalesce(pais_telefono,'ES') = 'ES'
         then lpad((abs(hashtext(id::text)) % 100000000)::text, 8, '0') || substr('TRWAGMYFPDXBNJZSQVHLCKE', (abs(hashtext(id::text)) % 100000000) % 23 + 1, 1)
         else upper(substr(md5(id::text), 1, 9)) end)
where numero_documento is null and creado_en < now();

select count(*) filter (where numero_documento is not null) as con_documento, count(*) as clientes from clientes;
