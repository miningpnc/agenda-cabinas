-- =====================================================================
-- ACTUALIZACIÓN 12 · Foto de cada trabajador (selfie desde la app)
-- Pegar ENTERO en Supabase → SQL Editor → New query → Run.
-- No borra nada. Se puede ejecutar más de una vez.
-- =====================================================================
alter table trabajadores add column if not exists foto text;   -- imagen pequeña (data:image/jpeg...)

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'trabajadores_foto_valida') then
    alter table trabajadores add constraint trabajadores_foto_valida
      check (foto is null or (foto like 'data:image/%' and length(foto) <= 300000));
  end if;
end $$;

-- Cada trabajador puede poner o quitar SU foto (el resto de su ficha la sigue llevando recepción)
create or replace function guardar_mi_foto(p_foto text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if mi_trabajador() is null then raise exception 'Solo los trabajadores tienen foto en la agenda'; end if;
  update trabajadores set foto = nullif(p_foto, '') where id = mi_trabajador();
end $$;
revoke execute on function guardar_mi_foto(text) from public, anon;
grant execute on function guardar_mi_foto(text) to authenticated;

select 'listo' as estado;
