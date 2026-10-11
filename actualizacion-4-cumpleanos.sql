-- =====================================================================
-- ACTUALIZACIÓN 4 · Fecha de nacimiento de los trabajadores (felicitación)
-- Pegar en Supabase → SQL Editor → New query → Run.
-- No borra nada. Se puede ejecutar más de una vez.
-- =====================================================================
alter table trabajadores add column if not exists fecha_nacimiento date;

select nombre, fecha_nacimiento from trabajadores order by nombre;
