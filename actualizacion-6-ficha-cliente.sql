-- =====================================================================
-- ACTUALIZACIÓN 6 · Ficha de cliente completa
-- Pegar ENTERO en Supabase → SQL Editor → New query → Run.
-- No borra nada. Se puede ejecutar más de una vez.
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
