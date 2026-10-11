-- =====================================================================
-- ACTUALIZACIÓN 10 · Solo recepción cambia el precio de los servicios con tarifa
-- (los trabajadores solo ponen precio en los servicios de precio libre, como «Otro»)
-- Pegar ENTERO en Supabase → SQL Editor → New query → Run.
-- No borra nada. Se puede ejecutar más de una vez.
-- =====================================================================
create or replace function comprobar_servicio() returns trigger language plpgsql
security definer set search_path = public as $$
declare s record; quien text;
begin
  if new.servicio_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.servicio_id = old.servicio_id and new.trabajador_id = old.trabajador_id
     and new.precio is not distinct from old.precio then return new; end if;
  select sv.nombre, sv.precio_libre, sv.actividad_id, a.nombre as actividad into s
  from servicios sv join actividades a on a.id = sv.actividad_id where sv.id = new.servicio_id;
  if not exists (select 1 from trabajador_actividades
                 where trabajador_id = new.trabajador_id and actividad_id = s.actividad_id) then
    select nombre into quien from trabajadores where id = new.trabajador_id;
    raise exception 'SERVICIO_NO_PERMITIDO|%|%', coalesce(quien, ''), s.actividad;
  end if;
  if s.precio_libre and (new.precio is null or new.precio < 0) then
    raise exception 'FALTA_PRECIO|%', s.nombre;
  end if;
  -- Servicio con tarifa: el trabajador no puede ponerle otro precio
  if not s.precio_libre and mi_rol() = 'trabajador' then
    new.precio := case when tg_op = 'UPDATE' and new.servicio_id = old.servicio_id then old.precio else null end;
  end if;
  return new;
end $$;

select 'listo' as estado;
