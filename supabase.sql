-- =====================================================================
-- AGENDA CABINAS · Base de datos para Supabase
-- Pegar ENTERO en SQL Editor → New query → Run.
-- Se puede volver a ejecutar: borra y crea todo de nuevo (datos incluidos).
-- No guarda información clínica: solo citas, clientes y facturación.
-- =====================================================================

-- ---------- Limpieza (también de versiones anteriores) ----------
drop trigger if exists al_crear_usuario on auth.users;
drop table if exists avisos, suscripciones_push, perfiles, cobros, citas, precios,
  servicios, trabajador_cabinas, trabajador_actividades, trabajador_salas,
  cabinas, salas, actividades, trabajadores, profesionales, clientes, ajustes cascade;
drop function if exists mi_rol(), mi_trabajador(), mi_profesional(), puedo_ver_precios(),
  puedo_facturar(), vincular_usuario(), vincular_trabajador(), comprobar_cabina(),
  gestionar_cobro(), avisar_cita(), marcar_recibido(uuid), marcar_todo_recibido(),
  historial_clientes(), citas_con_choque(timestamptz, timestamptz) cascade;

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
-- 1) El PRIMER usuario que se registra queda como recepción.
-- 2) Después, quien se registre con el email de un trabajador queda vinculado a él.
-- 3) Cualquier otro email no ve nada.
create function vincular_usuario() returns trigger language plpgsql
security definer set search_path = public as $$
begin
  if not exists (select 1 from perfiles where rol = 'recepcion') then
    insert into perfiles (user_id, rol, email) values (new.id, 'recepcion', new.email);
    return new;
  end if;
  insert into perfiles (user_id, rol, trabajador_id, email)
  select new.id, 'trabajador', t.id, new.email from trabajadores t
  where t.email is not null and lower(t.email) = lower(new.email)
  on conflict (user_id) do nothing;
  return new;
end $$;
create trigger al_crear_usuario after insert on auth.users
  for each row execute function vincular_usuario();

-- Si recepción da de alta a un trabajador cuyo usuario ya existía
create function vincular_trabajador() returns trigger language plpgsql
security definer set search_path = public as $$
begin
  if new.email is not null then
    insert into perfiles (user_id, rol, trabajador_id, email)
    select u.id, 'trabajador', new.id, u.email from auth.users u
    where lower(u.email) = lower(new.email)
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
 ('Laura', 'miningpnc+laura@gmail.com', true),   -- esteticién autónoma
 ('Carlos', 'miningpnc+carlos@gmail.com', false), -- fisio
 ('Sonia', 'miningpnc+sonia@gmail.com', true);    -- uñas y masajes

insert into trabajador_actividades
select t.id, a.id from trabajadores t join actividades a on
  (t.nombre = 'Laura' and a.nombre in ('Estética','Masajes')) or
  (t.nombre = 'Carlos' and a.nombre in ('Fisioterapia','Masajes')) or
  (t.nombre = 'Sonia' and a.nombre in ('Uñas','Masajes'));

insert into trabajador_cabinas
select t.id, c.id, c.nombre in ('Cabina estética','Sala fisio 1','Cabina uñas')
from trabajadores t join cabinas c on
  (t.nombre = 'Laura' and c.nombre in ('Cabina estética','Cabina masajes')) or
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
    (-7, time '10:00', 'Laura',  'Cabina estética', 'Ingrid Hansen',  'Limpieza facial',          'realizada', false),
    (-7, time '12:00', 'Sonia',  'Cabina uñas',     'Pilar Martínez', 'Pedicura',                 'no vino',   false),
    (-3, time '17:00', 'Sonia',  'Cabina uñas',     'Pilar Martínez', 'Manicura semipermanente',  'no vino',   false),
    (-2, time '11:00', 'Laura',  'Cabina estética', 'Lucía Pérez',    'Lifting de pestañas',      'realizada', false),
    (-1, time '10:00', 'Carlos', 'Sala fisio 1',    'Erik Nilsen',    'Sesión de fisioterapia',   'realizada', false),
    (-1, time '16:00', 'Laura',  'Cabina estética', 'Sarah Mitchell', 'Tinte de pestañas y cejas','cancelada', false),
    ( 0, time '09:30', 'Laura',  'Cabina estética', 'Ingrid Hansen',  'Tinte de pestañas y cejas','realizada', false),
    ( 0, time '11:00', 'Laura',  'Cabina estética', 'Lucía Pérez',    'Microblading',             'confirmada',false),
    ( 0, time '10:00', 'Carlos', 'Sala fisio 1',    'Erik Nilsen',    'Sesión de fisioterapia',   'confirmada',false),
    ( 0, time '12:00', 'Carlos', 'Sala fisio 1',    'Sarah Mitchell', 'Masaje descontracturante', 'confirmada',false),
    ( 0, time '16:00', 'Laura',  'Cabina masajes',  'Pilar Martínez', 'Masaje relajante 55 min',  'confirmada',true),
    ( 0, time '16:30', 'Sonia',  'Cabina masajes',  'Sarah Mitchell', 'Reflexología',             'confirmada',true),
    ( 0, time '10:30', 'Sonia',  'Cabina uñas',     'Pilar Martínez', 'Manicura semipermanente',  'confirmada',false),
    ( 1, time '10:00', 'Laura',  'Cabina estética', 'Sarah Mitchell', 'Limpieza facial',          'confirmada',false),
    ( 1, time '17:00', 'Sonia',  'Cabina uñas',     'Ingrid Hansen',  'Pedicura semipermanente',  'confirmada',false)
  ) x(d, h, trab, cab, cli, serv, e, sc)
  join trabajadores t on t.nombre = x.trab
  join cabinas c on c.nombre = x.cab
  join clientes cl on cl.nombre = x.cli
  join servicios s on s.nombre = x.serv;
end $$;

-- =====================================================================
-- LISTO. Ahora abre la app y regístrate con tu email:
-- el PRIMER usuario que se registra queda como recepción.
-- =====================================================================
