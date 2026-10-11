-- =====================================================================
-- ACTUALIZACIÓN 7 · Consentimiento de protección de datos firmado
-- Pegar ENTERO en Supabase → SQL Editor → New query → Run
-- (si pregunta por RLS: «Run and enable RLS»).
-- No borra nada. Se puede ejecutar más de una vez.
-- =====================================================================

-- Datos del centro que aparecen como «responsable» en la hoja
alter table ajustes add column if not exists razon_social text;
alter table ajustes add column if not exists cif text;
alter table ajustes add column if not exists email_contacto text;
alter table ajustes add column if not exists poblacion text;

alter table clientes add column if not exists consentimiento_comunicaciones boolean not null default false;

-- Cada hoja firmada (o retirada) queda guardada tal cual se firmó
create table if not exists consentimientos (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes on delete cascade,
  tipo text not null default 'firma' check (tipo in ('firma','papel','retirada')),
  acepta_salud boolean not null default false,
  acepta_comunicaciones boolean not null default false,
  texto text not null,     -- la hoja completa, tal como se firmó
  datos jsonb,             -- datos del cliente en ese momento
  firma text,              -- imagen de la firma (PNG) si se firmó en pantalla
  firmado_en timestamptz not null default now(),
  registrado_por uuid default auth.uid());
create index if not exists consentimientos_cliente on consentimientos (cliente_id, firmado_en desc);

alter table consentimientos enable row level security;
drop policy if exists ver on consentimientos;
drop policy if exists crear on consentimientos;
create policy ver on consentimientos for select to authenticated using (
  mi_rol() = 'recepcion'
  or exists (select 1 from clientes c where c.id = cliente_id and c.creado_por = auth.uid()));
create policy crear on consentimientos for insert to authenticated with check (
  mi_rol() = 'recepcion'
  or exists (select 1 from clientes c where c.id = cliente_id and c.creado_por = auth.uid()));
-- No se pueden modificar ni borrar: es el justificante

-- Al guardar una hoja, la ficha del cliente se actualiza sola
create or replace function aplicar_consentimiento() returns trigger language plpgsql
security definer set search_path = public as $$
begin
  update clientes set
    consentimiento_salud = new.acepta_salud,
    consentimiento_salud_en = case when new.acepta_salud then new.firmado_en else null end,
    salud = case when new.acepta_salud then salud else null end,   -- si lo retira, se borran las anotaciones
    consentimiento_comunicaciones = new.acepta_comunicaciones
  where id = new.cliente_id;
  return new;
end $$;
drop trigger if exists al_guardar_consentimiento on consentimientos;
create trigger al_guardar_consentimiento after insert on consentimientos
  for each row execute function aplicar_consentimiento();

-- Datos de ejemplo del centro (cámbialos en Ajustes → Centro)
update ajustes set
  razon_social = coalesce(razon_social, 'Centro de demostración S.L.'),
  cif = coalesce(cif, 'B00000000'),
  email_contacto = coalesce(email_contacto, 'miningpnc@gmail.com'),
  poblacion = coalesce(poblacion, 'Albir')
where id = 1;

select 'listo' as estado;
