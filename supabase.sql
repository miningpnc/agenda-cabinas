-- =====================================================================
-- AGENDA CABINAS · Base de datos para Supabase
-- Pegar ENTERO en SQL Editor → New query → Run.
-- Se puede volver a ejecutar: borra y crea todo de nuevo (datos incluidos).
-- No guarda información clínica: solo citas, clientes y facturación.
-- =====================================================================

-- ---------- Limpieza (también de versiones anteriores) ----------
drop trigger if exists al_crear_usuario on auth.users;
drop table if exists consentimientos, bloqueos, dias_especiales, horario_semanal, avisos, suscripciones_push, perfiles, cobros, citas, precios,
  servicios, trabajador_cabinas, trabajador_actividades, trabajador_salas,
  cabinas, salas, actividades, trabajadores, profesionales, clientes, ajustes cascade;
drop function if exists mi_rol(), mi_trabajador(), mi_profesional(), puedo_ver_precios(),
  puedo_facturar(), vincular_usuario(), vincular_trabajador(), comprobar_cabina(),
  gestionar_cobro(), avisar_cita(), marcar_recibido(uuid), marcar_todo_recibido(),
  historial_clientes(), citas_con_choque(timestamptz, timestamptz),
  horario_del_dia(date), comprobar_horario(), comprobar_bloqueo(), comprobar_servicio(),
  marcar_cliente_pendiente(), fusionar_clientes(uuid, uuid),
  guardar_suscripcion(jsonb, text), borrar_suscripcion(text), aplicar_consentimiento() cascade;

create extension if not exists btree_gist;

-- ---------- Ajustes del centro (una sola fila) ----------
create table ajustes (
  id int primary key default 1 check (id = 1),
  nombre_centro text not null default 'Mi centro',
  telefono text,
  direccion text,
  hora_apertura time not null default '09:00',
  hora_cierre time not null default '21:00',
  zona_horaria text not null default 'Europe/Madrid');

-- ---------- Equipo, actividades y cabinas ----------
create table actividades (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  color text not null default '#2a4580',
  orden int default 0,
  activa boolean default true);

create table trabajadores (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  email text unique,                    -- con este email entra en la app
  telefono text,
  ver_facturacion boolean default false, -- p. ej. autónomos que llevan su cuenta
  activo boolean default true,
  creado_en timestamptz default now());

-- Una persona puede dedicarse a varias actividades
create table trabajador_actividades (
  trabajador_id uuid references trabajadores on delete cascade,
  actividad_id uuid references actividades on delete cascade,
  primary key (trabajador_id, actividad_id));

create table cabinas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  orden int default 0,
  activa boolean default true);

-- Cabinas habituales de cada trabajador (una principal)
create table trabajador_cabinas (
  trabajador_id uuid references trabajadores on delete cascade,
  cabina_id uuid references cabinas on delete cascade,
  principal boolean default false,
  primary key (trabajador_id, cabina_id));

-- ---------- Servicios y precios ----------
create table servicios (
  id uuid primary key default gen_random_uuid(),
  actividad_id uuid not null references actividades on delete cascade,
  nombre text not null,
  duracion_min int not null check (duracion_min > 0),
  activo boolean default true);

-- Precios aparte: solo recepción y trabajadores con "ver facturación"
create table precios (
  servicio_id uuid primary key references servicios on delete cascade,
  precio numeric(8,2) not null);

-- ---------- Clientes (sin datos clínicos) ----------
create table clientes (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  telefono text,
  email text,
  idioma text default 'es',
  notas text,                           -- preferencias, nunca datos médicos
  creado_por uuid default auth.uid(),
  creado_en timestamptz default now());

-- ---------- Citas ----------
create table citas (
  id uuid primary key default gen_random_uuid(),
  inicio timestamptz not null,
  fin timestamptz not null,
  trabajador_id uuid not null references trabajadores on delete restrict,
  cabina_id uuid references cabinas on delete set null,
  cliente_id uuid references clientes on delete cascade,
  servicio_id uuid references servicios on delete set null,
  estado text not null default 'confirmada'
    check (estado in ('confirmada','realizada','no vino','cancelada')),
  notas text,
  solape_confirmado boolean default false, -- "sí, dos tratamientos a la vez en la cabina"
  creado_por uuid default auth.uid(),
  creado_en timestamptz default now(),
  check (fin > inicio),
  -- Una persona no puede estar en dos citas a la vez
  constraint trabajador_ocupado exclude using gist
    (trabajador_id with =, tstzrange(inicio, fin) with &&)
    where (estado not in ('no vino','cancelada')));
create index on citas (inicio);
create index on citas (cliente_id);

-- ---------- Dinero ----------
create table cobros (
  cita_id uuid primary key references citas on delete cascade,
  trabajador_id uuid references trabajadores on delete set null,
  importe numeric(8,2) not null default 0,
  metodo text check (metodo in ('efectivo','tarjeta','bizum','otro')),
  cobrado_en timestamptz default now());

-- ---------- Usuarios y avisos ----------
create table perfiles (
  user_id uuid primary key references auth.users on delete cascade,
  rol text not null check (rol in ('recepcion','trabajador')),
  trabajador_id uuid references trabajadores on delete set null,
  email text);

-- Cola de avisos: la app los muestra al momento; el envío por push,
-- correo o WhatsApp leerá de aquí (fase 2).
create table avisos (
  id uuid primary key default gen_random_uuid(),
  cita_id uuid references citas on delete cascade,
  para_rol text not null check (para_rol in ('recepcion','trabajador')),
  para_trabajador_id uuid references trabajadores on delete cascade,
  tipo text not null check (tipo in ('nueva','cambio','cancelada')),
  mensaje text not null,
  creado_en timestamptz default now(),
  leido_en timestamptz,
  leido_por uuid,
  enviado_push_en timestamptz,
  enviado_email_en timestamptz);
create index on avisos (cita_id);

create table suscripciones_push (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade,
  datos jsonb not null,
  creado_en timestamptz default now());

-- ---------- Funciones de permisos ----------
create function mi_rol() returns text language sql stable
security definer set search_path = public as
$$ select rol from perfiles where user_id = auth.uid() $$;

create function mi_trabajador() returns uuid language sql stable
security definer set search_path = public as
$$ select trabajador_id from perfiles where user_id = auth.uid() $$;

create function puedo_facturar() returns boolean language sql stable
security definer set search_path = public as
$$ select coalesce(
     (select true from perfiles where user_id = auth.uid() and rol = 'recepcion'),
     (select t.ver_facturacion from perfiles p join trabajadores t on t.id = p.trabajador_id
       where p.user_id = auth.uid()),
     false) $$;

-- ---------- Alta de usuarios ----------
-- Solo cuenta cuando el usuario ha CONFIRMADO su correo:
-- 1) El PRIMER usuario confirmado queda como recepción.
-- 2) Después, quien confirme el email de un trabajador queda vinculado a él.
-- 3) Cualquier otro email no ve nada.
create function vincular_usuario() returns trigger language plpgsql
security definer set search_path = public as $$
begin
  if exists (select 1 from perfiles where user_id = new.id) then return new; end if;
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
create trigger al_crear_usuario after insert or update of email_confirmed_at on auth.users
  for each row when (new.email_confirmed_at is not null)
  execute function vincular_usuario();

-- Si recepción da de alta a un trabajador cuyo usuario ya existía
create function vincular_trabajador() returns trigger language plpgsql
security definer set search_path = public as $$
begin
  if new.email is not null then
    insert into perfiles (user_id, rol, trabajador_id, email)
    select u.id, 'trabajador', new.id, u.email from auth.users u
    where lower(u.email) = lower(new.email) and u.email_confirmed_at is not null
      and not exists (select 1 from perfiles p where p.user_id = u.id)
    on conflict (user_id) do nothing;
  end if;
  return new;
end $$;
create trigger al_guardar_trabajador after insert or update of email on trabajadores
  for each row execute function vincular_trabajador();

-- ---------- Cabina compartida: preguntar antes de guardar ----------
-- Si la cabina ya está ocupada a esa hora y no se ha confirmado el solape,
-- se rechaza con CABINA_OCUPADA|cabina|trabajador|horario. La app pregunta
-- "¿Es correcto?" y, si se acepta, vuelve a guardar con solape_confirmado.
create function comprobar_cabina() returns trigger language plpgsql
security definer set search_path = public as $$
declare c record; tz text;
begin
  if new.cabina_id is null or new.estado <> 'confirmada' or new.solape_confirmado then
    return new; end if;
  if tg_op = 'UPDATE' and new.inicio = old.inicio and new.fin = old.fin
     and new.cabina_id is not distinct from old.cabina_id and old.estado = 'confirmada' then
    return new; end if;
  select zona_horaria into tz from ajustes where id = 1;
  select ci.inicio, ci.fin, t.nombre as trabajador, cb.nombre as cabina into c
  from citas ci join trabajadores t on t.id = ci.trabajador_id join cabinas cb on cb.id = ci.cabina_id
  where ci.cabina_id = new.cabina_id and ci.id <> new.id
    and ci.estado not in ('no vino','cancelada')
    and tstzrange(ci.inicio, ci.fin) && tstzrange(new.inicio, new.fin)
  order by ci.inicio limit 1;
  if found then
    raise exception 'CABINA_OCUPADA|%|%|%', c.cabina, c.trabajador,
      to_char(c.inicio at time zone coalesce(tz,'Europe/Madrid'), 'HH24:MI') || '–' ||
      to_char(c.fin at time zone coalesce(tz,'Europe/Madrid'), 'HH24:MI');
  end if;
  return new;
end $$;
create trigger antes_guardar_cita before insert or update on citas
  for each row execute function comprobar_cabina();

-- ---------- Cobro automático al marcar "realizada" ----------
create function gestionar_cobro() returns trigger language plpgsql
security definer set search_path = public as $$
begin
  if new.estado = 'realizada' and (tg_op = 'INSERT' or old.estado <> 'realizada') then
    insert into cobros (cita_id, trabajador_id, importe)
    values (new.id, new.trabajador_id,
            coalesce((select precio from precios where servicio_id = new.servicio_id), 0))
    on conflict (cita_id) do nothing;
  elsif tg_op = 'UPDATE' and old.estado = 'realizada' and new.estado <> 'realizada' then
    delete from cobros where cita_id = new.id;
  elsif tg_op = 'UPDATE' and new.trabajador_id <> old.trabajador_id then
    update cobros set trabajador_id = new.trabajador_id where cita_id = new.id;
  end if;
  return new;
end $$;
create trigger despues_guardar_cita_cobro after insert or update on citas
  for each row execute function gestionar_cobro();

-- ---------- Avisos automáticos ----------
-- Si la cita la crea o cambia recepción → aviso al trabajador.
-- Si la crea o cambia un trabajador → aviso a recepción.
create function avisar_cita() returns trigger language plpgsql
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
create trigger despues_guardar_cita_aviso after insert or update on citas
  for each row execute function avisar_cita();

-- "Recibido": marca como leídos los avisos de esa cita que son para mí
create function marcar_recibido(p_cita uuid) returns void language sql
security definer set search_path = public as $$
  update avisos set leido_en = now(), leido_por = auth.uid()
  where cita_id = p_cita and leido_en is null
    and ((para_rol = 'recepcion' and mi_rol() = 'recepcion')
      or (para_rol = 'trabajador' and para_trabajador_id = mi_trabajador())) $$;

create function marcar_todo_recibido() returns void language sql
security definer set search_path = public as $$
  update avisos set leido_en = now(), leido_por = auth.uid()
  where leido_en is null
    and ((para_rol = 'recepcion' and mi_rol() = 'recepcion')
      or (para_rol = 'trabajador' and para_trabajador_id = mi_trabajador())) $$;

-- Historial de asistencia por cliente (solo recepción)
create function historial_clientes()
returns table (cliente_id uuid, visitas bigint, canceladas bigint, no_vino bigint, ultima timestamptz)
language sql stable security definer set search_path = public as $$
  select cliente_id,
         count(*) filter (where estado = 'realizada'),
         count(*) filter (where estado = 'cancelada'),
         count(*) filter (where estado = 'no vino'),
         max(inicio) filter (where estado = 'realizada')
  from citas
  where mi_rol() = 'recepcion' and cliente_id is not null
  group by cliente_id $$;

-- Citas que comparten cabina a la vez (para pintarlas en rojo)
create function citas_con_choque(p_desde timestamptz, p_hasta timestamptz)
returns setof uuid language sql stable security definer set search_path = public as $$
  select distinct a.id from citas a
  join citas b on b.cabina_id = a.cabina_id and b.id <> a.id
   and tstzrange(a.inicio, a.fin) && tstzrange(b.inicio, b.fin)
   and b.estado not in ('no vino','cancelada')
  where a.inicio < p_hasta and a.fin > p_desde
    and a.estado not in ('no vino','cancelada')
    and (mi_rol() = 'recepcion' or a.trabajador_id = mi_trabajador()) $$;

-- ---------- Seguridad (RLS) ----------
alter table ajustes enable row level security;
alter table actividades enable row level security;
alter table trabajadores enable row level security;
alter table trabajador_actividades enable row level security;
alter table cabinas enable row level security;
alter table trabajador_cabinas enable row level security;
alter table servicios enable row level security;
alter table precios enable row level security;
alter table clientes enable row level security;
alter table citas enable row level security;
alter table cobros enable row level security;
alter table perfiles enable row level security;
alter table avisos enable row level security;
alter table suscripciones_push enable row level security;

-- Configuración: todo el personal la lee; solo recepción la cambia
do $$ declare t text; begin
  foreach t in array array['ajustes','actividades','trabajadores','trabajador_actividades',
                           'cabinas','trabajador_cabinas','servicios'] loop
    execute format('create policy leer on %I for select to authenticated using (mi_rol() is not null)', t);
    execute format('create policy recepcion on %I for all to authenticated
                    using (mi_rol() = ''recepcion'') with check (mi_rol() = ''recepcion'')', t);
  end loop;
end $$;

-- Precios: recepción y trabajadores con "ver facturación"
create policy leer on precios for select to authenticated using (puedo_facturar());
create policy recepcion on precios for all to authenticated
  using (mi_rol() = 'recepcion') with check (mi_rol() = 'recepcion');

-- Clientes: el personal los ve y puede crearlos; recepción los edita y borra
create policy leer on clientes for select to authenticated using (mi_rol() is not null);
create policy crear on clientes for insert to authenticated with check (mi_rol() is not null);
create policy recepcion on clientes for all to authenticated
  using (mi_rol() = 'recepcion') with check (mi_rol() = 'recepcion');

-- Citas: recepción todas; cada trabajador ve, crea y cambia solo las suyas
create policy recepcion on citas for all to authenticated
  using (mi_rol() = 'recepcion') with check (mi_rol() = 'recepcion');
create policy trabajador_ve on citas for select to authenticated
  using (trabajador_id = mi_trabajador());
create policy trabajador_crea on citas for insert to authenticated
  with check (trabajador_id = mi_trabajador());
create policy trabajador_cambia on citas for update to authenticated
  using (trabajador_id = mi_trabajador()) with check (trabajador_id = mi_trabajador());

-- Cobros: recepción todos; el trabajador con permiso, solo los suyos
create policy recepcion on cobros for all to authenticated
  using (mi_rol() = 'recepcion') with check (mi_rol() = 'recepcion');
create policy trabajador_ve on cobros for select to authenticated
  using (puedo_facturar() and trabajador_id = mi_trabajador());
create policy trabajador_cambia on cobros for update to authenticated
  using (puedo_facturar() and trabajador_id = mi_trabajador())
  with check (puedo_facturar() and trabajador_id = mi_trabajador());

create policy ver_perfil on perfiles for select to authenticated
  using (user_id = auth.uid() or mi_rol() = 'recepcion');
create policy recepcion on perfiles for all to authenticated
  using (mi_rol() = 'recepcion') with check (mi_rol() = 'recepcion');

-- Avisos: recepción ve todos (para saber si el trabajador lo ha recibido)
create policy ver on avisos for select to authenticated
  using (mi_rol() = 'recepcion'
         or (para_rol = 'trabajador' and para_trabajador_id = mi_trabajador()));

create policy mis_push on suscripciones_push for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- Tiempo real ----------
do $$ declare t text; begin
  foreach t in array array['citas','avisos','clientes'] loop
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- =====================================================================
-- DATOS DE EJEMPLO (inventados). Cambia los emails de los trabajadores
-- si no usas miningpnc@gmail.com.
-- =====================================================================
insert into ajustes (nombre_centro, telefono, direccion)
values ('Centro de demostración', '+34 600 000 000', 'Calle Ejemplo, 1');

insert into actividades (nombre, color, orden) values
 ('Fisioterapia', '#2a5ba8', 1), ('Estética', '#b0457a', 2),
 ('Uñas', '#a8701e', 3), ('Masajes', '#2b8174', 4), ('Peluquería', '#6b4fb3', 5);

insert into cabinas (nombre, orden) values
 ('Sala fisio 1', 1), ('Sala fisio 2', 2), ('Cabina estética', 3),
 ('Cabina uñas', 4), ('Cabina masajes', 5);

insert into trabajadores (nombre, email, ver_facturacion) values
 ('María', 'miningpnc+maria@gmail.com', true),   -- esteticién autónoma (cuenta de prueba)
 ('Carlos', 'miningpnc+carlos@gmail.com', false), -- fisio
 ('Sonia', 'miningpnc+sonia@gmail.com', true);    -- uñas y masajes

insert into trabajador_actividades
select t.id, a.id from trabajadores t join actividades a on
  (t.nombre = 'María' and a.nombre in ('Estética','Masajes')) or
  (t.nombre = 'Carlos' and a.nombre in ('Fisioterapia','Masajes')) or
  (t.nombre = 'Sonia' and a.nombre in ('Uñas','Masajes'));

insert into trabajador_cabinas
select t.id, c.id, c.nombre in ('Cabina estética','Sala fisio 1','Cabina uñas')
from trabajadores t join cabinas c on
  (t.nombre = 'María' and c.nombre in ('Cabina estética','Cabina masajes')) or
  (t.nombre = 'Carlos' and c.nombre in ('Sala fisio 1','Sala fisio 2')) or
  (t.nombre = 'Sonia' and c.nombre in ('Cabina uñas','Cabina masajes'));

with v (actividad, nombre, dur, precio) as (values
  ('Fisioterapia','Sesión de fisioterapia',45,45),
  ('Fisioterapia','Masaje descontracturante',30,35),
  ('Estética','Limpieza facial',50,60),
  ('Estética','Tinte de pestañas y cejas',30,35),
  ('Estética','Lifting de pestañas',45,45),
  ('Estética','Depilación de cejas',20,20),
  ('Estética','Microblading',120,250),
  ('Uñas','Manicura clásica',30,25),
  ('Uñas','Manicura semipermanente',45,35),
  ('Uñas','Pedicura',45,40),
  ('Uñas','Pedicura semipermanente',60,50),
  ('Masajes','Masaje relajante 55 min',55,60),
  ('Masajes','Masaje espalda 30 min',30,40),
  ('Masajes','Reflexología',40,40),
  ('Peluquería','Corte y peinado',45,30)),
s as (insert into servicios (actividad_id, nombre, duracion_min)
      select a.id, v.nombre, v.dur from v join actividades a on a.nombre = v.actividad
      returning id, nombre)
insert into precios select s.id, v.precio from s join v on v.nombre = s.nombre;

insert into clientes (nombre, telefono, idioma, notas) values
 ('Ingrid Hansen', '+47 900 00 001', 'no', 'Prefiere presión suave.'),
 ('Lucía Pérez', '+34 600 000 002', 'es', ''),
 ('Sarah Mitchell', '+44 7700 000003', 'en', 'Mejor por las tardes.'),
 ('Pilar Martínez', '+34 600 000 004', 'es', ''),
 ('Erik Nilsen', '+47 900 00 005', 'no', '');

-- Citas de ejemplo para hoy, mañana y días anteriores
do $$
declare hoy date := (now() at time zone 'Europe/Madrid')::date;
begin
  insert into citas (inicio, fin, trabajador_id, cabina_id, cliente_id, servicio_id, estado, solape_confirmado)
  select ((hoy + d) + h) at time zone 'Europe/Madrid',
         ((hoy + d) + h + make_interval(mins => s.duracion_min)) at time zone 'Europe/Madrid',
         t.id, c.id, cl.id, s.id, e, sc
  from (values
    (-7, time '10:00', 'María',  'Cabina estética', 'Ingrid Hansen',  'Limpieza facial',          'realizada', false),
    (-7, time '12:00', 'Sonia',  'Cabina uñas',     'Pilar Martínez', 'Pedicura',                 'no vino',   false),
    (-3, time '17:00', 'Sonia',  'Cabina uñas',     'Pilar Martínez', 'Manicura semipermanente',  'no vino',   false),
    (-2, time '11:00', 'María',  'Cabina estética', 'Lucía Pérez',    'Lifting de pestañas',      'realizada', false),
    (-1, time '10:00', 'Carlos', 'Sala fisio 1',    'Erik Nilsen',    'Sesión de fisioterapia',   'realizada', false),
    (-1, time '16:00', 'María',  'Cabina estética', 'Sarah Mitchell', 'Tinte de pestañas y cejas','cancelada', false),
    ( 0, time '09:30', 'María',  'Cabina estética', 'Ingrid Hansen',  'Tinte de pestañas y cejas','realizada', false),
    ( 0, time '11:00', 'María',  'Cabina estética', 'Lucía Pérez',    'Microblading',             'confirmada',false),
    ( 0, time '10:00', 'Carlos', 'Sala fisio 1',    'Erik Nilsen',    'Sesión de fisioterapia',   'confirmada',false),
    ( 0, time '12:00', 'Carlos', 'Sala fisio 1',    'Sarah Mitchell', 'Masaje descontracturante', 'confirmada',false),
    ( 0, time '16:00', 'María',  'Cabina masajes',  'Pilar Martínez', 'Masaje relajante 55 min',  'confirmada',true),
    ( 0, time '16:30', 'Sonia',  'Cabina masajes',  'Sarah Mitchell', 'Reflexología',             'confirmada',true),
    ( 0, time '10:30', 'Sonia',  'Cabina uñas',     'Pilar Martínez', 'Manicura semipermanente',  'confirmada',false),
    ( 1, time '10:00', 'María',  'Cabina estética', 'Sarah Mitchell', 'Limpieza facial',          'confirmada',false),
    ( 1, time '17:00', 'Sonia',  'Cabina uñas',     'Ingrid Hansen',  'Pedicura semipermanente',  'confirmada',false)
  ) x(d, h, trab, cab, cli, serv, e, sc)
  join trabajadores t on t.nombre = x.trab
  join cabinas c on c.nombre = x.cab
  join clientes cl on cl.nombre = x.cli
  join servicios s on s.nombre = x.serv;
end $$;

-- =====================================================================
-- CUENTAS DE PRUEBA YA CREADAS EN Authentication → Users
-- Si cambias los emails, cámbialos aquí también.
-- =====================================================================
do $$
declare
  email_recepcion text := 'miningpnc+recepcion@gmail.com';
  email_trabajador text := 'miningpnc+maria@gmail.com';
begin
  -- Marca ambas cuentas como confirmadas (por si se crearon sin "Auto Confirm User")
  update auth.users set email_confirmed_at = coalesce(email_confirmed_at, now())
  where lower(email) in (lower(email_recepcion), lower(email_trabajador));

  -- Recepción
  insert into perfiles (user_id, rol, email)
  select id, 'recepcion', email from auth.users where lower(email) = lower(email_recepcion)
  on conflict (user_id) do update set rol = 'recepcion', trabajador_id = null;

  -- Cualquier usuario confirmado cuyo email sea el de un trabajador
  insert into perfiles (user_id, rol, trabajador_id, email)
  select u.id, 'trabajador', t.id, u.email
  from auth.users u join trabajadores t on lower(t.email) = lower(u.email)
  where u.email_confirmed_at is not null
  on conflict (user_id) do nothing;
end $$;

select p.rol, p.email, t.nombre as trabajador
from perfiles p left join trabajadores t on t.id = p.trabajador_id order by p.rol;
-- Debe salir: recepcion → miningpnc+recepcion@gmail.com
--             trabajador → miningpnc+maria@gmail.com → María

-- =====================================================================
-- HORARIO, FESTIVOS Y MÁS DATOS DE EJEMPLO
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

-- =====================================================================
-- SERVICIOS POR TRABAJADOR Y SERVICIO «OTRO»
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

-- =====================================================================
-- CLIENTES POR TRABAJADOR, ALTAS PENDIENTES Y RETRASOS
-- =====================================================================
-- ---------- Columnas nuevas ----------
-- validado = false: lo creó un trabajador y recepción aún no lo ha dado de alta
alter table clientes add column if not exists validado boolean not null default true;
alter table citas add column if not exists llego_tarde boolean not null default false;

-- Un cliente creado por un trabajador queda pendiente de alta
create or replace function marcar_cliente_pendiente() returns trigger language plpgsql
security definer set search_path = public as $$
begin
  if mi_rol() = 'trabajador' then
    new.validado := false;
    new.creado_por := auth.uid();
  end if;
  return new;
end $$;
drop trigger if exists antes_crear_cliente on clientes;
create trigger antes_crear_cliente before insert on clientes
  for each row execute function marcar_cliente_pendiente();

-- ---------- Quién ve qué clientes ----------
-- Recepción: todos. Trabajador: los que ha creado él y los de sus propias citas.
drop policy if exists leer on clientes;
drop policy if exists crear on clientes;
drop policy if exists recepcion on clientes;
drop policy if exists trabajador_edita on clientes;
create policy leer on clientes for select to authenticated using (
  mi_rol() = 'recepcion'
  or creado_por = auth.uid()
  or exists (select 1 from citas c where c.cliente_id = clientes.id and c.trabajador_id = mi_trabajador()));
create policy crear on clientes for insert to authenticated with check (mi_rol() is not null);
create policy recepcion on clientes for all to authenticated
  using (mi_rol() = 'recepcion') with check (mi_rol() = 'recepcion');
-- El trabajador puede corregir los datos de sus clientes mientras estén pendientes de alta
create policy trabajador_edita on clientes for update to authenticated
  using (mi_rol() = 'trabajador' and creado_por = auth.uid() and not validado)
  with check (mi_rol() = 'trabajador' and creado_por = auth.uid() and not validado);

-- ---------- Unir un cliente pendiente con uno que ya existía ----------
create or replace function fusionar_clientes(p_origen uuid, p_destino uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if mi_rol() <> 'recepcion' then raise exception 'Solo recepción puede unir clientes'; end if;
  if p_origen = p_destino then return; end if;
  update citas set cliente_id = p_destino where cliente_id = p_origen;
  update clientes d set
    telefono = coalesce(d.telefono, o.telefono),
    email = coalesce(d.email, o.email),
    notas = nullif(concat_ws(' · ', nullif(d.notas, ''), nullif(o.notas, '')), '')
  from clientes o where d.id = p_destino and o.id = p_origen;
  delete from clientes where id = p_origen;
end $$;
revoke execute on function fusionar_clientes(uuid, uuid) from public, anon;
grant execute on function fusionar_clientes(uuid, uuid) to authenticated;

-- ---------- Historial con retrasos ----------
drop function if exists historial_clientes();
create function historial_clientes()
returns table (cliente_id uuid, visitas bigint, canceladas bigint, no_vino bigint, tarde bigint, ultima timestamptz)
language sql stable security definer set search_path = public as $$
  select cliente_id,
         count(*) filter (where estado = 'realizada'),
         count(*) filter (where estado = 'cancelada'),
         count(*) filter (where estado = 'no vino'),
         count(*) filter (where llego_tarde),
         max(inicio) filter (where estado = 'realizada')
  from citas
  where mi_rol() = 'recepcion' and cliente_id is not null
  group by cliente_id $$;

-- ---------- Ejemplos ----------
-- Algunos clientes que llegaron tarde
update citas set llego_tarde = true
where estado = 'realizada' and not llego_tarde
  and id in (select id from citas where estado = 'realizada' order by md5(id::text) limit 18)
  and not exists (select 1 from citas where llego_tarde);

-- Una clienta que María se apuntó ella misma y aún no ha pasado por recepción
do $$
declare uid uuid; tid uuid; cid uuid; srv uuid; d date; tz text; h record;
begin
  if exists (select 1 from clientes where nombre = 'Noelia Vidal') then return; end if;
  select p.user_id, p.trabajador_id into uid, tid from perfiles p join trabajadores t on t.id = p.trabajador_id where t.nombre = 'María' limit 1;
  if tid is null then select id into tid from trabajadores where nombre = 'María'; end if;
  if tid is null then return; end if;
  insert into clientes (nombre, telefono, idioma, notas, validado, creado_por)
  values ('Noelia Vidal', '+34 622 300 400', 'es', 'Clienta habitual de María.', false, uid) returning id into cid;
  select coalesce(zona_horaria, 'Europe/Madrid') into tz from ajustes where id = 1; tz := coalesce(tz, 'Europe/Madrid');
  d := (now() at time zone tz)::date + 2;
  loop select * into h from horario_del_dia(d) limit 1; exit when h.abierto; d := d + 1; end loop;
  select s.id into srv from servicios s join actividades a on a.id = s.actividad_id
  where a.nombre = 'Uñas' and s.nombre = 'Manicura Shellac' and s.activo limit 1;
  begin
    insert into citas (inicio, fin, trabajador_id, cliente_id, servicio_id,
                       cabina_id, estado)
    values ((d + time '13:00') at time zone tz, (d + time '13:45') at time zone tz, tid, cid, srv,
            (select cabina_id from trabajador_cabinas where trabajador_id = tid order by principal desc limit 1), 'confirmada');
  exception when others then null;
  end;
end $$;

select (select count(*) from clientes where validado) as clientes_dados_de_alta,
       (select count(*) from clientes where not validado) as pendientes_de_alta,
       (select count(*) from citas where llego_tarde) as citas_con_retraso;

-- =====================================================================
-- FECHA DE NACIMIENTO DE LOS TRABAJADORES
-- =====================================================================
alter table trabajadores add column if not exists fecha_nacimiento date;

select nombre, fecha_nacimiento from trabajadores order by nombre;

-- =====================================================================
-- AVISOS PUSH
-- =====================================================================
alter table suscripciones_push add column if not exists endpoint text;
alter table suscripciones_push add column if not exists dispositivo text;
create unique index if not exists suscripciones_push_endpoint on suscripciones_push (endpoint);

-- Guarda el permiso de avisos de este dispositivo para el usuario que ha entrado.
-- Si el móvil lo usaba otra persona antes, el permiso pasa al usuario actual.
create or replace function guardar_suscripcion(p_datos jsonb, p_dispositivo text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sin sesión'; end if;
  delete from suscripciones_push where endpoint = p_datos->>'endpoint';
  insert into suscripciones_push (user_id, datos, endpoint, dispositivo)
  values (auth.uid(), p_datos, p_datos->>'endpoint', p_dispositivo);
end $$;

-- Al cerrar sesión, este dispositivo deja de recibir avisos de ese usuario
create or replace function borrar_suscripcion(p_endpoint text) returns void
language sql security definer set search_path = public as $$
  delete from suscripciones_push where endpoint = p_endpoint and user_id = auth.uid() $$;

revoke execute on function guardar_suscripcion(jsonb, text) from public, anon;
revoke execute on function borrar_suscripcion(text) from public, anon;
grant execute on function guardar_suscripcion(jsonb, text) to authenticated;
grant execute on function borrar_suscripcion(text) to authenticated;

select 'listo' as estado;

-- =====================================================================
-- FICHA DE CLIENTE COMPLETA
-- =====================================================================
-- «nombre» sigue guardando el nombre completo (lo que se ve en la agenda);
-- además se guardan por separado nombre de pila y apellidos.
alter table clientes add column if not exists nombre_pila text;
alter table clientes add column if not exists apellidos text;
alter table clientes add column if not exists fecha_nacimiento date;
alter table clientes add column if not exists sexo text;
alter table clientes add column if not exists pais_telefono text default 'ES';  -- código ISO del país del teléfono
alter table clientes add column if not exists direccion text;
-- Datos de salud: solo con consentimiento expreso del cliente
alter table clientes add column if not exists salud text;
alter table clientes add column if not exists consentimiento_salud boolean not null default false;
alter table clientes add column if not exists consentimiento_salud_en timestamptz;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'clientes_sexo_valido') then
    alter table clientes add constraint clientes_sexo_valido check (sexo is null or sexo in ('mujer','hombre','otro','nd'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'clientes_salud_con_consentimiento') then
    alter table clientes add constraint clientes_salud_con_consentimiento
      check (salud is null or salud = '' or consentimiento_salud);
  end if;
end $$;

-- Separar nombre y apellidos de los clientes que ya existían
update clientes
set nombre_pila = split_part(nombre, ' ', 1),
    apellidos = nullif(trim(substr(nombre, length(split_part(nombre, ' ', 1)) + 1)), '')
where nombre_pila is null;

-- Prefijo de país deducido de los teléfonos existentes
update clientes set pais_telefono = case
  when telefono like '+47%' then 'NO' when telefono like '+44%' then 'GB' when telefono like '+49%' then 'DE'
  when telefono like '+33%' then 'FR' when telefono like '+31%' then 'NL' when telefono like '+32%' then 'BE'
  when telefono like '+46%' then 'SE' when telefono like '+45%' then 'DK' when telefono like '+358%' then 'FI'
  else 'ES' end
where telefono is not null and (pais_telefono is null or pais_telefono = 'ES');
-- Teléfonos sin espacios (formato internacional)
update clientes set telefono = regexp_replace(telefono, '[^0-9+]', '', 'g') where telefono ~ '[^0-9+]';

-- Ejemplos: fechas de nacimiento y sexo inventados para los clientes de ejemplo
update clientes set
  fecha_nacimiento = date '1955-01-01' + ((abs(hashtext(id::text)) % 18000) || ' days')::interval,
  sexo = case when nombre_pila in ('Ingrid','Astrid','Kari','Carmen','Isabel','Pilar','Sarah','Claire','Emma','Charlotte','Rosa','Elena','Paula','Laura','Marta','Sofía','Petra','Noelia','Lucía') then 'mujer'
              else 'hombre' end
where fecha_nacimiento is null and creado_en < now();

-- Dos clientes con el mismo nombre, para ver el aviso de nombres repetidos
insert into clientes (nombre, nombre_pila, apellidos, telefono, pais_telefono, idioma, fecha_nacimiento, sexo, direccion, validado)
select v.* from (values
  ('José Martínez', 'José', 'Martínez', '+34611200201', 'ES', 'es', date '1968-04-12', 'hombre', 'Calle Mayor 10, Alfàs del Pi', true),
  ('José Martínez', 'José', 'Martínez', '+34655300402', 'ES', 'es', date '1991-09-30', 'hombre', 'Av. del Albir 25, Albir', true)
) v(nombre, nombre_pila, apellidos, telefono, pais_telefono, idioma, fecha_nacimiento, sexo, direccion, validado)
where (select count(*) from clientes where nombre = 'José Martínez') = 0;

select count(*) as clientes,
       count(*) filter (where fecha_nacimiento is not null) as con_fecha_nacimiento,
       count(*) filter (where pais_telefono <> 'ES') as telefonos_extranjeros
from clientes;

-- =====================================================================
-- CONSENTIMIENTO DE PROTECCIÓN DE DATOS
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

-- =====================================================================
-- DOCUMENTO DE IDENTIDAD Y NACIONALIDAD
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
