-- =====================================================================
-- ACTUALIZACIÓN 9 · Zonas de dolor marcadas en el dibujo del cuerpo
-- Pegar ENTERO en Supabase → SQL Editor → New query → Run.
-- No borra nada. Se puede ejecutar más de una vez.
-- =====================================================================
alter table clientes add column if not exists zonas_dolor text[] not null default '{}';

-- Igual que las anotaciones: solo con consentimiento firmado
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'clientes_zonas_con_consentimiento') then
    alter table clientes add constraint clientes_zonas_con_consentimiento
      check (cardinality(zonas_dolor) = 0 or consentimiento_salud);
  end if;
end $$;

-- Si retira el consentimiento, se borran también las zonas marcadas
create or replace function aplicar_consentimiento() returns trigger language plpgsql
security definer set search_path = public as $$
begin
  update clientes set
    consentimiento_salud = new.acepta_salud,
    consentimiento_salud_en = case when new.acepta_salud then new.firmado_en else null end,
    salud = case when new.acepta_salud then salud else null end,
    zonas_dolor = case when new.acepta_salud then zonas_dolor else '{}' end,
    consentimiento_comunicaciones = new.acepta_comunicaciones,
    consentimiento_rechazado_en = case when new.tipo = 'rechazo' then new.firmado_en else null end
  where id = new.cliente_id;
  return new;
end $$;

select 'listo' as estado;
