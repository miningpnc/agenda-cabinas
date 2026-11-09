-- =====================================================================
-- ACTUALIZACIÓN 14 · Autónomos y asalariados + cobro real de cada sesión
--  · Cada trabajador es asalariado o autónomo. El autónomo paga al centro
--    un % de lo que factura (alquiler de sala).
--  · Al terminar una sesión se confirma lo que se ha cobrado de verdad
--    (puede ser más o menos de lo previsto). Lo confirma el autónomo en sus
--    citas y recepción en las de los asalariados (y puede corregir cualquiera).
-- Pegar ENTERO en Supabase → SQL Editor → New query → Run.
-- Necesita las actualizaciones 11 y 13. No borra nada. Se puede ejecutar más de una vez.
-- =====================================================================

-- ---------- Tipo de trabajador ----------
alter table trabajadores add column if not exists tipo text not null default 'asalariado';
alter table trabajadores add column if not exists porcentaje_centro numeric(5,2) not null default 0;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'trabajadores_tipo_valido') then
    alter table trabajadores add constraint trabajadores_tipo_valido check (tipo in ('asalariado','autonomo'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'trabajadores_porcentaje_valido') then
    alter table trabajadores add constraint trabajadores_porcentaje_valido check (porcentaje_centro between 0 and 100);
  end if;
end $$;

-- Hasta ahora «ve su facturación» = autónomo. Se pasan a autónomos con un 30 % de ejemplo.
update trabajadores set tipo = 'autonomo', porcentaje_centro = case when porcentaje_centro = 0 then 30 else porcentaje_centro end
where ver_facturacion and tipo = 'asalariado'
  and not exists (select 1 from trabajadores where tipo = 'autonomo');

-- El autónomo siempre ve (y confirma) su propia facturación; el asalariado no
create or replace function sincronizar_tipo_trabajador() returns trigger language plpgsql as $$
begin
  new.ver_facturacion := (new.tipo = 'autonomo');
  if new.tipo = 'asalariado' then new.porcentaje_centro := 0; end if;
  return new;
end $$;
drop trigger if exists sincronizar_tipo on trabajadores;
create trigger sincronizar_tipo before insert or update on trabajadores
  for each row execute function sincronizar_tipo_trabajador();
update trabajadores set tipo = tipo;   -- aplica la regla a los que ya existen

-- ---------- Cobro real de cada sesión ----------
alter table cobros add column if not exists previsto numeric(8,2);          -- precio previsto al dar la cita
alter table cobros add column if not exists autonomo boolean not null default false;
alter table cobros add column if not exists porcentaje_centro numeric(5,2);  -- % para el centro en ese momento
alter table cobros add column if not exists nota text;                       -- p. ej. «+ esmaltado»
alter table cobros add column if not exists confirmado_en timestamptz;
alter table cobros add column if not exists confirmado_por text;

-- Lo que ya había: previsto = cobrado, y lo de días anteriores se da por confirmado
update cobros co set previsto = coalesce(co.previsto, co.importe) where co.previsto is null;
update cobros co set autonomo = (t.tipo = 'autonomo'), porcentaje_centro = case when t.tipo = 'autonomo' then t.porcentaje_centro end
from trabajadores t where t.id = co.trabajador_id and co.porcentaje_centro is null and t.tipo = 'autonomo';
update cobros set confirmado_en = cobrado_en, confirmado_por = 'Datos anteriores'
where confirmado_en is null and cobrado_en < date_trunc('day', now());

create or replace function gestionar_cobro() returns trigger language plpgsql
security definer set search_path = public as $$
declare pr numeric; t record;
begin
  if new.estado = 'realizada' and (tg_op = 'INSERT' or old.estado <> 'realizada') then
    pr := coalesce(new.precio, (select precio from precios where servicio_id = new.servicio_id), 0);
    select tipo, porcentaje_centro into t from trabajadores where id = new.trabajador_id;
    insert into cobros (cita_id, trabajador_id, importe, previsto, autonomo, porcentaje_centro)
    values (new.id, new.trabajador_id, pr, pr, coalesce(t.tipo = 'autonomo', false),
            case when t.tipo = 'autonomo' then t.porcentaje_centro end)
    on conflict (cita_id) do nothing;
  elsif tg_op = 'UPDATE' and old.estado = 'realizada' and new.estado <> 'realizada' then
    delete from cobros where cita_id = new.id;
  elsif tg_op = 'UPDATE' and new.trabajador_id <> old.trabajador_id then
    select tipo, porcentaje_centro into t from trabajadores where id = new.trabajador_id;
    update cobros set trabajador_id = new.trabajador_id, autonomo = coalesce(t.tipo = 'autonomo', false),
      porcentaje_centro = case when t.tipo = 'autonomo' then t.porcentaje_centro end
    where cita_id = new.id;
  end if;
  return new;
end $$;

-- Al guardar un cobro desde la app queda confirmado (quién y cuándo).
-- El trabajador no puede tocar el previsto ni el % del centro.
create or replace function confirmar_cobro() returns trigger language plpgsql
security definer set search_path = public as $$
begin
  if auth.uid() is null or pg_trigger_depth() > 1 then return new; end if;   -- solo cambios hechos desde la app
  if mi_rol() = 'trabajador' then
    new.previsto := old.previsto; new.autonomo := old.autonomo;
    new.porcentaje_centro := old.porcentaje_centro; new.trabajador_id := old.trabajador_id;
  end if;
  new.confirmado_en := now();
  new.confirmado_por := nombre_usuario_actual();
  return new;
end $$;
drop trigger if exists confirmar_cobro on cobros;
create trigger confirmar_cobro before update on cobros
  for each row execute function confirmar_cobro();

-- Solo el autónomo puede confirmar sus cobros (el asalariado, no: lo hace recepción)
drop policy if exists trabajador_cambia on cobros;
create policy trabajador_cambia on cobros for update to authenticated
  using (puedo_facturar() and trabajador_id = mi_trabajador())
  with check (puedo_facturar() and trabajador_id = mi_trabajador());

-- ---------- Estadísticas: lo que entra al centro ----------
create or replace function estadisticas(p_desde date, p_hasta date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare tz text; r jsonb; d0 date := p_desde; d1 date := p_hasta;
begin
  if not soy_propietario() then raise exception 'Solo dirección puede ver las estadísticas'; end if;
  select coalesce(zona_horaria, 'Europe/Madrid') into tz from ajustes where id = 1;
  tz := coalesce(tz, 'Europe/Madrid');
  if d0 is null then
    select coalesce(min((inicio at time zone tz)::date), current_date) into d0 from citas;
  end if;
  d1 := coalesce(d1, current_date);

  with c as (
    select ci.*, (ci.inicio at time zone tz) as li, (ci.fin at time zone tz) as lf,
           coalesce(co.importe, 0) as imp,
           case when co.autonomo then coalesce(co.importe, 0) * coalesce(co.porcentaje_centro, 0) / 100
                else coalesce(co.importe, 0) end as cen,
           coalesce(co.previsto, co.importe, 0) as prev
    from citas ci left join cobros co on co.cita_id = ci.id
    where ci.inicio >= (d0::timestamp at time zone tz) and ci.inicio < ((d1 + 1)::timestamp at time zone tz)
  ),
  dias as (
    select li::date as d, trabajador_id as t,
           count(*) filter (where estado = 'realizada') as n,
           sum(imp) filter (where estado = 'realizada') as imp,
           sum(cen) filter (where estado = 'realizada') as cen,
           sum(prev) filter (where estado = 'realizada') as prev,
           count(*) filter (where estado = 'no vino') as nv,
           count(*) filter (where estado = 'cancelada') as ca,
           count(*) filter (where estado = 'confirmada') as pe,
           sum(extract(epoch from lf - li) / 60) filter (where estado <> 'cancelada') as mo
    from c group by 1, 2
  ),
  horas as (
    select extract(isodow from li)::int as w, extract(hour from li)::int as h,
           count(*) as n, sum(imp) as imp
    from c where estado = 'realizada' group by 1, 2
  ),
  ocupado as (
    select extract(isodow from g)::int as w, extract(hour from g)::int as h,
           sum(extract(epoch from least(lf, g + interval '1 hour') - greatest(li, g)) / 60) as mo
    from c cross join lateral generate_series(date_trunc('hour', li), lf - interval '1 second', interval '1 hour') g
    where estado <> 'cancelada' group by 1, 2
  ),
  capacidad as (
    select extract(isodow from dd)::int as w, hh as h,
           sum(extract(epoch from least(hd.cierre, make_time(hh, 0, 0) + interval '1 hour')
                              - greatest(hd.apertura, make_time(hh, 0, 0))) / 60
               * (select count(*) from trabajadores where activo)) as md
    from generate_series(d0, d1, interval '1 day') dd
    cross join lateral horario_del_dia(dd::date) hd
    cross join generate_series(0, 23) hh
    where hd.abierto and make_time(hh, 0, 0) < hd.cierre and make_time(hh, 0, 0) + interval '1 hour' > hd.apertura
    group by 1, 2
  ),
  serv as (
    select servicio_id as s, count(*) as n, sum(imp) as imp from c where estado = 'realizada' group by 1
  )
  select jsonb_build_object(
    'desde', d0, 'hasta', d1,
    'dias', coalesce((select jsonb_agg(jsonb_build_object('d', d, 't', t, 'n', n, 'imp', coalesce(imp, 0), 'cen', round(coalesce(cen, 0), 2), 'prev', coalesce(prev, 0), 'nv', nv, 'ca', ca, 'pe', pe, 'mo', round(coalesce(mo, 0)))) from dias), '[]'),
    'horas', coalesce((select jsonb_agg(jsonb_build_object('w', w, 'h', h, 'n', n, 'imp', imp)) from horas), '[]'),
    'ocupado', coalesce((select jsonb_agg(jsonb_build_object('w', w, 'h', h, 'mo', round(mo))) from ocupado), '[]'),
    'capacidad', coalesce((select jsonb_agg(jsonb_build_object('w', w, 'h', h, 'md', round(md))) from capacidad), '[]'),
    'servicios', coalesce((select jsonb_agg(jsonb_build_object('s', s, 'n', n, 'imp', imp)) from serv), '[]'),
    'primer_dia', (select min((inicio at time zone tz)::date) from citas)
  ) into r;
  return r;
end $$;

select (select string_agg(nombre || ': ' || tipo || case when tipo = 'autonomo' then ' ' || porcentaje_centro || ' %' else '' end, ' · ' order by nombre) from trabajadores) as equipo,
       (select count(*) from cobros where confirmado_en is null) as cobros_por_confirmar,
       'listo' as estado;
