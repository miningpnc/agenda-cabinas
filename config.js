// Conexión con Supabase. Copia estos dos datos de:
// Supabase → Project Settings → API (o el botón "Connect").
// La clave "publishable" (o "anon public") puede ir aquí sin problema.
// NUNCA pongas aquí la clave "secret" ni la "service_role".
window.APP_CONFIG = {
  supabaseUrl: 'https://kyujqjnhypjkvcblpqtu.supabase.co',
  supabaseKey: 'sb_publishable_psgvcwg2opBU9g2Je7zyUg_3xykqLwW',

  // false = solo entran los usuarios que crea el centro (no hay registro público)
  permitirRegistro: false,

  // Pantalla de demostración con dos botones de entrada.
  // Deben coincidir con los usuarios creados en Supabase → Authentication → Users.
  // Este archivo es público: usa estas contraseñas SOLO para la demo.
  demo: {
    activa: true,
    recepcion:  { email: 'miningpnc+recepcion@gmail.com', password: 'recepcion' },
    trabajador: { email: 'miningpnc+maria@gmail.com',     password: 'trabajador' }
  }
};
