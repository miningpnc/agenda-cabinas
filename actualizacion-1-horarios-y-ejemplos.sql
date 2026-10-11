-- =====================================================================
-- ACTUALIZACIÓN 1 · Horario semanal, festivos y más datos de ejemplo
-- Pegar ENTERO en Supabase → SQL Editor → New query → Run.
-- No borra nada: añade lo nuevo. Se puede ejecutar más de una vez.
-- =====================================================================

-- ---------- Horario semanal (1 = lunes … 7 = domingo) ----------
create table if not exists horario_semanal (
  dia smallint primary key check (dia between 1 and 7),
  abierto boolean not null default true,
  apertura time not null default '09:00',
  cierre time not null default '21:00',
  check (cierre > apertura));

insert into horario_semanal (dia, abierto, apertura, cierre) values
  (1, true,  '09:00', '21:00'), (2, true, '09:00', '21:00'), (3, true, '09:00', '21:00'),
  (4, true,  '09:00', '21:00'), (5, true, '09:00', '21:00'),
  (6, true,  '09:00', '14:00'),   -- sábado: solo mañana
  (7, false, '09:00', '14:00')    -- domingo: cerrado
on conflict (dia) do nothing;

-- ---------- Días especiales: festivos o aperturas fuera de lo normal ----------
create table if not exists dias_especiales (
  fecha date primary key,
  abierto boolean not null,   -- false = cerrado (festivo); true = horario especial
  apertura time,
  cierre time,
  motivo text,
  check (not abierto or (apertura is not null and cierre is not null and cierre > apertura)));

-- Horario que se aplica a una fecha concreta
create or replace function horario_del_dia(p_fecha date)
returns table (abierto boolean, apertura time, cierre time, motivo text, especial boolean)
language sql stable security definer set search_path = public as $$
  select d.abierto, d.apertura, d.cierre, d.motivo, true from dias_especiales d where d.fecha = p_fecha
  union all
  select h.abierto, h.apertura, h.cierre, null, false from horario_semanal h
  where h.dia = extract(isodow from p_fecha)::int
    and not exists (select 1 from dias_especiales where fecha = p_fecha) $$;

-- No se puede reservar en un día cerrado ni fuera del horario de ese día
create or replace function comprobar_horario() returns trigger language plpgsql
security definer set search_path = public as $$
declare tz text; f date; h record;
begin
  if new.estado <> 'confirmada' then return new; end if;
  if tg_op = 'UPDATE' and new.inicio = old.inicio and new.fin = old.fin and old.estado = 'confirmada' then
    return new; end if;
  select zona_horaria into tz from ajustes where id = 1;
  tz := coalesce(tz, 'Europe/Madrid');
  f := (new.inicio at time zone tz)::date;
  select * into h from horario_del_dia(f) limit 1;
  if not found then return new; end if;
  if not h.abierto then
    raise exception 'FUERA_HORARIO|cerrado|%', coalesce(h.motivo, '');
  end if;
  if (new.fin at time zone tz)::date <> f
     or (new.inicio at time zone tz)::time < h.apertura
     or (new.fin at time zone tz)::time > h.cierre then
    raise exception 'FUERA_HORARIO|horario|%–%', to_char(h.apertura, 'HH24:MI'), to_char(h.cierre, 'HH24:MI');
  end if;
  return new;
end $$;

-- Se comprueba antes que la cabina (los triggers van por orden alfabético)
drop trigger if exists a_comprobar_horario on citas;
create trigger a_comprobar_horario before insert or update on citas
  for each row execute function comprobar_horario();

-- ---------- Permisos ----------
alter table horario_semanal enable row level security;
alter table dias_especiales enable row level security;
do $$ declare t text; begin
  foreach t in array array['horario_semanal','dias_especiales'] loop
    execute format('drop policy if exists leer on %I', t);
    execute format('drop policy if exists recepcion on %I', t);
    execute format('create policy leer on %I for select to authenticated using (mi_rol() is not null)', t);
    execute format('create policy recepcion on %I for all to authenticated
                    using (mi_rol() = ''recepcion'') with check (mi_rol() = ''recepcion'')', t);
  end loop;
end $$;

-- Tiempo real: si recepción cambia un horario, se ve al momento en todos los dispositivos
do $$ declare t text; begin
  foreach t in array array['horario_semanal','dias_especiales'] loop
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ---------- Bloqueos de trabajador (horas o días en que no se le pueden dar citas) ----------
create table if not exists bloqueos (
  id uuid primary key default gen_random_uuid(),
  trabajador_id uuid not null references trabajadores on delete cascade,
  inicio timestamptz not null,
  fin timestamptz not null,
  motivo text,
  creado_por uuid default auth.uid(),
  creado_en timestamptz default now(),
  check (fin > inicio));
create index if not exists bloqueos_trabajador_inicio on bloqueos (trabajador_id, inicio);

alter table bloqueos enable row level security;
drop policy if exists ver on bloqueos;
drop policy if exists gestionar on bloqueos;
-- Recepción ve y gestiona todos; cada trabajador, solo los suyos
create policy ver on bloqueos for select to authenticated
  using (mi_rol() = 'recepcion' or trabajador_id = mi_trabajador());
create policy gestionar on bloqueos for all to authenticated
  using (mi_rol() = 'recepcion' or trabajador_id = mi_trabajador())
  with check (mi_rol() = 'recepcion' or trabajador_id = mi_trabajador());

create or replace function comprobar_bloqueo() returns trigger language plpgsql
security definer set search_path = public as $$
declare b record; tz text;
begin
  if new.estado <> 'confirmada' then return new; end if;
  if tg_op = 'UPDATE' and new.inicio = old.inicio and new.fin = old.fin
     and new.trabajador_id = old.trabajador_id and old.estado = 'confirmada' then return new; end if;
  select bl.inicio, bl.fin, bl.motivo, t.nombre into b
  from bloqueos bl join trabajadores t on t.id = bl.trabajador_id
  where bl.trabajador_id = new.trabajador_id and tstzrange(bl.inicio, bl.fin) && tstzrange(new.inicio, new.fin)
  order by bl.inicio limit 1;
  if found then
    select zona_horaria into tz from ajustes where id = 1; tz := coalesce(tz, 'Europe/Madrid');
    raise exception 'TRABAJADOR_BLOQUEADO|%|%|%', b.nombre, coalesce(b.motivo, ''),
      to_char(b.inicio at time zone tz, 'DD/MM HH24:MI') || '–' || to_char(b.fin at time zone tz, 'DD/MM HH24:MI');
  end if;
  return new;
end $$;
drop trigger if exists a_comprobar_bloqueo on citas;
create trigger a_comprobar_bloqueo before insert or update on citas
  for each row execute function comprobar_bloqueo();

do $$ begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'bloqueos') then
    alter publication supabase_realtime add table public.bloqueos;
  end if;
end $$;

-- Ejemplos: María tiene asuntos propios mañana por la tarde y Carlos un día de formación
do $$
declare tz text; hoy date; d date;
begin
  if exists (select 1 from bloqueos) then return; end if;
  select coalesce(zona_horaria, 'Europe/Madrid') into tz from ajustes where id = 1; tz := coalesce(tz, 'Europe/Madrid');
  hoy := (now() at time zone tz)::date;
  d := hoy + 1; while not (select h.abierto from horario_del_dia(d) h limit 1) loop d := d + 1; end loop;
  insert into bloqueos (trabajador_id, inicio, fin, motivo)
  select id, (d + time '16:00') at time zone tz, (d + time '19:00') at time zone tz, 'Asuntos propios'
  from trabajadores where nombre = 'María';
  d := hoy + 4; while not (select h.abierto from horario_del_dia(d) h limit 1) loop d := d + 1; end loop;
  insert into bloqueos (trabajador_id, inicio, fin, motivo)
  select id, d::timestamp at time zone tz, (d + 1)::timestamp at time zone tz, 'Formación'
  from trabajadores where nombre = 'Carlos';
end $$;

-- ---------- Carta de tratamientos (masajes, estética y uñas) ----------
-- Duraciones marcadas como estimadas cuando la carta no las indica; se corrigen en Ajustes.
with v (actividad, nombre, dur, precio, estimada) as (values
  ('Masajes',  'Aromaterapia cuerpo completo',                 55, 60, false),
  ('Masajes',  'Aromaterapia espalda, hombros y cuello',       30, 40, false),
  ('Masajes',  'Reflexología',                                 40, 40, false),
  ('Masajes',  'Exfoliación corporal',                         40, 50, false),
  ('Estética', 'Tinte de pestañas y cejas + diseño',           30, 35, true),
  ('Estética', 'Depilación con cera y tinte de cejas',         20, 20, true),
  ('Estética', 'Tinte de pestañas',                            15, 20, true),
  ('Estética', 'Lifting de pestañas + tinte',                  45, 45, true),
  ('Estética', 'Limpieza facial con tratamiento antiarrugas',  50, 60, false),
  ('Uñas',     'Pedicura con esmalte',                         45, 40, true),
  ('Uñas',     'Pedicura francesa',                            50, 45, true),
  ('Uñas',     'Pedicura Shellac',                             60, 50, true),
  ('Uñas',     'Pedicura francesa Shellac',                    60, 35, true),
  ('Uñas',     'Manicura clásica',                             30, 25, true),
  ('Uñas',     'Manicura francesa',                            40, 30, true),
  ('Uñas',     'Manicura Shellac',                             45, 40, true),
  ('Uñas',     'Manicura francesa Shellac',                    50, 45, true)),
nuevos as (
  insert into servicios (actividad_id, nombre, duracion_min, activo)
  select a.id, v.nombre, v.dur, true from v join actividades a on a.nombre = v.actividad
  where not exists (select 1 from servicios s where s.actividad_id = a.id and s.nombre = v.nombre)
  returning id, nombre),
todos as (
  select s.id, v.precio, v.dur from v join actividades a on a.nombre = v.actividad
  join servicios s on s.actividad_id = a.id and s.nombre = v.nombre
  union all select n.id, v.precio, v.dur from nuevos n join v on v.nombre = n.nombre),
act_dur as (
  update servicios s set duracion_min = t.dur, activo = true from todos t where s.id = t.id returning s.id)
insert into precios (servicio_id, precio)
select id, precio from todos
on conflict (servicio_id) do update set precio = excluded.precio;

-- Los servicios genéricos de ejemplo de esas actividades se ocultan (sus citas se conservan)
update servicios s set activo = false
from actividades a
where s.actividad_id = a.id and a.nombre in ('Masajes','Estética','Uñas')
  and s.nombre not in ('Aromaterapia cuerpo completo','Aromaterapia espalda, hombros y cuello','Reflexología',
    'Exfoliación corporal','Tinte de pestañas y cejas + diseño','Depilación con cera y tinte de cejas','Tinte de pestañas',
    'Lifting de pestañas + tinte','Limpieza facial con tratamiento antiarrugas','Pedicura con esmalte','Pedicura francesa',
    'Pedicura Shellac','Pedicura francesa Shellac','Manicura clásica','Manicura francesa','Manicura Shellac','Manicura francesa Shellac');

-- =====================================================================
-- MÁS DATOS DE EJEMPLO (inventados)
-- =====================================================================
insert into clientes (nombre, telefono, idioma, notas)
select v.nombre, v.tel, v.idioma, v.notas
from (values
  ('Carmen Ruiz',        '+34 611 200 101', 'es', 'Prefiere primera hora.'),
  ('Antonio García',     '+34 611 200 102', 'es', ''),
  ('Laura Sánchez',      '+34 611 200 103', 'es', 'Piel sensible: hacer prueba antes de tintes.'),
  ('Isabel Moreno',      '+34 611 200 104', 'es', ''),
  ('Javier López',       '+34 611 200 105', 'es', 'Viene con su mujer, intentar citas seguidas.'),
  ('Marta Fernández',    '+34 611 200 106', 'es', ''),
  ('Rosa Jiménez',       '+34 611 200 107', 'es', 'Bono de masajes.'),
  ('Elena Navarro',      '+34 611 200 108', 'es', ''),
  ('Paula Romero',       '+34 611 200 109', 'es', 'Le gusta el esmalte nude.'),
  ('Sofía Torres',       '+34 611 200 110', 'es', ''),
  ('Astrid Larsen',      '+47 900 10 011',  'no', 'Residente de invierno.'),
  ('Ole Pedersen',       '+47 900 10 012',  'no', ''),
  ('Kari Johansen',      '+47 900 10 013',  'no', 'Prefiere presión fuerte.'),
  ('Bjørn Andersen',     '+47 900 10 014',  'no', ''),
  ('Emma Thompson',      '+44 7700 100015', 'en', ''),
  ('James Walker',       '+44 7700 100016', 'en', 'Mejor por las tardes.'),
  ('Charlotte Evans',    '+44 7700 100017', 'en', ''),
  ('Hans Müller',        '+49 151 1000018', 'de', ''),
  ('Petra Schmidt',      '+49 151 1000019', 'de', 'Habla algo de español.'),
  ('Claire Dubois',      '+33 6 10 00 00 20', 'fr', '')
) v(nombre, tel, idioma, notas)
where not exists (select 1 from clientes c where c.nombre = v.nombre);

-- Citas repartidas del último mes a las próximas dos semanas, dentro del horario
-- y sin solapes (cada trabajador en su cabina principal). Solo se generan una vez.
do $$
declare
  tz text; hoy date; d int; f date; h record; t record; hora time;
  sv record; cl uuid; est text; ini timestamptz; r float;
  horas time[] := array['09:30','11:00','12:30','16:00','17:30','19:00']::time[];
begin
  if (select count(*) from citas) >= 120 then return; end if;
  select coalesce(zona_horaria, 'Europe/Madrid') into tz from ajustes where id = 1;
  tz := coalesce(tz, 'Europe/Madrid');
  hoy := (now() at time zone tz)::date;
  perform setseed(0.42);
  for d in -30..14 loop
    f := hoy + d;
    select * into h from horario_del_dia(f) limit 1;
    continue when not found or not h.abierto;
    for t in select tr.id, (select tc.cabina_id from trabajador_cabinas tc
                            where tc.trabajador_id = tr.id order by tc.principal desc limit 1) as cabina
             from trabajadores tr where tr.activo loop
      foreach hora in array horas loop
        continue when random() > 0.5;
        select s.id, s.duracion_min into sv from servicios s
        join trabajador_actividades ta on ta.actividad_id = s.actividad_id and ta.trabajador_id = t.id
        where s.activo and s.duracion_min <= 60 order by random() limit 1;
        continue when sv.id is null;
        continue when hora < h.apertura or hora + make_interval(mins => sv.duracion_min) > h.cierre;
        select id into cl from clientes order by random() limit 1;
        r := random();
        if d < 0 then est := case when r < 0.80 then 'realizada' when r < 0.89 then 'no vino' else 'cancelada' end;
        elsif d = 0 then est := 'confirmada';
        else est := case when r < 0.92 then 'confirmada' else 'cancelada' end; end if;
        ini := (f + hora) at time zone tz;
        begin
          insert into citas (inicio, fin, trabajador_id, cabina_id, cliente_id, servicio_id, estado)
          values (ini, ini + make_interval(mins => sv.duracion_min), t.id, t.cabina, cl, sv.id, est);
        exception when others then null; -- si choca con una cita existente, se salta
        end;
      end loop;
    end loop;
  end loop;
end $$;

-- Si ya había citas de ejemplo en un día que ahora sale cerrado (p. ej. un domingo),
-- ese día se marca como apertura especial para que la demo sea coherente.
insert into dias_especiales (fecha, abierto, apertura, cierre, motivo)
select distinct (c.inicio at time zone coalesce((select zona_horaria from ajustes where id = 1), 'Europe/Madrid'))::date,
       true, time '09:00', time '21:00', 'Apertura especial'
from citas c
where c.estado <> 'cancelada'
  and not (select h.abierto from horario_del_dia((c.inicio at time zone coalesce((select zona_horaria from ajustes where id = 1), 'Europe/Madrid'))::date) h limit 1)
on conflict (fecha) do nothing;

-- Un festivo de ejemplo: el próximo 25 de diciembre
insert into dias_especiales (fecha, abierto, motivo)
values (make_date(extract(year from now())::int, 12, 25), false, 'Navidad')
on conflict (fecha) do nothing;

select (select count(*) from clientes) as clientes, (select count(*) from citas) as citas,
       (select count(*) from horario_semanal) as dias_horario;
