-- =====================================================================
-- ACTUALIZACIÓN 11 · Perfil de dirección (propietario) con estadísticas,
-- historial de cambios, logo del centro y dos años de datos de ejemplo
-- Pegar ENTERO en Supabase → SQL Editor → New query → Run
-- (si pregunta por RLS: «Run and enable RLS»).
-- No borra nada. Se puede ejecutar más de una vez.
-- =====================================================================

-- ---------- Logo del centro y «latido» para que la base no se duerma ----------
alter table ajustes add column if not exists logo text;           -- imagen pequeña (data:image/...)
alter table ajustes add column if not exists ultimo_latido timestamptz;

create or replace function mantener_activo() returns text language sql
security definer set search_path = public as $$
  update ajustes set ultimo_latido = now() where id = 1 returning 'ok' $$;
revoke execute on function mantener_activo() from public;
grant execute on function mantener_activo() to anon, authenticated;

-- ---------- Dirección / propietario ----------
-- Tiene todos los permisos de recepción y, además, las estadísticas.
alter table perfiles add column if not exists propietario boolean not null default false;

-- Emails que, al confirmar su cuenta, entran como dirección
create table if not exists emails_propietario (email text primary key);
alter table emails_propietario enable row level security;
insert into emails_propietario (email) values ('miningpnc+propietario@gmail.com') on conflict do nothing;

create or replace function soy_propietario() returns boolean language sql stable
security definer set search_path = public as
$$ select coalesce((select propietario from perfiles where user_id = auth.uid()), false) $$;

drop policy if exists propietario on emails_propietario;
create policy propietario on emails_propietario for all to authenticated
  using (soy_propietario()) with check (soy_propietario());

-- Nadie puede hacerse propietario a sí mismo desde la app (solo otro propietario o el SQL Editor)
create or replace function proteger_propietario() returns trigger language plpgsql
security definer set search_path = public as $$
begin
  if auth.uid() is not null and not soy_propietario() then
    new.propietario := case when tg_op = 'UPDATE' then old.propietario else false end;
  end if;
  return new;
end $$;
drop trigger if exists proteger_propietario on perfiles;
create trigger proteger_propietario before insert or update on perfiles
  for each row execute function proteger_propietario();

create or replace function vincular_usuario() returns trigger language plpgsql
security definer set search_path = public as $$
begin
  if exists (select 1 from perfiles where user_id = new.id) then return new; end if;
  -- Dirección
  if exists (select 1 from emails_propietario where lower(email) = lower(new.email)) then
    insert into perfiles (user_id, rol, email, propietario) values (new.id, 'recepcion', new.email, true)
    on conflict (user_id) do nothing;
    return new;
  end if;
  if not exists (select 1 from perfiles where rol = 'recepcion') then
    insert into perfiles (user_id, rol, email) values (new.id, 'recepcion', new.email)
    on conflict (user_id) do nothing;
    return new;
  end if;
  insert into perfiles (user_id, rol, trabajador_id, email)
  select new.id, 'trabajador', t.id, new.email from trabajadores t
  where t.email is not null and lower(t.email) = lower(new.email)
  on conflict (user_id) do nothing;
  return new;
end $$;

-- Si la cuenta de dirección ya existía, se marca ahora
update auth.users set email_confirmed_at = coalesce(email_confirmed_at, now())
where lower(email) in (select lower(email) from emails_propietario);
insert into perfiles (user_id, rol, email, propietario)
select u.id, 'recepcion', u.email, true from auth.users u
where lower(u.email) in (select lower(email) from emails_propietario)
on conflict (user_id) do update set rol = 'recepcion', trabajador_id = null, propietario = true;

-- ---------- Historial de cambios ----------
-- Cada alta, cambio o borrado de citas y clientes queda anotado: quién, cuándo y qué cambió.
create table if not exists cambios (
  id bigserial primary key,
  en timestamptz not null default now(),
  tabla text not null,                 -- 'citas' o 'clientes'
  registro_id uuid not null,
  cliente_id uuid,
  accion text not null check (accion in ('crear','cambiar','borrar')),
  campos jsonb not null default '{}',  -- { campo: [antes, después] }
  usuario uuid default auth.uid(),
  quien text);
create index if not exists cambios_registro on cambios (registro_id, en desc);
create index if not exists cambios_cliente on cambios (cliente_id, en desc);

create or replace function nombre_usuario_actual() returns text language sql stable
security definer set search_path = public as $$
  select coalesce(
    (select t.nombre from perfiles p join trabajadores t on t.id = p.trabajador_id where p.user_id = auth.uid()),
    (select case when p.propietario then 'Dirección' else 'Recepción' end from perfiles p where p.user_id = auth.uid()),
    'Sistema') $$;

create or replace function registrar_cambio() returns trigger language plpgsql
security definer set search_path = public as $$
declare a jsonb; b jsonb; dif jsonb := '{}'; k text;
        ignorar text[] := array['creado_en','creado_por','solape_confirmado','ultimo_latido'];
        cli uuid;
begin
  if tg_op = 'DELETE' then
    -- Borrados en cascada (p. ej. las citas de un cliente borrado) no se anotan uno a uno
    if pg_trigger_depth() > 1 then return old; end if;
    if tg_table_name = 'clientes' then
      delete from cambios where cliente_id = old.id;   -- su historial se va con él
      insert into cambios (tabla, registro_id, cliente_id, accion, campos, quien)
      values ('clientes', old.id, null, 'borrar', jsonb_build_object('nombre', jsonb_build_array(old.nombre, null)), nombre_usuario_actual());
    else
      insert into cambios (tabla, registro_id, cliente_id, accion, campos, quien)
      values ('citas', old.id, old.cliente_id, 'borrar',
              jsonb_build_object('inicio', jsonb_build_array(old.inicio, null), 'servicio_id', jsonb_build_array(old.servicio_id, null)),
              nombre_usuario_actual());
    end if;
    return old;
  end if;
  b := to_jsonb(new);
  cli := case when tg_table_name = 'clientes' then new.id else (b->>'cliente_id')::uuid end;
  if tg_op = 'INSERT' then
    insert into cambios (tabla, registro_id, cliente_id, accion, quien)
    values (tg_table_name, new.id, cli, 'crear', nombre_usuario_actual());
    return new;
  end if;
  a := to_jsonb(old);
  for k in select jsonb_object_keys(b) loop
    continue when k = any(ignorar);
    if (a->k) is distinct from (b->k) then dif := dif || jsonb_build_object(k, jsonb_build_array(a->k, b->k)); end if;
  end loop;
  if dif <> '{}' then
    insert into cambios (tabla, registro_id, cliente_id, accion, campos, quien)
    values (tg_table_name, new.id, cli, 'cambiar', dif, nombre_usuario_actual());
  end if;
  return new;
end $$;
drop trigger if exists z_registrar_cambio on citas;
create trigger z_registrar_cambio after insert or update or delete on citas
  for each row execute function registrar_cambio();
drop trigger if exists z_registrar_cambio on clientes;
create trigger z_registrar_cambio after insert or update or delete on clientes
  for each row execute function registrar_cambio();

alter table cambios enable row level security;
drop policy if exists ver on cambios;
-- Recepción, todo. Trabajador: lo de los clientes que puede ver y sus propias citas
-- (sin cambios de precio si no ve facturación). Nadie puede modificar ni borrar el historial.
create policy ver on cambios for select to authenticated using (
  mi_rol() = 'recepcion'
  or (mi_rol() = 'trabajador'
      and (puedo_facturar() or not (campos ? 'precio'))
      and (exists (select 1 from clientes c where c.id = cambios.cliente_id)
           or exists (select 1 from citas ci where ci.id = cambios.registro_id))));

-- ---------- Anotaciones: las puede actualizar quien atiende al cliente ----------
-- (antes, con el cliente ya dado de alta, solo recepción). El historial guarda quién lo cambió.
create or replace function guardar_anotaciones(p_cliente uuid, p_salud text, p_zonas text[])
returns void language plpgsql security definer set search_path = public as $$
declare c record;
begin
  select * into c from clientes where id = p_cliente;
  if not found then raise exception 'Cliente no encontrado'; end if;
  if not (mi_rol() = 'recepcion' or c.creado_por = auth.uid()
          or exists (select 1 from citas where cliente_id = p_cliente and trabajador_id = mi_trabajador())) then
    raise exception 'No atiendes a este cliente';
  end if;
  if not c.consentimiento_salud then raise exception 'Falta el consentimiento firmado'; end if;
  update clientes set salud = nullif(trim(p_salud), ''), zonas_dolor = coalesce(p_zonas, '{}') where id = p_cliente;
end $$;
revoke execute on function guardar_anotaciones(uuid, text, text[]) from public, anon;
grant execute on function guardar_anotaciones(uuid, text, text[]) to authenticated;

-- Si retira el consentimiento, se borran también las anotaciones antiguas del historial
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
  if not new.acepta_salud then
    update cambios set campos = campos - 'salud' - 'zonas_dolor'
    where cliente_id = new.cliente_id and (campos ? 'salud' or campos ? 'zonas_dolor');
    delete from cambios where cliente_id = new.cliente_id and accion = 'cambiar' and campos = '{}';
  end if;
  return new;
end $$;

-- Al unir dos clientes, el historial pasa a la ficha que se queda
create or replace function fusionar_clientes(p_origen uuid, p_destino uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if mi_rol() <> 'recepcion' then raise exception 'Solo recepción puede unir clientes'; end if;
  if p_origen = p_destino then return; end if;
  update citas set cliente_id = p_destino where cliente_id = p_origen;
  update cambios set cliente_id = p_destino where cliente_id = p_origen;
  update clientes d set
    telefono = coalesce(d.telefono, o.telefono),
    email = coalesce(d.email, o.email),
    notas = nullif(concat_ws(' · ', nullif(d.notas, ''), nullif(o.notas, '')), '')
  from clientes o where d.id = p_destino and o.id = p_origen;
  delete from clientes where id = p_origen;
end $$;

-- ---------- Estadísticas (solo dirección) ----------
-- Devuelve en un solo paquete todo lo que necesitan las gráficas del periodo.
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
           coalesce(co.importe, 0) as imp
    from citas ci left join cobros co on co.cita_id = ci.id
    where ci.inicio >= (d0::timestamp at time zone tz) and ci.inicio < ((d1 + 1)::timestamp at time zone tz)
  ),
  dias as (
    select li::date as d, trabajador_id as t,
           count(*) filter (where estado = 'realizada') as n,
           sum(imp) filter (where estado = 'realizada') as imp,
           count(*) filter (where estado = 'no vino') as nv,
           count(*) filter (where estado = 'cancelada') as ca,
           count(*) filter (where estado = 'confirmada') as pe,
           sum(extract(epoch from lf - li) / 60) filter (where estado <> 'cancelada') as mo
    from c group by 1, 2
  ),
  horas as (   -- facturación por día de la semana y hora de inicio
    select extract(isodow from li)::int as w, extract(hour from li)::int as h,
           count(*) as n, sum(imp) as imp
    from c where estado = 'realizada' group by 1, 2
  ),
  ocupado as (  -- minutos reservados que caen en cada franja horaria
    select extract(isodow from g)::int as w, extract(hour from g)::int as h,
           sum(extract(epoch from least(lf, g + interval '1 hour') - greatest(li, g)) / 60) as mo
    from c cross join lateral generate_series(date_trunc('hour', li), lf - interval '1 second', interval '1 hour') g
    where estado <> 'cancelada' group by 1, 2
  ),
  capacidad as (  -- minutos disponibles: horario de cada día × trabajadores activos
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
    'dias', coalesce((select jsonb_agg(jsonb_build_object('d', d, 't', t, 'n', n, 'imp', coalesce(imp, 0), 'nv', nv, 'ca', ca, 'pe', pe, 'mo', round(coalesce(mo, 0)))) from dias), '[]'),
    'horas', coalesce((select jsonb_agg(jsonb_build_object('w', w, 'h', h, 'n', n, 'imp', imp)) from horas), '[]'),
    'ocupado', coalesce((select jsonb_agg(jsonb_build_object('w', w, 'h', h, 'mo', round(mo))) from ocupado), '[]'),
    'capacidad', coalesce((select jsonb_agg(jsonb_build_object('w', w, 'h', h, 'md', round(md))) from capacidad), '[]'),
    'servicios', coalesce((select jsonb_agg(jsonb_build_object('s', s, 'n', n, 'imp', imp)) from serv), '[]'),
    'primer_dia', (select min((inicio at time zone tz)::date) from citas)
  ) into r;
  return r;
end $$;
revoke execute on function estadisticas(date, date) from public, anon;
grant execute on function estadisticas(date, date) to authenticated;

-- ---------- Datos de ejemplo: dos años de actividad para ver las gráficas ----------
-- Solo se genera una vez y solo si la base es la de demostración (hay pocas citas antiguas).
do $$
declare
  tz text; hoy date; f date; h record; t record; sv record; cl uuid; est text;
  cur time; ini timestamptz; p float; r float; anios float; imp numeric;
  fh float[] := array[0,0,0,0,0,0,0,0,0, .55,.8,.9,.85,.6,.3,.35,.75,.95,1,.9,.55,0,0,0];  -- por hora (0-23)
  fw float[] := array[.85,.95,.9,1,1.05,.8,.5];                                           -- lunes..domingo
  fm float[] := array[.8,.85,.95,1,1.05,1.1,1,.72,.95,1,.9,1.08];                         -- enero..diciembre
  festivos text[] := array['01-01','01-06','05-01','08-15','10-12','11-01','12-06','12-08','12-25'];
  clientes_ids uuid[]; nueva uuid;
begin
  select coalesce(zona_horaria, 'Europe/Madrid') into tz from ajustes where id = 1;
  tz := coalesce(tz, 'Europe/Madrid');
  hoy := (now() at time zone tz)::date;
  if exists (select 1 from citas where inicio < ((hoy - 60)::timestamp at time zone tz)) then return; end if;
  if (select count(*) from trabajadores) > 6 then return; end if;   -- no es la demo

  select array_agg(id) into clientes_ids from clientes where validado;
  if clientes_ids is null then return; end if;

  -- Sin avisos, sin comprobaciones y sin historial mientras se cargan los datos antiguos
  alter table citas disable trigger user;
  perform setseed(0.7);
  for f in select generate_series(hoy - 730, hoy - 31, interval '1 day')::date loop
    continue when to_char(f, 'MM-DD') = any(festivos);
    select * into h from horario_del_dia(f) limit 1;
    continue when not found or not h.abierto;
    anios := 0.62 + 0.28 * (730 - (hoy - f)) / 700.0;           -- el negocio crece con el tiempo
    for t in select tr.id, (select tc.cabina_id from trabajador_cabinas tc
                            where tc.trabajador_id = tr.id order by tc.principal desc limit 1) as cabina
             from trabajadores tr where tr.activo loop
      cur := h.apertura;
      while cur < h.cierre loop
        select s.id, s.duracion_min, coalesce(pr.precio, 0) as precio into sv
        from servicios s
        join trabajador_actividades ta on ta.actividad_id = s.actividad_id and ta.trabajador_id = t.id
        join precios pr on pr.servicio_id = s.id
        where s.activo and not s.precio_libre and s.duracion_min <= 90
        order by random() limit 1;
        exit when sv.id is null;
        exit when cur + make_interval(mins => sv.duracion_min) > h.cierre;
        p := anios * fh[extract(hour from cur)::int + 1] * fw[extract(isodow from f)::int] * fm[extract(month from f)::int];
        if random() < p then
          r := random();
          est := case when r < 0.88 then 'realizada' when r < 0.93 then 'no vino' else 'cancelada' end;
          cl := clientes_ids[1 + floor(random() * array_length(clientes_ids, 1))::int];
          ini := (f + cur) at time zone tz;
          insert into citas (inicio, fin, trabajador_id, cabina_id, cliente_id, servicio_id, estado, solape_confirmado, llego_tarde, creado_en)
          values (ini, ini + make_interval(mins => sv.duracion_min), t.id, t.cabina, cl, sv.id, est, true,
                  est = 'realizada' and random() < 0.06, ini - interval '3 day')
          returning id into nueva;
          if est = 'realizada' then
            insert into cobros (cita_id, trabajador_id, importe, metodo, cobrado_en)
            values (nueva, t.id, sv.precio,
                    (array['tarjeta','tarjeta','efectivo','bizum'])[1 + floor(random() * 4)::int], ini + make_interval(mins => sv.duracion_min))
            on conflict (cita_id) do nothing;
          end if;
          cur := cur + make_interval(mins => (ceil(sv.duracion_min / 15.0) * 15)::int);
        else
          cur := cur + interval '30 minutes';
        end if;
      end loop;
    end loop;
  end loop;
  alter table citas enable trigger user;
end $$;

select (select count(*) from citas) as citas,
       (select count(*) from perfiles where propietario) as cuentas_direccion,
       'listo' as estado;
