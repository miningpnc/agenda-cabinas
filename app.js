/* Agenda Cabinas · app conectada a Supabase */
'use strict';

/* ================= utilidades ================= */
/* apariencia elegida en este dispositivo (se aplica antes de pintar nada) */
const TEMAS = [
  ['auto', 'Automático', ['#f2f4f8', '#0e1320'], '#24406f'], ['claro', 'Claro', ['#f2f4f8', '#ffffff'], '#24406f'],
  ['oscuro', 'Oscuro', ['#0e1320', '#161e30'], '#0e1320'], ['verde', 'Verde pastel', ['#eef6f0', '#3f7d5c'], '#3f7d5c'],
  ['azul', 'Azul pastel', ['#edf4fb', '#3a6ea5'], '#3a6ea5'], ['pergamino', 'Pergamino', ['#f3ead8', '#8a5a2b'], '#8a5a2b'],
  ['minimal', 'Minimalista', ['#ffffff', '#111111'], '#111111']
];
function aplicarTema(t) {
  const r = document.documentElement;
  if (!t || t === 'auto') r.removeAttribute('data-theme'); else r.setAttribute('data-theme', t);
  const m = document.querySelector('meta[name="theme-color"]'), def = TEMAS.find(x => x[0] === (t || 'auto'));
  if (m) m.setAttribute('content', t === 'auto' || !t ? (matchMedia('(prefers-color-scheme: dark)').matches ? '#0e1320' : '#24406f') : def ? def[3] : '#24406f');
}
function temaActual() { try { return localStorage.getItem('agenda-tema') || 'auto'; } catch (e) { return 'auto'; } }
function elegirTema(t) { try { localStorage.setItem('agenda-tema', t); } catch (e) { } aplicarTema(t); renderVista(); toast('Apariencia: ' + TEMAS.find(x => x[0] === t)[1]); }
aplicarTema(temaActual());
const HASH0 = location.hash; // se lee antes de que Supabase limpie la dirección
const CFG = window.APP_CONFIG || {};
const DEMO = !!(CFG.demo && CFG.demo.activa); // pantalla de bienvenida con botones de prueba
const REGISTRO = CFG.permitirRegistro === true; // false: solo entran los usuarios creados por el centro
const CONFIGURADO = !!(CFG.supabaseUrl && CFG.supabaseKey && !/TU-PROYECTO/.test(CFG.supabaseUrl) && !/TU-CLAVE/.test(CFG.supabaseKey));
const sb = CONFIGURADO && window.supabase ? window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey) : null;

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const dkey = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const addDays = (k, n) => { const d = new Date(k + 'T12:00'); d.setDate(d.getDate() + n); return dkey(d); };
const startOf = k => new Date(k + 'T00:00');
const hhmm = d => pad(d.getHours()) + ':' + pad(d.getMinutes());
const toMin = t => { const [h, m] = String(t).slice(0, 5).split(':'); return +h * 60 + +m; };
const minToT = m => pad(Math.floor(m / 60)) + ':' + pad(m % 60);
const eur = n => (+n || 0).toLocaleString('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' €';
const fechaCorta = d => new Date(d).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
const iniciales = n => String(n || '?').split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
const LANGS = { es: 'Español', en: 'Inglés', de: 'Alemán', fr: 'Francés', no: 'Noruego' };
const LOC = { es: 'es-ES', en: 'en-GB', de: 'de-DE', fr: 'fr-FR', no: 'nb-NO' };
const ESTADOS = { confirmada: 'Confirmada', realizada: 'Realizada', 'no vino': 'No vino', cancelada: 'Cancelada' };

/* ================= estado ================= */
const S = {
  user: null, rol: null, meId: null, puedeFacturar: false,
  ajustes: {}, actividades: [], trabajadores: [], tAct: {}, tCab: {}, cabinas: [], servicios: [], precios: {}, clientes: [], hist: {}, vinculados: new Set(),
  citas: [], choques: new Set(), avisos: [],
  tab: 'agenda', day: dkey(new Date()), filtroAct: '', filtroTrab: '', q: '',
  vista: (() => { try { return localStorage.getItem('agenda-vista') || 'dia'; } catch (e) { return 'dia'; } })(),
  fPeriodo: 'dia', fRef: dkey(new Date())
};
const esRecepcion = () => S.rol === 'recepcion';
const act = id => S.actividades.find(a => a.id === id) || { nombre: '—', color: '#7a869f' };
const srv = id => S.servicios.find(s => s.id === id) || { nombre: 'Sin servicio', duracion_min: 30, actividad_id: null };
const trab = id => S.trabajadores.find(t => t.id === id) || { nombre: '—' };
const cab = id => S.cabinas.find(c => c.id === id) || { nombre: 'Sin cabina' };
const cli = id => S.clientes.find(c => c.id === id) || { nombre: 'Sin cliente', idioma: 'es' };
const yo = () => S.trabajadores.find(t => t.id === S.meId);
const nombreCita = c => { const s = srv(c.servicio_id); return s.precio_libre && c.concepto ? `${s.nombre}: ${c.concepto}` : s.nombre; };
const precioCita = c => c.precio != null ? +c.precio : (S.precios[c.servicio_id] || 0);
const hayPrecioLibre = () => S.servicios.some(x => 'precio_libre' in x);
const hayAltas = () => S.clientes.some(x => 'validado' in x);
const pendienteAlta = c => hayAltas() && c && c.validado === false;
// clientes que se pueden elegir: recepción todos; un trabajador solo los que ha creado él
const misClientes = () => esRecepcion() ? S.clientes : S.clientes.filter(c => c.creado_por === S.user.id);
const paraMi = a => !a.leido_en && (esRecepcion() ? a.para_rol === 'recepcion' : (a.para_rol === 'trabajador' && a.para_trabajador_id === S.meId));
const misAvisos = () => S.avisos.filter(paraMi).sort((a, b) => b.creado_en.localeCompare(a.creado_en));

/* ================= sonido y avisos ================= */
let AC = null;
document.addEventListener('pointerdown', () => { try { AC = AC || new (window.AudioContext || window.webkitAudioContext)(); if (AC.state === 'suspended') AC.resume(); } catch (e) { } }, { once: false, passive: true });
function tono(freqs, dur = 0.16, gap = 0.07, type = 'sine') {
  try {
    AC = AC || new (window.AudioContext || window.webkitAudioContext)();
    let t = AC.currentTime + 0.02;
    freqs.forEach(f => {
      const o = AC.createOscillator(), g = AC.createGain();
      o.type = type; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(AC.destination); o.start(t); o.stop(t + dur + 0.03); t += dur + gap;
    });
  } catch (e) { }
}
const alarma = () => { tono([880, 620, 880, 620, 880, 620], 0.17, 0.05, 'square'); try { navigator.vibrate && navigator.vibrate([300, 120, 300, 120, 300]); } catch (e) { } };
const pitido = () => { tono([660, 990], 0.14); try { navigator.vibrate && navigator.vibrate(180); } catch (e) { } };

function toast(t) { const d = document.createElement('div'); d.className = 'toast'; d.textContent = t; document.body.appendChild(d); setTimeout(() => d.remove(), 2600); }

function notificarSistema(titulo, cuerpo) {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    if (navigator.serviceWorker && navigator.serviceWorker.getRegistration) {
      navigator.serviceWorker.getRegistration().then(r => r ? r.showNotification(titulo, { body: cuerpo, icon: 'icon-192.png', tag: 'agenda' }) : new Notification(titulo, { body: cuerpo }));
    } else new Notification(titulo, { body: cuerpo });
  } catch (e) { }
}
const esIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const instalada = () => window.matchMedia && (matchMedia('(display-mode: standalone)').matches || navigator.standalone === true);
const pushPosible = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && !!CFG.vapidPublicKey;
function claveVapid(b64) { const p = '='.repeat((4 - b64.length % 4) % 4), raw = atob((b64 + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from([...raw].map(c => c.charCodeAt(0))); }
// apunta este dispositivo para recibir avisos aunque la app esté cerrada
async function suscribirPush(silencioso = false) {
  if (!pushPosible() || Notification.permission !== 'granted' || !S.user) return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: claveVapid(CFG.vapidPublicKey) });
    const disp = (esIOS() ? 'iPhone/iPad' : /android/i.test(navigator.userAgent) ? 'Android' : 'Ordenador') + ' · ' + new Date().toLocaleDateString('es-ES');
    const r = await sb.rpc('guardar_suscripcion', { p_datos: sub.toJSON(), p_dispositivo: disp });
    if (r.error) { if (!silencioso) toast(/guardar_suscripcion/.test(r.error.message) ? 'Falta ejecutar la actualización 5 en Supabase' : r.error.message); return false; }
    S.pushActivo = true; return true;
  } catch (e) { if (!silencioso) toast('No se pudo activar en este dispositivo: ' + (e.message || e)); return false; }
}
async function activarNotificaciones() {
  if (esIOS() && !instalada()) {
    sheet(`<h3>Primero, instala la app</h3><p>En iPhone los avisos solo llegan si la agenda está en la pantalla de inicio:</p>
      <ol><li>Abre esta página en <b>Safari</b>.</li><li>Pulsa <b>Compartir</b> (el cuadrado con la flecha).</li><li>Elige <b>Añadir a pantalla de inicio</b>.</li><li>Abre la agenda desde el icono nuevo y vuelve a pulsar «Activar».</li></ol>
      <div class="actions"><button class="primary" onclick="closeSheet()">Entendido</button></div>`);
    return;
  }
  if (!('Notification' in window)) { toast('Este navegador no permite notificaciones'); return; }
  try {
    const r = await Notification.requestPermission();
    if (r !== 'granted') { toast('Notificaciones no permitidas en este dispositivo'); render(); return; }
    const ok = await suscribirPush();
    toast(ok ? 'Listo: este dispositivo recibirá avisos aunque la app esté cerrada' : 'Notificaciones activadas con la app abierta');
    render();
  } catch (e) { toast('No se pudieron activar'); }
}
async function avisoPrueba(correo) {
  const r = await sb.functions.invoke(CFG.funcionAvisos || 'enviar-aviso', { body: { prueba: true, correo } });
  if (r.error) { toast('El servidor de avisos aún no está configurado (función «enviar-aviso»).'); return; }
  const d = r.data || {};
  toast(`Enviado: ${d.push || 0} aviso${d.push === 1 ? '' : 's'} al móvil${correo ? ` y ${d.correos || 0} correo${d.correos === 1 ? '' : 's'}` : ''}. Puede tardar unos segundos.`);
}
async function cerrarSesion(btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'Cerrando sesión…'; }
  const conLimite = (p, ms) => Promise.race([p, new Promise(r => setTimeout(r, ms))]);
  // 1) este dispositivo deja de recibir avisos de este usuario (como mucho 2 s)
  try {
    if (pushPosible()) await conLimite((async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = reg && await reg.pushManager.getSubscription();
      if (sub) await sb.rpc('borrar_suscripcion', { p_endpoint: sub.endpoint });
    })(), 2000);
  } catch (e) { }
  // 2) cerrar la sesión en este navegador (sin depender de la conexión)
  try { await conLimite(sb.auth.signOut({ scope: 'local' }), 2000); } catch (e) { }
  // 3) por si acaso, borrar cualquier resto de la sesión guardada
  try { Object.keys(localStorage).filter(k => /^sb-.*-auth-token/.test(k)).forEach(k => localStorage.removeItem(k)); } catch (e) { }
  location.reload();
}
try { if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { }); } catch (e) { }

/* ================= hojas y diálogos ================= */
function sheet(html, cls = '') { $('#sheet').innerHTML = `<div class="scrim ${cls}" onclick="if(event.target===this)closeSheet()"><div class="sheet" role="dialog" aria-modal="true">${html}</div></div>`; }
function closeSheet() { $('#sheet').innerHTML = ''; }
function preguntar(titulo, texto, si = 'Sí', no = 'No', rojo = false) {
  return new Promise(res => {
    $('#dialog').innerHTML = `<div class="scrim ${rojo ? 'alarm' : ''}"><div class="sheet" role="alertdialog" aria-modal="true">
      <h3 class="${rojo ? 'bad' : ''}">${esc(titulo)}</h3><p>${esc(texto)}</p>
      <div class="actions"><button class="ghost" id="dlg-no">${esc(no)}</button><button class="${rojo ? 'danger' : 'primary'}" id="dlg-si">${esc(si)}</button></div></div></div>`;
    $('#dlg-no').onclick = () => { $('#dialog').innerHTML = ''; res(false); };
    $('#dlg-si').onclick = () => { $('#dialog').innerHTML = ''; res(true); };
  });
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') { if ($('#dialog').innerHTML) return; closeSheet(); } });

/* ================= arranque y acceso ================= */
const VOLVER_A = location.origin + location.pathname; // los enlaces de los correos vuelven aquí
let enRecuperacion = HASH0.includes('type=recovery');

async function boot() {
  if (!CONFIGURADO) return pantallaConfig();
  if (!sb) return pantallaError('No se pudo cargar la conexión. Revisa tu internet y recarga.');
  sb.auth.onAuthStateChange(ev => {
    if (ev === 'SIGNED_OUT') location.reload();
    if (ev === 'PASSWORD_RECOVERY') { enRecuperacion = true; pantallaNuevaPass(); }
  });
  const { data } = await sb.auth.getSession();
  const q = new URLSearchParams(HASH0.replace(/^#/, ''));
  if (q.get('error_description')) {
    history.replaceState(null, '', VOLVER_A);
    return pantallaLogin('entrar', /expired|invalid/i.test(q.get('error_description')) ? 'El enlace del correo ha caducado o ya se usó. Entra con tu contraseña o pide otro.' : q.get('error_description'));
  }
  if (enRecuperacion && data.session) return pantallaNuevaPass();
  if (!data.session) return DEMO ? pantallaDemo() : pantallaLogin();
  S.user = data.session.user;
  if (HASH0.includes('type=signup')) toast('Correo confirmado. ¡Bienvenido!');
  iniciarApp();
}

function pantallaConfig() {
  $('#app').innerHTML = `<div class="center"><div class="card"><h2>Falta conectar la base de datos</h2>
  <p class="muted">Abre el archivo <b>config.js</b> en GitHub y pega la <b>Project URL</b> y la clave <b>publishable</b> de tu proyecto de Supabase. Guarda y recarga esta página en un par de minutos.</p></div></div>`;
}
function pantallaError(t) { $('#app').innerHTML = `<div class="center"><div class="card"><h2>Algo ha fallado</h2><p class="muted">${esc(t)}</p><div class="actions"><button class="primary" onclick="location.reload()">Recargar</button></div></div></div>`; }

function pantallaDemo(aviso = '') {
  $('#app').innerHTML = `<div class="center"><div class="card welcome">
    <div class="logo" style="margin-bottom:12px">${LOGO}</div>
    <span class="demo-tag">Versión de demostración</span>
    <h2 style="margin-top:8px">Agenda Cabinas</h2>
    <p class="muted" style="margin:4px 0 0">Agenda de citas para centros con varias actividades, cabinas y profesionales. Elige cómo quieres entrar:</p>
    <div class="roles">
      <button class="role" id="d-recepcion" type="button">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4M8 14h8M8 17h5"/></svg>
        <span><b>Entrar como Recepción</b><small>Administrador: agenda de todo el equipo, clientes, facturación del centro y ajustes.</small></span>
      </button>
      <button class="role" id="d-trabajador" type="button">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="8.5" r="3.5"/><path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5"/></svg>
        <span><b>Entrar como Trabajador${(CFG.demo && CFG.demo.trabajador && CFG.demo.trabajador.nombre) ? ' · ' + esc(CFG.demo.trabajador.nombre) : ''}</b><small>Profesional: solo sus citas y los servicios de sus actividades, sus avisos y, si es autónomo, su propia facturación.</small></span>
      </button>
    </div>
    <div class="err" id="d-err" ${aviso ? '' : 'hidden'}>${esc(aviso)}</div>
    <div class="secure">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6z"/><path d="M9 12l2 2 4-4"/></svg>
      <div><b>Así se protegen los datos en la versión para tu centro</b>
      <ul>
        <li>Cada persona entra con <b>su email y su contraseña</b>. Sin ellos no se ve ningún dato, ni siquiera desde esta web.</li>
        <li>El alta se <b>valida por correo electrónico</b>: nadie accede hasta confirmar su email, y solo si el centro le ha dado de alta.</li>
        <li>Los datos se guardan <b>cifrados en servidores de la Unión Europea</b>.</li>
        <li>Cada uno ve <b>solo lo que le corresponde</b>: recepción, todo; cada profesional, sus citas.</li>
        <li>No se guarda historia clínica: eso sigue en el programa de pacientes del centro.</li>
      </ul>
      <p>Esta demo funciona sobre la misma base de datos y los mismos permisos reales. Los botones solo rellenan por ti el email y la contraseña de dos cuentas de prueba con datos inventados.</p></div>
    </div>
    <p style="text-align:center;margin:14px 0 0"><button type="button" class="pill" id="d-manual">Entrar con mi email y contraseña</button></p>
  </div></div>`;
  const entrar = async (rol, btn) => {
    const c = (CFG.demo || {})[rol] || {}, err = $('#d-err');
    err.hidden = true;
    if (!c.email || !c.password) { err.hidden = false; err.textContent = 'Falta configurar la cuenta de prueba en config.js.'; return; }
    document.querySelectorAll('.role').forEach(b => b.disabled = true);
    const t = btn.querySelector('b'), txt = t.textContent; t.textContent = 'Entrando…';
    const r = await sb.auth.signInWithPassword({ email: c.email, password: c.password });
    document.querySelectorAll('.role').forEach(b => b.disabled = false); t.textContent = txt;
    if (r.error) {
      err.hidden = false;
      err.textContent = /Invalid login/i.test(r.error.message) ? 'La cuenta de prueba no existe o su contraseña no coincide con config.js. Revisa los usuarios en Supabase.' : traducirAuth(r.error.message);
      return;
    }
    S.user = r.data.session.user; iniciarApp();
  };
  $('#d-recepcion').onclick = e => entrar('recepcion', e.currentTarget);
  $('#d-trabajador').onclick = e => entrar('trabajador', e.currentTarget);
  $('#d-manual').onclick = () => pantallaLogin('entrar');
}

function pantallaLogin(modo = 'entrar', aviso = '', email = '', ok = false) {
  const nuevo = modo === 'nuevo', olvido = modo === 'olvido';
  const intro = nuevo ? 'Primera vez: crea tu contraseña con el email que te ha dado de alta recepción. Te llegará un correo para confirmarlo.'
    : olvido ? 'Escribe tu email y te enviaremos un enlace para crear una contraseña nueva.' : 'Entra con tu email y contraseña.';
  $('#app').innerHTML = `<div class="center"><form class="card" id="login" novalidate>
    <div class="logo" style="margin-bottom:12px">${LOGO}</div>
    <h2>Agenda Cabinas</h2>
    <p class="muted" style="margin:4px 0 0">${intro}</p>
    <div class="field"><label for="l-email">Email</label><input id="l-email" type="email" autocomplete="email" required value="${esc(email)}"></div>
    ${olvido ? '' : `<div class="field"><label for="l-pass">Contraseña</label><input id="l-pass" type="password" autocomplete="${nuevo ? 'new-password' : 'current-password'}" minlength="6" required></div>`}
    ${nuevo ? '<div class="field"><label for="l-pass2">Repite la contraseña</label><input id="l-pass2" type="password" autocomplete="new-password" minlength="6" required></div>' : ''}
    <div class="${ok ? 'box info' : 'err'}" id="l-err" ${aviso ? '' : 'style="margin:0"'}>${esc(aviso)}</div>
    <div class="actions"><button class="primary" type="submit">${nuevo ? 'Crear mi acceso' : olvido ? 'Enviar enlace' : 'Entrar'}</button></div>
    <div class="actions" id="l-extra" hidden><button type="button" class="ghost" id="l-resend">Reenviar correo de confirmación</button></div>
    ${DEMO ? '<p style="text-align:center;margin:14px 0 0"><button type="button" class="pill" onclick="pantallaDemo()">‹ Volver a la demostración</button></p>' : ''}
    ${REGISTRO ? `<p style="text-align:center;margin:14px 0 0;display:flex;gap:8px;justify-content:center;flex-wrap:wrap">
      ${modo !== 'entrar' ? '<button type="button" class="pill" data-m="entrar">Ya tengo contraseña</button>' : ''}
      ${modo !== 'nuevo' ? '<button type="button" class="pill" data-m="nuevo">Es mi primera vez</button>' : ''}
      ${modo === 'entrar' ? '<button type="button" class="pill" data-m="olvido">He olvidado mi contraseña</button>' : ''}
    </p>` : ''}
    <div class="secure">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6z"/><path d="M9 12l2 2 4-4"/></svg>
      <div><b>Tus datos están protegidos</b>
      <p>Solo se puede entrar con un email y una contraseña dados de alta por el centro. Sin ellos no se ve ningún dato, ni siquiera desde esta web.</p>
      <p>La información se guarda cifrada en servidores de la Unión Europea y cada persona ve únicamente lo que le corresponde: recepción, la agenda completa; cada profesional, solo sus citas.</p>
      <p>Esta agenda no guarda historia clínica. Protege tu contraseña y no la compartas.</p></div>
    </div>
  </form></div>`;
  document.querySelectorAll('#login [data-m]').forEach(b => b.onclick = () => pantallaLogin(b.dataset.m, '', $('#l-email').value.trim()));
  const mostrarReenvio = () => {
    $('#l-extra').hidden = false;
    $('#l-resend').onclick = async () => {
      const em = $('#l-email').value.trim().toLowerCase();
      const r = await sb.auth.resend({ type: 'signup', email: em, options: { emailRedirectTo: VOLVER_A } });
      const box = $('#l-err'); box.style.margin = ''; box.className = r.error ? 'err' : 'box info';
      box.textContent = r.error ? traducirAuth(r.error.message) : 'Correo reenviado. Revisa también la carpeta de spam.';
    };
  };
  $('#login').onsubmit = async e => {
    e.preventDefault();
    const em = $('#l-email').value.trim().toLowerCase(), err = $('#l-err');
    const pass = olvido ? '' : $('#l-pass').value;
    err.className = 'err'; err.style.margin = ''; err.textContent = '';
    if (!em) { err.textContent = 'Escribe tu email.'; return; }
    if (!olvido && pass.length < 6) { err.textContent = 'La contraseña debe tener al menos 6 caracteres.'; return; }
    if (nuevo && pass !== $('#l-pass2').value) { err.textContent = 'Las contraseñas no coinciden.'; return; }
    const btn = e.submitter || $('#login button[type=submit]'), txt = btn.textContent; btn.disabled = true; btn.textContent = 'Un momento…';
    let r;
    if (olvido) r = await sb.auth.resetPasswordForEmail(em, { redirectTo: VOLVER_A });
    else if (nuevo) r = await sb.auth.signUp({ email: em, password: pass, options: { emailRedirectTo: VOLVER_A } });
    else r = await sb.auth.signInWithPassword({ email: em, password: pass });
    btn.disabled = false; btn.textContent = txt;
    if (r.error) {
      err.textContent = traducirAuth(r.error.message);
      if (/not confirmed/i.test(r.error.message)) mostrarReenvio();
      return;
    }
    if (olvido) return pantallaLogin('entrar', 'Si ese email tiene acceso, te hemos enviado un enlace para crear una contraseña nueva.', em, true);
    if (nuevo && r.data.user && Array.isArray(r.data.user.identities) && r.data.user.identities.length === 0)
      return pantallaLogin('entrar', 'Este email ya tiene acceso. Entra con tu contraseña o usa «He olvidado mi contraseña».', em);
    if (!r.data.session) { pantallaLogin('entrar', `Te hemos enviado un correo a ${em}. Pulsa el enlace para confirmar y entrarás directamente. Revisa también spam.`, em, true); mostrarReenvio(); return; }
    S.user = r.data.session.user; iniciarApp();
  };
}
function traducirAuth(m) {
  m = m || '';
  if (/Invalid login/i.test(m)) return 'Email o contraseña incorrectos.';
  if (/not confirmed/i.test(m)) return 'Aún no has confirmado tu correo. Pulsa el enlace que te enviamos o pide que te lo reenviemos.';
  if (/signups? not allowed|signup.*disabled/i.test(m)) return 'El registro está cerrado. Pide a recepción que te dé de alta.';
  if (/already registered/i.test(m)) return 'Este email ya tiene acceso. Pulsa «Ya tengo contraseña».';
  if (/rate limit|security purposes|seconds/i.test(m)) return 'Has hecho varios intentos seguidos. Espera un minuto y vuelve a probar.';
  if (/sending|smtp|email.*(send|deliver)/i.test(m)) return 'No se ha podido enviar el correo. Revisa la configuración de correo en Supabase.';
  if (/password/i.test(m) && /weak|short|least/i.test(m)) return 'La contraseña es demasiado débil. Usa al menos 6 caracteres.';
  return m;
}
function pantallaNuevaPass() {
  history.replaceState(null, '', VOLVER_A);
  $('#app').innerHTML = `<div class="center"><form class="card" id="np" novalidate>
    <h2>Crea tu contraseña nueva</h2>
    <div class="field"><label for="np-1">Contraseña nueva</label><input id="np-1" type="password" autocomplete="new-password" minlength="6"></div>
    <div class="field"><label for="np-2">Repítela</label><input id="np-2" type="password" autocomplete="new-password" minlength="6"></div>
    <div class="err" id="np-err"></div>
    <div class="actions"><button class="primary" type="submit">Guardar y entrar</button></div></form></div>`;
  $('#np').onsubmit = async e => {
    e.preventDefault();
    const a = $('#np-1').value, b = $('#np-2').value, err = $('#np-err');
    if (a.length < 6) { err.textContent = 'Al menos 6 caracteres.'; return; }
    if (a !== b) { err.textContent = 'Las contraseñas no coinciden.'; return; }
    const r = await sb.auth.updateUser({ password: a });
    if (r.error) { err.textContent = traducirAuth(r.error.message); return; }
    enRecuperacion = false; S.user = r.data.user; toast('Contraseña cambiada'); iniciarApp();
  };
}

function pantallaSinPerfil() {
  $('#app').innerHTML = `<div class="center"><div class="card"><h2>Tu usuario aún no está dado de alta</h2>
  <p class="muted">Has entrado como <b>${esc(S.user.email)}</b>, pero recepción todavía no te ha añadido al equipo con este email.</p>
  <p class="muted">Pide que te den de alta con exactamente este email y vuelve a comprobarlo.</p>
  <div class="actions"><button class="ghost" onclick="cerrarSesion(this)">Salir</button><button class="primary" onclick="iniciarApp()">Volver a comprobar</button></div></div></div>`;
}

async function iniciarApp() {
  $('#app').innerHTML = '<div class="spinner" aria-label="Cargando"></div>';
  const { data: p, error } = await sb.from('perfiles').select('rol,trabajador_id').eq('user_id', S.user.id).maybeSingle();
  if (error) return pantallaError(error.message);
  if (!p) return pantallaSinPerfil();
  S.rol = p.rol; S.meId = p.trabajador_id;
  try { await cargarBase(); } catch (e) { return pantallaError(e.message || String(e)); }
  S.puedeFacturar = esRecepcion() || !!(yo() && yo().ver_facturacion);
  await Promise.all([cargarDia(), cargarAvisos()]);
  elegirFrase();
  suscribir();
  suscribirPush(true).then(ok => { if (ok && (S.tab === 'cuenta' || S.tab === 'ajustes')) renderVista(); });
  render();
}

/* ================= datos ================= */
function chk(r) { if (r.error) throw new Error(r.error.message); return r.data || []; }
async function cargarBase() {
  const [aj, ac, tr, ta, cb, tc, sv, pr, cl] = await Promise.all([
    sb.from('ajustes').select('*').maybeSingle(),
    sb.from('actividades').select('*').order('orden').order('nombre'),
    sb.from('trabajadores').select('*').order('nombre'),
    sb.from('trabajador_actividades').select('*'),
    sb.from('cabinas').select('*').order('orden').order('nombre'),
    sb.from('trabajador_cabinas').select('*'),
    sb.from('servicios').select('*').order('nombre'),
    sb.from('precios').select('*'),
    sb.from('clientes').select('*').order('nombre')
  ]);
  if (aj.error) throw new Error(aj.error.message);
  S.ajustes = aj.data || { nombre_centro: 'Mi centro', hora_apertura: '09:00', hora_cierre: '21:00' };
  S.actividades = chk(ac); S.trabajadores = chk(tr); S.cabinas = chk(cb); S.servicios = chk(sv); S.clientes = chk(cl);
  S.tAct = {}; chk(ta).forEach(r => (S.tAct[r.trabajador_id] = S.tAct[r.trabajador_id] || new Set()).add(r.actividad_id));
  S.tCab = {}; chk(tc).forEach(r => (S.tCab[r.trabajador_id] = S.tCab[r.trabajador_id] || []).push(r));
  S.precios = {}; chk(pr).forEach(r => S.precios[r.servicio_id] = +r.precio);
  await Promise.all([cargarHistorial(), cargarHorario()]);
}
async function cargarHistorial() {
  S.hist = {};
  if (!esRecepcion()) return;
  const r = await sb.rpc('historial_clientes');
  if (!r.error) (r.data || []).forEach(h => S.hist[h.cliente_id] = h);
}
async function cargarClientes() { const r = await sb.from('clientes').select('*').order('nombre'); if (!r.error) S.clientes = r.data.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')); }
async function cargarDia() {
  const { a, b } = rangoAgenda();
  const campos = S.vista === 'anio' ? 'id,inicio,fin,estado,trabajador_id,servicio_id,cabina_id,cliente_id' + (hayPrecioLibre() ? ',precio,concepto' : '') : '*';
  const [c, ch] = await Promise.all([
    sb.from('citas').select(campos).gte('inicio', a.toISOString()).lt('inicio', b.toISOString()).order('inicio').limit(5000),
    sb.rpc('citas_con_choque', { p_desde: a.toISOString(), p_hasta: b.toISOString() }),
    sb.from('bloqueos').select('*').lt('inicio', b.toISOString()).gt('fin', a.toISOString())
  ]).then(r => { S.bloqueosOK = !r[2].error; S.bloqueos = r[2].error ? [] : r[2].data; return r; });
  S.citas = c.error ? [] : c.data;
  S.choques = new Set(ch.error ? [] : (ch.data || []).map(x => typeof x === 'string' ? x : Object.values(x)[0]));
  const faltan = [...new Set(S.citas.map(x => x.cliente_id).filter(id => id && !S.clientes.some(c => c.id === id)))];
  if (faltan.length) await cargarClientes();
}
async function cargarAvisos() {
  const desde = new Date(Date.now() - 45 * 864e5).toISOString();
  const r = await sb.from('avisos').select('*').is('leido_en', null).gte('creado_en', desde).order('creado_en', { ascending: false }).limit(300);
  S.avisos = r.error ? [] : r.data;
}

/* ================= tiempo real ================= */
let tRefresco = null;
function refrescarPronto() {
  clearTimeout(tRefresco);
  tRefresco = setTimeout(async () => {
    await cargarDia();
    if (esRecepcion()) await cargarHistorial();
    if (S.tab === 'agenda' || S.tab === 'facturacion') renderVista();
    pintarCampana();
  }, 350);
}
function suscribir() {
  sb.channel('agenda-cambios')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'citas' }, () => refrescarPronto())
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'avisos' }, p => {
      const a = p.new; if (!a) return;
      S.avisos = S.avisos.filter(x => x.id !== a.id); S.avisos.unshift(a);
      if (paraMi(a)) { pitido(); toast(a.mensaje); if (document.hidden) notificarSistema('Agenda', a.mensaje); }
      pintarCampana(); refrescarPronto();
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'avisos' }, p => {
      const a = p.new; if (!a) return;
      S.avisos = S.avisos.map(x => x.id === a.id ? a : x).filter(x => !x.leido_en);
      pintarCampana(); if (S.tab === 'agenda') renderVista();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'bloqueos' }, p => { if (p.eventType === 'INSERT' && esRecepcion() && p.new && p.new.creado_por !== S.user.id) { pitido(); toast(`${trab(p.new.trabajador_id).nombre} ha bloqueado: ${textoBloqueo(p.new)}`); } refrescarPronto(); })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'dias_especiales' }, async () => { await cargarHorario(); if (S.tab === 'agenda' || S.tab === 'ajustes') renderVista(); })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'horario_semanal' }, async () => { await cargarHorario(); if (S.tab === 'agenda' || S.tab === 'ajustes') renderVista(); })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'clientes' }, async () => { await cargarClientes(); if (S.tab === 'clientes' && document.activeElement?.id !== 'q') renderVista(); })
    .subscribe();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { cargarAvisos().then(pintarCampana); refrescarPronto(); } });
}


/* ================= saludo y frase del día ================= */
const FRASES = [
  ['Un viaje de mil millas comienza con un solo paso.', 'Tao Te Ching'],
  ['Cae siete veces, levántate ocho.', 'Proverbio japonés'],
  ['El mejor momento para plantar un árbol fue hace veinte años. El segundo mejor momento es ahora.', 'Proverbio chino'],
  ['Cuando bebas agua, recuerda la fuente.', 'Proverbio chino'],
  ['La paciencia es un árbol de raíz amarga pero de frutos muy dulces.', 'Proverbio persa'],
  ['El agua blanda vence a la roca dura.', 'Proverbio chino'],
  ['Antes de la iluminación, cortar leña y acarrear agua. Después de la iluminación, cortar leña y acarrear agua.', 'Proverbio zen'],
  ['Si caminas solo, irás más rápido. Si caminas acompañado, llegarás más lejos.', 'Proverbio africano'],
  ['No hay camino hacia la paz: la paz es el camino.', 'Sabiduría zen'],
  ['La gota abre la piedra no por su fuerza, sino por su constancia.', 'Proverbio latino'],
  ['Una sonrisa cuesta menos que la electricidad y da más luz.', 'Proverbio escocés'],
  ['El bambú que se dobla es más fuerte que el roble que resiste.', 'Proverbio japonés'],
  ['Inhala calma, exhala prisa.', 'Respiración consciente'],
  ['Haz una cosa cada vez, y hazla con todo tu cuidado.', 'Práctica zen'],
  ['Las manos que ayudan valen más que los labios que rezan.', 'Proverbio popular'],
  ['El que mueve montañas empieza apartando piedras pequeñas.', 'Proverbio chino'],
  ['Hoy es un buen día para cuidar de alguien, también de ti.', 'Frase del día'],
  ['La mente es como el agua: cuando está agitada no ves el fondo; cuando está en calma, todo se aclara.', 'Sabiduría oriental'],
  ['Donde pones tu atención, pones tu energía.', 'Enseñanza del yoga'],
  ['Cada cliente que se va mejor de lo que llegó es un pequeño éxito.', 'Frase del día'],
  ['No cuentes los días: haz que los días cuenten.', 'Frase del día'],
  ['Escucha con las manos, cuida con la mirada.', 'Frase del día'],
  ['El cuerpo dice lo que las palabras callan.', 'Sabiduría popular'],
  ['Sé como el sauce: flexible ante el viento y firme en la raíz.', 'Proverbio chino'],
  ['La calma también se contagia.', 'Frase del día'],
  ['Quien domina su respiración domina su día.', 'Enseñanza del yoga'],
  ['Lo que haces cada día importa más que lo que haces de vez en cuando.', 'Frase del día'],
  ['Las grandes obras se hacen con pequeños gestos bien hechos.', 'Frase del día'],
  ['El sol no pregunta si merece brillar: simplemente brilla.', 'Frase del día'],
  ['Aprende a estar presente: el ahora es el único momento que tienes.', 'Práctica de atención plena'],
  ['La perseverancia es el camino del éxito.', 'Proverbio chino'],
  ['Un buen equipo convierte un día difícil en un día más.', 'Frase del día'],
  ['El descanso también es parte del trabajo.', 'Frase del día'],
  ['Trata cada cita como si fuera la primera.', 'Frase del día'],
  ['Con orden y calma se llega a todo.', 'Refrán popular'],
  ['No es más rico quien más tiene, sino quien menos necesita.', 'Proverbio popular'],
  ['La flor no compite con la flor de al lado: simplemente florece.', 'Sabiduría zen'],
  ['Postura firme, respiración suave, mente tranquila.', 'Enseñanza del yoga'],
  ['La amabilidad es el idioma que todos entienden.', 'Frase del día'],
  ['Tu energía de hoy es el cuidado que darás a otros.', 'Frase del día'],
  ['Más vale encender una vela que maldecir la oscuridad.', 'Proverbio chino'],
  ['No temas avanzar despacio; teme solo quedarte quieto.', 'Proverbio chino'],
  ['El que pregunta es ignorante un minuto; el que no pregunta lo es toda la vida.', 'Proverbio chino'],
  ['Aprender sin reflexionar es malgastar la energía.', 'Confucio'],
  ['Cuando camines, camina. Cuando comas, come.', 'Proverbio zen'],
  ['Siéntate, respira, sonríe.', 'Práctica zen'],
  ['Quien busca un amigo sin defectos se queda sin amigos.', 'Proverbio turco'],
  ['Mente sana en cuerpo sano.', 'Juvenal'],
  ['Poco a poco se va lejos.', 'Refrán'],
  ['A mal tiempo, buena cara.', 'Refrán'],
  ['No hay mal que cien años dure.', 'Refrán'],
  ['Lo que se hace con cariño no cansa igual.', 'Frase del día'],
  ['Respira: es solo un mal rato, no un mal día.', 'Frase del día'],
  ['La sonrisa es el camino más corto entre dos personas.', 'Frase popular'],
  ['Namasté: lo mejor de mí saluda a lo mejor de ti.', 'Saludo del yoga'],
  ['El silencio también cuida.', 'Frase del día'],
  ['Las hojas que caen nos enseñan a soltar.', 'Sabiduría zen'],
  ['Si no puedes cambiar el viento, ajusta las velas.', 'Proverbio marinero'],
  ['El río no lucha contra la piedra: la rodea y sigue su camino.', 'Sabiduría oriental'],
  ['Un buen masaje empieza mucho antes de tocar: empieza escuchando.', 'Frase del día'],
  ['La belleza que más se nota es la del trato.', 'Frase del día'],
  ['Unas manos tranquilas transmiten tranquilidad.', 'Frase del día'],
  ['Hoy cuenta. Cada cita cuenta.', 'Frase del día'],
  ['El detalle marca la diferencia entre un buen servicio y uno inolvidable.', 'Frase del día'],
  ['Cuídate para poder cuidar.', 'Frase del día'],
  ['Una pausa a tiempo vale más que diez carreras.', 'Frase del día'],
  ['La constancia vence lo que la dicha no alcanza.', 'Refrán'],
  ['Nadie tropieza dos veces con la misma piedra si mira dónde pisa.', 'Refrán adaptado'],
  ['El hábito hace al maestro.', 'Refrán'],
  ['Con paciencia y saliva, el elefante se comió a la hormiga.', 'Refrán'],
  ['En calma, las manos saben lo que hacen.', 'Frase del día'],
  ['El estrés no trabaja mejor que tú: déjalo en la puerta.', 'Frase del día'],
  ['La primera impresión es la bienvenida; la última, el recuerdo.', 'Frase del día'],
  ['El tiempo que dedicas a escuchar nunca es tiempo perdido.', 'Frase del día'],
  ['La montaña no se sube de un salto, sino paso a paso.', 'Proverbio tibetano'],
  ['Al final del camino, lo que queda es cómo hiciste sentir a los demás.', 'Frase del día'],
  ['Lo pequeño, bien hecho, se vuelve grande.', 'Frase del día'],
  ['Un día tranquilo también es un buen día.', 'Frase del día'],
  ['Tu postura habla antes que tú: espalda recta, hombros sueltos.', 'Enseñanza del yoga'],
  ['Agradece el día, incluso los ratos difíciles: también enseñan.', 'Frase del día'],
  ['La luna no tiene prisa y aun así recorre todo el cielo.', 'Proverbio oriental'],
  ['Si cuidas las raíces, las flores llegan solas.', 'Sabiduría popular'],
  ['La mejor recomendación es un cliente que vuelve.', 'Frase del día'],
  ['El orden de la cabina es el orden de la mente.', 'Frase del día'],
  ['Mira a cada cliente como si fuera la persona más importante del día.', 'Frase del día'],
  ['Hay días de siembra y días de cosecha: los dos son necesarios.', 'Sabiduría popular'],
  ['Las cosas buenas llevan tiempo; las mejores, cuidado.', 'Frase del día'],
  ['Exhala lo que no puedes controlar.', 'Respiración consciente'],
  ['El equilibrio no se encuentra: se practica.', 'Enseñanza del yoga'],
  ['Una mente serena convierte la prisa en ritmo.', 'Sabiduría zen'],
  ['Tú también eres parte del bienestar que se respira aquí.', 'Frase del día'],
  ['Empieza donde estás, usa lo que tienes, haz lo que puedas.', 'Frase popular'],
  ['La generosidad es la riqueza que más se multiplica.', 'Proverbio popular'],
  ['El mejor maquillaje es una buena noche de descanso.', 'Frase del día'],
  ['Mueve el cuerpo, aquieta la mente.', 'Enseñanza del yoga'],
  ['Hoy alguien saldrá de aquí sintiéndose mejor gracias a ti.', 'Frase del día'],
  ['La amabilidad nunca pasa de moda.', 'Frase del día'],
  ['Para florecer hace falta luz, agua y paciencia.', 'Sabiduría popular'],
  ['Las manos expertas se hicieron con miles de repeticiones.', 'Frase del día'],
  ['Disfruta del camino: la meta es solo una parte.', 'Proverbio oriental'],
  ['Si hoy cuesta, recuerda por qué empezaste.', 'Frase del día']
];
const FRASES_FESTIVO = [
  ['Trabajar hoy, festivo, te dará un día libre cuando más te convenga.', 'Hoy es festivo'],
  ['Hoy trabajas tú para que mañana libres tú.', 'Hoy es festivo'],
  ['Un festivo trabajado es un día normal ganado para tu descanso.', 'Hoy es festivo'],
  ['El trabajo de hoy es la calidad de vida de mañana.', 'Hoy es festivo'],
  ['Mientras otros descansan, tú siembras tu próximo día libre.', 'Hoy es festivo'],
  ['Hoy es festivo y estás aquí: gracias. Ese esfuerzo también vuelve.', 'Hoy es festivo'],
  ['Hoy por ti, mañana libre para ti.', 'Hoy es festivo'],
  ['Los clientes de hoy también tienen fiesta: hagamos que la disfruten.', 'Hoy es festivo'],
  ['Trabaja hoy con calma y disfruta mañana con ganas.', 'Hoy es festivo'],
  ['Un día distinto merece un ánimo distinto: hoy toca brillar.', 'Hoy es festivo']
];
function saludo() { const h = new Date().getHours(); return h >= 6 && h < 14 ? 'Buenos días' : h >= 14 && h < 21 ? 'Buenas tardes' : 'Buenas noches'; }
function nombreSaludo() { if (esRecepcion()) return 'Recepción'; return (yo()?.nombre || '').split(' ')[0]; }
// saca frases de una "bolsa" barajada: no se repite ninguna hasta que han salido todas
function deLaBolsa(clave, n) {
  let bolsa = [];
  try { bolsa = JSON.parse(localStorage.getItem(clave) || '[]').filter(i => Number.isInteger(i) && i < n); } catch (e) { }
  if (!bolsa.length) { bolsa = [...Array(n).keys()]; for (let i = n - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [bolsa[i], bolsa[j]] = [bolsa[j], bolsa[i]]; } }
  const i = bolsa.pop();
  try { localStorage.setItem(clave, JSON.stringify(bolsa)); } catch (e) { }
  return i;
}
const esCumple = (t, d = new Date()) => { if (!t || !t.fecha_nacimiento) return false; const [, m, dd] = String(t.fecha_nacimiento).split('-').map(Number); return m === d.getMonth() + 1 && dd === d.getDate(); };
function festivoTrabajado(k) {
  const e = (S.especiales || {})[k], base = (S.horario || {})[isoDia(k)];
  return !!(e && e.abierto && ((base && !base.abierto) || /festiv/i.test(e.motivo || '')));
}
function elegirFrase() {
  const hoy = new Date(), m = hoy.getMonth() + 1, d = hoy.getDate(), y = hoy.getFullYear(), k = dkey(hoy);
  const nom = nombreSaludo(), quien = esRecepcion() ? '' : ', ' + nom;
  S.cumple = !esRecepcion() && esCumple(yo());
  if (S.cumple) { S.frase = [`Hoy es tu día. Que este año te traiga salud, calma y muchas alegrías.`, 'De parte de todo el equipo', 'cumple']; return; }
  const cumpleHoy = esRecepcion() ? S.trabajadores.filter(t => t.activo && esCumple(t)) : [];
  if (cumpleHoy.length) { S.frase = [`Hoy es el cumpleaños de ${cumpleHoy.map(t => t.nombre).join(' y ')}. ¡No olvidéis felicitar${cumpleHoy.length > 1 ? 'les' : 'le'}!`, 'Cumpleaños en el equipo', 'cumple']; return; }
  if (m === 12 && (d === 24 || d === 25)) { S.frase = [`¡Feliz Navidad${quien}! Que estos días vengan llenos de paz y buenos momentos.`, 'Navidad', 'fiesta']; return; }
  if (m === 12 && d === 31) { S.frase = [`Último día del año: gracias por cada cita, cada sonrisa y cada esfuerzo. ¡Feliz salida de año!`, 'Fin de año', 'fiesta']; return; }
  if (m === 1 && d <= 5) { S.frase = [`¡Feliz Año ${y}${quien}! Que este año venga cargado de salud, equilibrio y buenos proyectos.`, 'Año Nuevo', 'fiesta']; return; }
  if (m === 1 && d === 6) { S.frase = [`¡Felices Reyes${quien}! Que hoy os traigan descanso, ilusión y algún buen regalo.`, 'Día de Reyes', 'fiesta']; return; }
  if (festivoTrabajado(k)) { S.frase = FRASES_FESTIVO[deLaBolsa('agenda-frases-festivo', FRASES_FESTIVO.length)].concat('festivo'); return; }
  S.frase = FRASES[deLaBolsa('agenda-frases', FRASES.length)];
}
/* ================= estructura ================= */
const LOGO = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/><path d="M8 14h3M13 14h3M8 17h3" stroke-linecap="round"/></svg>';
const ICONOS = {
  agenda: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>',
  clientes: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="8.5" r="3.5"/><path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5"/></svg>',
  facturacion: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
  ajustes: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/></svg>',
  cuenta: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="10" r="3"/><path d="M6.5 18c1.4-2 3.3-3 5.5-3s4.1 1 5.5 3"/></svg>'
};
const BELL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>';
function pestañas() {
  if (esRecepcion()) return [['agenda', 'Agenda'], ['clientes', 'Clientes'], ['facturacion', 'Facturación'], ['ajustes', 'Ajustes']];
  const t = [['agenda', 'Mis citas'], ['clientes', 'Mis clientes']];
  if (S.puedeFacturar) t.push(['facturacion', 'Facturación']);
  t.push(['cuenta', 'Cuenta']);
  return t;
}
function render() {
  $('#app').innerHTML = `<div class="wrap">
    <header class="top"><div class="logo">${LOGO}</div>
      <div class="t"><h1>${S.cumple ? '¡Feliz cumpleaños, ' + esc(nombreSaludo()) + '!' : saludo() + (nombreSaludo() ? ', ' + esc(nombreSaludo()) : '')}</h1><small>${esc(S.ajustes.nombre_centro || 'Mi centro')}${esRecepcion() ? ' · Recepción' : ''}${DEMO ? ' · <span class="demo-tag">Demo</span>' : ''}</small></div>
      <button class="bell" id="bell" aria-label="Avisos" onclick="abrirAvisos()">${BELL}<b id="bell-n" hidden></b></button>
    </header>
    ${S.frase ? (S.frase[2] ? `<p class="frase especial ${S.frase[2]}">${esc(S.frase[0])} <span>— ${esc(S.frase[1])}</span></p>` : `<p class="frase">«${esc(S.frase[0])}» <span>— ${esc(S.frase[1])}</span></p>`) : ''}
    <main id="view"></main></div>
    <nav class="tabs" aria-label="Secciones">${pestañas().map(([k, l]) => `<button data-tab="${k}" aria-current="${S.tab === k ? 'page' : 'false'}" onclick="irA('${k}')">${ICONOS[k]}${l}</button>`).join('')}</nav>`;
  renderVista(); pintarCampana();
}
function irA(t) { S.tab = t; closeSheet(); render(); window.scrollTo(0, 0); }
function renderVista() {
  const v = $('#view'); if (!v) return;
  const f = { agenda: vistaAgenda, clientes: vistaClientes, facturacion: vistaFacturacion, ajustes: vistaAjustes, cuenta: vistaCuenta }[S.tab] || vistaAgenda;
  v.innerHTML = f();
  if (S.tab === 'facturacion') cargarFacturacion();
  if (S.tab === 'ajustes') cargarVinculados();
}
function pintarCampana() {
  const n = misAvisos().length, b = $('#bell-n');
  if (!b) return;
  b.hidden = !n; b.textContent = n > 99 ? '99+' : n;
}

/* ================= agenda ================= */
const PX = 28; // píxeles por 15 minutos
const VISTAS = { dia: 'Día', semana: 'Semana', mes: 'Mes', anio: 'Año' };
const DSEM = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const lunesDe = k => { const d = new Date(k + 'T12:00'); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return dkey(d); };
function rangoAgenda() {
  const d = new Date(S.day + 'T12:00');
  if (S.vista === 'semana') { const a = lunesDe(S.day); return { a: startOf(a), b: startOf(addDays(a, 7)) }; }
  if (S.vista === 'mes') return { a: new Date(d.getFullYear(), d.getMonth(), 1), b: new Date(d.getFullYear(), d.getMonth() + 1, 1) };
  if (S.vista === 'anio') return { a: new Date(d.getFullYear(), 0, 1), b: new Date(d.getFullYear() + 1, 0, 1) };
  return { a: startOf(S.day), b: startOf(addDays(S.day, 1)) };
}
function etiquetaAgenda() {
  const d = new Date(S.day + 'T12:00');
  if (S.vista === 'semana') { const a = new Date(lunesDe(S.day) + 'T12:00'), e = new Date(a); e.setDate(e.getDate() + 6); return `${fechaCorta(a)} – ${fechaCorta(e)} ${e.getFullYear()}`; }
  if (S.vista === 'mes') return d.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
  if (S.vista === 'anio') return String(d.getFullYear());
  return d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
}
function moverAgenda(n) {
  const d = new Date(S.day + 'T12:00');
  if (S.vista === 'semana') d.setDate(d.getDate() + 7 * n);
  else if (S.vista === 'mes') d.setMonth(d.getMonth() + n, 1);
  else if (S.vista === 'anio') d.setFullYear(d.getFullYear() + n, 0, 1);
  else d.setDate(d.getDate() + n);
  S.day = dkey(d); recargarDia();
}
function cambiarVista(v) { S.vista = v; try { localStorage.setItem('agenda-vista', v); } catch (e) { } recargarDia(); }
function irADia(k) { S.day = k; S.vista = 'dia'; recargarDia(); }
function columnas() {
  if (!esRecepcion()) return [yo()].filter(Boolean);
  const conCita = new Set(S.citas.filter(c => c.estado !== 'cancelada').map(c => c.trabajador_id));
  return S.trabajadores.filter(t => (t.activo || conCita.has(t.id)) && (!S.filtroAct || (S.tAct[t.id] && S.tAct[t.id].has(S.filtroAct))) && (!S.filtroTrab || t.id === S.filtroTrab));
}
// citas que se muestran en semana/mes/año según los filtros
function citasFiltradas() {
  const ids = new Set(columnas().map(t => t.id));
  return S.citas.filter(c => c.estado !== 'cancelada' && ids.has(c.trabajador_id));
}
// reparte las citas que se solapan en carriles para que no se tapen
function carriles(lista) {
  const res = new Map(); let grupo = [], finGrupo = 0;
  const cerrar = () => { const fin = []; grupo.forEach(c => { const s = +new Date(c.inicio); let i = fin.findIndex(f => f <= s); if (i < 0) { i = fin.length; fin.push(0); } fin[i] = +new Date(c.fin); res.set(c.id, { i }); }); grupo.forEach(c => res.get(c.id).n = fin.length); grupo = []; };
  [...lista].sort((x, y) => x.inicio.localeCompare(y.inicio)).forEach(c => { const s = +new Date(c.inicio); if (grupo.length && s >= finGrupo) cerrar(); grupo.push(c); finGrupo = Math.max(finGrupo, +new Date(c.fin)); });
  if (grupo.length) cerrar();
  return res;
}
function bloqueCita(c, OPEN, extra = '', conTrab = false) {
  const s = srv(c.servicio_id), a = act(s.actividad_id), ini = new Date(c.inicio), fin = new Date(c.fin);
  const m0 = ini.getHours() * 60 + ini.getMinutes(), dur = (fin - ini) / 60000;
  const top = Math.max(0, (m0 - OPEN) / 15 * PX), h = Math.max(dur / 15 * PX - 2, 22);
  const pend = S.avisos.filter(x => x.cita_id === c.id && !x.leido_en);
  const nueva = pend.some(paraMi), sinConf = esRecepcion() && pend.some(x => x.para_rol === 'trabajador');
  const choque = S.choques.has(c.id);
  const cls = [c.estado === 'realizada' ? 'realizada' : '', c.estado === 'no vino' ? 'novino' : '', choque ? 'choque' : ''].join(' ');
  const flags = [choque ? '<span class="flag red">Cabina compartida</span>' : '', nueva ? '<span class="flag new">Nueva</span>' : '', sinConf ? '<span class="flag wait">Sin confirmar</span>' : ''].join(' ');
  return `<button class="appt ${cls}" style="--c:${esc(a.color)};top:${top}px;height:${h}px;${extra}" onclick="event.stopPropagation();abrirCita('${c.id}')">
    <b>${hhmm(ini)} ${esc(cli(c.cliente_id).nombre)}</b><span>${conTrab ? esc(trab(c.trabajador_id).nombre) + ' · ' : ''}${esc(nombreCita(c))}</span><span>${esc(cab(c.cabina_id).nombre)}${c.estado !== 'confirmada' ? ' · ' + ESTADOS[c.estado] : ''}</span>${flags}</button>`;
}
function horasGrid(OPEN, CLOSE) { let h = ''; for (let m = OPEN; m < CLOSE; m += 60) h += `<span style="top:${(m - OPEN) / 15 * PX}px">${minToT(m)}</span>`; return h; }
function lineaAhora(OPEN, CLOSE, left = '48px', width = null) {
  const n = new Date(), m = n.getHours() * 60 + n.getMinutes();
  if (m < OPEN || m > CLOSE) return '';
  return `<div class="now" style="top:${(m - OPEN) / 15 * PX}px;left:${left};${width ? 'right:auto;width:' + width : ''}"></div>`;
}

function vistaAgenda() {
  const lista = S.vista === 'dia' ? null : citasFiltradas();
  const visibles = S.vista === 'dia' ? S.citas.filter(c => c.estado !== 'cancelada' && columnas().some(t => t.id === c.trabajador_id)) : lista;
  const prevision = visibles.filter(c => c.estado === 'confirmada').reduce((s, c) => s + precioCita(c), 0);
  const nChoques = visibles.filter(c => S.choques.has(c.id)).length;
  const cuerpo = { dia: cuerpoDia, semana: cuerpoSemana, mes: cuerpoMes, anio: cuerpoAnio }[S.vista] || cuerpoDia;
  return `
  <div class="chips" style="padding-top:8px">${Object.entries(VISTAS).map(([k, v]) => `<button aria-pressed="${S.vista === k}" onclick="cambiarVista('${k}')">${v}</button>`).join('')}</div>
  <div class="daybar">
    <button class="iconbtn" aria-label="Anterior" onclick="moverAgenda(-1)">‹</button>
    <div class="date">${esc(etiquetaAgenda())}</div>
    <button class="iconbtn" aria-label="Siguiente" onclick="moverAgenda(1)">›</button>
  </div>
  <div class="toolbar">
    <button class="pill" onclick="irHoy()">Hoy</button>
    <input type="date" id="pick-day" class="pill" value="${S.day}" onchange="if(this.value){S.day=this.value;recargarDia()}" aria-label="Elegir fecha">
    ${esRecepcion() && S.vista !== 'dia' ? `<select id="f-trab-filtro" class="pill" onchange="S.filtroTrab=this.value;renderVista()" aria-label="Filtrar por trabajador"><option value="">Todo el equipo</option>${S.trabajadores.filter(t => t.activo).map(t => `<option value="${t.id}" ${S.filtroTrab === t.id ? 'selected' : ''}>${esc(t.nombre)}</option>`).join('')}</select>` : ''}
    <span class="grow"></span>
    <button class="ghost" onclick="nuevoBloqueo()">Bloquear horas</button>
    <button class="primary" onclick="abrirFormulario()">+ Cita</button>
  </div>
  <div class="summary" style="padding-bottom:10px"><span><b>${visibles.length}</b> ${visibles.length === 1 ? 'cita' : 'citas'}</span>${S.puedeFacturar ? `<span>Previsto <b>${eur(prevision)}</b></span>` : ''}${nChoques ? `<span class="bad"><b class="bad">${nChoques}</b> en cabina compartida</span>` : ''}</div>
  ${esRecepcion() && S.actividades.length > 1 ? `<div class="chips"><button aria-pressed="${!S.filtroAct}" onclick="S.filtroAct='';renderVista()">Todas las actividades</button>${S.actividades.filter(a => a.activa).map(a => `<button aria-pressed="${S.filtroAct === a.id}" onclick="S.filtroAct='${a.id}';renderVista()"><i style="background:${esc(a.color)}"></i>${esc(a.nombre)}</button>`).join('')}</div>` : ''}
  ${cuerpo(lista)}
  <div class="legend">${S.actividades.filter(a => a.activa).map(a => `<span><i style="width:10px;height:10px;border-radius:3px;background:${esc(a.color)};display:inline-block"></i>${esc(a.nombre)}</span>`).join('')}<span><span class="flag red" style="margin:0">Cabina compartida</span></span><span><span class="bloq-ley"></span>Bloqueado</span><span><span class="cerr-ley"></span>Cerrado o festivo</span>${esRecepcion() ? '<span><span class="flag wait" style="margin:0">Sin confirmar</span> el trabajador aún no ha pulsado «Recibido»</span>' : ''}</div>
  <p class="note">${S.vista === 'dia' || S.vista === 'semana' ? 'Toca un hueco libre para crear una cita a esa hora.' : 'Toca un día para verlo en detalle.'} Los cambios aparecen al momento en todos los dispositivos.</p>`;
}

function cuerpoDia() {
  const cols = columnas(), [OPEN, CLOSE] = limites([S.day], S.citas), H = (CLOSE - OPEN) / 15 * PX;
  const visibles = S.citas.filter(c => c.estado !== 'cancelada' && cols.some(t => t.id === c.trabajador_id));
  const canceladas = S.citas.filter(c => c.estado === 'cancelada');
  if (!cols.length) return `<div class="list"><p class="row muted">${esRecepcion() ? 'No hay trabajadores con este filtro. Añádelos en Ajustes → Equipo.' : 'Tu ficha de trabajador no está activa. Habla con recepción.'}</p></div>`;
  const htmlCols = cols.map(t => `<div class="col" style="height:${H}px" onclick="clicHueco(event,'${t.id}')">${sombras(S.day, OPEN, CLOSE)}${capasBloqueo(bloqueosDe(t.id, S.day), S.day, OPEN, CLOSE)}${visibles.filter(c => c.trabajador_id === t.id).map(c => bloqueCita(c, OPEN)).join('')}</div>`).join('');
  return `${bannerDia(S.day)}<div class="gridwrap"><div class="grid" style="--cols:${cols.length};--hour:${4 * PX}px">
    <div class="ghead"><div></div>${cols.map(t => `<div>${esc(t.nombre)}<small>${esc([...(S.tAct[t.id] || [])].map(id => act(id).nombre).join(', ') || 'Sin actividad')}</small></div>`).join('')}</div>
    <div class="gbody"><div class="times" style="height:${H}px">${horasGrid(OPEN, CLOSE)}</div>${htmlCols}${S.day === dkey(new Date()) ? lineaAhora(OPEN, CLOSE) : ''}</div>
  </div></div>
  ${canceladas.length ? `<div class="sect">Canceladas este día (${canceladas.length})</div><div class="list">${canceladas.map(c => `<button class="row" onclick="abrirCita('${c.id}')"><span class="main"><b>${hhmm(new Date(c.inicio))} · ${esc(cli(c.cliente_id).nombre)}</b><small>${esc(nombreCita(c))} · ${esc(trab(c.trabajador_id).nombre)}</small></span></button>`).join('')}</div>` : ''}`;
}

function cuerpoSemana(lista) {
  const lunes = lunesDe(S.day), hoy = dkey(new Date());
  const dias = [...Array(7)].map((_, i) => addDays(lunes, i));
  const [OPEN, CLOSE] = limites(dias, lista), H = (CLOSE - OPEN) / 15 * PX;
  const varios = esRecepcion() && !S.filtroTrab;
  const cols = dias.map(k => {
    const delDia = lista.filter(c => dkey(new Date(c.inicio)) === k), car = carriles(delDia);
    const bloques = delDia.map(c => { const l = car.get(c.id) || { i: 0, n: 1 }; const w = 100 / l.n; return bloqueCita(c, OPEN, `left:calc(${l.i * w}% + 2px);right:auto;width:calc(${w}% - 4px)`, varios); }).join('');
    return `<div class="col" style="height:${H}px" onclick="clicHueco(event,'${S.filtroTrab || (esRecepcion() ? '' : S.meId)}','${k}')">${sombras(k, OPEN, CLOSE)}${capasBloqueo((S.bloqueos || []).filter(x => columnas().some(t => t.id === x.trabajador_id) && bloqueosDe(x.trabajador_id, k).includes(x)), k, OPEN, CLOSE, varios)}${bloques}</div>`;
  }).join('');
  const iHoy = dias.indexOf(hoy);
  return `<div class="gridwrap"><div class="grid semana" style="--cols:7;--hour:${4 * PX}px">
    <div class="ghead"><div></div>${dias.map(k => { const d = new Date(k + 'T12:00'); return `<div class="${k === hoy ? 'hoy' : ''}"><button class="dayhead" onclick="irADia('${k}')">${d.toLocaleDateString('es-ES', { weekday: 'short' })} <b>${d.getDate()}</b></button>${horarioDe(k).abierto ? `<small>${(n => n ? n + (n === 1 ? ' cita' : ' citas') : 'Libre')(lista.filter(c => dkey(new Date(c.inicio)) === k).length)}${horarioDe(k).especial ? ' · ' + horarioDe(k).ap + '–' + horarioDe(k).ci : ''}</small>` : `<small class="cerr">${esc(horarioDe(k).motivo || 'Cerrado')}</small>`}</div>`; }).join('')}</div>
    <div class="gbody"><div class="times" style="height:${H}px">${horasGrid(OPEN, CLOSE)}</div>${cols}${iHoy >= 0 ? lineaAhora(OPEN, CLOSE, `calc(48px + (100% - 48px) / 7 * ${iHoy})`, 'calc((100% - 48px) / 7)') : ''}</div>
  </div></div>`;
}

function cuerpoMes(lista) {
  const d = new Date(S.day + 'T12:00'), y = d.getFullYear(), m = d.getMonth(), hoy = dkey(new Date());
  const primero = dkey(new Date(y, m, 1, 12)), inicio = lunesDe(primero);
  const ultimo = new Date(y, m + 1, 0, 12), semanas = Math.ceil((((new Date(primero + 'T12:00').getDay() + 6) % 7) + ultimo.getDate()) / 7);
  const porDia = {}; lista.forEach(c => (porDia[dkey(new Date(c.inicio))] = porDia[dkey(new Date(c.inicio))] || []).push(c));
  let celdas = '';
  for (let i = 0; i < semanas * 7; i++) {
    const k = addDays(inicio, i), dd = new Date(k + 'T12:00'), fuera = dd.getMonth() !== m;
    const cs = (porDia[k] || []).sort((a, b) => a.inicio.localeCompare(b.inicio)), ch = cs.some(c => S.choques.has(c.id));
    const hd = horarioDe(k);
    celdas += `<button class="mcell ${fuera ? 'fuera' : ''} ${k === hoy ? 'hoy' : ''} ${hd.abierto ? '' : 'cerrada'}" onclick="irADia('${k}')" aria-label="${dd.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })}: ${cs.length} citas">
      <span class="mnum">${dd.getDate()}${ch ? '<i class="mdot" title="Cabina compartida"></i>' : ''}</span>
      ${(b => b.length ? `<span class="mtag bl">Bloqueo: ${esc([...new Set(b.map(x => trab(x.trabajador_id).nombre))].join(', '))}</span>` : '')(bloqueosDe('', k).filter(x => columnas().some(t => t.id === x.trabajador_id)))}
      ${!hd.abierto ? `<span class="mtag">${esc(hd.especial ? (hd.motivo || 'Festivo') : 'Cerrado')}</span>` : hd.especial ? `<span class="mtag ab">${hd.ap}–${hd.ci}</span>` : ''}
      ${cs.slice(0, 3).map(c => `<span class="mline" style="--c:${esc(act(srv(c.servicio_id).actividad_id).color)}">${hhmm(new Date(c.inicio))} ${esc(esRecepcion() && !S.filtroTrab ? trab(c.trabajador_id).nombre : cli(c.cliente_id).nombre)}</span>`).join('')}
      ${cs.length > 3 ? `<span class="mmore">+${cs.length - 3} más</span>` : ''}
      ${cs.length ? `<span class="mcount">${cs.length}</span>` : ''}</button>`;
  }
  return `<div class="month"><div class="mhead">${DSEM.map(x => `<span>${x}</span>`).join('')}</div><div class="mgrid">${celdas}</div></div>`;
}

function cuerpoAnio(lista) {
  const y = new Date(S.day + 'T12:00').getFullYear(), hoy = dkey(new Date());
  const porDia = {}; lista.forEach(c => { const k = dkey(new Date(c.inicio)); porDia[k] = (porDia[k] || 0) + 1; });
  const max = Math.max(1, ...Object.values(porDia));
  const meses = [...Array(12)].map((_, m) => {
    const primero = new Date(y, m, 1, 12), hueco = (primero.getDay() + 6) % 7, nd = new Date(y, m + 1, 0).getDate();
    let total = 0, celdas = '<span></span>'.repeat(hueco);
    for (let dd = 1; dd <= nd; dd++) {
      const k = dkey(new Date(y, m, dd, 12)), n = porDia[k] || 0; total += n;
      const nivel = n ? Math.min(4, Math.ceil(n / max * 4)) : 0;
      const hd = horarioDe(k); celdas += `<button class="ycell n${nivel} ${k === hoy ? 'hoy' : ''} ${hd.abierto ? '' : 'cerrada'}" onclick="irADia('${k}')" title="${dd}: ${hd.abierto ? n + ' citas' : esc(hd.motivo || 'Cerrado')}" aria-label="${dd} de ${primero.toLocaleDateString('es-ES', { month: 'long' })}: ${n} citas">${dd}</button>`;
    }
    return `<div class="ymonth"><button class="yname" onclick="S.day='${dkey(primero)}';cambiarVista('mes')">${primero.toLocaleDateString('es-ES', { month: 'long' })}<small>${total === 1 ? '1 cita' : total + ' citas'}</small></button>
      <div class="yhead">${DSEM.map(x => `<span>${x}</span>`).join('')}</div><div class="ygrid">${celdas}</div></div>`;
  }).join('');
  return `<div class="year">${meses}</div>
  <div class="legend"><span>Menos</span>${[0, 1, 2, 3, 4].map(n => `<span class="ycell n${n}" style="width:16px;height:16px;padding:0"></span>`).join('')}<span>Más citas</span><span class="ycell cerrada" style="width:16px;height:16px;padding:0"></span><span>Cerrado o festivo</span></div>`;
}

async function recargarDia() { await cargarDia(); renderVista(); }
function cambiarDia(n) { moverAgenda(n); }
function irHoy() { S.day = dkey(new Date()); recargarDia(); }
function clicHueco(e, tid, fecha) {
  const k = fecha || S.day;
  const [OPEN, CLOSE] = S.vista === 'semana' ? limites([...Array(7)].map((_, i) => addDays(lunesDe(S.day), i)), S.citas) : limites([S.day], S.citas);
  const r = e.currentTarget.getBoundingClientRect();
  let m = OPEN + Math.floor((e.clientY - r.top) / PX) * 15;
  m = Math.min(Math.max(m, OPEN), CLOSE - 15);
  if (fueraDeHorario(k, m, m + 15)) { avisoCerrado(k); return; }
  const tq = tid || (esRecepcion() ? '' : S.meId), bq = tq && bloqueoEn(tq, k, m, m + 15);
  if (bq) { abrirBloqueo(bq.id); return; }
  abrirFormulario(null, { hora: minToT(m), trabajador_id: tid || '', fecha: k });
}


/* ================= horario y festivos ================= */
const NOMBRE_DIA = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const isoDia = k => ((new Date(k + 'T12:00').getDay() + 6) % 7) + 1;
const fechaLarga = k => new Date(k + 'T12:00').toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
const t5 = t => t ? String(t).slice(0, 5) : '';
async function cargarHorario() {
  const [h, e] = await Promise.all([sb.from('horario_semanal').select('*'), sb.from('dias_especiales').select('*').order('fecha')]);
  S.horarioOK = !h.error && !e.error;
  S.horario = {}; (h.data || []).forEach(r => S.horario[r.dia] = r);
  S.especiales = {}; (e.data || []).forEach(r => S.especiales[r.fecha] = r);
}
function horarioDe(k) {
  const e = (S.especiales || {})[k];
  if (e) return { abierto: e.abierto, ap: t5(e.apertura), ci: t5(e.cierre), motivo: e.motivo || '', especial: true };
  const h = (S.horario || {})[isoDia(k)];
  if (h) return { abierto: h.abierto, ap: t5(h.apertura), ci: t5(h.cierre), motivo: '', especial: false };
  return { abierto: true, ap: t5(S.ajustes.hora_apertura || '09:00'), ci: t5(S.ajustes.hora_cierre || '21:00'), motivo: '', especial: false };
}
function textoHorario(k) {
  const h = horarioDe(k);
  if (!h.abierto) return h.especial ? 'Cerrado' + (h.motivo ? ' · ' + h.motivo : '') : `Cerrado (${NOMBRE_DIA[isoDia(k)].toLowerCase()})`;
  return `${h.ap}–${h.ci}` + (h.especial ? ' · ' + (h.motivo || 'horario especial') : '');
}
function fueraDeHorario(k, m0, m1) { const h = horarioDe(k); return !h.abierto || m0 < toMin(h.ap) || m1 > toMin(h.ci); }
// franja horaria que se dibuja: la del horario de esos días, ampliada si hay citas fuera
function limites(dias, citas = []) {
  let o = Infinity, c = -Infinity;
  dias.forEach(k => { const h = horarioDe(k); if (h.abierto) { o = Math.min(o, toMin(h.ap)); c = Math.max(c, toMin(h.ci)); } });
  citas.filter(x => x.estado !== 'cancelada').forEach(x => { const i = new Date(x.inicio), f = new Date(x.fin); o = Math.min(o, i.getHours() * 60 + i.getMinutes()); c = Math.max(c, f.getHours() * 60 + f.getMinutes()); });
  if (!isFinite(o)) { o = toMin(S.ajustes.hora_apertura || '09:00'); c = toMin(S.ajustes.hora_cierre || '21:00'); }
  o = Math.max(0, Math.floor(o / 60) * 60); c = Math.min(1440, Math.ceil(c / 60) * 60);
  if (c - o < 180) c = Math.min(1440, o + 180);
  return [o, c];
}
// zonas cerradas pintadas sobre una columna de la agenda
function sombras(k, OPEN, CLOSE) {
  const h = horarioDe(k), px = m => (m - OPEN) / 15 * PX;
  if (!h.abierto) return `<div class="cerrado todo"><span>${esc(h.especial ? (h.motivo || 'Festivo') : 'Cerrado')}</span></div>`;
  let s = ''; const a = toMin(h.ap), c = toMin(h.ci);
  if (a > OPEN) s += `<div class="cerrado" style="top:0;height:${px(a)}px"></div>`;
  if (c < CLOSE) s += `<div class="cerrado" style="top:${px(c)}px;height:${px(CLOSE) - px(c)}px"></div>`;
  return s;
}
function bannerDia(k) {
  if (!S.horarioOK && !esRecepcion()) return '';
  const h = horarioDe(k), rec = esRecepcion();
  const cls = !h.abierto ? 'daystate cerr' : h.especial ? 'daystate esp' : 'daystate';
  const txt = !h.abierto ? `<b>${esc(h.especial ? (h.motivo || 'Festivo') : 'Cerrado')}</b> · no se pueden coger citas este día`
    : `<b>${h.especial ? esc(h.motivo || 'Horario especial') : 'Horario'}</b> ${h.ap}–${h.ci}`;
  const btn = rec ? `<button class="pill" onclick="abrirHorarioDia('${k}')">${!h.abierto ? 'Abrir este día' : 'Cambiar horario de este día'}</button>` : '';
  return `<div class="${cls}"><span>${txt}</span>${btn}</div>`;
}
async function avisoCerrado(k) {
  const h = horarioDe(k);
  const txt = !h.abierto ? `El ${fechaLarga(k)} está cerrado${h.motivo ? ' (' + h.motivo + ')' : ''}.` : `Esa hora queda fuera del horario del ${fechaLarga(k)} (${h.ap}–${h.ci}).`;
  if (!esRecepcion()) { toast(txt + ' Habla con recepción.'); return; }
  if (await preguntar('Fuera de horario', txt + ' ¿Quieres cambiar el horario de ese día?', 'Cambiar horario', 'Cancelar')) abrirHorarioDia(k);
}
function sinTablasHorario() {
  sheet(`<h3>Falta un paso en la base de datos</h3><p>Para usar horarios y festivos, ejecuta en Supabase → SQL Editor el archivo <b>actualizacion-1-horarios-y-ejemplos.sql</b> del repositorio.</p>
    <div class="actions"><button class="primary" onclick="closeSheet()">Entendido</button></div>`);
}
async function abrirHorarioDia(k, volver = false) {
  if (!S.horarioOK) return sinTablasHorario();
  const e = S.especiales[k], base = S.horario[isoDia(k)];
  const normal = base ? (base.abierto ? `${t5(base.apertura)}–${t5(base.cierre)}` : 'cerrado') : '—';
  const modo = !e ? 'normal' : (e.abierto ? 'especial' : 'cerrado');
  const a = startOf(k), b = startOf(addDays(k, 1));
  const r = await sb.from('citas').select('id').eq('estado', 'confirmada').gte('inicio', a.toISOString()).lt('inicio', b.toISOString());
  const n = (r.data || []).length;
  sheet(`<h3 style="text-transform:none">${esc(fechaLarga(k))}</h3>
    <p class="muted" style="margin:0">Horario habitual de este día de la semana (${NOMBRE_DIA[isoDia(k)].toLowerCase()}): <b>${normal}</b></p>
    <div class="field"><span class="flabel">¿Cómo queda este día?</span><div class="seg" id="hd-seg">
      <button type="button" data-m="normal" aria-pressed="${modo === 'normal'}">Horario habitual</button>
      <button type="button" data-m="cerrado" aria-pressed="${modo === 'cerrado'}">Cerrado / festivo</button>
      <button type="button" data-m="especial" aria-pressed="${modo === 'especial'}">Horario especial</button></div></div>
    <div id="hd-cerrado" ${modo === 'cerrado' ? '' : 'hidden'}>
      <div class="field"><label for="hd-motivo-c">Motivo</label><input id="hd-motivo-c" value="${esc(e && !e.abierto ? e.motivo || '' : '')}" placeholder="Festivo, vacaciones, formación…"></div>
      ${n ? `<div class="box warnb">Hay <b>${n} ${n === 1 ? 'cita confirmada' : 'citas confirmadas'}</b> este día. No se anulan solas: revísalas en la agenda.</div>` : ''}
    </div>
    <div id="hd-especial" ${modo === 'especial' ? '' : 'hidden'}>
      <div class="two"><div class="field"><label for="hd-ap">Abre</label><input id="hd-ap" type="time" step="900" value="${t5(e && e.abierto ? e.apertura : (base ? base.apertura : '09:00')) || '09:00'}"></div>
        <div class="field"><label for="hd-ci">Cierra</label><input id="hd-ci" type="time" step="900" value="${t5(e && e.abierto ? e.cierre : (base && base.abierto ? base.cierre : '14:00')) || '14:00'}"></div></div>
      <div class="field"><label for="hd-motivo-e">Motivo (opcional)</label><input id="hd-motivo-e" value="${esc(e && e.abierto ? e.motivo || '' : '')}" placeholder="Apertura especial, campaña de Navidad…"></div>
      <p class="muted" style="font-size:13px;margin:8px 0 0">Sirve para abrir un día que normalmente está cerrado o para alargar el horario después del cierre.</p>
    </div>
    <div class="err" id="hd-err"></div>
    <div class="actions"><button class="ghost" onclick="${volver ? 'pintarFormulario()' : 'closeSheet()'}">Cancelar</button><button class="primary" id="hd-save">Guardar</button></div>`);
  let m = modo;
  document.querySelectorAll('#hd-seg [data-m]').forEach(bt => bt.onclick = () => {
    m = bt.dataset.m;
    document.querySelectorAll('#hd-seg [data-m]').forEach(x => x.setAttribute('aria-pressed', x === bt));
    $('#hd-cerrado').hidden = m !== 'cerrado'; $('#hd-especial').hidden = m !== 'especial';
  });
  $('#hd-save').onclick = () => guardarHorarioDia(k, m, volver);
}
async function guardarHorarioDia(k, m, volver) {
  const err = $('#hd-err'); err.textContent = '';
  let r;
  if (m === 'normal') r = await sb.from('dias_especiales').delete().eq('fecha', k);
  else if (m === 'cerrado') r = await sb.from('dias_especiales').upsert({ fecha: k, abierto: false, apertura: null, cierre: null, motivo: $('#hd-motivo-c').value.trim() || 'Festivo' });
  else {
    const ap = $('#hd-ap').value, ci = $('#hd-ci').value;
    if (!ap || !ci || toMin(ci) <= toMin(ap)) { err.textContent = 'La hora de cierre debe ser posterior a la de apertura.'; return; }
    r = await sb.from('dias_especiales').upsert({ fecha: k, abierto: true, apertura: ap, cierre: ci, motivo: $('#hd-motivo-e').value.trim() || 'Horario especial' });
  }
  if (r.error) { err.textContent = r.error.message; return; }
  await cargarHorario();
  if (volver && F) { pintarFormulario(); toast('Horario guardado. Ya puedes guardar la cita.'); return; }
  closeSheet(); renderVista();
  toast(m === 'normal' ? 'Ese día vuelve a su horario habitual' : m === 'cerrado' ? 'Día marcado como cerrado' : 'Horario especial guardado');
}
function nuevoDiaEspecial() {
  if (!S.horarioOK) return sinTablasHorario();
  sheet(`<h3>Festivo o día especial</h3>
    <div class="field"><label for="nd-fecha">Fecha</label><input id="nd-fecha" type="date" value="${dkey(new Date())}"></div>
    <div class="actions"><button class="ghost" onclick="closeSheet()">Cancelar</button><button class="primary" onclick="if($('#nd-fecha').value)abrirHorarioDia($('#nd-fecha').value)">Continuar</button></div>`);
}
function editarHorarioSemanal() {
  if (!S.horarioOK) return sinTablasHorario();
  sheet(`<h3>Horario semanal</h3><p class="muted" style="margin:0">Es el horario normal de cada día. Los festivos y cambios puntuales se ponen aparte.</p>
    <div class="hsem">${[1, 2, 3, 4, 5, 6, 7].map(d => { const h = S.horario[d] || { abierto: d < 7, apertura: '09:00', cierre: d === 6 ? '14:00' : '21:00' }; return `
      <div class="hrow"><label class="hday"><input type="checkbox" id="hs-on-${d}" ${h.abierto ? 'checked' : ''} onchange="document.querySelectorAll('.hrow-${d} input[type=time]').forEach(i=>i.disabled=!this.checked)">${NOMBRE_DIA[d]}</label>
        <span class="hrow-${d}"><input type="time" step="900" id="hs-ap-${d}" value="${t5(h.apertura)}" ${h.abierto ? '' : 'disabled'} aria-label="${NOMBRE_DIA[d]} abre"> – <input type="time" step="900" id="hs-ci-${d}" value="${t5(h.cierre)}" ${h.abierto ? '' : 'disabled'} aria-label="${NOMBRE_DIA[d]} cierra"></span></div>`; }).join('')}</div>
    <div class="err" id="hs-err"></div>
    <div class="actions"><button class="ghost" onclick="closeSheet()">Cancelar</button><button class="primary" onclick="guardarHorarioSemanal()">Guardar</button></div>`);
}
async function guardarHorarioSemanal() {
  const filas = [1, 2, 3, 4, 5, 6, 7].map(d => ({ dia: d, abierto: $('#hs-on-' + d).checked, apertura: $('#hs-ap-' + d).value || '09:00', cierre: $('#hs-ci-' + d).value || '21:00' }));
  const mal = filas.find(f => toMin(f.cierre) <= toMin(f.apertura));
  if (mal) { $('#hs-err').textContent = `${NOMBRE_DIA[mal.dia]}: la hora de cierre debe ser posterior a la de apertura.`; return; }
  const r = await sb.from('horario_semanal').upsert(filas);
  if (r.error) { $('#hs-err').textContent = r.error.message; return; }
  await cargarHorario(); closeSheet(); renderVista(); toast('Horario semanal guardado');
}
function pascua(y) { // domingo de Pascua (calendario gregoriano)
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  return new Date(y, Math.floor((h + l - 7 * m + 114) / 31) - 1, ((h + l - 7 * m + 114) % 31) + 1, 12);
}
function festivosNacionalesDe(y) {
  const vs = pascua(y); vs.setDate(vs.getDate() - 2);
  return [[`${y}-01-01`, 'Año Nuevo'], [`${y}-01-06`, 'Epifanía del Señor'], [dkey(vs), 'Viernes Santo'], [`${y}-05-01`, 'Fiesta del Trabajo'],
    [`${y}-08-15`, 'Asunción de la Virgen'], [`${y}-10-12`, 'Fiesta Nacional de España'], [`${y}-11-01`, 'Todos los Santos'],
    [`${y}-12-06`, 'Día de la Constitución'], [`${y}-12-08`, 'Inmaculada Concepción'], [`${y}-12-25`, 'Navidad']];
}
async function festivosNacionales(y) {
  if (!S.horarioOK) return sinTablasHorario();
  const nuevos = festivosNacionalesDe(y).filter(([f]) => !S.especiales[f]);
  if (!nuevos.length) { toast(`Los festivos nacionales de ${y} ya están añadidos`); return; }
  const ok = await preguntar(`Festivos nacionales de ${y}`, `Se marcarán como cerrados ${nuevos.length} días: ${nuevos.map(([f, n]) => fechaCorta(f + 'T12:00') + ' ' + n).join(', ')}. Los autonómicos y locales añádelos a mano.`, 'Añadir', 'Cancelar');
  if (!ok) return;
  const r = await sb.from('dias_especiales').insert(nuevos.map(([f, n]) => ({ fecha: f, abierto: false, motivo: n })));
  if (r.error) { toast(r.error.message); return; }
  await cargarHorario(); renderVista(); toast(`${nuevos.length} festivos añadidos`);
}
function seccionHorario() {
  if (!S.horarioOK) return `<div class="sect">Horario y festivos</div><div class="box warnb" style="margin-top:0">Para activar el horario semanal y los festivos, ejecuta en Supabase → SQL Editor el archivo <b>actualizacion-1-horarios-y-ejemplos.sql</b> del repositorio.</div>`;
  const hoy = dkey(new Date()), y = new Date().getFullYear();
  const prox = Object.values(S.especiales).filter(e => e.fecha >= hoy).sort((a, b) => a.fecha.localeCompare(b.fecha));
  return `<div class="sect">Horario semanal<button class="pill" onclick="editarHorarioSemanal()">Editar</button></div>
  <div class="list hlist">${[1, 2, 3, 4, 5, 6, 7].map(d => { const h = S.horario[d]; return `<div class="row"><span class="main"><b>${NOMBRE_DIA[d]}</b></span><span class="end ${h && h.abierto ? '' : 'muted'}">${h ? (h.abierto ? `${t5(h.apertura)}–${t5(h.cierre)}` : 'Cerrado') : '—'}</span></div>`; }).join('')}</div>
  <div class="sect">Festivos y días especiales<button class="pill" onclick="nuevoDiaEspecial()">+ Día</button></div>
  <div class="list">${prox.slice(0, 40).map(e => `<button class="row" onclick="abrirHorarioDia('${e.fecha}')"><span class="main"><b class="cap">${esc(fechaLarga(e.fecha))}</b><small>${esc(e.motivo || '')}</small></span><span class="end ${e.abierto ? 'ok' : 'bad'}">${e.abierto ? `Abierto ${t5(e.apertura)}–${t5(e.cierre)}` : 'Cerrado'}</span></button>`).join('') || '<p class="row muted">No hay festivos ni días especiales próximos.</p>'}</div>
  <div class="actions"><button class="ghost" onclick="festivosNacionales(${y})">Festivos nacionales ${y}</button><button class="ghost" onclick="festivosNacionales(${y + 1})">Festivos nacionales ${y + 1}</button></div>
  <p class="note">Los festivos autonómicos y locales se añaden con «+ Día». Desde la agenda también puedes abrir o cerrar un día concreto, o alargar su horario.</p>`;
}


/* ================= bloqueos de trabajador ================= */
function bloqueosDe(tid, k) {
  const a = startOf(k), b = startOf(addDays(k, 1));
  return (S.bloqueos || []).filter(x => (!tid || x.trabajador_id === tid) && new Date(x.inicio) < b && new Date(x.fin) > a);
}
function bloqueoEn(tid, k, m0, m1) {
  const ini = new Date(startOf(k).getTime() + m0 * 60000), fin = new Date(startOf(k).getTime() + m1 * 60000);
  return (S.bloqueos || []).find(x => x.trabajador_id === tid && new Date(x.inicio) < fin && new Date(x.fin) > ini);
}
function textoBloqueo(x) {
  const i = new Date(x.inicio), f = new Date(x.fin), dia = startOf(dkey(i));
  const todoDia = i.getTime() === dia.getTime() && (f - i) % 864e5 === 0;
  if (todoDia) { const dias = Math.round((f - i) / 864e5); return dias === 1 ? `${fechaLarga(dkey(i))} · todo el día` : `${fechaCorta(i)} – ${fechaCorta(new Date(f - 1))} · ${dias} días`; }
  return dkey(i) === dkey(new Date(f - 1)) ? `${fechaLarga(dkey(i))} · ${hhmm(i)}–${hhmm(f)}` : `${fechaCorta(i)} ${hhmm(i)} – ${fechaCorta(f)} ${hhmm(f)}`;
}
// franjas bloqueadas sobre una columna de la agenda
function capasBloqueo(lista, k, OPEN, CLOSE, conNombre = false) {
  const base = startOf(k).getTime();
  return lista.map(x => {
    const m0 = Math.max(OPEN, Math.round((new Date(x.inicio).getTime() - base) / 60000));
    const m1 = Math.min(CLOSE, Math.round((new Date(x.fin).getTime() - base) / 60000));
    if (m1 <= m0) return '';
    return `<button class="bloq" style="top:${(m0 - OPEN) / 15 * PX}px;height:${(m1 - m0) / 15 * PX}px" onclick="event.stopPropagation();abrirBloqueo('${x.id}')">
      <span>${conNombre ? esc(trab(x.trabajador_id).nombre) + ' · ' : ''}Bloqueado${x.motivo ? ' · ' + esc(x.motivo) : ''}</span></button>`;
  }).join('');
}
function nuevoBloqueo(pre = {}) {
  if (!S.bloqueosOK) return sheet(`<h3>Falta un paso en la base de datos</h3><p>Para bloquear horas, ejecuta en Supabase → SQL Editor el archivo <b>actualizacion-1-horarios-y-ejemplos.sql</b> del repositorio.</p><div class="actions"><button class="primary" onclick="closeSheet()">Entendido</button></div>`);
  const tid = esRecepcion() ? (pre.trabajador_id || S.filtroTrab || '') : S.meId;
  const k = pre.fecha || S.day, h = horarioDe(k);
  sheet(`<h3>Bloquear horas</h3>
    <p class="muted" style="margin:0">${esRecepcion() ? 'Durante ese tiempo no se podrán dar citas a esta persona.' : 'Durante ese tiempo nadie podrá darte citas, tampoco recepción.'}</p>
    ${esRecepcion() ? `<div class="field"><label for="bq-trab">Trabajador</label><select id="bq-trab">${S.trabajadores.filter(t => t.activo).map(t => `<option value="${t.id}" ${t.id === tid ? 'selected' : ''}>${esc(t.nombre)}</option>`).join('')}</select></div>` : ''}
    <div class="two"><div class="field"><label for="bq-desde">Desde el día</label><input id="bq-desde" type="date" value="${k}"></div>
      <div class="field"><label for="bq-hasta">Hasta el día</label><input id="bq-hasta" type="date" value="${k}"></div></div>
    <label class="switch"><span><b>Todo el día</b><br><small class="muted">Desmárcalo para bloquear solo unas horas.</small></span><input type="checkbox" id="bq-todo" ${pre.hora ? '' : 'checked'}></label>
    <div class="two" id="bq-horas" ${pre.hora ? '' : 'hidden'}><div class="field"><label for="bq-ini">De</label><input id="bq-ini" type="time" step="900" value="${pre.hora || (h.abierto ? h.ap : '09:00')}"></div>
      <div class="field"><label for="bq-fin">A</label><input id="bq-fin" type="time" step="900" value="${pre.hora ? minToT(Math.min(toMin(pre.hora) + 120, 1439)) : (h.abierto ? h.ci : '14:00')}"></div></div>
    <div class="field"><label for="bq-motivo">Motivo (opcional)</label><input id="bq-motivo" placeholder="Asuntos propios, formación, vacaciones…"></div>
    <p class="muted" style="font-size:13px;margin:8px 0 0">El motivo lo ve recepción. No pongas datos de salud.</p>
    <div class="err" id="bq-err"></div>
    <div class="actions"><button class="ghost" onclick="closeSheet()">Cancelar</button><button class="primary" id="bq-save" onclick="guardarBloqueo()">Bloquear</button></div>`);
  $('#bq-todo').onchange = e => { $('#bq-horas').hidden = e.target.checked; };
  $('#bq-desde').onchange = e => { if ($('#bq-hasta').value < e.target.value) $('#bq-hasta').value = e.target.value; };
}
async function guardarBloqueo() {
  const err = $('#bq-err'); err.textContent = '';
  const tid = esRecepcion() ? $('#bq-trab').value : S.meId, desde = $('#bq-desde').value, hasta = $('#bq-hasta').value || desde;
  const todo = $('#bq-todo').checked, ini = $('#bq-ini').value, fin = $('#bq-fin').value, motivo = $('#bq-motivo').value.trim() || null;
  if (!tid) { err.textContent = 'Elige el trabajador.'; return; }
  if (!desde || hasta < desde) { err.textContent = 'Revisa las fechas: «hasta» no puede ser anterior a «desde».'; return; }
  if (!todo && (!ini || !fin || toMin(fin) <= toMin(ini))) { err.textContent = 'La hora final debe ser posterior a la inicial.'; return; }
  const filas = [];
  if (todo) filas.push({ trabajador_id: tid, inicio: startOf(desde).toISOString(), fin: startOf(addDays(hasta, 1)).toISOString(), motivo });
  else for (let k = desde; k <= hasta; k = addDays(k, 1)) filas.push({ trabajador_id: tid, inicio: new Date(k + 'T' + ini).toISOString(), fin: new Date(k + 'T' + fin).toISOString(), motivo });
  if (filas.length > 120) { err.textContent = 'Como máximo 120 días de una vez.'; return; }
  // ¿hay citas ya dadas en ese tiempo?
  const r0 = await sb.from('citas').select('id,inicio,fin').eq('trabajador_id', tid).eq('estado', 'confirmada').lt('inicio', filas[filas.length - 1].fin).gt('fin', filas[0].inicio);
  const choc = (r0.data || []).filter(c => filas.some(f => new Date(c.inicio) < new Date(f.fin) && new Date(c.fin) > new Date(f.inicio)));
  if (choc.length && !(await preguntar('Hay citas en ese tiempo', `${choc.length === 1 ? 'Hay 1 cita confirmada' : `Hay ${choc.length} citas confirmadas`} en ese tiempo. El bloqueo no las anula: ${esRecepcion() ? 'tendrás que moverlas o anularlas' : 'avisa a recepción para moverlas'}. ¿Bloquear igualmente?`, 'Bloquear', 'Cancelar'))) return;
  const r = await sb.from('bloqueos').insert(filas);
  if (r.error) { err.textContent = traducirError(r.error); return; }
  closeSheet(); await cargarDia(); renderVista();
  toast(esRecepcion() ? `Tiempo bloqueado para ${trab(tid).nombre}` : 'Tiempo bloqueado. Recepción ya no podrá darte citas en ese hueco.');
}
async function abrirBloqueo(id) {
  const x = (S.bloqueos || []).find(b => b.id === id); if (!x) return;
  const puede = esRecepcion() || x.trabajador_id === S.meId;
  sheet(`<h3>Tiempo bloqueado</h3>
    <dl class="kv"><dt>Quién</dt><dd>${esc(trab(x.trabajador_id).nombre)}</dd><dt>Cuándo</dt><dd style="text-transform:none">${esc(textoBloqueo(x))}</dd>${x.motivo ? `<dt>Motivo</dt><dd>${esc(x.motivo)}</dd>` : ''}</dl>
    <p class="muted" style="font-size:13px">En este tiempo no se pueden dar citas a ${x.trabajador_id === S.meId ? 'ti' : 'esta persona'}.</p>
    <div class="actions"><button class="ghost" onclick="closeSheet()">Cerrar</button>${puede ? `<button class="danger" onclick="quitarBloqueo('${x.id}')">Quitar bloqueo</button>` : ''}</div>`);
}
async function quitarBloqueo(id) {
  const r = await sb.from('bloqueos').delete().eq('id', id);
  if (r.error) { toast(r.error.message); return; }
  closeSheet(); await cargarDia(); renderVista(); toast('Bloqueo quitado');
}

/* ================= ficha de cita ================= */
function lineaHistorial(cid) {
  if (!esRecepcion() || !cid) return '';
  const h = S.hist[cid];
  if (!h) return '<span class="muted">Primera visita</span>';
  const nv = +h.no_vino, cls = nv >= 2 ? 'bad' : '';
  const ta = h.tarde != null ? +h.tarde : null;
  return `<span class="${cls}">${+h.visitas} visitas · ${+h.canceladas} canceladas · <b>${nv} no vino</b>${ta != null ? ` · ${ta} con retraso` : ''}${h.ultima ? ' · última: ' + fechaCorta(h.ultima) : ''}</span>${nv >= 2 ? '<br><b class="bad">Cliente con ausencias repetidas</b>' : ''}${ta >= 3 ? '<br><b class="warn">Suele llegar tarde</b>' : ''}`;
}
async function obtenerCita(id) {
  let c = S.citas.find(x => x.id === id);
  if (!c) { const r = await sb.from('citas').select('*').eq('id', id).maybeSingle(); c = r.data; }
  return c;
}
async function abrirCita(id, idiomaMsg) {
  const c = await obtenerCita(id);
  if (!c) { toast('Esa cita ya no existe o no tienes acceso'); return; }
  const s = srv(c.servicio_id), cl = cli(c.cliente_id), ini = new Date(c.inicio), fin = new Date(c.fin);
  const pend = S.avisos.filter(x => x.cita_id === c.id && !x.leido_en);
  const mio = pend.some(paraMi), sinConf = esRecepcion() && pend.some(x => x.para_rol === 'trabajador');
  let cobro = null;
  if (S.puedeFacturar && c.estado === 'realizada') { const r = await sb.from('cobros').select('*').eq('cita_id', c.id).maybeSingle(); cobro = r.data; }
  const lang = idiomaMsg || cl.idioma || 'es';
  sheet(`<h3>${esc(cl.nombre)}</h3><p class="muted" style="margin:0">${esc(nombreCita(c))} · ${esc(act(s.actividad_id).nombre)}</p>
    ${S.choques.has(c.id) ? '<div class="box red">Cabina compartida: hay otro tratamiento en esta cabina a la misma hora.</div>' : ''}
    ${mio ? `<div class="box info"><b>Cita ${pend.find(paraMi).tipo === 'nueva' ? 'nueva' : pend.find(paraMi).tipo === 'cancelada' ? 'cancelada' : 'modificada'}.</b> Confirma que la has visto.<div class="actions" style="margin-top:8px"><button class="primary" onclick="recibido('${c.id}')">Recibido</button></div></div>` : ''}
    ${sinConf ? `<div class="box warnb">${esc(trab(c.trabajador_id).nombre)} aún no ha confirmado que ha visto esta cita.</div>` : ''}
    <dl class="kv">
      <dt>Cuándo</dt><dd>${ini.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' })} · ${hhmm(ini)}–${hhmm(fin)}</dd>
      <dt>Con</dt><dd>${esc(trab(c.trabajador_id).nombre)}</dd>
      <dt>Cabina</dt><dd>${esc(cab(c.cabina_id).nombre)}</dd>
      <dt>Teléfono</dt><dd>${esc(verTel(cl.telefono, cl.pais_telefono) || '—')}</dd>${cl.fecha_nacimiento ? `<dt>Edad</dt><dd>${edad(cl.fecha_nacimiento)} años</dd>` : ''}${(cl.zonas_dolor || []).length ? `<dt>Molestias</dt><dd><div class="mapa mini">${mapaCuerpo(cl.zonas_dolor, false, 'mc-cita').replace(/<div class="zchips"[\s\S]*$/, '')}</div><b class="warn">${esc(textoZonas(cl.zonas_dolor))}</b></dd>` : ''}${cl.salud ? `<dt>Anotaciones</dt><dd class="warn"><b>${esc(cl.salud)}</b></dd>` : ''}
      ${S.puedeFacturar || c.precio != null ? `<dt>Precio</dt><dd>${eur(precioCita(c))}</dd>` : ''}
      ${c.notas ? `<dt>Notas</dt><dd>${esc(c.notas)}</dd>` : ''}
      ${esRecepcion() ? `<dt>Historial</dt><dd>${lineaHistorial(c.cliente_id)}</dd>` : ''}
    </dl>
    <div class="field"><span class="flabel">Estado</span><div class="seg">${Object.keys(ESTADOS).map(e => `<button aria-pressed="${c.estado === e}" onclick="cambiarEstado('${c.id}','${e}')">${ESTADOS[e]}</button>`).join('')}</div></div>
    ${'llego_tarde' in c && (c.estado === 'confirmada' || c.estado === 'realizada') ? `<label class="switch"><span><b>Llegó tarde</b><br><small class="muted">Cuenta en el historial del cliente.</small></span><input type="checkbox" id="c-tarde" ${c.llego_tarde ? 'checked' : ''} onchange="marcarTarde('${c.id}', this.checked)"></label>` : ''}
    ${esRecepcion() && pendienteAlta(cl) ? `<div class="box warnb">Cliente pendiente de alta: cuando llegue, pídele sus datos. <button class="linkbtn" onclick="abrirCliente('${cl.id}')">Abrir su ficha</button></div>` : ''}
    ${cobro ? `<div class="two"><div class="field"><label for="cb-imp">Cobrado (€)</label><input id="cb-imp" type="number" inputmode="decimal" step="0.01" value="${+cobro.importe}"></div>
      <div class="field"><label for="cb-met">Forma de pago</label><select id="cb-met"><option value="">—</option>${['efectivo', 'tarjeta', 'bizum', 'otro'].map(m => `<option ${cobro.metodo === m ? 'selected' : ''}>${m}</option>`).join('')}</select></div></div>
      <div class="actions" style="margin-top:8px"><button class="ghost" onclick="guardarCobro('${c.id}')">Guardar cobro</button></div>` : ''}
    ${c.estado === 'confirmada' ? `<div class="field"><label for="rem">Recordatorio para el cliente (WhatsApp o SMS)</label>
      <div class="seg">${Object.keys(LANGS).map(l => `<button aria-pressed="${l === lang}" onclick="abrirCita('${c.id}','${l}')">${l.toUpperCase()}</button>`).join('')}</div>
      <textarea id="rem" class="msg">${esc(recordatorio(c, lang))}</textarea>
      <div class="actions" style="margin-top:6px"><button class="ghost" onclick="copiar('rem')">Copiar mensaje</button></div></div>` : ''}
    <div class="actions"><button class="ghost" onclick="closeSheet()">Cerrar</button><button class="primary" onclick="editarCita('${c.id}')">Editar cita</button></div>
    ${esRecepcion() && c.cliente_id ? `<div class="actions" style="margin-top:8px"><button class="ghost" onclick="abrirCliente('${c.cliente_id}')">Ver ficha del cliente</button></div>` : ''}`);
}
async function editarCita(id) { const c = await obtenerCita(id); if (c) abrirFormulario(c); }
async function recibido(id, reabrir = true) {
  const r = await sb.rpc('marcar_recibido', { p_cita: id });
  if (r.error) { toast(r.error.message); return; }
  S.avisos = S.avisos.filter(a => !(a.cita_id === id && paraMi(a)));
  pintarCampana(); renderVista(); toast('Marcada como recibida');
  if (reabrir && $('#sheet').innerHTML) abrirCita(id);
}
async function cambiarEstado(id, estado) {
  const r = await conSolape(conf => {
    const upd = { estado }; if (conf) upd.solape_confirmado = true;
    return sb.from('citas').update(upd).eq('id', id).select().maybeSingle();
  });
  if (r.cancelado) return;
  if (r.error) { toast(traducirError(r.error)); return; }
  if (!r.data) { toast('No tienes permiso para cambiar esta cita'); return; }
  S.citas = S.citas.map(c => c.id === id ? r.data : c);
  await cargarDia(); if (esRecepcion()) await cargarHistorial();
  renderVista(); abrirCita(id); toast('Estado: ' + ESTADOS[estado]);
}
async function marcarTarde(id, v) {
  const r = await sb.from('citas').update({ llego_tarde: v }).eq('id', id).select().maybeSingle();
  if (r.error || !r.data) { toast(r.error ? traducirError(r.error) : 'No tienes permiso para cambiar esta cita'); return; }
  S.citas = S.citas.map(c => c.id === id ? r.data : c); if (esRecepcion()) await cargarHistorial();
  toast(v ? 'Marcada: llegó tarde' : 'Quitado el retraso');
}
async function guardarCobro(id) {
  const r = await sb.from('cobros').update({ importe: +$('#cb-imp').value || 0, metodo: $('#cb-met').value || null }).eq('cita_id', id).select().maybeSingle();
  if (r.error || !r.data) { toast(r.error ? r.error.message : 'No tienes permiso'); return; }
  toast('Cobro guardado'); if (S.tab === 'facturacion') renderVista();
}
function recordatorio(c, lang) {
  const cl = cli(c.cliente_id), s = srv(c.servicio_id), A = S.ajustes, d = new Date(c.inicio);
  const fecha = d.toLocaleDateString(LOC[lang] || 'es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
  const h = hhmm(d), n = (cl.nombre || '').split(' ')[0], centro = A.nombre_centro || '', tel = A.telefono || '', dir = A.direccion ? ` (${A.direccion})` : '';
  const T = {
    es: `Hola ${n}, te recordamos tu cita de ${(s.precio_libre && c.concepto ? c.concepto : s.nombre).toLowerCase()} el ${fecha} a las ${h} en ${centro}${dir}. Si no puedes venir, avísanos${tel ? ' al ' + tel : ''}. ¡Gracias!`,
    en: `Hi ${n}, this is a reminder of your appointment (${s.nombre}) on ${fecha} at ${h} at ${centro}${dir}. If you can't make it, please let us know${tel ? ' on ' + tel : ''}. Thank you!`,
    de: `Hallo ${n}, wir erinnern Sie an Ihren Termin (${s.nombre}) am ${fecha} um ${h} Uhr bei ${centro}${dir}. Falls Sie nicht kommen können, geben Sie uns bitte Bescheid${tel ? ': ' + tel : ''}. Danke!`,
    fr: `Bonjour ${n}, nous vous rappelons votre rendez-vous (${s.nombre}) le ${fecha} à ${h} chez ${centro}${dir}. En cas d'empêchement, merci de nous prévenir${tel ? ' au ' + tel : ''}. Merci !`,
    no: `Hei ${n}! Vi minner om timen din (${s.nombre}) ${fecha} kl. ${h} hos ${centro}${dir}. Gi oss beskjed${tel ? ' på ' + tel : ''} hvis du ikke kan komme. Takk!`
  };
  return T[lang] || T.es;
}
function copiar(id) {
  const ta = $('#' + id);
  try { navigator.clipboard.writeText(ta.value).then(() => toast('Mensaje copiado'), () => { ta.select(); toast('Selecciona el texto y cópialo'); }); }
  catch (e) { ta.select(); toast('Selecciona el texto y cópialo'); }
}

/* ================= guardar con aviso de cabina ================= */
async function conSolape(run) {
  let r = await run(false);
  const m = r.error && (r.error.message || '');
  if (m && m.includes('CABINA_OCUPADA')) {
    const [, cabina, quien, horario] = m.slice(m.indexOf('CABINA_OCUPADA')).split('|');
    alarma();
    const ok = await preguntar('Has asignado dos trabajadores en la misma cabina',
      `${cabina} ya está ocupada por ${quien} de ${horario}. ¿Es correcto? Por ejemplo, dos tratamientos a la vez en la misma cabina. Si lo confirmas, ambas citas saldrán en rojo en la agenda.`,
      'Sí, es correcto', 'No, cambiar', true);
    if (!ok) return { cancelado: true };
    r = await run(true);
  }
  return r;
}
function traducirError(e) {
  const m = (e && e.message) || '';
  if (m.includes('trabajador_ocupado')) return 'Esa persona ya tiene otra cita a esa hora.';
  if (m.includes('SERVICIO_NO_PERMITIDO')) { const [, quien, actv] = m.slice(m.indexOf('SERVICIO_NO_PERMITIDO')).split('|'); return `${quien} no tiene asignada la actividad ${actv}. Recepción puede asignársela en Ajustes → Equipo.`; }
  if (m.includes('FALTA_PRECIO')) return 'Pon el precio del servicio «Otro».';
  if (m.includes('TRABAJADOR_BLOQUEADO')) { const [, quien, motivo, cuando] = m.slice(m.indexOf('TRABAJADOR_BLOQUEADO')).split('|'); return `${quien} tiene ese tiempo bloqueado${motivo ? ' (' + motivo + ')' : ''}: ${cuando}.`; }
  if (m.includes('FUERA_HORARIO')) { const [, tipo, info] = m.slice(m.indexOf('FUERA_HORARIO')).split('|'); return tipo === 'cerrado' ? `El centro está cerrado ese día${info ? ' (' + info + ')' : ''}. Recepción puede abrirlo desde la agenda.` : `La cita se sale del horario de ese día (${info}).`; }
  if (/row-level security/i.test(m)) return 'No tienes permiso para hacer este cambio.';
  if (m.includes('fin > inicio') || m.includes('citas_check')) return 'La hora de fin debe ser posterior al inicio.';
  return m || 'No se ha podido guardar.';
}

/* ================= formulario de cita ================= */
let F = null; // estado del formulario
function opcionesHora(sel, fecha) {
  const h = horarioDe(fecha || S.day);
  const [OPEN, CLOSE] = h.abierto ? [toMin(h.ap), toMin(h.ci)] : limites([fecha || S.day]);
  let o = ''; for (let m = OPEN; m < CLOSE; m += 15) { const t = minToT(m); o += `<option ${t === sel ? 'selected' : ''}>${t}</option>`; }
  if (sel && !o.includes(`>${sel}<`)) o = `<option selected>${sel}</option>` + o;
  return o;
}
function actividadesPermitidas() {
  const activas = S.actividades.filter(a => a.activa);
  if (esRecepcion()) return activas;
  const mias = S.tAct[S.meId] || new Set();
  return activas.filter(a => mias.has(a.id));
}
function abrirFormulario(cita = null, pre = {}) {
  const editando = !!cita;
  const s0 = cita ? srv(cita.servicio_id) : null;
  const tid = cita ? cita.trabajador_id : (esRecepcion() ? (pre.trabajador_id || '') : S.meId);
  const acts = actividadesPermitidas();
  let actId = s0 && s0.actividad_id ? s0.actividad_id : '';
  if (!actId && tid && S.tAct[tid]) actId = [...S.tAct[tid]].find(id => acts.some(a => a.id === id)) || '';
  if (!actId && acts[0]) actId = acts[0].id;
  F = {
    id: cita ? cita.id : null, orig: cita,
    fecha: cita ? dkey(new Date(cita.inicio)) : (pre.fecha || S.day),
    hora: cita ? hhmm(new Date(cita.inicio)) : (pre.hora || '10:00'),
    actId, servicioId: cita ? cita.servicio_id : '', trabajadorId: tid, cabinaId: cita ? cita.cabina_id : '',
    cliente: cita && cita.cliente_id ? cli(cita.cliente_id) : (pre.cliente_id ? cli(pre.cliente_id) : null),
    nuevoNombre: '', notas: cita ? (cita.notas || '') : '',
    precioLibre: cita && cita.precio != null ? +cita.precio : '', concepto: cita ? (cita.concepto || '') : '',
    durLibre: cita ? Math.round((new Date(cita.fin) - new Date(cita.inicio)) / 60000) : 30
  };
  pintarFormulario();
}
function serviciosDe(actId) { return S.servicios.filter(s => s.actividad_id === actId && (s.activo || s.id === F.servicioId)); }
function trabajadoresDe(actId) { return S.trabajadores.filter(t => (t.activo || t.id === F.trabajadorId) && (!actId || (S.tAct[t.id] && S.tAct[t.id].has(actId)))); }
function cabinaPorDefecto(tid) { const l = S.tCab[tid] || []; return (l.find(x => x.principal) || l[0] || {}).cabina_id || ''; }
function pintarFormulario() {
  const acts = actividadesPermitidas();
  const servs = serviciosDe(F.actId);
  if (!servs.some(s => s.id === F.servicioId)) F.servicioId = servs[0] ? servs[0].id : '';
  let trabs = esRecepcion() ? trabajadoresDe(F.actId) : [yo()].filter(Boolean);
  if (esRecepcion() && !trabs.length) trabs = S.trabajadores.filter(t => t.activo);
  if (esRecepcion() && !trabs.some(t => t.id === F.trabajadorId)) F.trabajadorId = trabs[0] ? trabs[0].id : '';
  if (!F.cabinaId && !F.id) F.cabinaId = cabinaPorDefecto(F.trabajadorId);
  const habituales = new Set((S.tCab[F.trabajadorId] || []).map(x => x.cabina_id));
  const cabs = S.cabinas.filter(c => c.activa || c.id === F.cabinaId);
  const s = srv(F.servicioId);
  sheet(`<h3>${F.id ? 'Editar cita' : 'Nueva cita'}</h3>
    <div class="two"><div class="field"><label for="f-fecha">Fecha</label><input id="f-fecha" type="date" value="${F.fecha}"></div>
      <div class="field"><label for="f-hora">Hora</label><select id="f-hora">${opcionesHora(F.hora, F.fecha)}</select></div></div>
    <p class="hint ${horarioDe(F.fecha).abierto ? '' : 'bad'}">Horario de ese día: ${esc(textoHorario(F.fecha))}${!horarioDe(F.fecha).abierto && esRecepcion() ? ` · <button type="button" class="linkbtn" onclick="leerForm();abrirHorarioDia('${F.fecha}',true)">Abrir ese día</button>` : ''}</p>
    <div class="field"><label for="f-act">Actividad</label><select id="f-act">${acts.map(a => `<option value="${a.id}" ${a.id === F.actId ? 'selected' : ''}>${esc(a.nombre)}</option>`).join('')}</select></div>
    ${!acts.length ? `<div class="box warnb">No tienes actividades asignadas, así que no puedes dar citas. Pide a recepción que te las asigne en Ajustes → Equipo.</div>` : ''}
    <div class="field"><label for="f-srv">Servicio</label><select id="f-srv">${servs.map(x => `<option value="${x.id}" ${x.id === F.servicioId ? 'selected' : ''}>${esc(x.nombre)}${x.precio_libre ? ' · precio libre' : ` · ${x.duracion_min} min${S.puedeFacturar && S.precios[x.id] != null ? ' · ' + eur(S.precios[x.id]) : ''}`}</option>`).join('') || '<option value="">No hay servicios en esta actividad</option>'}</select></div>
    ${s.precio_libre ? `<div class="box info"><b>Servicio fuera de carta</b>
      <div class="field"><label for="f-concepto">¿Qué se le hace?</label><input id="f-concepto" value="${esc(F.concepto)}" placeholder="Retirada de esmalte, depilación de labio…"></div>
      <div class="two"><div class="field"><label for="f-precio">Precio (€)</label><input id="f-precio" type="number" min="0" step="0.5" inputmode="decimal" value="${F.precioLibre}"></div>
        <div class="field"><label for="f-dur">Duración (min)</label><input id="f-dur" type="number" min="5" step="5" value="${F.durLibre}"></div></div></div>` : ''}
    ${esRecepcion() ? `<div class="field"><label for="f-trab">Trabajador</label><select id="f-trab">${trabs.map(t => `<option value="${t.id}" ${t.id === F.trabajadorId ? 'selected' : ''}>${esc(t.nombre)}</option>`).join('')}</select></div>` : ''}
    <div class="field"><label for="f-cab">Cabina</label><select id="f-cab"><option value="">Sin cabina</option>
      ${cabs.some(c => habituales.has(c.id)) ? `<optgroup label="Habituales">${cabs.filter(c => habituales.has(c.id)).map(c => `<option value="${c.id}" ${c.id === F.cabinaId ? 'selected' : ''}>${esc(c.nombre)}</option>`).join('')}</optgroup>` : ''}
      <optgroup label="${habituales.size ? 'Otras' : 'Cabinas'}">${cabs.filter(c => !habituales.has(c.id)).map(c => `<option value="${c.id}" ${c.id === F.cabinaId ? 'selected' : ''}>${esc(c.nombre)}</option>`).join('')}</optgroup></select></div>
    <div class="field"><span class="flabel">Cliente</span><div id="f-cli-box"></div></div>
    <div class="field"><label for="f-notas">Notas de la cita</label><textarea id="f-notas" rows="2" placeholder="Sin datos clínicos">${esc(F.notas)}</textarea></div>
    <p class="muted" style="font-size:13px;margin:8px 0 0">Termina a las <b id="f-fin">${calcFin(F.hora, durForm())}</b> (<span id="f-durtxt">${durForm()}</span> min).</p>
    <div class="err" id="f-err"></div>
    <div class="actions"><button class="ghost" onclick="closeSheet()">Cancelar</button><button class="primary" id="f-save" onclick="guardarCita()">Guardar cita</button></div>`);
  pintarCliente();
  const leer = leerForm;
  $('#f-act').onchange = e => { leer(); F.actId = e.target.value; F.servicioId = ''; if (esRecepcion() && !trabajadoresDe(F.actId).some(t => t.id === F.trabajadorId)) { F.trabajadorId = ''; F.cabinaId = ''; } pintarFormulario(); };
  $('#f-srv').onchange = e => { leer(); F.servicioId = e.target.value; pintarFormulario(); };
  if ($('#f-dur')) $('#f-dur').oninput = () => { leer(); $('#f-fin').textContent = calcFin(F.hora, durForm()); $('#f-durtxt').textContent = durForm(); };
  $('#f-fecha').onchange = () => { leer(); pintarFormulario(); };
  $('#f-hora').onchange = () => { leer(); $('#f-fin').textContent = calcFin(F.hora, durForm()); };
  if ($('#f-trab')) $('#f-trab').onchange = e => { leer(); F.trabajadorId = e.target.value; F.cabinaId = cabinaPorDefecto(F.trabajadorId); pintarFormulario(); };
}
function durForm() { const s = srv(F.servicioId); return s.precio_libre ? Math.max(5, parseInt(F.durLibre, 10) || 30) : (s.duracion_min || 30); }
function leerForm() { if (!$('#f-fecha')) return; if ($('#f-concepto')) { F.concepto = $('#f-concepto').value; F.precioLibre = $('#f-precio').value; F.durLibre = $('#f-dur').value; } F.fecha = $('#f-fecha').value || F.fecha; F.hora = $('#f-hora').value; F.notas = $('#f-notas').value; F.cabinaId = $('#f-cab').value; if ($('#f-srv')) F.servicioId = $('#f-srv').value; if ($('#f-trab')) F.trabajadorId = $('#f-trab').value; }
function calcFin(h, dur) { return minToT((toMin(h) + (+dur || 30)) % 1440); }
function pintarCliente() {
  const box = $('#f-cli-box'); if (!box) return;
  if (F.cliente) {
    box.innerHTML = `<div class="picked"><span class="avatar">${esc(iniciales(F.cliente.nombre))}</span><span class="grow" style="min-width:0"><b>${esc(F.cliente.nombre)}</b><br><small>${esc(detalleCliente(F.cliente))}</small>${lineaHistorial(F.cliente.id) ? '<br><small>' + lineaHistorial(F.cliente.id) + '</small>' : ''}${(F.cliente.zonas_dolor || []).length ? `<br><small class="warn"><b>Molestias:</b> ${esc(textoZonas(F.cliente.zonas_dolor))}</small>` : ''}${F.cliente.salud ? `<br><small class="warn"><b>Anotaciones:</b> ${esc(F.cliente.salud)}</small>` : ''}</span><button class="pill" type="button" onclick="F.cliente=null;pintarCliente()">Cambiar</button></div>`;
    return;
  }
  if (F.creandoCliente) {
    const [pila, ...ap] = (F.nuevoNombre || '').split(' ');
    box.innerHTML = `<div class="box info" style="margin-top:0"><b>Cliente nuevo</b>${esRecepcion() ? '' : '<br><small class="muted">Quedará en tu lista. Cuando venga, recepción completará sus datos y lo dará de alta en el centro.</small>'}
      <div class="two"><div class="field"><label for="nc-nombre">Nombre</label><input id="nc-nombre" onblur="this.value=capitalizar(this.value)" value="${esc(pila || '')}" autocomplete="off"></div>
        <div class="field"><label for="nc-apellidos">Apellidos</label><input id="nc-apellidos" onblur="this.value=capitalizar(this.value)" value="${esc(ap.join(' '))}" autocomplete="off"></div></div>
      <div class="field"><label for="nc-tel-num">Teléfono</label>${campoTel('nc-tel', '', 'ES')}</div>
      <div class="two"><div class="field"><label for="nc-nac">Fecha de nacimiento</label><input id="nc-nac" type="date"></div>
        <div class="field"><label for="nc-lang">Idioma</label><select id="nc-lang">${Object.entries(LANGS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div></div>
      <div class="actions" style="margin-top:8px"><button class="ghost" type="button" onclick="F.creandoCliente=false;F.nuevoNombre='';pintarCliente()">Buscar otro</button></div></div>`;
    return;
  }
  const lista = misClientes();
  const presentes = new Set(lista.map(c => letraDe(c.nombre)));
  box.innerHTML = `<input id="f-cli-q" type="search" placeholder="Buscar por nombre o teléfono" autocomplete="off" style="border:1px solid var(--line);background:var(--sunken);border-radius:10px;padding:10px 12px;width:100%">
    <div class="azh" role="group" aria-label="Buscar por letra">${LETRAS.map(l => `<button type="button" data-l="${l}" ${presentes.has(l) ? '' : 'disabled'}>${l}</button>`).join('')}</div>
    <div id="f-cli-res"></div>`;
  const q = $('#f-cli-q');
  const fila = c => `<button type="button" data-id="${c.id}"><b>${esc(c.nombre)}</b>${nombreRepetido(c) ? ' <small class="warn">· nombre repetido</small>' : ''}<br><small class="muted">${esc(detalleCliente(c) || 'Sin teléfono ni fecha de nacimiento')}</small>${pendienteAlta(c) ? ' <small class="warn">· pendiente de alta</small>' : ''}${esRecepcion() && S.hist[c.id] && +S.hist[c.id].no_vino >= 2 ? ' <small class="bad">· ' + S.hist[c.id].no_vino + ' no vino</small>' : ''}</button>`;
  const pintar = (m, nuevo) => {
    const res = $('#f-cli-res');
    res.innerHTML = `<div class="results scroll">${m.map(fila).join('')}${nuevo ? `<button type="button" data-new="1">+ Crear «${esc(nuevo)}» como cliente nuevo</button>` : '<button type="button" data-new="1">+ Cliente nuevo</button>'}</div>`;
    res.querySelectorAll('button[data-id]').forEach(b => b.onclick = () => { F.cliente = cli(b.dataset.id); pintarCliente(); });
    res.querySelector('button[data-new]').onclick = () => { F.nuevoNombre = nuevo || ''; F.creandoCliente = true; pintarCliente(); };
  };
  q.oninput = () => {
    const t = normNombre(q.value), td = q.value.replace(/\D/g, '');
    box.querySelectorAll('.azh button').forEach(b => b.removeAttribute('aria-pressed'));
    if (!t) { $('#f-cli-res').innerHTML = ''; return; }
    pintar(lista.filter(c => coincideNombre(c.nombre, q.value) || (td.length >= 3 && (c.telefono || '').includes(td))).slice(0, 30), capitalizar(q.value));
  };
  box.querySelectorAll('.azh button').forEach(b => b.onclick = () => {
    box.querySelectorAll('.azh button').forEach(x => x.setAttribute('aria-pressed', x === b)); q.value = '';
    pintar(lista.filter(c => letraDe(c.nombre) === b.dataset.l), '');
  });
}
async function guardarCita() {
  const err = $('#f-err'); err.textContent = '';
  F.fecha = $('#f-fecha').value; F.hora = $('#f-hora').value; F.notas = $('#f-notas').value; F.cabinaId = $('#f-cab').value;
  F.servicioId = $('#f-srv').value; if ($('#f-trab')) F.trabajadorId = $('#f-trab').value;
  if (!F.fecha || !F.hora) { err.textContent = 'Elige fecha y hora.'; return; }
  if (!F.servicioId) { err.textContent = 'Elige un servicio. Si no hay, créalo en Ajustes.'; return; }
  if (!F.trabajadorId) { err.textContent = 'Elige quién atiende la cita.'; return; }
  leerForm();
  const sl = srv(F.servicioId);
  if (sl.precio_libre) {
    if (!F.concepto.trim()) { err.textContent = 'Escribe qué se le hace al cliente.'; return; }
    if (F.precioLibre === '' || +F.precioLibre < 0) { err.textContent = 'Pon el precio del servicio.'; return; }
  }
  if (S.tAct[F.trabajadorId] && !S.tAct[F.trabajadorId].has(sl.actividad_id)) { err.textContent = `${trab(F.trabajadorId).nombre} no tiene asignada la actividad ${act(sl.actividad_id).nombre}.`; return; }
  { const m0 = toMin(F.hora), m1 = m0 + durForm();
    if (fueraDeHorario(F.fecha, m0, m1)) {
      const h = horarioDe(F.fecha);
      err.innerHTML = esc(!h.abierto ? `Ese día está cerrado${h.motivo ? ' (' + h.motivo + ')' : ''}.` : `La cita se sale del horario de ese día (${h.ap}–${h.ci}).`)
        + (esRecepcion() ? ` <button class="linkbtn" type="button" onclick="leerForm();abrirHorarioDia('${F.fecha}',true)">Cambiar horario de ese día</button>` : ' Habla con recepción.');
      return;
    }
    const bq = bloqueoEn(F.trabajadorId, F.fecha, m0, m1);
    if (bq) { err.textContent = `${F.trabajadorId === S.meId ? 'Tienes' : trab(F.trabajadorId).nombre + ' tiene'} ese tiempo bloqueado${bq.motivo ? ' (' + bq.motivo + ')' : ''}: ${textoBloqueo(bq)}.`; return; } }
  if (!F.cliente && !F.creandoCliente) { err.textContent = 'Busca o crea el cliente.'; return; }
  const btn = $('#f-save'); btn.disabled = true; btn.textContent = 'Guardando…';
  const fin = () => { btn.disabled = false; btn.textContent = 'Guardar cita'; };
  let clienteId = F.cliente ? F.cliente.id : null;
  if (!clienteId) {
    const pila = capitalizar($('#nc-nombre').value), apell = capitalizar($('#nc-apellidos').value), nombre = [pila, apell].filter(Boolean).join(' ');
    if (!pila) { err.textContent = 'Escribe el nombre del cliente.'; fin(); return; }
    const tl = leerTel('nc-tel'); if (tl.error) { err.textContent = tl.error; fin(); return; }
    const fnac = $('#nc-nac').value || null;
    if (!(await confirmarDuplicado(nombre, fnac))) { fin(); return; }
    const nuevoC = { nombre, telefono: tl.telefono, idioma: $('#nc-lang').value };
    if (hayFicha()) Object.assign(nuevoC, { nombre_pila: pila, apellidos: apell || null, pais_telefono: tl.pais_telefono, fecha_nacimiento: fnac });
    const r = await sb.from('clientes').insert(nuevoC).select().single();
    if (r.error) { err.textContent = traducirError(r.error); fin(); return; }
    S.clientes.push(r.data); S.clientes.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    F.cliente = r.data; F.creandoCliente = false; clienteId = r.data.id;
  }
  const ini = new Date(F.fecha + 'T' + F.hora), dur = durForm();
  const datos = { inicio: ini.toISOString(), fin: new Date(ini.getTime() + dur * 60000).toISOString(), trabajador_id: F.trabajadorId, cabina_id: F.cabinaId || null, cliente_id: clienteId, servicio_id: F.servicioId, notas: F.notas.trim() || null };
  if (hayPrecioLibre()) { const libre = srv(F.servicioId).precio_libre; datos.precio = libre ? +F.precioLibre : null; datos.concepto = libre ? F.concepto.trim() : null; }
  const o = F.orig;
  const mismaFranja = o && new Date(o.inicio).getTime() === ini.getTime() && new Date(o.fin).getTime() === new Date(datos.fin).getTime() && (o.cabina_id || null) === datos.cabina_id;
  const r = await conSolape(conf => {
    const d = { ...datos, solape_confirmado: conf || !!(mismaFranja && o.solape_confirmado) };
    return F.id ? sb.from('citas').update(d).eq('id', F.id).select().maybeSingle() : sb.from('citas').insert(d).select().single();
  });
  if (r.cancelado) { fin(); return; }
  if (r.error) { err.textContent = traducirError(r.error); fin(); return; }
  if (!r.data) { err.textContent = 'No tienes permiso para cambiar esta cita.'; fin(); return; }
  closeSheet(); S.day = F.fecha; if (S.tab !== 'agenda') S.tab = 'agenda';
  await cargarDia(); if (esRecepcion()) await cargarHistorial();
  render(); toast(F.id ? 'Cita actualizada' : (esRecepcion() ? 'Cita guardada · se ha avisado a ' + trab(F.trabajadorId).nombre : 'Cita guardada · se ha avisado a recepción'));
}

/* ================= avisos ================= */
function abrirAvisos() {
  const l = misAvisos();
  const permiso = 'Notification' in window ? Notification.permission : 'denied';
  sheet(`<h3>Avisos</h3><p class="muted" style="margin:0">${l.length ? `${l.length} sin confirmar` : 'No tienes avisos pendientes.'}</p>
    ${permiso === 'default' ? '<div class="box info">Activa las notificaciones para enterarte aunque tengas la app en segundo plano.<div class="actions" style="margin-top:8px"><button class="primary" onclick="activarNotificaciones()">Activar notificaciones</button></div></div>' : ''}
    ${l.length ? `<div class="list" style="margin-top:12px">${l.map(a => `<div class="row"><span class="main"><b style="white-space:normal">${esc(a.mensaje)}</b><small>${new Date(a.creado_en).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</small></span>
      <span style="display:grid;gap:6px">${a.cita_id ? `<button class="pill" onclick="verCitaAviso('${a.cita_id}')">Ver</button>` : ''}<button class="pill" onclick="recibido('${a.cita_id}',false).then(abrirAvisos)">Recibido</button></span></div>`).join('')}</div>
      <div class="actions"><button class="primary" onclick="todoRecibido()">Marcar todo como recibido</button></div>` : ''}
    <div class="actions"><button class="ghost" onclick="closeSheet()">Cerrar</button></div>`);
}
async function verCitaAviso(id) {
  const c = await obtenerCita(id);
  if (!c) { toast('Esa cita ya no existe'); return; }
  S.day = dkey(new Date(c.inicio)); S.vista = 'dia'; S.tab = 'agenda'; await cargarDia(); render(); abrirCita(id);
}
async function todoRecibido() {
  const r = await sb.rpc('marcar_todo_recibido');
  if (r.error) { toast(r.error.message); return; }
  S.avisos = S.avisos.filter(a => !paraMi(a)); pintarCampana(); renderVista(); closeSheet(); toast('Todo marcado como recibido');
}


/* ================= teléfonos, nombres y alfabeto ================= */
const PAISES = [
  ['ES', 'España', '34'], ['NO', 'Noruega', '47'], ['GB', 'Reino Unido', '44'], ['DE', 'Alemania', '49'], ['FR', 'Francia', '33'],
  ['NL', 'Países Bajos', '31'], ['BE', 'Bélgica', '32'], ['SE', 'Suecia', '46'], ['DK', 'Dinamarca', '45'], ['FI', 'Finlandia', '358'],
  ['IS', 'Islandia', '354'], ['IE', 'Irlanda', '353'], ['IT', 'Italia', '39'], ['PT', 'Portugal', '351'], ['CH', 'Suiza', '41'],
  ['AT', 'Austria', '43'], ['LU', 'Luxemburgo', '352'], ['PL', 'Polonia', '48'], ['CZ', 'Chequia', '420'], ['SK', 'Eslovaquia', '421'],
  ['HU', 'Hungría', '36'], ['RO', 'Rumanía', '40'], ['BG', 'Bulgaria', '359'], ['GR', 'Grecia', '30'], ['HR', 'Croacia', '385'],
  ['SI', 'Eslovenia', '386'], ['LT', 'Lituania', '370'], ['LV', 'Letonia', '371'], ['EE', 'Estonia', '372'], ['UA', 'Ucrania', '380'],
  ['RU', 'Rusia', '7'], ['TR', 'Turquía', '90'], ['IL', 'Israel', '972'], ['MA', 'Marruecos', '212'], ['DZ', 'Argelia', '213'],
  ['US', 'Estados Unidos / Canadá', '1'], ['MX', 'México', '52'], ['AR', 'Argentina', '54'], ['CO', 'Colombia', '57'], ['VE', 'Venezuela', '58'],
  ['PE', 'Perú', '51'], ['CL', 'Chile', '56'], ['EC', 'Ecuador', '593'], ['UY', 'Uruguay', '598'], ['BR', 'Brasil', '55'],
  ['CU', 'Cuba', '53'], ['DO', 'República Dominicana', '1809'], ['CN', 'China', '86'], ['IN', 'India', '91'], ['AU', 'Australia', '61']
];
const paisDe = code => PAISES.find(p => p[0] === code) || PAISES[0];
// separa un teléfono internacional (+447700…) en país y número
function partirTel(tel, paisPorDefecto = 'ES') {
  const t = String(tel || '').replace(/[^\d+]/g, '');
  if (t.startsWith('+') || t.startsWith('00')) {
    const dig = t.replace(/^\+|^00/, '');
    const p = [...PAISES].sort((a, b) => b[2].length - a[2].length).find(x => dig.startsWith(x[2]));
    if (p) return { pais: p[0], num: dig.slice(p[2].length) };
    return { pais: paisPorDefecto, num: dig };
  }
  return { pais: paisPorDefecto, num: t };
}
function verTel(tel, pais) {
  if (!tel) return '';
  const { pais: p, num } = partirTel(tel, pais || 'ES');
  return `+${paisDe(p)[2]} ${num.replace(/(\d{3})(?=\d{2,})/g, '$1 ')}`.trim();
}
// selector de país + número
function campoTel(id, tel, pais) {
  const { pais: p, num } = partirTel(tel, pais || 'ES');
  return `<div class="tel"><select id="${id}-pais" aria-label="País del teléfono">${PAISES.map(x => `<option value="${x[0]}" ${x[0] === p ? 'selected' : ''}>${x[0]} +${x[2]} · ${x[1]}</option>`).join('')}</select>
    <input id="${id}-num" inputmode="tel" autocomplete="tel-national" placeholder="Número" value="${esc(num)}" oninput="detectarPais('${id}')"></div>`;
}
function detectarPais(id) {
  const inp = $('#' + id + '-num'), v = inp.value.trim();
  if (/^(\+|00)\d{1,4}/.test(v)) { const r = partirTel(v); const sel = $('#' + id + '-pais'); if (r.pais !== sel.value || v.startsWith('+') || v.startsWith('00')) { sel.value = r.pais; inp.value = r.num; } }
}
function leerTel(id) {
  const pais = $('#' + id + '-pais').value, num = $('#' + id + '-num').value.replace(/\D/g, '').replace(/^0+(?=\d{9,})/, '');
  if (!num) return { telefono: null, pais_telefono: pais };
  if (num.length < 6 || num.length > 13) return { error: 'Revisa el teléfono: el número (sin prefijo) debe tener entre 6 y 13 cifras.' };
  return { telefono: '+' + paisDe(pais)[2] + num, pais_telefono: pais };
}
const hayFicha = () => S.clientes.some(c => 'nombre_pila' in c);
const hayDoc = () => S.clientes.some(c => 'numero_documento' in c);
const hayMapa = () => S.clientes.some(c => 'zonas_dolor' in c);
const nombrePais = code => code === 'OT' ? 'Otra' : (PAISES.find(p => p[0] === code) || [])[1] || '';
const sinAcentos = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const normNombre = s => sinAcentos(s).toLowerCase().replace(/\s+/g, ' ').trim();
// búsqueda sin distinguir mayúsculas, minúsculas ni acentos; vale en cualquier orden («martinez maria»)
function coincideNombre(nombre, consulta) {
  const n = normNombre(nombre), toks = normNombre(consulta).split(' ').filter(Boolean);
  return toks.every(t => n.includes(t));
}
// «maria de la fuente» → «Maria de la Fuente»; respeta lo escrito con mayúsculas mezcladas («McDonald»)
const PARTICULAS = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e', 'da', 'das', 'do', 'dos', 'van', 'von', 'der', 'den', 'di', 'du', 'le']);
function capitalizar(t) {
  return String(t || '').trim().replace(/\s+/g, ' ').split(' ').map((w, i) => {
    if (!w) return w;
    const min = w.toLocaleLowerCase('es');
    if (i > 0 && PARTICULAS.has(min)) return min;
    if (w !== min && w !== w.toLocaleUpperCase('es')) return w;
    return min.replace(/(^|[-'’])(\p{L})/gu, (m, a, b) => a + b.toLocaleUpperCase('es'));
  }).join(' ');
}
const LETRAS = 'ABCDEFGHIJKLMNÑOPQRSTUVWXYZ#'.split('');
function letraDe(nombre) {
  const c = String(nombre || '').trim().charAt(0).toUpperCase();
  if (c === 'Ñ') return 'Ñ';
  const b = sinAcentos(c);
  return /[A-Z]/.test(b) ? b : '#';
}
const edad = f => { if (!f) return null; const d = new Date(f + 'T12:00'), h = new Date(); let e = h.getFullYear() - d.getFullYear(); if (h < new Date(h.getFullYear(), d.getMonth(), d.getDate())) e--; return e; };
const fechaNac = f => f ? new Date(f + 'T12:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
function detalleCliente(c) { return [c.fecha_nacimiento ? `${fechaNac(c.fecha_nacimiento)} (${edad(c.fecha_nacimiento)} años)` : '', verTel(c.telefono, c.pais_telefono)].filter(Boolean).join(' · '); }
function duplicadosDe(nombre, exceptoId) { const n = normNombre(nombre); return S.clientes.filter(c => c.id !== exceptoId && normNombre(c.nombre) === n); }
const nombreRepetido = c => S.clientes.some(x => x.id !== c.id && normNombre(x.nombre) === normNombre(c.nombre));
// pregunta si es otra persona cuando ya hay alguien con el mismo nombre
async function confirmarDuplicado(nombre, fnac, exceptoId) {
  const d = duplicadosDe(nombre, exceptoId);
  if (!d.length) return true;
  const misma = fnac && d.some(c => c.fecha_nacimiento === fnac);
  return preguntar(misma ? 'Mismo nombre y misma fecha de nacimiento' : 'Ya hay un cliente con este nombre',
    `${d.length === 1 ? 'Ya existe' : `Ya existen ${d.length}`}: ${d.map(c => `${c.nombre}${detalleCliente(c) ? ' (' + detalleCliente(c) + ')' : ''}`).join('; ')}. ${misma ? 'Comprueba el teléfono antes de seguir. ' : ''}¿Seguro que es una persona distinta?`,
    'Sí, es otra persona', 'No, revisar', misma);
}
// barra A–Z: salta a la letra en la lista
function barraAZ(presentes, accion) {
  return `<nav class="az" aria-label="Ir a la letra">${LETRAS.map(l => `<button type="button" ${presentes.has(l) ? '' : 'disabled'} onclick="${accion}('${l}')">${l}</button>`).join('')}</nav>`;
}
function irALetra(l) {
  const el = document.getElementById('letra-' + l); if (!el) return;
  const y = el.getBoundingClientRect().top + window.scrollY - 70;
  window.scrollTo({ top: y, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}



/* ================= mapa corporal (zonas de dolor) ================= */
// Coordenadas en un lienzo de 120×270. En la vista de frente, la derecha del cliente queda a la izquierda del dibujo.
const ZONAS = {
  cabeza: 'Cabeza', cara: 'Cara', cuello: 'Cuello', cervicales: 'Cervicales',
  'hombro-d': 'Hombro derecho', 'hombro-i': 'Hombro izquierdo', pecho: 'Pecho', abdomen: 'Abdomen',
  'omoplato-d': 'Omóplato derecho', 'omoplato-i': 'Omóplato izquierdo', dorsales: 'Espalda alta (dorsales)', lumbares: 'Lumbares',
  'brazo-d': 'Brazo derecho', 'brazo-i': 'Brazo izquierdo', 'codo-d': 'Codo derecho', 'codo-i': 'Codo izquierdo',
  'antebrazo-d': 'Antebrazo derecho', 'antebrazo-i': 'Antebrazo izquierdo', 'muneca-d': 'Muñeca derecha', 'muneca-i': 'Muñeca izquierda',
  'mano-d': 'Mano derecha', 'mano-i': 'Mano izquierda', 'cadera-d': 'Cadera derecha', 'cadera-i': 'Cadera izquierda',
  'gluteo-d': 'Glúteo derecho', 'gluteo-i': 'Glúteo izquierdo', 'muslo-d': 'Muslo derecho', 'muslo-i': 'Muslo izquierdo',
  'isquio-d': 'Isquiotibiales derecho', 'isquio-i': 'Isquiotibiales izquierdo', 'rodilla-d': 'Rodilla derecha', 'rodilla-i': 'Rodilla izquierda',
  'corva-d': 'Corva derecha', 'corva-i': 'Corva izquierda', 'espinilla-d': 'Espinilla derecha', 'espinilla-i': 'Espinilla izquierda',
  'gemelo-d': 'Gemelo derecho', 'gemelo-i': 'Gemelo izquierdo', 'tobillo-d': 'Tobillo derecho', 'tobillo-i': 'Tobillo izquierdo',
  'pie-d': 'Pie derecho', 'pie-i': 'Pie izquierdo', 'talon-d': 'Talón derecho', 'talon-i': 'Talón izquierdo'
};
// [id, forma, ...medidas]; los lados se reflejan: «a» es el lado izquierdo del dibujo
function figuraCuerpo(vista, sel = new Set()) {
  const fr = vista === 'frente';
  const a = fr ? 'd' : 'i', b = fr ? 'i' : 'd'; // lado del dibujo → lado del cliente
  const piezas = [
    ['cabeza', 'e', 60, 20, 13, 15], [fr ? 'cara' : 'cabeza', 'e', 60, 24, 9, 9],
    [fr ? 'cuello' : 'cervicales', 'r', 53, 35, 14, 10, 4],
    [`hombro-${a}`, 'e', 35, 54, 9, 8], [`hombro-${b}`, 'e', 85, 54, 9, 8],
    ...(fr ? [['pecho', 'r', 44, 47, 32, 30, 8], ['abdomen', 'r', 45, 78, 30, 30, 7]]
           : [[`omoplato-${a}`, 'r', 44, 47, 15, 22, 6], [`omoplato-${b}`, 'r', 61, 47, 15, 22, 6], ['dorsales', 'r', 46, 70, 28, 14, 5], ['lumbares', 'r', 45, 85, 30, 23, 6]]),
    [`brazo-${a}`, 'r', 24, 62, 12, 26, 6], [`brazo-${b}`, 'r', 84, 62, 12, 26, 6],
    [`codo-${a}`, 'e', 29, 94, 6.5, 6], [`codo-${b}`, 'e', 91, 94, 6.5, 6],
    [`antebrazo-${a}`, 'r', 20, 100, 13, 31, 6], [`antebrazo-${b}`, 'r', 87, 100, 13, 31, 6],
    [`muneca-${a}`, 'r', 17, 131, 12, 8, 3], [`muneca-${b}`, 'r', 91, 131, 12, 8, 3],
    [`mano-${a}`, 'e', 21.5, 147, 7, 9], [`mano-${b}`, 'e', 98.5, 147, 7, 9],
    ...(fr ? [[`cadera-${a}`, 'r', 43, 108, 17, 18, 6], [`cadera-${b}`, 'r', 60, 108, 17, 18, 6]]
           : [[`gluteo-${a}`, 'r', 43, 108, 17, 20, 8], [`gluteo-${b}`, 'r', 60, 108, 17, 20, 8]]),
    ...(fr ? [[`muslo-${a}`, 'r', 44, 127, 15, 44, 7], [`muslo-${b}`, 'r', 61, 127, 15, 44, 7]]
           : [[`isquio-${a}`, 'r', 44, 129, 15, 42, 7], [`isquio-${b}`, 'r', 61, 129, 15, 42, 7]]),
    ...(fr ? [[`rodilla-${a}`, 'e', 51.5, 177, 8, 7], [`rodilla-${b}`, 'e', 68.5, 177, 8, 7]]
           : [[`corva-${a}`, 'e', 51.5, 177, 8, 7], [`corva-${b}`, 'e', 68.5, 177, 8, 7]]),
    ...(fr ? [[`espinilla-${a}`, 'r', 45, 185, 13, 40, 6], [`espinilla-${b}`, 'r', 62, 185, 13, 40, 6]]
           : [[`gemelo-${a}`, 'r', 45, 185, 13, 40, 6], [`gemelo-${b}`, 'r', 62, 185, 13, 40, 6]]),
    [`tobillo-${a}`, 'r', 45, 228, 12, 9, 3], [`tobillo-${b}`, 'r', 63, 228, 12, 9, 3],
    ...(fr ? [[`pie-${a}`, 'e', 49, 245, 8, 6], [`pie-${b}`, 'e', 71, 245, 8, 6]]
           : [[`talon-${a}`, 'e', 51, 245, 6, 5], [`talon-${b}`, 'e', 69, 245, 6, 5]])
  ];
  return piezas.map(([id, f, x, y, w, h, r]) => {
    const t = `<title>${ZONAS[id]}</title>`;
    return f === 'e'
      ? `<ellipse class="zona${sel.has(id) ? ' sel' : ''}" data-z="${id}" cx="${x}" cy="${y}" rx="${w}" ry="${h}">${t}</ellipse>`
      : `<rect class="zona${sel.has(id) ? ' sel' : ''}" data-z="${id}" x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}">${t}</rect>`;
  }).join('');
}
// silueta humana: se dibuja media y se refleja para que sea simétrica
const MEDIO_CUERPO = 'M60,4 C52,4 47,10 47,19 C47,27 50,33 54,36 C55,37 56,38 56,40 L56,44 C50,46 42,46 37,48 C31,50 28,54 27,60 C25,70 24,80 24,90 C23,100 21,112 20,124 C19,130 18,134 17,138 C14,142 13,150 16,155 C19,158 25,157 27,152 C28,147 28,142 28,138 C29,128 31,114 33,102 C34,90 35,72 38,63 C39,74 41,84 42,92 C41,100 40,106 40,114 C40,128 41,150 43,172 C44,182 44,190 44,200 C44,212 46,224 47,232 C47,236 44,240 42,244 C41,248 45,250 52,250 C56,250 57,246 56,240 C56,230 57,214 57,200 C57,190 56,182 57,172 C58,154 59,136 60,124';
function siluetaCuerpo(vista) {
  const espejo = 'transform="translate(120,0) scale(-1,1)"';
  const base = `<path class="sil" d="${MEDIO_CUERPO} Z"/><path class="sil" d="${MEDIO_CUERPO} Z" ${espejo}/>
    <path class="sil-borde" d="${MEDIO_CUERPO}"/><path class="sil-borde" d="${MEDIO_CUERPO}" ${espejo}/>`;
  const frente = `<path class="sil-pelo" d="M47.6,18 C47,8 54,3.6 60,3.6 C66,3.6 73,8 72.4,18 C70,12.5 65,10.5 60,10.5 C55,10.5 50,12.5 47.6,18 Z"/>
    <g class="sil-det">
      <ellipse cx="55" cy="19" rx="1.6" ry="1.1"/><ellipse cx="65" cy="19" rx="1.6" ry="1.1"/>
      <path d="M60,20 L59,25 L61,25"/><path d="M56.5,29 Q60,31 63.5,29"/>
      <path d="M44,50 Q52,53 59,51 M76,50 Q68,53 61,51"/>
      <path d="M46,62 Q53,70 59,66 M74,62 Q67,70 61,66"/>
      <path d="M60,70 L60,100"/><circle cx="60" cy="96" r="1"/>
      <path d="M48,176 Q51.5,180 55,176 M65,176 Q68.5,180 72,176"/></g>`;
  const espalda = `<path class="sil-pelo" d="M47.5,19 C47,8 54,4 60,4 C66,4 73,8 72.5,19 C72,25 70,29 67,31 C63,29 57,29 53,31 C50,29 48,25 47.5,19 Z"/>
    <g class="sil-det">
      <path d="M60,44 L60,112" stroke-dasharray="2.2 1.8"/>
      <path d="M45,56 Q50,72 58,66 M75,56 Q70,72 62,66"/>
      <path d="M44,104 Q52,100 59,104 M76,104 Q68,100 61,104"/>
      <path d="M60,114 L60,124 M47,124 Q53,130 59,126 M73,124 Q67,130 61,126"/>
      <path d="M47,190 Q50,200 50,212 M73,190 Q70,200 70,212"/></g>`;
  return base + (vista === 'frente' ? frente : espalda);
}
function mapaCuerpo(sel = [], editable = false, id = 'mc') {
  const s = new Set(sel);
  const svg = vista => `<figure><svg viewBox="0 0 120 254" role="img" aria-label="Cuerpo visto de ${vista === 'frente' ? 'frente' : 'espaldas'}">${siluetaCuerpo(vista)}${figuraCuerpo(vista, s)}</svg><figcaption>${vista === 'frente' ? 'De frente' : 'De espaldas'}<small>${vista === 'frente' ? 'su derecha queda a tu izquierda' : 'su derecha queda a tu derecha'}</small></figcaption></figure>`;
  return `<div class="mapa ${editable ? 'editable' : ''}" id="${id}">${svg('frente')}${svg('espalda')}</div>
    <div class="zchips" id="${id}-chips">${[...s].map(z => `<span class="zchip">${esc(ZONAS[z] || z)}${editable ? ` <button type="button" aria-label="Quitar ${esc(ZONAS[z] || z)}" data-q="${z}">×</button>` : ''}</span>`).join('') || (editable ? '<small class="muted">Toca en el dibujo las zonas donde tiene molestias.</small>' : '')}</div>`;
}
function pintarSeleccionMapa(id, s) {
  document.querySelectorAll(`#${id} .zona`).forEach(z => z.classList.toggle('sel', s.has(z.dataset.z)));
}
function activarMapa(id, sel) {
  const s = new Set(sel); window._zonas = s;
  const repintar = () => {
    pintarSeleccionMapa(id, s);
    const ch = $(`#${id}-chips`);
    ch.innerHTML = [...s].map(z => `<span class="zchip">${esc(ZONAS[z] || z)} <button type="button" aria-label="Quitar ${esc(ZONAS[z] || z)}" data-q="${z}">×</button></span>`).join('') || '<small class="muted">Toca en el dibujo las zonas donde tiene molestias.</small>';
    ch.querySelectorAll('[data-q]').forEach(bq => bq.onclick = () => { s.delete(bq.dataset.q); repintar(); });
  };
  document.querySelectorAll(`#${id} .zona`).forEach(z => z.addEventListener('click', () => { const k = z.dataset.z; s.has(k) ? s.delete(k) : s.add(k); repintar(); }));
  repintar();
}
const textoZonas = zs => (zs || []).map(z => ZONAS[z] || z).join(', ');

/* ================= consentimiento de protección de datos ================= */
const hayConsent = () => 'cif' in (S.ajustes || {});
const fechaLargaD = d => new Date(d).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
// hoja de consentimiento (sirve para la pantalla, para guardar y para imprimir)
function hojaConsentimiento(c, op = {}) {
  const A = S.ajustes, cuadro = v => v === true ? '☑' : '☐';
  const resp = A.razon_social || A.nombre_centro || '[Nombre del centro]';
  const pobl = A.poblacion || (A.direccion || '').split(',').pop().trim() || '______________';
  const fila = (k, v) => `<tr><th>${k}</th><td>${esc(v || '')}</td></tr>`;
  return `<article class="hoja">
  <header><h1>Consentimiento para el tratamiento de datos personales</h1><p>${esc(resp)}${A.cif ? ' · CIF ' + esc(A.cif) : ''}</p></header>
  <h2>Datos del cliente</h2>
  <table>${fila('Nombre y apellidos', c.nombre)}${c.numero_documento ? fila(c.tipo_documento || 'Documento', c.numero_documento) : fila('Documento de identidad', '')}${fila('Nacionalidad', nombrePais(c.nacionalidad))}${fila('Fecha de nacimiento', c.fecha_nacimiento ? fechaLargaD(c.fecha_nacimiento + 'T12:00') : '')}${fila('Teléfono', verTel(c.telefono, c.pais_telefono))}${fila('Correo electrónico', c.email)}${fila('Dirección', c.direccion)}</table>
  <h2>Información básica sobre protección de datos</h2>
  <p class="ley">Reglamento (UE) 2016/679 (RGPD) y Ley Orgánica 3/2018 de Protección de Datos Personales y garantía de los derechos digitales.</p>
  <dl>
    <dt>Responsable</dt><dd>${esc(resp)}${A.cif ? ', CIF ' + esc(A.cif) : ''}. ${esc(A.direccion || '')}${A.telefono ? '. Tel. ' + esc(A.telefono) : ''}${A.email_contacto ? '. ' + esc(A.email_contacto) : ''}.</dd>
    <dt>Finalidad</dt><dd>Gestionar sus citas y los servicios que solicita. Si lo autoriza, anotar información sobre su salud o molestias necesaria para atenderle de forma segura y enviarle recordatorios de sus citas.</dd>
    <dt>Legitimación</dt><dd>La prestación del servicio que usted solicita. Para los datos de salud y los recordatorios, su consentimiento expreso (artículos 6.1.a y 9.2.a del RGPD), que puede retirar en cualquier momento sin que ello afecte a la licitud del tratamiento anterior.</dd>
    <dt>Destinatarios</dt><dd>No se cederán datos a terceros salvo obligación legal. El proveedor que aloja la aplicación de citas trata los datos por cuenta del centro, en servidores situados en la Unión Europea.</dd>
    <dt>Conservación</dt><dd>Mientras se mantenga la relación con el centro y, después, durante los plazos que exija la ley.</dd>
    <dt>Derechos</dt><dd>Puede ejercer sus derechos de acceso, rectificación, supresión, oposición, limitación del tratamiento y portabilidad dirigiéndose al responsable en la dirección o el correo indicados. Si considera que no se han respetado sus derechos, puede presentar una reclamación ante la Agencia Española de Protección de Datos (www.aepd.es).</dd>
  </dl>
  <h2>Autorizaciones</h2>
  <p class="casilla"><span>${cuadro(op.salud)}</span> Autorizo que se anoten datos sobre mi salud o molestias necesarios para prestarme el servicio.</p>
  <p class="casilla"><span>${cuadro(op.comunicaciones)}</span> Autorizo recibir recordatorios de mis citas por WhatsApp, SMS o correo electrónico.</p>
  <p class="lugar">En ${esc(pobl)}, a ${op.fecha ? fechaLargaD(op.fecha) : '____ de ______________ de ________'}.</p>
  <div class="firma"><div class="caja">${op.firma ? `<img src="${op.firma}" alt="Firma del cliente">` : ''}</div><p>Firma: ${esc(c.nombre)}</p></div>
  ${op.tipo === 'papel' ? '<p class="nota">Firmado en papel. El original se conserva en el centro.</p>' : ''}
  ${op.tipo === 'rechazo' ? '<p class="nota"><b>El cliente no ha querido firmar.</b> Se le atiende igualmente; no se guardan anotaciones sobre su salud ni se le envían recordatorios.</p>' : ''}
  <p class="nota pie">Firmar este documento es voluntario. Si no desea firmarlo, se le atenderá igualmente, pero no se guardarán anotaciones sobre su salud ni recibirá recordatorios de sus citas.</p>
</article>`;
}
function imprimirHoja(html) {
  let d = document.getElementById('imprimir');
  if (!d) { d = document.createElement('div'); d.id = 'imprimir'; document.body.appendChild(d); }
  d.innerHTML = html;
  const limpiar = () => { d.innerHTML = ''; window.removeEventListener('afterprint', limpiar); };
  window.addEventListener('afterprint', limpiar);
  setTimeout(() => window.print(), 50);
}
async function abrirConsentimiento(id) {
  if (!hayConsent()) return sheet(`<h3>Falta un paso en la base de datos</h3><p>Para generar y firmar consentimientos, ejecuta en Supabase → SQL Editor el archivo <b>actualizacion-7-consentimientos.sql</b>.</p><div class="actions"><button class="primary" onclick="closeSheet()">Entendido</button></div>`);
  const c = cli(id);
  const r = await sb.from('consentimientos').select('id,tipo,acepta_salud,acepta_comunicaciones,firmado_en').eq('cliente_id', id).order('firmado_en', { ascending: false });
  const hist = r.data || [];
  const TIPO = { firma: 'Firmado en la app', papel: 'Firmado en papel', retirada: 'Consentimiento retirado', rechazo: 'No quiso firmar' };
  sheet(`<h3>Protección de datos</h3><p class="muted" style="margin:0">${esc(c.nombre)}</p>
    <div class="box ${c.consentimiento_salud ? 'info' : 'warnb'}">${c.consentimiento_salud ? `<b>Consentimiento firmado</b> el ${fechaLargaD(c.consentimiento_salud_en)}. Se pueden guardar anotaciones de salud.${c.consentimiento_comunicaciones ? ' Acepta recordatorios.' : ' No acepta recordatorios.'}` : (c.consentimiento_rechazado_en ? `<b>No quiso firmar</b> el ${fechaLargaD(c.consentimiento_rechazado_en)}. Se le atiende igual, sin anotaciones de salud ni recordatorios.` : '<b>Sin consentimiento firmado.</b> Genera la hoja para que el cliente la firme en pantalla o en papel.')}</div>
    <div class="actions"><button class="primary" onclick="pantallaFirma('${id}')">Nuevo consentimiento</button><button class="ghost" onclick="imprimirHoja(hojaConsentimiento(cli('${id}')))">Imprimir en blanco</button></div>
    ${hist.length ? `<div class="sect">Historial</div><div class="list">${hist.map(h => `<button class="row" onclick="verConsentimiento('${h.id}')"><span class="main"><b>${TIPO[h.tipo]}</b><small>${new Date(h.firmado_en).toLocaleString('es-ES', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}${h.tipo !== 'retirada' && h.tipo !== 'rechazo' ? ` · salud: ${h.acepta_salud ? 'sí' : 'no'} · recordatorios: ${h.acepta_comunicaciones ? 'sí' : 'no'}` : ''}</small></span><span class="end muted">Ver</span></button>`).join('')}</div>` : ''}
    ${c.consentimiento_salud && esRecepcion() ? `<div class="actions"><button class="ghost" onclick="retirarConsentimiento('${id}')">El cliente retira su consentimiento</button></div>` : ''}
    <div class="actions"><button class="ghost" onclick="abrirCliente('${id}')">Volver a la ficha</button></div>
    <p class="note">Texto orientativo: conviene que el asesor legal o el delegado de protección de datos del centro lo revise antes de usarlo con clientes reales.</p>`);
}
async function verConsentimiento(cid) {
  const r = await sb.from('consentimientos').select('*').eq('id', cid).maybeSingle();
  if (!r.data) { toast('No se encontró la hoja'); return; }
  const h = r.data;
  sheet(`<div class="hoja-pantalla">${h.texto}</div>
    <div class="actions"><button class="ghost" onclick="abrirConsentimiento('${h.cliente_id}')">Volver</button><button class="primary" id="cs-print">Imprimir</button></div>`);
  $('#cs-print').onclick = () => imprimirHoja(h.texto);
}
function pantallaFirma(id) {
  const c = cli(id);
  const op = { salud: true, comunicaciones: true };
  const pintarHoja = () => { $('#cs-hoja').innerHTML = hojaConsentimiento(c, { ...op, fecha: new Date() }); };
  const faltan = [hayDoc() && !c.numero_documento ? 'documento de identidad' : '', !c.fecha_nacimiento ? 'fecha de nacimiento' : '', !c.telefono ? 'teléfono' : ''].filter(Boolean);
  sheet(`<h3>Consentimiento de datos</h3><p class="muted" style="margin:0">Revisa los datos con el cliente.</p>
    ${faltan.length ? `<div class="box warnb">Faltan datos para identificar bien al cliente: <b>${faltan.join(', ')}</b>. <button class="linkbtn" onclick="abrirCliente('${id}')">Completar ficha</button></div>` : ''}
    <div class="hoja-pantalla" id="cs-hoja"></div>
    <label class="chk" style="margin-top:12px"><input type="checkbox" id="cs-salud" checked> <span>Autoriza anotar datos sobre su salud o molestias</span></label>
    <label class="chk" style="margin-top:8px"><input type="checkbox" id="cs-com" checked> <span>Autoriza recordatorios por WhatsApp, SMS o correo</span></label>
    <div class="field"><span class="flabel">Firma del cliente (con el dedo o el ratón)</span>
      <canvas id="cs-firma" class="firma-lienzo" aria-label="Recuadro para firmar"></canvas>
      <div class="actions" style="margin-top:6px"><button class="ghost" type="button" id="cs-borrar">Borrar firma</button></div></div>
    <div class="err" id="cs-err"></div>
    <div class="actions"><button class="primary" id="cs-guardar">Guardar firma</button></div>
    <div class="actions"><button class="ghost" id="cs-imprimir">Imprimir para firmar en papel</button><button class="ghost" id="cs-papel">Ya está firmado en papel</button></div>
    ${hayDoc() ? '<div class="actions"><button class="ghost" id="cs-rechazo">El cliente no quiere firmar</button></div>' : ''}
    <div class="actions"><button class="ghost" onclick="abrirConsentimiento('${id}')">Cancelar</button></div>`);
  pintarHoja();
  $('#cs-salud').onchange = e => { op.salud = e.target.checked; pintarHoja(); };
  $('#cs-com').onchange = e => { op.comunicaciones = e.target.checked; pintarHoja(); };
  // lienzo de firma
  const cv = $('#cs-firma'), ctx = cv.getContext('2d'); let dibujando = false, hayTrazo = false;
  const ajustar = () => { const r = cv.getBoundingClientRect(), k = window.devicePixelRatio || 1; cv.width = r.width * k; cv.height = r.height * k; ctx.setTransform(k, 0, 0, k, 0, 0); ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#10204a'; };
  ajustar();
  const pos = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  cv.onpointerdown = e => { dibujando = true; hayTrazo = true; $('#cs-err').textContent = ''; cv.setPointerCapture(e.pointerId); const [x, y] = pos(e); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 0.1, y + 0.1); ctx.stroke(); e.preventDefault(); };
  cv.onpointermove = e => { if (!dibujando) return; const [x, y] = pos(e); ctx.lineTo(x, y); ctx.stroke(); e.preventDefault(); };
  cv.onpointerup = cv.onpointercancel = () => { dibujando = false; };
  $('#cs-borrar').onclick = () => { ctx.clearRect(0, 0, cv.width, cv.height); hayTrazo = false; };
  const datos = () => ({ nombre: c.nombre, fecha_nacimiento: c.fecha_nacimiento || null, telefono: c.telefono || null, email: c.email || null, direccion: c.direccion || null });
  const guardar = async (tipo, firma) => {
    const fecha = new Date();
    const texto = hojaConsentimiento(c, { ...op, fecha, firma, tipo });
    const r = await sb.from('consentimientos').insert({ cliente_id: id, tipo, acepta_salud: op.salud, acepta_comunicaciones: op.comunicaciones, texto, datos: datos(), firma: firma || null, firmado_en: fecha.toISOString() });
    if (r.error) { $('#cs-err').textContent = traducirError(r.error); return; }
    await cargarClientes(); toast(tipo === 'papel' ? 'Registrado como firmado en papel' : tipo === 'rechazo' ? 'Anotado: no ha querido firmar' : 'Consentimiento firmado y guardado');
    abrirConsentimiento(id);
  };
  $('#cs-guardar').onclick = () => {
    if (!hayTrazo) { $('#cs-err').textContent = 'Falta la firma del cliente en el recuadro.'; return; }
    // firma sobre fondo blanco para que se vea bien al imprimir
    const t = document.createElement('canvas'); t.width = cv.width; t.height = cv.height; const tc = t.getContext('2d');
    tc.fillStyle = '#fff'; tc.fillRect(0, 0, t.width, t.height); tc.drawImage(cv, 0, 0);
    guardar('firma', t.toDataURL('image/png'));
  };
  $('#cs-imprimir').onclick = () => imprimirHoja(hojaConsentimiento(c, {}));
  if ($('#cs-rechazo')) $('#cs-rechazo').onclick = async () => {
    if (!(await preguntar('El cliente no quiere firmar', `Quedará anotado que ${c.nombre} no ha querido firmar. Se le atiende igual, pero sin anotaciones de salud ni recordatorios.`, 'Anotar', 'Cancelar'))) return;
    op.salud = false; op.comunicaciones = false; guardar('rechazo', null);
  };
  $('#cs-papel').onclick = async () => {
    if (await preguntar('¿Firmado en papel?', `Confirma que ${c.nombre} ha firmado la hoja impresa con las autorizaciones marcadas aquí. Guarda el original en el centro.`, 'Sí, está firmado', 'Cancelar')) guardar('papel', null);
  };
}
async function retirarConsentimiento(id) {
  const c = cli(id);
  if (!(await preguntar('Retirar consentimiento', `Se borrarán las anotaciones de salud de ${c.nombre} y dejará de recibir recordatorios. Las hojas firmadas anteriores se conservan como justificante.`, 'Retirar', 'Cancelar', true))) return;
  const r = await sb.from('consentimientos').insert({ cliente_id: id, tipo: 'retirada', acepta_salud: false, acepta_comunicaciones: false, texto: `<article class="hoja"><h1>Retirada del consentimiento</h1><p>${esc(c.nombre)} retira su consentimiento para el tratamiento de datos de salud y el envío de recordatorios el ${fechaLargaD(new Date())}.</p></article>`, datos: { nombre: c.nombre } });
  if (r.error) { toast(traducirError(r.error)); return; }
  await cargarClientes(); toast('Consentimiento retirado'); abrirConsentimiento(id);
}

/* ================= clientes (recepción) ================= */
function filaCliente(c) {
  const h = S.hist[c.id], nv = h ? +h.no_vino : 0, ta = h && h.tarde != null ? +h.tarde : null;
  const sub = esRecepcion()
    ? (h ? `${+h.visitas} visitas · ${+h.canceladas} canceladas · ${nv} no vino${ta != null ? ' · ' + ta + ' tarde' : ''}` : 'Sin visitas todavía')
    : (pendienteAlta(c) ? 'Pendiente de alta en recepción' : 'Dado de alta en el centro');
  const det = detalleCliente(c);
  return `<button class="row" onclick="abrirCliente('${c.id}')"><span class="avatar">${esc(iniciales(c.nombre))}</span><span class="main"><b>${esc(c.nombre)}${nombreRepetido(c) ? ' <small class="warn">· nombre repetido</small>' : ''}</b><small class="${esRecepcion() && nv >= 2 ? 'bad' : (!esRecepcion() && pendienteAlta(c) ? 'warn' : '')}">${sub}</small>${det ? `<small class="muted" style="display:block">${esc(det)}</small>` : ''}</span>${esRecepcion() && pendienteAlta(c) ? '<span class="tag warn">Pendiente</span>' : ''}<span class="lang">${esc((c.idioma || 'es').toUpperCase())}</span></button>`;
}
function vistaClientes() {
  const t = normNombre(S.q), td = S.q.replace(/\D/g, '');
  const coincide = c => !t || coincideNombre(c.nombre, S.q) || (td.length >= 3 && (c.telefono || '').includes(td));
  const base = misClientes().filter(coincide).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  const pend = esRecepcion() ? base.filter(pendienteAlta) : [];
  const l = esRecepcion() ? base.filter(c => !pendienteAlta(c)) : base;
  const grupos = {}; l.forEach(c => (grupos[letraDe(c.nombre)] = grupos[letraDe(c.nombre)] || []).push(c));
  const presentes = new Set(Object.keys(grupos));
  return `<div class="toolbar"><input id="q" type="search" placeholder="Buscar por nombre o teléfono" value="${esc(S.q)}" oninput="S.q=this.value;mantenerFoco('q')"><button class="primary" onclick="abrirCliente()">+ Cliente</button></div>
  ${pend.length ? `<div class="sect" style="margin-top:6px">Pendientes de alta (${pend.length})</div>
    <p class="note" style="margin-top:0">Los han apuntado los trabajadores. Cuando el cliente venga, completa sus datos y dalo de alta, o únelo con su ficha si ya existía.</p>
    <div class="list">${pend.map(filaCliente).join('')}</div><div class="sect">Clientes del centro (${l.length})</div>` : `<p class="note" style="margin-top:0">${l.length} ${l.length === 1 ? 'cliente' : 'clientes'}${t ? ' encontrados' : ''}.${!esRecepcion() ? ' Aquí solo están los clientes que has creado tú; la lista completa del centro la gestiona recepción.' : ''}</p>`}
  <div class="conaz">
    <div class="azlista">${LETRAS.filter(x => grupos[x]).map(x => `<div class="letra" id="letra-${x}">${x}</div><div class="list">${grupos[x].map(filaCliente).join('')}</div>`).join('') || `<div class="list"><p class="row muted">${t ? 'Ningún cliente coincide con la búsqueda.' : esRecepcion() ? 'Aún no hay clientes.' : 'Todavía no has creado clientes. Puedes hacerlo al dar una cita o con «+ Cliente».'}</p></div>`}</div>
    ${l.length > 8 ? barraAZ(presentes, 'irALetra') : ''}
  </div>
  <p class="note">${esRecepcion() ? 'En rojo, clientes con 2 o más ausencias. ' : ''}Toca una letra para saltar a los clientes que empiezan por ella.</p>`;
}
function mantenerFoco(id) { const el = $('#' + id), p = el.selectionStart; renderVista(); const n = $('#' + id); n.focus(); try { n.setSelectionRange(p, p); } catch (e) { } }
async function abrirCliente(id) {
  const c = id ? cli(id) : { nombre: '', telefono: '', email: '', idioma: 'es', notas: '' };
  let citas = [];
  if (id) { const r = await sb.from('citas').select('*').eq('cliente_id', id).order('inicio', { ascending: false }).limit(60); citas = r.data || []; }
  if (esRecepcion() && id && pendienteAlta(c) && !S.vinculadosUsuarios) { const rp = await sb.from('perfiles').select('user_id,trabajador_id'); S.vinculadosUsuarios = {}; (rp.data || []).forEach(x => S.vinculadosUsuarios[x.user_id] = x.trabajador_id); }
  const puedeEditar = esRecepcion() || !id || (c.creado_por === S.user.id && pendienteAlta(c));
  sheet(`<h3>${id ? esc(c.nombre) : 'Cliente nuevo'}</h3>${id && detalleCliente(c) ? `<p class="muted" style="margin:0">${esc(detalleCliente(c))}</p>` : ''}${id ? `<p style="margin:2px 0 0">${lineaHistorial(id)}</p>` : ''}
    ${id && nombreRepetido(c) ? `<div class="box warnb">Hay otro cliente con el mismo nombre. Comprueba la fecha de nacimiento o el teléfono para no confundirlos.</div>` : ''}
    ${id && pendienteAlta(c) && esRecepcion() ? `<div class="box warnb"><b>Pendiente de alta.</b> Lo apuntó ${esc((S.trabajadores.find(t => S.vinculadosUsuarios && S.vinculadosUsuarios[c.creado_por] === t.id) || {}).nombre || 'un trabajador')}. Revisa sus datos con el cliente y dalo de alta, o únelo con su ficha si ya existía.
      <div class="actions" style="margin-top:8px"><button class="primary" onclick="darDeAlta('${id}')">Dar de alta</button><button class="ghost" onclick="unirCliente('${id}')">Ya existe: unir</button></div></div>` : ''}
    ${id && !esRecepcion() ? `<div class="box ${pendienteAlta(c) ? 'warnb' : 'info'}">${pendienteAlta(c) ? 'Pendiente de alta: recepción completará sus datos cuando venga. Mientras tanto puedes corregirlos.' : 'Dado de alta en el centro. Para cambiar sus datos, habla con recepción.'}</div>` : ''}
    ${formCliente(c)}
    <div class="err" id="c-err"></div>
    <div class="actions"><button class="ghost" onclick="closeSheet()">Cerrar</button>${puedeEditar ? `<button class="primary" onclick="guardarCliente(${id ? `'${id}'` : 'null'})">Guardar</button>` : ''}</div>
    ${id ? `<div class="actions" style="margin-top:8px"><button class="ghost" onclick="closeSheet();abrirFormulario(null,{cliente_id:'${id}'})">Nueva cita para este cliente</button></div>
    <div class="sect">Historial</div><div class="list">${citas.map(x => `<button class="row" onclick="verCitaAviso('${x.id}')"><span class="main"><b>${esc(nombreCita(x))}</b><small>${new Date(x.inicio).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: '2-digit' })} ${hhmm(new Date(x.inicio))} · ${esc(trab(x.trabajador_id).nombre)}</small></span><span class="end ${x.estado === 'no vino' ? 'bad' : x.estado === 'cancelada' ? 'warn' : x.estado === 'realizada' ? 'ok' : ''}">${ESTADOS[x.estado]}</span></button>`).join('') || '<p class="row muted">Sin citas todavía.</p>'}</div>` : ''}`);
  if ($('#mc-ficha')) activarMapa('mc-ficha', c.zonas_dolor || []);
}
function formCliente(c) {
  const ficha = hayFicha();
  const pila = ficha ? (c.nombre_pila ?? (c.nombre || '').split(' ')[0]) : c.nombre;
  const apell = ficha ? (c.apellidos ?? (c.nombre || '').split(' ').slice(1).join(' ')) : '';
  return `${ficha ? `<div class="two"><div class="field"><label for="c-nombre">Nombre *</label><input id="c-nombre" onblur="this.value=capitalizar(this.value)" value="${esc(pila || '')}" autocomplete="off"></div>
      <div class="field"><label for="c-apellidos">Apellidos *</label><input id="c-apellidos" onblur="this.value=capitalizar(this.value)" value="${esc(apell || '')}" autocomplete="off"></div></div>
    <div class="two"><div class="field"><label for="c-nac">Fecha de nacimiento</label><input id="c-nac" type="date" value="${esc(c.fecha_nacimiento || '')}"></div>
      <div class="field"><label for="c-sexo">Sexo</label><select id="c-sexo"><option value="">—</option>${[['mujer', 'Mujer'], ['hombre', 'Hombre'], ['otro', 'Otro'], ['nd', 'Prefiere no decirlo']].map(([k, v]) => `<option value="${k}" ${c.sexo === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div></div>
    ${hayDoc() ? `<div class="two"><div class="field"><label for="c-tdoc">Documento</label><select id="c-tdoc">${['DNI', 'NIE', 'Pasaporte', 'Documento de su país'].map(t => `<option ${(c.tipo_documento || (c.pais_telefono && c.pais_telefono !== 'ES' ? 'Pasaporte' : 'DNI')) === t ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
      <div class="field"><label for="c-ndoc">Número de documento</label><input id="c-ndoc" value="${esc(c.numero_documento || '')}" autocomplete="off" style="text-transform:uppercase"></div></div>
    <div class="field"><label for="c-nac-pais">Nacionalidad</label><select id="c-nac-pais"><option value="">—</option>${[...PAISES].sort((a, b) => a[1].localeCompare(b[1], 'es')).map(x => `<option value="${x[0]}" ${x[0] === (c.nacionalidad || '') ? 'selected' : ''}>${x[1]}</option>`).join('')}<option value="OT" ${c.nacionalidad === 'OT' ? 'selected' : ''}>Otra</option></select></div>` : ''}`
    : `<div class="field"><label for="c-nombre">Nombre y apellidos</label><input id="c-nombre" onblur="this.value=capitalizar(this.value)" value="${esc(c.nombre || '')}"></div>`}
    <div class="field"><label for="c-tel-num">Teléfono</label>${campoTel('c-tel', c.telefono, c.pais_telefono)}<small class="muted">Elige el país o pega el número con su prefijo (+44…) y se detecta solo.</small></div>
    <div class="two"><div class="field"><label for="c-email">Email</label><input id="c-email" type="email" value="${esc(c.email || '')}"></div>
      <div class="field"><label for="c-lang">Idioma</label><select id="c-lang">${Object.entries(LANGS).map(([k, v]) => `<option value="${k}" ${k === (c.idioma || 'es') ? 'selected' : ''}>${v}</option>`).join('')}</select></div></div>
    ${ficha ? `<div class="field"><label for="c-dir">Dirección</label><input id="c-dir" value="${esc(c.direccion || '')}" placeholder="Calle, número, población"></div>
    <div class="salud">
      ${hayConsent() ? `<button type="button" class="primary ancho" onclick="${c.id ? `guardarCliente('${c.id}','consent')` : `guardarCliente(null,'consent')`}">Consentimiento de datos: imprimir o firmar</button>
        <p class="cons-txt ${c.consentimiento_salud ? 'ok' : c.consentimiento_rechazado_en ? 'bad' : 'warn'}"><input type="checkbox" id="c-cons" ${c.consentimiento_salud ? 'checked' : ''} disabled aria-label="Consentimiento firmado"><span>${c.consentimiento_salud ? `<b>Firmado</b>${c.consentimiento_salud_en ? ' el ' + fechaCorta(c.consentimiento_salud_en) : ''}. Ya se pueden escribir anotaciones.` : c.consentimiento_rechazado_en ? `<b>No quiso firmar</b> (${fechaCorta(c.consentimiento_rechazado_en)}). Se le atiende igual, sin anotaciones de salud.` : `<b>Pendiente de firma.</b> ${c.id ? 'Pulsa el botón para imprimir la hoja o firmarla en pantalla.' : 'El botón guarda la ficha y prepara la hoja con estos datos.'}`}</span></p>`
      : `<label class="chk"><input type="checkbox" id="c-cons" ${c.consentimiento_salud ? 'checked' : ''} onchange="$('#c-salud').disabled=!this.checked"> <span><b>El cliente da su consentimiento</b> para guardar anotaciones sobre su salud o molestias</span></label>`}
      ${hayMapa() ? `<div class="field"><span class="flabel">Zonas con molestias</span>${c.consentimiento_salud ? mapaCuerpo(c.zonas_dolor || [], true, 'mc-ficha') : `<div class="mapa-bloq">${mapaCuerpo(c.zonas_dolor || [], false, 'mc-bloq')}<p>Disponible cuando el cliente firme el consentimiento</p></div>`}</div>` : ''}
      <div class="field"><label for="c-salud">Anotaciones del cliente</label><textarea id="c-salud" rows="3" ${c.consentimiento_salud ? '' : 'disabled'} placeholder="Ej.: tiene problemas de espalda · deportista, juega al tenis y se queja del brazo">${esc(c.salud || '')}</textarea>
      <small class="muted">Solo lo ven recepción y quien atiende a este cliente.</small></div></div>` : ''}
    <div class="field"><label for="c-notas">Notas y preferencias</label><textarea id="c-notas" rows="2" placeholder="Prefiere tardes, presión suave…">${esc(c.notas || '')}</textarea></div>`;
}
function datosFormCliente(orig = {}) {
  let tl = leerTel('c-tel');
  if (tl.error) { // un teléfono antiguo que no se ha tocado no impide guardar el resto
    const o = partirTel(orig.telefono, orig.pais_telefono);
    if (orig.telefono && o.num === $('#c-tel-num').value.replace(/\D/g, '')) tl = { telefono: orig.telefono, pais_telefono: orig.pais_telefono };
    else return { error: tl.error };
  }
  if (!hayFicha()) { const nombre = $('#c-nombre').value.trim(); if (!nombre) return { error: 'Escribe el nombre.' }; return { d: { nombre, telefono: tl.telefono, idioma: $('#c-lang').value, email: $('#c-email').value.trim() || null, notas: $('#c-notas').value.trim() || null } }; }
  const pila = capitalizar($('#c-nombre').value), apell = capitalizar($('#c-apellidos').value);
  if (!pila) return { error: 'Escribe el nombre.' };
  if (!apell) return { error: 'Escribe al menos un apellido: ayuda a distinguir clientes con el mismo nombre.' };
  const cons = $('#c-cons').checked, salud = $('#c-salud').value.trim();
  const consCampos = hayConsent() ? { salud: orig.consentimiento_salud ? (salud || null) : null, ...(hayMapa() ? { zonas_dolor: orig.consentimiento_salud && window._zonas ? [...window._zonas] : (orig.zonas_dolor || []) } : {}) }
    : { consentimiento_salud: cons, salud: cons ? (salud || null) : null, consentimiento_salud_en: cons ? (orig.consentimiento_salud_en || new Date().toISOString()) : null };
  return { d: {
    nombre: pila + ' ' + apell, nombre_pila: pila, apellidos: apell,
    telefono: tl.telefono, pais_telefono: tl.pais_telefono, idioma: $('#c-lang').value, email: $('#c-email').value.trim() || null,
    fecha_nacimiento: $('#c-nac').value || null, sexo: $('#c-sexo').value || null, direccion: $('#c-dir').value.trim() || null,
    ...(hayDoc() ? { tipo_documento: $('#c-tdoc').value, numero_documento: $('#c-ndoc').value.toUpperCase().replace(/[\s.-]/g, '') || null, nacionalidad: $('#c-nac-pais').value || null } : {}),
    ...consCampos,
    notas: $('#c-notas').value.trim() || null } };
}
async function darDeAlta(id) {
  const fd = datosFormCliente(cli(id)); if (fd.error) { $('#c-err').textContent = fd.error; return; }
  const d = { ...fd.d, validado: true };
  if (!(await confirmarDuplicado(d.nombre, d.fecha_nacimiento, id))) return;
  const r = await sb.from('clientes').update(d).eq('id', id).select().maybeSingle();
  if (r.error || !r.data) { $('#c-err').textContent = r.error ? traducirError(r.error) : 'No tienes permiso.'; return; }
  await cargarClientes(); closeSheet(); renderVista(); toast('Cliente dado de alta en el centro');
}
function unirCliente(id) {
  const c = cli(id);
  sheet(`<h3>Unir «${esc(c.nombre)}» con un cliente existente</h3>
    <p class="muted" style="margin:0">Sus citas pasarán a la ficha que elijas y esta ficha provisional se borrará. Los datos que falten en la ficha elegida se completarán con estos.</p>
    <div class="field"><label for="u-q">Buscar cliente del centro</label><input id="u-q" type="search" placeholder="Nombre o teléfono" value="${esc(c.nombre.split(' ')[0])}" autocomplete="off"></div>
    <div id="u-res"></div>
    <div class="actions"><button class="ghost" onclick="abrirCliente('${id}')">Volver</button></div>`);
  const pintar = () => {
    const t = $('#u-q').value.trim(), td = t.replace(/\D/g, '');
    const m = S.clientes.filter(x => x.id !== id && !pendienteAlta(x) && (!t || coincideNombre(x.nombre, t) || (td.length >= 3 && (x.telefono || '').includes(td)) || (x.telefono || '').replace(/\s/g, '').includes(t.replace(/\s/g, '')))).slice(0, 8);
    $('#u-res').innerHTML = `<div class="results">${m.map(x => `<button type="button" data-id="${x.id}"><b>${esc(x.nombre)}</b> <small class="muted">${esc(x.telefono || '')}</small></button>`).join('') || '<button type="button" disabled>Ningún cliente coincide</button>'}</div>`;
    $('#u-res').querySelectorAll('button[data-id]').forEach(b => b.onclick = async () => {
      const destino = cli(b.dataset.id);
      if (!(await preguntar('Unir clientes', `Las citas de «${c.nombre}» pasarán a «${destino.nombre}» y la ficha provisional se borrará.`, 'Unir', 'Cancelar'))) return;
      const r = await sb.rpc('fusionar_clientes', { p_origen: id, p_destino: destino.id });
      if (r.error) { toast(r.error.message); return; }
      await cargarClientes(); await cargarHistorial(); await cargarDia(); closeSheet(); renderVista(); toast(`Unido con ${destino.nombre}`);
    });
  };
  $('#u-q').oninput = pintar; pintar();
}
async function guardarCliente(id, siguiente) {
  const orig = id ? cli(id) : {};
  const fd = datosFormCliente(orig); if (fd.error) { $('#c-err').textContent = fd.error; $('#c-err').scrollIntoView({ block: 'center' }); return; }
  const d = fd.d;
  if (d.numero_documento) {
    const mismoDoc = S.clientes.find(x => x.id !== id && (x.numero_documento || '').toUpperCase() === d.numero_documento);
    if (mismoDoc && !(await preguntar('Documento repetido', `${mismoDoc.nombre} ya tiene el documento ${d.numero_documento}. Puede que este cliente ya exista.`, 'Guardar igualmente', 'Revisar', true))) return;
  }
  if ((!id || normNombre(orig.nombre) !== normNombre(d.nombre)) && !(await confirmarDuplicado(d.nombre, d.fecha_nacimiento, id))) return;
  const r = id ? await sb.from('clientes').update(d).eq('id', id).select().maybeSingle() : await sb.from('clientes').insert(d).select().single();
  if (r.error || !r.data) { $('#c-err').textContent = r.error ? traducirError(r.error) : 'No tienes permiso.'; return; }
  await cargarClientes(); renderVista();
  if (siguiente === 'consent') { toast('Ficha guardada'); pantallaFirma(r.data.id); return; }
  closeSheet(); toast('Cliente guardado');
}

/* ================= facturación ================= */
const PERIODOS = { dia: 'Día', semana: 'Semana', mes: 'Mes', trimestre: 'Trimestre', anio: 'Año' };
function rangoPeriodo() {
  const d = new Date(S.fRef + 'T12:00'); let a, b, label;
  if (S.fPeriodo === 'dia') { a = new Date(d.getFullYear(), d.getMonth(), d.getDate()); b = new Date(a); b.setDate(b.getDate() + 1); label = a.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }); }
  else if (S.fPeriodo === 'semana') { a = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7)); b = new Date(a); b.setDate(b.getDate() + 7); const e = new Date(b); e.setDate(e.getDate() - 1); label = `${fechaCorta(a)} – ${fechaCorta(e)}`; }
  else if (S.fPeriodo === 'mes') { a = new Date(d.getFullYear(), d.getMonth(), 1); b = new Date(d.getFullYear(), d.getMonth() + 1, 1); label = a.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' }); }
  else if (S.fPeriodo === 'trimestre') { const q = Math.floor(d.getMonth() / 3); a = new Date(d.getFullYear(), q * 3, 1); b = new Date(d.getFullYear(), q * 3 + 3, 1); label = `${q + 1}.º trimestre ${d.getFullYear()}`; }
  else { a = new Date(d.getFullYear(), 0, 1); b = new Date(d.getFullYear() + 1, 0, 1); label = String(d.getFullYear()); }
  return { a, b, label };
}
function moverPeriodo(n) {
  const d = new Date(S.fRef + 'T12:00');
  if (S.fPeriodo === 'dia') d.setDate(d.getDate() + n);
  else if (S.fPeriodo === 'semana') d.setDate(d.getDate() + 7 * n);
  else if (S.fPeriodo === 'mes') d.setMonth(d.getMonth() + n, 1);
  else if (S.fPeriodo === 'trimestre') d.setMonth(d.getMonth() + 3 * n, 1);
  else d.setFullYear(d.getFullYear() + n);
  S.fRef = dkey(d); renderVista();
}
function vistaFacturacion() {
  if (!S.puedeFacturar) return '<div class="list"><p class="row muted">No tienes acceso a la facturación.</p></div>';
  const { label } = rangoPeriodo();
  return `<div class="chips" style="padding-top:8px">${Object.entries(PERIODOS).map(([k, v]) => `<button aria-pressed="${S.fPeriodo === k}" onclick="S.fPeriodo='${k}';renderVista()">${v}</button>`).join('')}</div>
  <div class="daybar"><button class="iconbtn" aria-label="Anterior" onclick="moverPeriodo(-1)">‹</button><div class="date">${esc(label)}</div><button class="iconbtn" aria-label="Siguiente" onclick="moverPeriodo(1)">›</button></div>
  <div class="toolbar"><button class="pill" onclick="S.fRef=dkey(new Date());renderVista()">Hoy</button><span class="muted grow" style="font-size:13px">${esRecepcion() ? 'Todo el centro' : 'Solo tus citas'}</span></div>
  <div id="fact"><div class="spinner"></div></div>`;
}
async function cargarFacturacion() {
  const { a, b } = rangoPeriodo();
  const r = await sb.from('citas').select('id,inicio,estado,trabajador_id,servicio_id' + (hayPrecioLibre() ? ',precio' : '') + ',cobros(importe,metodo)').gte('inicio', a.toISOString()).lt('inicio', b.toISOString());
  const box = $('#fact'); if (!box) return;
  if (r.error) { box.innerHTML = `<p class="err">${esc(r.error.message)}</p>`; return; }
  const filas = r.data.map(c => { const cb = Array.isArray(c.cobros) ? c.cobros[0] : c.cobros; return { ...c, importe: cb ? +cb.importe : 0, precio: precioCita(c) }; });
  const sum = (l, f) => l.reduce((s, x) => s + f(x), 0);
  const real = filas.filter(c => c.estado === 'realizada'), pend = filas.filter(c => c.estado === 'confirmada');
  const nov = filas.filter(c => c.estado === 'no vino'), canc = filas.filter(c => c.estado === 'cancelada');
  const tReal = sum(real, c => c.importe), tPend = sum(pend, c => c.precio), tPerd = sum(nov, c => c.precio) + sum(canc, c => c.precio);
  const porTrab = {}; filas.forEach(c => { const p = porTrab[c.trabajador_id] = porTrab[c.trabajador_id] || { r: 0, n: 0, nv: 0, ca: 0, pe: 0 }; if (c.estado === 'realizada') { p.r += c.importe; p.n++; } if (c.estado === 'no vino') p.nv++; if (c.estado === 'cancelada') p.ca++; if (c.estado === 'confirmada') p.pe += c.precio; });
  const porAct = {}; real.forEach(c => { const k = srv(c.servicio_id).actividad_id || '-'; porAct[k] = (porAct[k] || 0) + c.importe; });
  const maxA = Math.max(1, ...Object.values(porAct));
  box.innerHTML = `<div class="stats">
      <div class="stat"><small>Facturado</small><b>${eur(tReal)}</b><em>${real.length} ${real.length === 1 ? 'cita realizada' : 'citas realizadas'}</em></div>
      <div class="stat"><small>Previsto pendiente</small><b>${eur(tPend)}</b><em>${pend.length} ${pend.length === 1 ? 'cita' : 'citas'} por hacer</em></div>
      <div class="stat"><small>Perdido</small><b class="${tPerd ? 'bad' : ''}">${eur(tPerd)}</b><em>${nov.length} no vino · ${canc.length} canceladas</em></div>
      <div class="stat"><small>Total previsto al inicio</small><b>${eur(sum(filas, c => c.precio))}</b><em>${filas.length} ${filas.length === 1 ? 'cita reservada' : 'citas reservadas'}</em></div>
    </div>
    ${esRecepcion() ? `<div class="sect">Por trabajador</div><div class="tablewrap"><table><thead><tr><th>Trabajador</th><th>Realizadas</th><th>Facturado</th><th>Pendiente</th><th>No vino</th><th>Canceladas</th></tr></thead><tbody>
      ${Object.entries(porTrab).sort((x, y) => y[1].r - x[1].r).map(([k, p]) => `<tr><td>${esc(trab(k).nombre)}</td><td>${p.n}</td><td><b>${eur(p.r)}</b></td><td>${eur(p.pe)}</td><td class="${p.nv ? 'bad' : ''}">${p.nv}</td><td>${p.ca}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">Sin citas en este periodo.</td></tr>'}
      </tbody><tfoot><tr><td>Total</td><td>${real.length}</td><td>${eur(tReal)}</td><td>${eur(tPend)}</td><td>${nov.length}</td><td>${canc.length}</td></tr></tfoot></table></div>` : ''}
    <div class="sect">Facturado por actividad</div>
    <div class="bars">${Object.entries(porAct).sort((x, y) => y[1] - x[1]).map(([k, v]) => `<div class="bar"><span>${esc(act(k).nombre)}</span><b class="num">${eur(v)}</b><div class="track"><i style="width:${v / maxA * 100}%;background:${esc(act(k).color)}"></i></div></div>`).join('') || '<p class="muted" style="margin:0">Aún no hay nada facturado en este periodo.</p>'}</div>
    <p class="note">Facturado = citas marcadas como «Realizada», con el importe cobrado. Previsto = precio de carta de las citas que aún están confirmadas. Perdido = precio de las que no vinieron o se cancelaron.</p>`;
}

/* ================= ajustes (recepción) ================= */
async function cargarVinculados() {
  const r = await sb.from('perfiles').select('trabajador_id').not('trabajador_id', 'is', null);
  S.vinculados = new Set((r.data || []).map(x => x.trabajador_id));
  document.querySelectorAll('[data-vinc]').forEach(el => { const ok = S.vinculados.has(el.dataset.vinc); el.textContent = ok ? 'Ya ha entrado' : 'Pendiente de su primer acceso'; el.className = 'tag ' + (ok ? 'ok' : 'warn'); });
}
function vistaAjustes() {
  const A = S.ajustes;
  return `<div class="sect">Centro<button class="pill" onclick="editarCentro()">Editar</button></div>
  <div class="list"><div class="row"><span class="main"><b>${esc(A.nombre_centro)}</b><small>${esc([A.telefono, A.direccion].filter(Boolean).join(' · ') || 'Sin teléfono ni dirección')}</small></span></div></div>
  ${seccionHorario()}

  <div class="sect">Equipo<button class="pill" onclick="editarTrabajador()">+ Trabajador</button></div>
  <div class="list">${S.trabajadores.map(t => `<button class="row" onclick="editarTrabajador('${t.id}')"><span class="avatar">${esc(iniciales(t.nombre))}</span><span class="main"><b>${esc(t.nombre)}${t.activo ? '' : ' <small class="muted">(de baja)</small>'}</b><small>${esc(t.email || 'Sin email: no podrá entrar en la app')}</small>
    <span class="tagline">${[...(S.tAct[t.id] || [])].map(id => `<span class="tag">${esc(act(id).nombre)}</span>`).join('')}${t.ver_facturacion ? '<span class="tag">Ve su facturación</span>' : ''}${t.email ? `<span class="tag" data-vinc="${t.id}">…</span>` : ''}</span></span></button>`).join('') || '<p class="row muted">Añade a tu primer trabajador.</p>'}</div>

  <div class="sect">Cabinas<button class="pill" onclick="editarCabina()">+ Cabina</button></div>
  <div class="list">${S.cabinas.map(c => `<button class="row" onclick="editarCabina('${c.id}')"><span class="main"><b>${esc(c.nombre)}${c.activa ? '' : ' <small class="muted">(cerrada)</small>'}</b><small>${esc(S.trabajadores.filter(t => (S.tCab[t.id] || []).some(x => x.cabina_id === c.id)).map(t => t.nombre).join(', ') || 'Sin trabajadores habituales')}</small></span></button>`).join('') || '<p class="row muted">Crea tu primera cabina.</p>'}</div>

  <div class="sect">Actividades y servicios<button class="pill" onclick="editarActividad()">+ Actividad</button></div>
  ${S.actividades.map(a => `<div class="list" style="margin-bottom:10px">
    <button class="row" onclick="editarActividad('${a.id}')"><i style="width:12px;height:12px;border-radius:4px;background:${esc(a.color)}"></i><span class="main"><b>${esc(a.nombre)}${a.activa ? '' : ' <small class="muted">(oculta)</small>'}</b></span><span class="end muted">Editar</span></button>
    ${S.servicios.filter(s => s.actividad_id === a.id).map(s => `<button class="row" onclick="editarServicio('${s.id}')"><span class="main"><b style="font-weight:500">${esc(s.nombre)}${s.activo ? '' : ' <small class="muted">(oculto)</small>'}</b><small>${s.precio_libre ? 'Duración y precio los pone quien da la cita' : s.duracion_min + ' min'}</small></span><span class="end"><b>${s.precio_libre ? 'Libre' : S.precios[s.id] != null ? eur(S.precios[s.id]) : '—'}</b></span></button>`).join('')}
    <button class="row" onclick="editarServicio(null,'${a.id}')"><span class="main" style="color:var(--accent);font-weight:600">+ Servicio de ${esc(a.nombre.toLowerCase())}</span></button></div>`).join('')}

  ${vistaCuenta()}`;
}
function vistaCuenta() {
  const permiso = 'Notification' in window ? Notification.permission : 'denied';
  const tm = temaActual();
  return `<div class="sect">Apariencia</div>
  <div class="list"><div class="temas" role="group" aria-label="Apariencia">${TEMAS.map(([k, n, c]) => `<button type="button" class="tema" aria-pressed="${tm === k}" onclick="elegirTema('${k}')"><span class="muestra">${k === 'auto' ? `<i style="background:${c[0]}"></i><i style="background:${c[1]}"></i>` : `<i style="background:${c[0]}"></i><i style="background:${c[1]}"></i>`}</span>${n}</button>`).join('')}</div>
  <p class="note" style="margin:0 14px 12px">Automático cambia solo entre claro y oscuro según tu móvil u ordenador. La elección se guarda en este dispositivo.</p></div>
  <div class="sect">Este dispositivo</div>
  <div class="list"><div class="row"><span class="main"><b>${esc(S.user.email)}</b><small>${esRecepcion() ? 'Recepción' : 'Trabajador · ' + esc(yo()?.nombre || '')}</small></span></div>
  <div class="row"><span class="main"><b>Avisos en este dispositivo</b><small>${permiso === 'granted' ? (S.pushActivo ? 'Activados: te llegarán aunque la app esté cerrada o el móvil bloqueado.' : 'Activados con la app abierta. Pulsa «Activar» para recibirlos también con la app cerrada.') : permiso === 'denied' ? 'Bloqueados en los ajustes del navegador o del móvil.' : esIOS() && !instalada() ? 'En iPhone, primero añade la app a la pantalla de inicio.' : 'Desactivados.'}</small></span>${permiso !== 'denied' && !S.pushActivo ? '<button class="pill" onclick="activarNotificaciones()">Activar</button>' : ''}</div>
  ${S.pushActivo ? '<div class="row"><span class="main"><b>Probar avisos</b><small>Te envía un aviso de prueba a ti.</small></span><span style="display:grid;gap:6px"><button class="pill" onclick="avisoPrueba(false)">Al móvil</button><button class="pill" onclick="avisoPrueba(true)">Móvil y correo</button></span></div>' : ''}
  <div class="row"><span class="main"><b>Probar sonido de alarma</b><small>El que suena cuando dos trabajadores coinciden en una cabina.</small></span><button class="pill" onclick="alarma()">Probar</button></div></div>
  <div class="actions"><button class="ghost" onclick="cerrarSesion(this)">Cerrar sesión</button></div>
  <p class="note">Para instalarla como app: en Android, menú del navegador → «Instalar aplicación». En iPhone, Safari → Compartir → «Añadir a pantalla de inicio».</p>`;
}
function editarCentro() {
  const A = S.ajustes;
  sheet(`<h3>Datos del centro</h3>
    <div class="field"><label for="a-nombre">Nombre del centro</label><input id="a-nombre" value="${esc(A.nombre_centro)}"></div>
    <div class="two"><div class="field"><label for="a-tel">Teléfono</label><input id="a-tel" value="${esc(A.telefono || '')}"></div>
      <div class="field"><label for="a-dir">Dirección</label><input id="a-dir" value="${esc(A.direccion || '')}"></div></div>
    ${hayConsent() ? `<div class="two"><div class="field"><label for="a-razon">Razón social</label><input id="a-razon" value="${esc(A.razon_social || '')}" placeholder="Empresa S.L."></div>
      <div class="field"><label for="a-cif">CIF / NIF</label><input id="a-cif" value="${esc(A.cif || '')}"></div></div>
    <div class="two"><div class="field"><label for="a-email">Email de contacto</label><input id="a-email" type="email" value="${esc(A.email_contacto || '')}"></div>
      <div class="field"><label for="a-pobl">Población</label><input id="a-pobl" value="${esc(A.poblacion || '')}"></div></div>` : ''}
    <p class="muted" style="font-size:13px">El nombre, teléfono y dirección aparecen en los recordatorios. Razón social, CIF y email aparecen como responsable en la hoja de consentimiento de datos.</p>
    <div class="err" id="a-err"></div>
    <div class="actions"><button class="ghost" onclick="closeSheet()">Cancelar</button><button class="primary" onclick="guardarCentro()">Guardar</button></div>`);
}
async function guardarCentro() {
  const d = { id: 1, nombre_centro: $('#a-nombre').value.trim() || 'Mi centro', telefono: $('#a-tel').value.trim() || null, direccion: $('#a-dir').value.trim() || null };
  if ($('#a-cif')) Object.assign(d, { razon_social: $('#a-razon').value.trim() || null, cif: $('#a-cif').value.trim() || null, email_contacto: $('#a-email').value.trim() || null, poblacion: $('#a-pobl').value.trim() || null });
  const r = await sb.from('ajustes').upsert(d).select().single();
  if (r.error) { $('#a-err').textContent = r.error.message; return; }
  S.ajustes = r.data; closeSheet(); render(); toast('Datos del centro guardados');
}
function editarTrabajador(id) {
  const t = id ? trab(id) : { nombre: '', email: '', telefono: '', ver_facturacion: false, activo: true };
  const acts = S.tAct[id] || new Set(), cabs = S.tCab[id] || [];
  const principal = (cabs.find(x => x.principal) || {}).cabina_id;
  sheet(`<h3>${id ? esc(t.nombre) : 'Nuevo trabajador'}</h3>
    <div class="field"><label for="t-nombre">Nombre</label><input id="t-nombre" value="${esc(t.nombre)}"></div>
    <div class="two"><div class="field"><label for="t-email">Email de acceso</label><input id="t-email" type="email" value="${esc(t.email || '')}" placeholder="nombre@correo.com"></div>
      <div class="field"><label for="t-tel">Teléfono</label><input id="t-tel" inputmode="tel" value="${esc(t.telefono || '')}"></div></div>
    ${S.trabajadores.some(x => 'fecha_nacimiento' in x) ? `<div class="field"><label for="t-nac">Fecha de nacimiento (opcional)</label><input id="t-nac" type="date" value="${esc(t.fecha_nacimiento || '')}"><small class="muted">La app le felicitará el día de su cumpleaños y avisará a recepción.</small></div>` : ''}
    <div class="field"><span class="flabel">A qué se dedica (puede ser más de una cosa)</span><div class="checks">${S.actividades.map(a => `<label><input type="checkbox" name="t-act" value="${a.id}" ${acts.has(a.id) ? 'checked' : ''}><i style="width:10px;height:10px;border-radius:3px;background:${esc(a.color)}"></i>${esc(a.nombre)}</label>`).join('')}</div></div>
    <div class="field"><span class="flabel">Cabinas habituales · ● principal</span><div class="checks">${S.cabinas.filter(c => c.activa).map(c => `<label><input type="checkbox" name="t-cab" value="${c.id}" ${cabs.some(x => x.cabina_id === c.id) ? 'checked' : ''}>${esc(c.nombre)}<input type="radio" name="t-pri" value="${c.id}" ${principal === c.id ? 'checked' : ''} aria-label="Principal" style="margin-left:auto"></label>`).join('') || '<span class="muted">Primero crea cabinas.</span>'}</div></div>
    <label class="switch"><span><b>Ve su facturación</b><br><small class="muted">Para autónomos: verá lo facturado en sus propias citas, nunca el total del centro.</small></span><input type="checkbox" id="t-fact" ${t.ver_facturacion ? 'checked' : ''}></label>
    <label class="switch"><span><b>En activo</b><br><small class="muted">Si lo desactivas deja de salir en la agenda; su historial se conserva.</small></span><input type="checkbox" id="t-act-on" ${t.activo ? 'checked' : ''}></label>
    <div class="box info">${REGISTRO ? 'Para entrar, el trabajador abre la app, pulsa «Es mi primera vez» y crea su contraseña con <b>este mismo email</b>.' : 'Para que pueda entrar, crea su usuario en Supabase (Authentication → Users → Add user) con <b>este mismo email</b> y una contraseña, y pásasela en persona.'}</div>
    <div class="err" id="t-err"></div>
    <div class="actions"><button class="ghost" onclick="closeSheet()">Cancelar</button><button class="primary" onclick="guardarTrabajador(${id ? `'${id}'` : 'null'})">Guardar</button></div>`);
}
async function guardarTrabajador(id) {
  const err = $('#t-err');
  const d = { nombre: $('#t-nombre').value.trim(), email: $('#t-email').value.trim().toLowerCase() || null, telefono: $('#t-tel').value.trim() || null, ver_facturacion: $('#t-fact').checked, activo: $('#t-act-on').checked };
  if ($('#t-nac')) d.fecha_nacimiento = $('#t-nac').value || null;
  if (!d.nombre) { err.textContent = 'Escribe el nombre.'; return; }
  const acts = [...document.querySelectorAll('input[name=t-act]:checked')].map(i => i.value);
  const cabs = [...document.querySelectorAll('input[name=t-cab]:checked')].map(i => i.value);
  let pri = (document.querySelector('input[name=t-pri]:checked') || {}).value;
  if (!cabs.includes(pri)) pri = cabs[0];
  const r = id ? await sb.from('trabajadores').update(d).eq('id', id).select().single() : await sb.from('trabajadores').insert(d).select().single();
  if (r.error) { err.textContent = /duplicate|unique/i.test(r.error.message) ? 'Ese email ya está asignado a otro trabajador.' : r.error.message; return; }
  const tid = r.data.id;
  await sb.from('trabajador_actividades').delete().eq('trabajador_id', tid);
  if (acts.length) await sb.from('trabajador_actividades').insert(acts.map(a => ({ trabajador_id: tid, actividad_id: a })));
  await sb.from('trabajador_cabinas').delete().eq('trabajador_id', tid);
  if (cabs.length) await sb.from('trabajador_cabinas').insert(cabs.map(c => ({ trabajador_id: tid, cabina_id: c, principal: c === pri })));
  await cargarBase(); closeSheet(); renderVista(); toast(id ? 'Trabajador guardado' : 'Trabajador añadido');
}
function editarCabina(id) {
  const c = id ? cab(id) : { nombre: '', activa: true };
  sheet(`<h3>${id ? 'Editar cabina' : 'Nueva cabina'}</h3>
    <div class="field"><label for="k-nombre">Nombre</label><input id="k-nombre" value="${esc(c.nombre)}" placeholder="Cabina 1"></div>
    <label class="switch"><span><b>Disponible</b></span><input type="checkbox" id="k-on" ${c.activa ? 'checked' : ''}></label>
    <div class="err" id="k-err"></div>
    <div class="actions"><button class="ghost" onclick="closeSheet()">Cancelar</button><button class="primary" onclick="guardarCabina(${id ? `'${id}'` : 'null'})">Guardar</button></div>`);
}
async function guardarCabina(id) {
  const d = { nombre: $('#k-nombre').value.trim(), activa: $('#k-on').checked };
  if (!d.nombre) { $('#k-err').textContent = 'Escribe el nombre.'; return; }
  if (!id) d.orden = S.cabinas.length + 1;
  const r = id ? await sb.from('cabinas').update(d).eq('id', id) : await sb.from('cabinas').insert(d);
  if (r.error) { $('#k-err').textContent = /duplicate|unique/i.test(r.error.message) ? 'Ya hay una cabina con ese nombre.' : r.error.message; return; }
  await cargarBase(); closeSheet(); renderVista(); toast('Cabina guardada');
}
const COLORES = ['#2a5ba8', '#b0457a', '#a8701e', '#2b8174', '#6b4fb3', '#b5482f', '#3f7f2e', '#5d6b82'];
function editarActividad(id) {
  const a = id ? act(id) : { nombre: '', color: COLORES[S.actividades.length % COLORES.length], activa: true };
  sheet(`<h3>${id ? 'Editar actividad' : 'Nueva actividad'}</h3>
    <div class="field"><label for="v-nombre">Nombre</label><input id="v-nombre" value="${esc(a.nombre)}" placeholder="Estética, Uñas, Peluquería…"></div>
    <div class="field"><span class="flabel">Color en la agenda</span><div class="seg">${COLORES.map(c => `<button type="button" aria-pressed="${c === a.color}" data-col="${c}" style="width:34px;height:34px;padding:0;background:${c};border-color:${c}" aria-label="Color ${c}"></button>`).join('')}</div></div>
    <label class="switch"><span><b>Visible</b></span><input type="checkbox" id="v-on" ${a.activa ? 'checked' : ''}></label>
    <div class="err" id="v-err"></div>
    <div class="actions"><button class="ghost" onclick="closeSheet()">Cancelar</button><button class="primary" onclick="guardarActividad(${id ? `'${id}'` : 'null'})">Guardar</button></div>`);
  window._color = a.color;
  document.querySelectorAll('[data-col]').forEach(b => b.onclick = () => { window._color = b.dataset.col; document.querySelectorAll('[data-col]').forEach(x => x.setAttribute('aria-pressed', x === b)); });
}
async function guardarActividad(id) {
  const d = { nombre: $('#v-nombre').value.trim(), color: window._color, activa: $('#v-on').checked };
  if (!d.nombre) { $('#v-err').textContent = 'Escribe el nombre.'; return; }
  if (!id) d.orden = S.actividades.length + 1;
  const r = id ? await sb.from('actividades').update(d).eq('id', id) : await sb.from('actividades').insert(d);
  if (r.error) { $('#v-err').textContent = /duplicate|unique/i.test(r.error.message) ? 'Ya existe una actividad con ese nombre.' : r.error.message; return; }
  await cargarBase(); closeSheet(); renderVista(); toast('Actividad guardada');
}
function editarServicio(id, actId) {
  const s = id ? srv(id) : { nombre: '', duracion_min: 30, actividad_id: actId, activo: true };
  sheet(`<h3>${id ? 'Editar servicio' : 'Nuevo servicio'}</h3>
    <div class="field"><label for="s-act">Actividad</label><select id="s-act">${S.actividades.map(a => `<option value="${a.id}" ${a.id === s.actividad_id ? 'selected' : ''}>${esc(a.nombre)}</option>`).join('')}</select></div>
    <div class="field"><label for="s-nombre">Nombre</label><input id="s-nombre" value="${esc(s.nombre)}"></div>
    <div class="two"><div class="field"><label for="s-dur">Duración (min)</label><input id="s-dur" type="number" min="5" step="5" value="${s.duracion_min}"></div>
      <div class="field"><label for="s-precio">Precio (€)</label><input id="s-precio" type="number" min="0" step="0.5" inputmode="decimal" value="${id && S.precios[id] != null ? S.precios[id] : ''}"></div></div>
    ${hayPrecioLibre() ? `<label class="switch"><span><b>Precio libre</b><br><small class="muted">Quien da la cita escribe qué hace, el precio y la duración (como «Otro»).</small></span><input type="checkbox" id="s-libre" ${s.precio_libre ? 'checked' : ''}></label>` : ''}
    <label class="switch"><span><b>Disponible para reservar</b></span><input type="checkbox" id="s-on" ${s.activo ? 'checked' : ''}></label>
    <div class="err" id="s-err"></div>
    <div class="actions"><button class="ghost" onclick="closeSheet()">Cancelar</button><button class="primary" onclick="guardarServicio(${id ? `'${id}'` : 'null'})">Guardar</button></div>`);
}
async function guardarServicio(id) {
  const d = { actividad_id: $('#s-act').value, nombre: $('#s-nombre').value.trim(), duracion_min: parseInt($('#s-dur').value, 10) || 0, activo: $('#s-on').checked };
  if ($('#s-libre')) d.precio_libre = $('#s-libre').checked;
  if (!d.nombre) { $('#s-err').textContent = 'Escribe el nombre.'; return; }
  if (d.duracion_min < 5) { $('#s-err').textContent = 'La duración mínima es de 5 minutos.'; return; }
  const r = id ? await sb.from('servicios').update(d).eq('id', id).select().single() : await sb.from('servicios').insert(d).select().single();
  if (r.error) { $('#s-err').textContent = r.error.message; return; }
  const p = $('#s-precio').value;
  if (p !== '') { const rp = await sb.from('precios').upsert({ servicio_id: r.data.id, precio: +p }); if (rp.error) { $('#s-err').textContent = rp.error.message; return; } }
  await cargarBase(); closeSheet(); renderVista(); toast('Servicio guardado');
}

/* ================= reloj ================= */
setInterval(() => { if (S.tab === 'agenda' && S.rol && !$('#sheet').innerHTML && document.activeElement?.tagName !== 'INPUT') renderVista(); }, 60000);

boot().catch(e => pantallaError(e.message || String(e)));
