// Conexión con Supabase. Copia estos dos datos de:
// Supabase → Project Settings → API (o el botón "Connect").
// La clave "publishable" (o "anon public") puede ir aquí sin problema.
// NUNCA pongas aquí la clave "secret" ni la "service_role".
window.APP_CONFIG = {
  supabaseUrl: 'https://kyujqjnhypjkvcblpqtu.supabase.co',
  supabaseKey: 'sb_publishable_psgvcwg2opBU9g2Je7zyUg_3xykqLwW',

  // Clave pública para avisos push (la privada va solo en Supabase → Edge Functions → Secrets)
  // Nombre interno (slug) de la función de avisos en Supabase → Edge Functions
  funcionAvisos: 'clever-action',
  vapidPublicKey: 'BHnHgUpukAJzF_chsIOMixN0CrZj8J2gCkTazmGadbOw9M2i_1rFKG_PMysp_BoY1HDgSpTvkTK2qk_Cmx_hDE4',

  // false = solo entran los usuarios que crea el centro (no hay registro público)
  permitirRegistro: false,

  // Pantalla de demostración con dos botones de entrada.
  // Deben coincidir con los usuarios creados en Supabase → Authentication → Users.
  // Este archivo es público: usa estas contraseñas SOLO para la demo.
  demo: {
    activa: true,
    recepcion:  { email: 'miningpnc+recepcion@gmail.com', password: 'recepcion' },
    trabajador: { email: 'miningpnc+maria@gmail.com',     password: 'trabajador', nombre: 'María' },
    propietario: { email: 'miningpnc+propietario@gmail.com', password: 'propietario' }
  }
};
