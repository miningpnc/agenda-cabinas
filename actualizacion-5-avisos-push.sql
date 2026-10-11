-- =====================================================================
-- ACTUALIZACIÓN 5 · Avisos al móvil (push) aunque la app esté cerrada
-- Pegar en Supabase → SQL Editor → New query → Run.
-- No borra nada. Se puede ejecutar más de una vez.
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
