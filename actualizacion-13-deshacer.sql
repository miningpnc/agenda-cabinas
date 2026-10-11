-- =====================================================================
-- ACTUALIZACIÓN 13 · «Lo que he hecho»: lista de cambios con botón Deshacer
-- Pegar ENTERO en Supabase → SQL Editor → New query → Run.
-- Necesita la actualización 11. No borra nada. Se puede ejecutar más de una vez.
-- =====================================================================
alter table cambios add column if not exists deshecho_en timestamptz;
alter table cambios add column if not exists deshecho_por text;
create index if not exists cambios_usuario on cambios (usuario, en desc);
create index if not exists cambios_en on cambios (en desc);

-- El registro de cambios ahora también apunta los bloqueos de horas y guarda
-- la fila completa de lo que se borra (para poder recuperarlo).
create or replace function registrar_cambio() returns trigger language plpgsql
security definer set search_path = public as $$
declare a jsonb; b jsonb; dif jsonb := '{}'; k text; cli uuid; marca jsonb := '{}';
        ignorar text[] := array['creado_en','creado_por','solape_confirmado','ultimo_latido'];
begin
  -- Si el cambio lo provoca un «Deshacer», se marca para no confundirlo con un cambio normal
  if coalesce(current_setting('app.deshaciendo', true), '') <> '' then
    marca := jsonb_build_object('_deshacer', current_setting('app.deshaciendo', true)::bigint);
  end if;
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then return old; end if;   -- borrados en cascada
    a := to_jsonb(old);
    if tg_table_name = 'clientes' then
      delete from cambios where cliente_id = old.id;     -- su historial se va con él
      insert into cambios (tabla, registro_id, cliente_id, accion, campos, quien)
      values ('clientes', old.id, null, 'borrar', jsonb_build_object('nombre', jsonb_build_array(old.nombre, null)) || marca, nombre_usuario_actual());
    else
      insert into cambios (tabla, registro_id, cliente_id, accion, campos, quien)
      values (tg_table_name, old.id, (a->>'cliente_id')::uuid, 'borrar', jsonb_build_object('_fila', a) || marca, nombre_usuario_actual());
    end if;
    return old;
  end if;
  b := to_jsonb(new);
  cli := case when tg_table_name = 'clientes' then new.id else (b->>'cliente_id')::uuid end;
  if tg_op = 'INSERT' then
    insert into cambios (tabla, registro_id, cliente_id, accion, campos, quien)
    values (tg_table_name, new.id, cli, 'crear', marca, nombre_usuario_actual());
    return new;
  end if;
  a := to_jsonb(old);
  for k in select jsonb_object_keys(b) loop
    continue when k = any(ignorar);
    if (a->k) is distinct from (b->k) then dif := dif || jsonb_build_object(k, jsonb_build_array(a->k, b->k)); end if;
  end loop;
  if dif <> '{}' then
    insert into cambios (tabla, registro_id, cliente_id, accion, campos, quien)
    values (tg_table_name, new.id, cli, 'cambiar', dif || marca, nombre_usuario_actual());
  end if;
  return new;
end $$;
drop trigger if exists z_registrar_cambio on bloqueos;
create trigger z_registrar_cambio after insert or update or delete on bloqueos
  for each row execute function registrar_cambio();

-- Cada uno ve siempre sus propios cambios (además de lo que ya veía)
drop policy if exists ver on cambios;
create policy ver on cambios for select to authenticated using (
  mi_rol() = 'recepcion'
  or usuario = auth.uid()
  or (mi_rol() = 'trabajador'
      and (puedo_facturar() or not (campos ? 'precio'))
      and (exists (select 1 from clientes c where c.id = cambios.cliente_id)
           or exists (select 1 from citas ci where ci.id = cambios.registro_id))));

-- Aviso suelto (sin cita): marcar como recibido
create or replace function marcar_aviso(p_id uuid) returns void language sql
security definer set search_path = public as $$
  update avisos set leido_en = now(), leido_por = auth.uid()
  where id = p_id and leido_en is null
    and ((para_rol = 'recepcion' and mi_rol() = 'recepcion')
      or (para_rol = 'trabajador' and para_trabajador_id = mi_trabajador())) $$;
revoke execute on function marcar_aviso(uuid) from public, anon;
grant execute on function marcar_aviso(uuid) to authenticated;

-- ---------- Deshacer un cambio ----------
-- Solo quien lo hizo (o recepción) y solo si es el último cambio de esa cita/cliente/bloqueo.
-- p_confirmar = true acepta compartir cabina si al deshacer coincide con otra cita.
create or replace function deshacer_cambio(p_id bigint, p_confirmar boolean default false) returns text
language plpgsql security definer set search_path = public as $$
declare x cambios; r jsonb; cols text; t text; tz text; cuando text; txt text; actor text := mi_rol();
begin
  select * into x from cambios where id = p_id for update;
  if not found then raise exception 'NO_DESHACER|Ese cambio ya no existe.'; end if;
  if x.deshecho_en is not null then raise exception 'NO_DESHACER|Ese cambio ya estaba deshecho.'; end if;
  if x.campos ? '_deshacer' then raise exception 'NO_DESHACER|Esto ya fue un «Deshacer».'; end if;
  if actor is null or not (actor = 'recepcion' or x.usuario = auth.uid()) then
    raise exception 'NO_DESHACER|Solo puedes deshacer tus propios cambios.';
  end if;
  if exists (select 1 from cambios c where c.registro_id = x.registro_id and c.id > x.id
             and c.deshecho_en is null and not (c.campos ? '_deshacer')) then
    raise exception 'NO_DESHACER|Después se hizo otro cambio en lo mismo. Deshaz primero el más reciente.';
  end if;
  t := x.tabla;
  if t not in ('citas', 'clientes', 'bloqueos') then raise exception 'NO_DESHACER|Este cambio no se puede deshacer.'; end if;
  perform set_config('app.deshaciendo', p_id::text, true);

  if x.accion = 'crear' then
    if t = 'clientes' and exists (select 1 from citas where cliente_id = x.registro_id) then
      raise exception 'NO_DESHACER|Ese cliente ya tiene citas: no se puede quitar desde aquí.';
    end if;
    if t = 'citas' then
      -- Aviso a la otra parte de que la cita era un error
      select coalesce(zona_horaria, 'Europe/Madrid') into tz from ajustes where id = 1;
      select to_char(ci.inicio at time zone coalesce(tz, 'Europe/Madrid'), 'DD/MM HH24:MI') || ' · ' || coalesce(cl.nombre, 'Sin cliente'), ci.trabajador_id::text
        into cuando, txt
      from citas ci left join clientes cl on cl.id = ci.cliente_id where ci.id = x.registro_id;
      if cuando is not null then
        if actor = 'trabajador' then
          insert into avisos (para_rol, tipo, mensaje) values ('recepcion', 'cancelada', nombre_usuario_actual() || ': cita anulada (era un error) · ' || cuando);
        else
          insert into avisos (para_rol, para_trabajador_id, tipo, mensaje) values ('trabajador', txt::uuid, 'cancelada', 'Cita anulada (era un error) · ' || cuando);
        end if;
      end if;
    end if;
    execute format('delete from %I where id = $1', t) using x.registro_id;

  elsif x.accion = 'cambiar' then
    execute format('select to_jsonb(z) from %I z where id = $1', t) into r using x.registro_id;
    if r is null then raise exception 'NO_DESHACER|Ya no existe: se borró después.'; end if;
    select string_agg(format('%I = n.%I', c.column_name, c.column_name), ', '),
           jsonb_object_agg(c.column_name, x.campos->c.column_name->0)
      into cols, r
    from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = t and x.campos ? c.column_name
      and c.column_name not in ('id', 'creado_en', 'creado_por');
    if cols is null then raise exception 'NO_DESHACER|No hay nada que deshacer.'; end if;
    execute format('select to_jsonb(z) from %I z where id = $1', t) into x.campos using x.registro_id;  -- fila actual
    r := x.campos || r;
    if t = 'citas' and p_confirmar then r := r || '{"solape_confirmado": true}'; cols := cols || ', solape_confirmado = n.solape_confirmado'; end if;
    execute format('update %I t set %s from jsonb_populate_record(null::%I, $1) n where t.id = $2', t, cols, t) using r, x.registro_id;

  else  -- borrar: se recupera tal como estaba
    if t = 'clientes' or not (x.campos ? '_fila') then raise exception 'NO_DESHACER|Esto no se puede recuperar desde aquí.'; end if;
    r := x.campos->'_fila';
    if t = 'citas' and p_confirmar then r := r || '{"solape_confirmado": true}'; end if;
    execute format('insert into %I select * from jsonb_populate_record(null::%I, $1)', t, t) using r;
  end if;

  update cambios set deshecho_en = now(), deshecho_por = nombre_usuario_actual() where id = p_id;
  perform set_config('app.deshaciendo', '', true);
  return 'ok';
end $$;
revoke execute on function deshacer_cambio(bigint, boolean) from public, anon;
grant execute on function deshacer_cambio(bigint, boolean) to authenticated;

select 'listo' as estado;
