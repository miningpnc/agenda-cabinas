-- =====================================================================
-- ACTUALIZACIÓN 3 · Clientes: cada trabajador ve solo los suyos,
--                   altas pendientes para recepción y retrasos
-- Pegar ENTERO en Supabase → SQL Editor → New query → Run
-- (si pregunta por RLS: «Run and enable RLS»).
-- No borra nada. Se puede ejecutar más de una vez.
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
