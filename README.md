# Agenda Cabinas

Agenda de citas para centros con varias actividades (fisioterapia, estética, uñas, masajes, peluquería…), varios trabajadores y varias cabinas. Complementa al programa de pacientes del centro: **no guarda información clínica**.

## Qué hace
- **Recepción**: agenda de todo el equipo, clientes con su historial de asistencia, facturación (día, semana, mes, trimestre y año, por trabajador) y ajustes (equipo, cabinas, actividades, servicios y precios).
- **Trabajadores**: ven y crean sus propias citas. Los que tienen «Ve su facturación» activado (p. ej. autónomos) ven lo que han facturado ellos, nunca el total del centro.
- **Cabina compartida**: si dos citas coinciden en la misma cabina, suena una alarma y pregunta «¿Es correcto?». Si se confirma, ambas citas salen en rojo.
- **Avisos**: cuando recepción crea o cambia una cita, se avisa al trabajador, y al revés. Cada aviso queda pendiente hasta que se pulsa «Recibido».
- **Tiempo real**: todos los dispositivos ven los cambios al momento.

## Archivos
| Archivo | Para qué |
|---|---|
| `index.html` | La app (diseño y estructura) |
| `app.js` | La lógica de la app |
| `config.js` | **Aquí van la URL y la clave publishable de Supabase** |
| `sw.js` | Permite instalarla y mostrar notificaciones |
| `manifest.webmanifest`, `icon-*.png` | Instalación como app en el móvil |
| `supabase.sql` | Base de datos. **Se pega en Supabase → SQL Editor** (puede estar en el repositorio, no contiene claves) |

## Instalar en un centro nuevo
1. Crear un proyecto de Supabase en región UE y ejecutar `supabase.sql`.
2. En Supabase → Authentication → Sign In / Providers → Email: desactivar **Confirm email**.
3. Poner la URL y la clave publishable en `config.js`.
4. Publicar con GitHub Pages.
5. La primera persona que se registra en la app queda como **recepción**.

Cada centro usa su propio proyecto de Supabase: sus datos nunca se mezclan con los de otro.
