// Conexión con Supabase. Copia estos dos datos de:
// Supabase → Project Settings → API (o el botón "Connect").
// La clave "publishable" (o "anon public") puede ir aquí sin problema.
// NUNCA pongas aquí la clave "secret" ni la "service_role".
window.APP_CONFIG = {
  supabaseUrl: 'https://TU-PROYECTO.supabase.co',
  supabaseKey: 'TU-CLAVE-PUBLISHABLE',

  // false = solo entran los usuarios que crea el centro (no hay registro público)
  permitirRegistro: false,

  // Pantalla de demostración con dos botones de entrada.
  // Pon aquí los mismos emails y contraseñas que crees en Supabase → Authentication → Users.
  // Usa contraseñas SOLO para la demo: este archivo es público.
  demo: {
    activa: true,
    recepcion:  { email: 'miningpnc+recepcion@gmail.com', password: 'CAMBIA-ESTA-CLAVE-1' },
    trabajador: { email: 'miningpnc+laura@gmail.com',     password: 'CAMBIA-ESTA-CLAVE-2' }
  }
};
