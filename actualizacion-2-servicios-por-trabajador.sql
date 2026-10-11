-- =====================================================================
-- ACTUALIZACIÓN 2 · Cada trabajador solo da los servicios de sus actividades
--                   + servicio «Otro» con precio libre
-- Pegar ENTERO en Supabase → SQL Editor → New query → Run
-- (si pregunta por RLS: «Run and enable RLS»).
-- No borra nada. Se puede ejecutar más de una vez.
-- =====================================================================

-- ---------- Columnas nuevas ----------
alter table servicios add column if not exists precio_libre boolean not null default false;
alter table citas add column if not exists precio numeric(8,2);   -- precio de esta cita (servicio «Otro»)
alter table citas add column if not exists concepto text;         -- qué se hace (servicio «Otro»)

-- ---------- Servicio «Otro» en cada actividad ----------
insert into servicios (actividad_id, nombre, duracion_min, activo, precio_libre)
select a.id, 'Otro', 30, true, true from actividades a
where not exists (select 1 from servicios s where s.actividad_id = a.id and s.nombre = 'Otro');
update servicios set precio_libre = true where nombre = 'Otro';

-- ---------- Solo servicios de las actividades del trabajador ----------
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
  return new;
end $$;
drop trigger if exists a_comprobar_servicio on citas;
create trigger a_comprobar_servicio before insert or update on citas
  for each row execute function comprobar_servicio();

-- ---------- El cobro usa el precio de la cita si lo tiene ----------
create or replace function gestionar_cobro() returns trigger language plpgsql
security definer set search_path = public as $$
begin
  if new.estado = 'realizada' and (tg_op = 'INSERT' or old.estado <> 'realizada') then
    insert into cobros (cita_id, trabajador_id, importe)
    values (new.id, new.trabajador_id,
            coalesce(new.precio, (select precio from precios where servicio_id = new.servicio_id), 0))
    on conflict (cita_id) do nothing;
  elsif tg_op = 'UPDATE' and old.estado = 'realizada' and new.estado <> 'realizada' then
    delete from cobros where cita_id = new.id;
  elsif tg_op = 'UPDATE' and new.trabajador_id <> old.trabajador_id then
    update cobros set trabajador_id = new.trabajador_id where cita_id = new.id;
  end if;
  return new;
end $$;

-- ---------- Los avisos incluyen el concepto del servicio «Otro» ----------
create or replace function avisar_cita() returns trigger language plpgsql
security definer set search_path = public as $$
declare actor text := mi_rol(); tipo text; tz text; txt text;
        cli text; srv text; quien text; cuando text;
begin
  if auth.uid() is null or actor is null then return new; end if;
  if tg_op = 'INSERT' then tipo := 'nueva';
  elsif new.estado = 'cancelada' and old.estado <> 'cancelada' then tipo := 'cancelada';
  elsif new.estado = 'confirmada' and (new.inicio <> old.inicio or new.fin <> old.fin
        or new.trabajador_id <> old.trabajador_id
        or new.cabina_id is distinct from old.cabina_id
        or new.servicio_id is distinct from old.servicio_id
        or old.estado <> 'confirmada') then tipo := 'cambio';
  else return new; end if;

  select zona_horaria into tz from ajustes where id = 1;
  select nombre into cli from clientes where id = new.cliente_id;
  select nombre into srv from servicios where id = new.servicio_id;
  if new.concepto is not null and new.concepto <> '' then srv := coalesce(srv, '') || ': ' || new.concepto; end if;
  select nombre into quien from trabajadores where id = new.trabajador_id;
  cuando := to_char(new.inicio at time zone coalesce(tz,'Europe/Madrid'), 'DD/MM HH24:MI');
  txt := case tipo when 'nueva' then 'Nueva cita' when 'cambio' then 'Cita modificada'
                   else 'Cita cancelada' end
         || ' · ' || cuando || ' · ' || coalesce(cli,'Sin cliente') || ' · ' || coalesce(srv,'');

  if actor = 'trabajador' then
    insert into avisos (cita_id, para_rol, tipo, mensaje)
    values (new.id, 'recepcion', tipo, coalesce(quien,'') || ': ' || txt);
  else
    insert into avisos (cita_id, para_rol, para_trabajador_id, tipo, mensaje)
    values (new.id, 'trabajador', new.trabajador_id, tipo, txt);
    if tg_op = 'UPDATE' and new.trabajador_id <> old.trabajador_id then
      insert into avisos (cita_id, para_rol, para_trabajador_id, tipo, mensaje)
      values (new.id, 'trabajador', old.trabajador_id, 'cancelada',
              'Cita reasignada a ' || coalesce(quien,'otra persona') || ' · ' || cuando);
    end if;
  end if;
  return new;
end $$;

-- ---------- María da todo lo de la carta: masajes, estética y uñas ----------
insert into trabajador_actividades (trabajador_id, actividad_id)
select t.id, a.id from trabajadores t join actividades a on a.nombre in ('Masajes','Estética','Uñas')
where t.nombre = 'María'
on conflict do nothing;
insert into trabajador_cabinas (trabajador_id, cabina_id, principal)
select t.id, c.id, false from trabajadores t join cabinas c on c.nombre = 'Cabina uñas'
where t.nombre = 'María'
on conflict do nothing;

select t.nombre as trabajador, string_agg(a.nombre, ', ' order by a.orden) as actividades
from trabajadores t left join trabajador_actividades ta on ta.trabajador_id = t.id
left join actividades a on a.id = ta.actividad_id group by t.nombre order by t.nombre;
