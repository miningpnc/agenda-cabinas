/* Agenda Cabinas · app conectada a Supabase */
'use strict';

/* ================= utilidades ================= */
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
  tab: 'agenda', day: dkey(new Date()), filtroAct: '', q: '',
  fPeriodo: 'dia', fRef: dkey(new Date())
};
const esRecepcion = () => S.rol === 'recepcion';
const act = id => S.actividades.find(a => a.id === id) || { nombre: '—', color: '#7a869f' };
const srv = id => S.servicios.find(s => s.id === id) || { nombre: 'Sin servicio', duracion_min: 30, actividad_id: null };
const trab = id => S.trabajadores.find(t => t.id === id) || { nombre: '—' };
const cab = id => S.cabinas.find(c => c.id === id) || { nombre: 'Sin cabina' };
const cli = id => S.clientes.find(c => c.id === id) || { nombre: 'Sin cliente', idioma: 'es' };
const yo = () => S.trabajadores.find(t => t.id === S.meId);
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
async function activarNotificaciones() {
  if (!('Notification' in window)) { toast('Este navegador no permite notificaciones'); return; }
  try {
    const r = await Notification.requestPermission();
    toast(r === 'granted' ? 'Notificaciones activadas en este dispositivo' : 'Notificaciones no permitidas');
    render();
  } catch (e) { toast('No se pudieron activar'); }
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
        <span><b>Entrar como Trabajador</b><small>Profesional: solo sus citas, sus avisos y, si es autónomo, su propia facturación.</small></span>
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
  <div class="actions"><button class="ghost" onclick="sb.auth.signOut()">Salir</button><button class="primary" onclick="iniciarApp()">Volver a comprobar</button></div></div></div>`;
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
  suscribir();
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
  await cargarHistorial();
}
async function cargarHistorial() {
  S.hist = {};
  if (!esRecepcion()) return;
  const r = await sb.rpc('historial_clientes');
  if (!r.error) (r.data || []).forEach(h => S.hist[h.cliente_id] = h);
}
async function cargarClientes() { const r = await sb.from('clientes').select('*').order('nombre'); if (!r.error) S.clientes = r.data; }
async function cargarDia() {
  const a = startOf(S.day), b = startOf(addDays(S.day, 1));
  const [c, ch] = await Promise.all([
    sb.from('citas').select('*').gte('inicio', a.toISOString()).lt('inicio', b.toISOString()).order('inicio'),
    sb.rpc('citas_con_choque', { p_desde: a.toISOString(), p_hasta: b.toISOString() })
  ]);
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
    .on('postgres_changes', { event: '*', schema: 'public', table: 'clientes' }, async () => { await cargarClientes(); if (S.tab === 'clientes' && document.activeElement?.id !== 'q') renderVista(); })
    .subscribe();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { cargarAvisos().then(pintarCampana); refrescarPronto(); } });
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
  const t = [['agenda', 'Mis citas']];
  if (S.puedeFacturar) t.push(['facturacion', 'Facturación']);
  t.push(['cuenta', 'Cuenta']);
  return t;
}
function render() {
  $('#app').innerHTML = `<div class="wrap">
    <header class="top"><div class="logo">${LOGO}</div>
      <div class="t"><h1>${esc(S.ajustes.nombre_centro || 'Mi centro')}</h1><small>${esRecepcion() ? 'Recepción' : esc(yo()?.nombre || '')}${DEMO ? ' · <span class="demo-tag">Demo</span>' : ''}</small></div>
      <button class="bell" id="bell" aria-label="Avisos" onclick="abrirAvisos()">${BELL}<b id="bell-n" hidden></b></button>
    </header>
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
function columnas() {
  if (!esRecepcion()) return [yo()].filter(Boolean);
  const conCita = new Set(S.citas.filter(c => c.estado !== 'cancelada').map(c => c.trabajador_id));
  return S.trabajadores.filter(t => (t.activo || conCita.has(t.id)) && (!S.filtroAct || (S.tAct[t.id] && S.tAct[t.id].has(S.filtroAct))));
}
function vistaAgenda() {
  const OPEN = toMin(S.ajustes.hora_apertura || '09:00'), CLOSE = toMin(S.ajustes.hora_cierre || '21:00');
  const label = new Date(S.day + 'T12:00').toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
  const cols = columnas();
  const visibles = S.citas.filter(c => c.estado !== 'cancelada' && cols.some(t => t.id === c.trabajador_id));
  const canceladas = S.citas.filter(c => c.estado === 'cancelada');
  const H = (CLOSE - OPEN) / 15 * PX;
  let horas = ''; for (let m = OPEN; m < CLOSE; m += 60) horas += `<span style="top:${(m - OPEN) / 15 * PX}px">${minToT(m)}</span>`;
  const prevision = S.citas.filter(c => c.estado === 'confirmada').reduce((s, c) => s + (S.precios[c.servicio_id] || 0), 0);
  const nChoques = visibles.filter(c => S.choques.has(c.id)).length;

  const htmlCols = cols.map(t => {
    const bloques = visibles.filter(c => c.trabajador_id === t.id).map(c => {
      const s = srv(c.servicio_id), a = act(s.actividad_id), ini = new Date(c.inicio), fin = new Date(c.fin);
      const m0 = ini.getHours() * 60 + ini.getMinutes(), dur = (fin - ini) / 60000;
      const top = Math.max(0, (m0 - OPEN) / 15 * PX), h = Math.max(dur / 15 * PX - 2, 22);
      const pend = S.avisos.filter(x => x.cita_id === c.id && !x.leido_en);
      const nueva = pend.some(paraMi), sinConf = esRecepcion() && pend.some(x => x.para_rol === 'trabajador');
      const choque = S.choques.has(c.id);
      const cls = [c.estado === 'realizada' ? 'realizada' : '', c.estado === 'no vino' ? 'novino' : '', choque ? 'choque' : ''].join(' ');
      const flags = [choque ? '<span class="flag red">Cabina compartida</span>' : '', nueva ? '<span class="flag new">Nueva</span>' : '', sinConf ? '<span class="flag wait">Sin confirmar</span>' : ''].join(' ');
      return `<button class="appt ${cls}" style="--c:${esc(a.color)};top:${top}px;height:${h}px" onclick="event.stopPropagation();abrirCita('${c.id}')">
        <b>${hhmm(ini)} ${esc(cli(c.cliente_id).nombre)}</b><span>${esc(s.nombre)}</span><span>${esc(cab(c.cabina_id).nombre)}${c.estado !== 'confirmada' ? ' · ' + ESTADOS[c.estado] : ''}</span>${flags}</button>`;
    }).join('');
    return `<div class="col" style="height:${H}px" onclick="clicHueco(event,'${t.id}')">${bloques}</div>`;
  }).join('');

  let ahora = '';
  if (S.day === dkey(new Date())) { const n = new Date(), m = n.getHours() * 60 + n.getMinutes(); if (m >= OPEN && m <= CLOSE) ahora = `<div class="now" style="top:${(m - OPEN) / 15 * PX}px"></div>`; }

  return `
  <div class="daybar">
    <button class="iconbtn" aria-label="Día anterior" onclick="cambiarDia(-1)">‹</button>
    <div class="date">${esc(label)}</div>
    <button class="iconbtn" aria-label="Día siguiente" onclick="cambiarDia(1)">›</button>
  </div>
  <div class="toolbar">
    <button class="pill" onclick="irHoy()">Hoy</button>
    <input type="date" id="pick-day" class="pill" value="${S.day}" onchange="if(this.value){S.day=this.value;recargarDia()}" aria-label="Elegir día">
    <span class="grow"></span>
    <button class="primary" onclick="abrirFormulario()">+ Cita</button>
  </div>
  <div class="summary" style="padding-bottom:10px"><span><b>${visibles.length}</b> ${visibles.length === 1 ? 'cita' : 'citas'}</span>${S.puedeFacturar ? `<span>Previsto <b>${eur(prevision)}</b></span>` : ''}${nChoques ? `<span class="bad"><b class="bad">${nChoques}</b> en cabina compartida</span>` : ''}</div>
  ${esRecepcion() && S.actividades.length > 1 ? `<div class="chips"><button aria-pressed="${!S.filtroAct}" onclick="S.filtroAct='';renderVista()">Todo el equipo</button>${S.actividades.filter(a => a.activa).map(a => `<button aria-pressed="${S.filtroAct === a.id}" onclick="S.filtroAct='${a.id}';renderVista()"><i style="background:${esc(a.color)}"></i>${esc(a.nombre)}</button>`).join('')}</div>` : ''}
  ${cols.length ? `<div class="gridwrap"><div class="grid" style="--cols:${cols.length};--hour:${4 * PX}px">
    <div class="ghead"><div></div>${cols.map(t => `<div>${esc(t.nombre)}<small>${esc([...(S.tAct[t.id] || [])].map(id => act(id).nombre).join(', ') || 'Sin actividad')}</small></div>`).join('')}</div>
    <div class="gbody"><div class="times" style="height:${H}px">${horas}</div>${htmlCols}${ahora}</div>
  </div></div>` : `<div class="list"><p class="row muted">${esRecepcion() ? 'Aún no hay trabajadores. Añádelos en Ajustes → Equipo.' : 'Tu ficha de trabajador no está activa. Habla con recepción.'}</p></div>`}
  <div class="legend">${S.actividades.filter(a => a.activa).map(a => `<span><i style="width:10px;height:10px;border-radius:3px;background:${esc(a.color)};display:inline-block"></i>${esc(a.nombre)}</span>`).join('')}<span><span class="flag red" style="margin:0">Cabina compartida</span></span>${esRecepcion() ? '<span><span class="flag wait" style="margin:0">Sin confirmar</span> el trabajador aún no ha pulsado «Recibido»</span>' : ''}</div>
  ${canceladas.length ? `<div class="sect">Canceladas este día (${canceladas.length})</div><div class="list">${canceladas.map(c => `<button class="row" onclick="abrirCita('${c.id}')"><span class="main"><b>${hhmm(new Date(c.inicio))} · ${esc(cli(c.cliente_id).nombre)}</b><small>${esc(srv(c.servicio_id).nombre)} · ${esc(trab(c.trabajador_id).nombre)}</small></span></button>`).join('')}</div>` : ''}
  <p class="note">Toca un hueco libre para crear una cita a esa hora. Los cambios aparecen al momento en todos los dispositivos.</p>`;
}
async function recargarDia() { await cargarDia(); renderVista(); }
function cambiarDia(n) { S.day = addDays(S.day, n); recargarDia(); }
function irHoy() { S.day = dkey(new Date()); recargarDia(); }
function clicHueco(e, tid) {
  const OPEN = toMin(S.ajustes.hora_apertura || '09:00'), CLOSE = toMin(S.ajustes.hora_cierre || '21:00');
  const r = e.currentTarget.getBoundingClientRect();
  let m = OPEN + Math.floor((e.clientY - r.top) / PX) * 15;
  m = Math.min(Math.max(m, OPEN), CLOSE - 15);
  abrirFormulario(null, { hora: minToT(m), trabajador_id: tid });
}

/* ================= ficha de cita ================= */
function lineaHistorial(cid) {
  if (!esRecepcion() || !cid) return '';
  const h = S.hist[cid];
  if (!h) return '<span class="muted">Primera visita</span>';
  const nv = +h.no_vino, cls = nv >= 2 ? 'bad' : '';
  return `<span class="${cls}">${+h.visitas} visitas · ${+h.canceladas} canceladas · <b>${nv} no vino</b>${h.ultima ? ' · última: ' + fechaCorta(h.ultima) : ''}</span>${nv >= 2 ? '<br><b class="bad">Cliente con ausencias repetidas</b>' : ''}`;
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
  sheet(`<h3>${esc(cl.nombre)}</h3><p class="muted" style="margin:0">${esc(s.nombre)} · ${esc(act(s.actividad_id).nombre)}</p>
    ${S.choques.has(c.id) ? '<div class="box red">Cabina compartida: hay otro tratamiento en esta cabina a la misma hora.</div>' : ''}
    ${mio ? `<div class="box info"><b>Cita ${pend.find(paraMi).tipo === 'nueva' ? 'nueva' : pend.find(paraMi).tipo === 'cancelada' ? 'cancelada' : 'modificada'}.</b> Confirma que la has visto.<div class="actions" style="margin-top:8px"><button class="primary" onclick="recibido('${c.id}')">Recibido</button></div></div>` : ''}
    ${sinConf ? `<div class="box warnb">${esc(trab(c.trabajador_id).nombre)} aún no ha confirmado que ha visto esta cita.</div>` : ''}
    <dl class="kv">
      <dt>Cuándo</dt><dd>${ini.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' })} · ${hhmm(ini)}–${hhmm(fin)}</dd>
      <dt>Con</dt><dd>${esc(trab(c.trabajador_id).nombre)}</dd>
      <dt>Cabina</dt><dd>${esc(cab(c.cabina_id).nombre)}</dd>
      <dt>Teléfono</dt><dd>${esc(cl.telefono || '—')}</dd>
      ${S.puedeFacturar ? `<dt>Precio</dt><dd>${eur(S.precios[c.servicio_id])}</dd>` : ''}
      ${c.notas ? `<dt>Notas</dt><dd>${esc(c.notas)}</dd>` : ''}
      ${esRecepcion() ? `<dt>Historial</dt><dd>${lineaHistorial(c.cliente_id)}</dd>` : ''}
    </dl>
    <div class="field"><span class="flabel">Estado</span><div class="seg">${Object.keys(ESTADOS).map(e => `<button aria-pressed="${c.estado === e}" onclick="cambiarEstado('${c.id}','${e}')">${ESTADOS[e]}</button>`).join('')}</div></div>
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
    es: `Hola ${n}, te recordamos tu cita de ${s.nombre.toLowerCase()} el ${fecha} a las ${h} en ${centro}${dir}. Si no puedes venir, avísanos${tel ? ' al ' + tel : ''}. ¡Gracias!`,
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
  if (/row-level security/i.test(m)) return 'No tienes permiso para hacer este cambio.';
  if (m.includes('fin > inicio') || m.includes('citas_check')) return 'La hora de fin debe ser posterior al inicio.';
  return m || 'No se ha podido guardar.';
}

/* ================= formulario de cita ================= */
let F = null; // estado del formulario
function opcionesHora(sel) {
  const OPEN = toMin(S.ajustes.hora_apertura || '09:00'), CLOSE = toMin(S.ajustes.hora_cierre || '21:00');
  let o = ''; for (let m = OPEN; m < CLOSE; m += 15) { const t = minToT(m); o += `<option ${t === sel ? 'selected' : ''}>${t}</option>`; }
  if (sel && !o.includes(`>${sel}<`)) o = `<option selected>${sel}</option>` + o;
  return o;
}
function actividadesPermitidas() {
  const activas = S.actividades.filter(a => a.activa);
  if (esRecepcion()) return activas;
  const mias = S.tAct[S.meId] || new Set();
  const r = activas.filter(a => mias.has(a.id));
  return r.length ? r : activas;
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
    fecha: cita ? dkey(new Date(cita.inicio)) : S.day,
    hora: cita ? hhmm(new Date(cita.inicio)) : (pre.hora || '10:00'),
    actId, servicioId: cita ? cita.servicio_id : '', trabajadorId: tid, cabinaId: cita ? cita.cabina_id : '',
    cliente: cita && cita.cliente_id ? cli(cita.cliente_id) : (pre.cliente_id ? cli(pre.cliente_id) : null),
    nuevoNombre: '', notas: cita ? (cita.notas || '') : ''
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
      <div class="field"><label for="f-hora">Hora</label><select id="f-hora">${opcionesHora(F.hora)}</select></div></div>
    <div class="field"><label for="f-act">Actividad</label><select id="f-act">${acts.map(a => `<option value="${a.id}" ${a.id === F.actId ? 'selected' : ''}>${esc(a.nombre)}</option>`).join('')}</select></div>
    <div class="field"><label for="f-srv">Servicio</label><select id="f-srv">${servs.map(x => `<option value="${x.id}" ${x.id === F.servicioId ? 'selected' : ''}>${esc(x.nombre)} · ${x.duracion_min} min${S.puedeFacturar && S.precios[x.id] != null ? ' · ' + eur(S.precios[x.id]) : ''}</option>`).join('') || '<option value="">No hay servicios en esta actividad</option>'}</select></div>
    ${esRecepcion() ? `<div class="field"><label for="f-trab">Trabajador</label><select id="f-trab">${trabs.map(t => `<option value="${t.id}" ${t.id === F.trabajadorId ? 'selected' : ''}>${esc(t.nombre)}</option>`).join('')}</select></div>` : ''}
    <div class="field"><label for="f-cab">Cabina</label><select id="f-cab"><option value="">Sin cabina</option>
      ${cabs.some(c => habituales.has(c.id)) ? `<optgroup label="Habituales">${cabs.filter(c => habituales.has(c.id)).map(c => `<option value="${c.id}" ${c.id === F.cabinaId ? 'selected' : ''}>${esc(c.nombre)}</option>`).join('')}</optgroup>` : ''}
      <optgroup label="${habituales.size ? 'Otras' : 'Cabinas'}">${cabs.filter(c => !habituales.has(c.id)).map(c => `<option value="${c.id}" ${c.id === F.cabinaId ? 'selected' : ''}>${esc(c.nombre)}</option>`).join('')}</optgroup></select></div>
    <div class="field"><span class="flabel">Cliente</span><div id="f-cli-box"></div></div>
    <div class="field"><label for="f-notas">Notas de la cita</label><textarea id="f-notas" rows="2" placeholder="Sin datos clínicos">${esc(F.notas)}</textarea></div>
    <p class="muted" style="font-size:13px;margin:8px 0 0">Termina a las <b id="f-fin">${calcFin(F.hora, s.duracion_min)}</b> (${s.duracion_min} min).</p>
    <div class="err" id="f-err"></div>
    <div class="actions"><button class="ghost" onclick="closeSheet()">Cancelar</button><button class="primary" id="f-save" onclick="guardarCita()">Guardar cita</button></div>`);
  pintarCliente();
  const leer = () => { F.fecha = $('#f-fecha').value; F.hora = $('#f-hora').value; F.notas = $('#f-notas').value; F.cabinaId = $('#f-cab').value; };
  $('#f-act').onchange = e => { leer(); F.actId = e.target.value; F.servicioId = ''; if (esRecepcion() && !trabajadoresDe(F.actId).some(t => t.id === F.trabajadorId)) { F.trabajadorId = ''; F.cabinaId = ''; } pintarFormulario(); };
  $('#f-srv').onchange = e => { leer(); F.servicioId = e.target.value; $('#f-fin').textContent = calcFin(F.hora, srv(F.servicioId).duracion_min); };
  $('#f-hora').onchange = () => { leer(); $('#f-fin').textContent = calcFin(F.hora, srv(F.servicioId).duracion_min); };
  if ($('#f-trab')) $('#f-trab').onchange = e => { leer(); F.trabajadorId = e.target.value; F.cabinaId = cabinaPorDefecto(F.trabajadorId); pintarFormulario(); };
}
function calcFin(h, dur) { return minToT((toMin(h) + (+dur || 30)) % 1440); }
function pintarCliente() {
  const box = $('#f-cli-box'); if (!box) return;
  if (F.cliente) {
    box.innerHTML = `<div class="picked"><span class="avatar">${esc(iniciales(F.cliente.nombre))}</span><span class="grow" style="min-width:0"><b>${esc(F.cliente.nombre)}</b><br><small>${lineaHistorial(F.cliente.id) || esc(F.cliente.telefono || '')}</small></span><button class="pill" type="button" onclick="F.cliente=null;pintarCliente()">Cambiar</button></div>`;
    return;
  }
  if (F.nuevoNombre !== '' && F.creandoCliente) {
    box.innerHTML = `<div class="box info" style="margin-top:0"><b>Cliente nuevo</b>
      <div class="field"><label for="nc-nombre">Nombre</label><input id="nc-nombre" value="${esc(F.nuevoNombre)}"></div>
      <div class="two"><div class="field"><label for="nc-tel">Teléfono</label><input id="nc-tel" inputmode="tel"></div>
      <div class="field"><label for="nc-lang">Idioma</label><select id="nc-lang">${Object.entries(LANGS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div></div>
      <div class="actions" style="margin-top:8px"><button class="ghost" type="button" onclick="F.creandoCliente=false;F.nuevoNombre='';pintarCliente()">Buscar otro</button></div></div>`;
    return;
  }
  box.innerHTML = `<input id="f-cli-q" type="search" placeholder="Buscar por nombre o teléfono" autocomplete="off" style="border:1px solid var(--line);background:var(--sunken);border-radius:10px;padding:10px 12px;width:100%"><div id="f-cli-res"></div>`;
  const q = $('#f-cli-q');
  q.oninput = () => {
    const t = q.value.trim().toLowerCase(), res = $('#f-cli-res');
    if (!t) { res.innerHTML = ''; return; }
    const m = S.clientes.filter(c => c.nombre.toLowerCase().includes(t) || (c.telefono || '').replace(/\s/g, '').includes(t.replace(/\s/g, ''))).slice(0, 6);
    res.innerHTML = `<div class="results">${m.map(c => `<button type="button" data-id="${c.id}"><b>${esc(c.nombre)}</b> <small class="muted">${esc(c.telefono || '')}</small>${esRecepcion() && S.hist[c.id] && +S.hist[c.id].no_vino >= 2 ? ' <small class="bad">· ' + S.hist[c.id].no_vino + ' no vino</small>' : ''}</button>`).join('')}<button type="button" data-new="1">+ Crear «${esc(q.value.trim())}» como cliente nuevo</button></div>`;
    res.querySelectorAll('button[data-id]').forEach(b => b.onclick = () => { F.cliente = cli(b.dataset.id); pintarCliente(); });
    res.querySelector('button[data-new]').onclick = () => { F.nuevoNombre = q.value.trim(); F.creandoCliente = true; pintarCliente(); };
  };
}
async function guardarCita() {
  const err = $('#f-err'); err.textContent = '';
  F.fecha = $('#f-fecha').value; F.hora = $('#f-hora').value; F.notas = $('#f-notas').value; F.cabinaId = $('#f-cab').value;
  F.servicioId = $('#f-srv').value; if ($('#f-trab')) F.trabajadorId = $('#f-trab').value;
  if (!F.fecha || !F.hora) { err.textContent = 'Elige fecha y hora.'; return; }
  if (!F.servicioId) { err.textContent = 'Elige un servicio. Si no hay, créalo en Ajustes.'; return; }
  if (!F.trabajadorId) { err.textContent = 'Elige quién atiende la cita.'; return; }
  if (!F.cliente && !F.creandoCliente) { err.textContent = 'Busca o crea el cliente.'; return; }
  const btn = $('#f-save'); btn.disabled = true; btn.textContent = 'Guardando…';
  const fin = () => { btn.disabled = false; btn.textContent = 'Guardar cita'; };
  let clienteId = F.cliente ? F.cliente.id : null;
  if (!clienteId) {
    const nombre = ($('#nc-nombre').value || '').trim();
    if (!nombre) { err.textContent = 'Escribe el nombre del cliente.'; fin(); return; }
    const r = await sb.from('clientes').insert({ nombre, telefono: $('#nc-tel').value.trim() || null, idioma: $('#nc-lang').value }).select().single();
    if (r.error) { err.textContent = traducirError(r.error); fin(); return; }
    S.clientes.push(r.data); S.clientes.sort((a, b) => a.nombre.localeCompare(b.nombre));
    F.cliente = r.data; F.creandoCliente = false; clienteId = r.data.id;
  }
  const ini = new Date(F.fecha + 'T' + F.hora), dur = srv(F.servicioId).duracion_min || 30;
  const datos = { inicio: ini.toISOString(), fin: new Date(ini.getTime() + dur * 60000).toISOString(), trabajador_id: F.trabajadorId, cabina_id: F.cabinaId || null, cliente_id: clienteId, servicio_id: F.servicioId, notas: F.notas.trim() || null };
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
  S.day = dkey(new Date(c.inicio)); S.tab = 'agenda'; await cargarDia(); render(); abrirCita(id);
}
async function todoRecibido() {
  const r = await sb.rpc('marcar_todo_recibido');
  if (r.error) { toast(r.error.message); return; }
  S.avisos = S.avisos.filter(a => !paraMi(a)); pintarCampana(); renderVista(); closeSheet(); toast('Todo marcado como recibido');
}

/* ================= clientes (recepción) ================= */
function vistaClientes() {
  const t = S.q.trim().toLowerCase();
  const l = S.clientes.filter(c => !t || c.nombre.toLowerCase().includes(t) || (c.telefono || '').replace(/\s/g, '').includes(t.replace(/\s/g, '')));
  return `<div class="toolbar"><input id="q" type="search" placeholder="Buscar por nombre o teléfono" value="${esc(S.q)}" oninput="S.q=this.value;mantenerFoco('q')"><button class="primary" onclick="abrirCliente()">+ Cliente</button></div>
  <div class="list">${l.map(c => {
    const h = S.hist[c.id], nv = h ? +h.no_vino : 0;
    return `<button class="row" onclick="abrirCliente('${c.id}')"><span class="avatar">${esc(iniciales(c.nombre))}</span><span class="main"><b>${esc(c.nombre)}</b><small class="${nv >= 2 ? 'bad' : ''}">${h ? `${+h.visitas} visitas · ${+h.canceladas} canceladas · ${nv} no vino` : 'Sin visitas todavía'}</small></span><span class="lang">${esc((c.idioma || 'es').toUpperCase())}</span></button>`;
  }).join('') || '<p class="row muted">Ningún cliente coincide con la búsqueda.</p>'}</div>
  <p class="note">En rojo, clientes con 2 o más ausencias. Esta agenda no guarda historia clínica: eso sigue en el programa de pacientes del centro.</p>`;
}
function mantenerFoco(id) { const el = $('#' + id), p = el.selectionStart; renderVista(); const n = $('#' + id); n.focus(); try { n.setSelectionRange(p, p); } catch (e) { } }
async function abrirCliente(id) {
  const c = id ? cli(id) : { nombre: '', telefono: '', email: '', idioma: 'es', notas: '' };
  let citas = [];
  if (id) { const r = await sb.from('citas').select('*').eq('cliente_id', id).order('inicio', { ascending: false }).limit(60); citas = r.data || []; }
  sheet(`<h3>${id ? esc(c.nombre) : 'Cliente nuevo'}</h3>${id ? `<p style="margin:0">${lineaHistorial(id)}</p>` : ''}
    <div class="field"><label for="c-nombre">Nombre</label><input id="c-nombre" value="${esc(c.nombre)}"></div>
    <div class="two"><div class="field"><label for="c-tel">Teléfono</label><input id="c-tel" inputmode="tel" value="${esc(c.telefono || '')}"></div>
      <div class="field"><label for="c-lang">Idioma</label><select id="c-lang">${Object.entries(LANGS).map(([k, v]) => `<option value="${k}" ${k === (c.idioma || 'es') ? 'selected' : ''}>${v}</option>`).join('')}</select></div></div>
    <div class="field"><label for="c-email">Email</label><input id="c-email" type="email" value="${esc(c.email || '')}"></div>
    <div class="field"><label for="c-notas">Notas (preferencias; sin datos clínicos)</label><textarea id="c-notas" rows="2">${esc(c.notas || '')}</textarea></div>
    <div class="err" id="c-err"></div>
    <div class="actions"><button class="ghost" onclick="closeSheet()">Cerrar</button><button class="primary" onclick="guardarCliente(${id ? `'${id}'` : 'null'})">Guardar</button></div>
    ${id ? `<div class="actions" style="margin-top:8px"><button class="ghost" onclick="closeSheet();abrirFormulario(null,{cliente_id:'${id}'})">Nueva cita para este cliente</button></div>
    <div class="sect">Historial</div><div class="list">${citas.map(x => `<button class="row" onclick="verCitaAviso('${x.id}')"><span class="main"><b>${esc(srv(x.servicio_id).nombre)}</b><small>${new Date(x.inicio).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: '2-digit' })} ${hhmm(new Date(x.inicio))} · ${esc(trab(x.trabajador_id).nombre)}</small></span><span class="end ${x.estado === 'no vino' ? 'bad' : x.estado === 'cancelada' ? 'warn' : x.estado === 'realizada' ? 'ok' : ''}">${ESTADOS[x.estado]}</span></button>`).join('') || '<p class="row muted">Sin citas todavía.</p>'}</div>` : ''}`);
}
async function guardarCliente(id) {
  const d = { nombre: $('#c-nombre').value.trim(), telefono: $('#c-tel').value.trim() || null, idioma: $('#c-lang').value, email: $('#c-email').value.trim() || null, notas: $('#c-notas').value.trim() || null };
  if (!d.nombre) { $('#c-err').textContent = 'Escribe el nombre.'; return; }
  const r = id ? await sb.from('clientes').update(d).eq('id', id).select().maybeSingle() : await sb.from('clientes').insert(d).select().single();
  if (r.error || !r.data) { $('#c-err').textContent = r.error ? traducirError(r.error) : 'No tienes permiso.'; return; }
  await cargarClientes(); closeSheet(); renderVista(); toast('Cliente guardado');
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
  const r = await sb.from('citas').select('id,inicio,estado,trabajador_id,servicio_id,cobros(importe,metodo)').gte('inicio', a.toISOString()).lt('inicio', b.toISOString());
  const box = $('#fact'); if (!box) return;
  if (r.error) { box.innerHTML = `<p class="err">${esc(r.error.message)}</p>`; return; }
  const filas = r.data.map(c => { const cb = Array.isArray(c.cobros) ? c.cobros[0] : c.cobros; return { ...c, importe: cb ? +cb.importe : 0, precio: S.precios[c.servicio_id] || 0 }; });
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
  <div class="list"><div class="row"><span class="main"><b>${esc(A.nombre_centro)}</b><small>${esc([A.telefono, A.direccion].filter(Boolean).join(' · ') || 'Sin teléfono ni dirección')} · Horario ${String(A.hora_apertura).slice(0, 5)}–${String(A.hora_cierre).slice(0, 5)}</small></span></div></div>

  <div class="sect">Equipo<button class="pill" onclick="editarTrabajador()">+ Trabajador</button></div>
  <div class="list">${S.trabajadores.map(t => `<button class="row" onclick="editarTrabajador('${t.id}')"><span class="avatar">${esc(iniciales(t.nombre))}</span><span class="main"><b>${esc(t.nombre)}${t.activo ? '' : ' <small class="muted">(de baja)</small>'}</b><small>${esc(t.email || 'Sin email: no podrá entrar en la app')}</small>
    <span class="tagline">${[...(S.tAct[t.id] || [])].map(id => `<span class="tag">${esc(act(id).nombre)}</span>`).join('')}${t.ver_facturacion ? '<span class="tag">Ve su facturación</span>' : ''}${t.email ? `<span class="tag" data-vinc="${t.id}">…</span>` : ''}</span></span></button>`).join('') || '<p class="row muted">Añade a tu primer trabajador.</p>'}</div>

  <div class="sect">Cabinas<button class="pill" onclick="editarCabina()">+ Cabina</button></div>
  <div class="list">${S.cabinas.map(c => `<button class="row" onclick="editarCabina('${c.id}')"><span class="main"><b>${esc(c.nombre)}${c.activa ? '' : ' <small class="muted">(cerrada)</small>'}</b><small>${esc(S.trabajadores.filter(t => (S.tCab[t.id] || []).some(x => x.cabina_id === c.id)).map(t => t.nombre).join(', ') || 'Sin trabajadores habituales')}</small></span></button>`).join('') || '<p class="row muted">Crea tu primera cabina.</p>'}</div>

  <div class="sect">Actividades y servicios<button class="pill" onclick="editarActividad()">+ Actividad</button></div>
  ${S.actividades.map(a => `<div class="list" style="margin-bottom:10px">
    <button class="row" onclick="editarActividad('${a.id}')"><i style="width:12px;height:12px;border-radius:4px;background:${esc(a.color)}"></i><span class="main"><b>${esc(a.nombre)}${a.activa ? '' : ' <small class="muted">(oculta)</small>'}</b></span><span class="end muted">Editar</span></button>
    ${S.servicios.filter(s => s.actividad_id === a.id).map(s => `<button class="row" onclick="editarServicio('${s.id}')"><span class="main"><b style="font-weight:500">${esc(s.nombre)}${s.activo ? '' : ' <small class="muted">(oculto)</small>'}</b><small>${s.duracion_min} min</small></span><span class="end"><b>${S.precios[s.id] != null ? eur(S.precios[s.id]) : '—'}</b></span></button>`).join('')}
    <button class="row" onclick="editarServicio(null,'${a.id}')"><span class="main" style="color:var(--accent);font-weight:600">+ Servicio de ${esc(a.nombre.toLowerCase())}</span></button></div>`).join('')}

  ${vistaCuenta()}`;
}
function vistaCuenta() {
  const permiso = 'Notification' in window ? Notification.permission : 'denied';
  return `<div class="sect">Este dispositivo</div>
  <div class="list"><div class="row"><span class="main"><b>${esc(S.user.email)}</b><small>${esRecepcion() ? 'Recepción' : 'Trabajador · ' + esc(yo()?.nombre || '')}</small></span></div>
  <div class="row"><span class="main"><b>Notificaciones</b><small>${permiso === 'granted' ? 'Activadas: te avisará al llegar una cita con la app abierta o en segundo plano.' : permiso === 'denied' ? 'Bloqueadas en los ajustes del navegador.' : 'Desactivadas.'}</small></span>${permiso === 'default' ? '<button class="pill" onclick="activarNotificaciones()">Activar</button>' : ''}</div>
  <div class="row"><span class="main"><b>Probar sonido de alarma</b><small>El que suena cuando dos trabajadores coinciden en una cabina.</small></span><button class="pill" onclick="alarma()">Probar</button></div></div>
  <div class="actions"><button class="ghost" onclick="sb.auth.signOut()">Cerrar sesión</button></div>
  <p class="note">Para instalarla como app: en Android, menú del navegador → «Instalar aplicación». En iPhone, Safari → Compartir → «Añadir a pantalla de inicio».</p>`;
}
function editarCentro() {
  const A = S.ajustes;
  sheet(`<h3>Datos del centro</h3>
    <div class="field"><label for="a-nombre">Nombre del centro</label><input id="a-nombre" value="${esc(A.nombre_centro)}"></div>
    <div class="two"><div class="field"><label for="a-tel">Teléfono</label><input id="a-tel" value="${esc(A.telefono || '')}"></div>
      <div class="field"><label for="a-dir">Dirección</label><input id="a-dir" value="${esc(A.direccion || '')}"></div></div>
    <div class="two"><div class="field"><label for="a-ab">Abre</label><input id="a-ab" type="time" step="900" value="${String(A.hora_apertura).slice(0, 5)}"></div>
      <div class="field"><label for="a-ci">Cierra</label><input id="a-ci" type="time" step="900" value="${String(A.hora_cierre).slice(0, 5)}"></div></div>
    <p class="muted" style="font-size:13px">El nombre, teléfono y dirección aparecen en los recordatorios que se envían a los clientes.</p>
    <div class="err" id="a-err"></div>
    <div class="actions"><button class="ghost" onclick="closeSheet()">Cancelar</button><button class="primary" onclick="guardarCentro()">Guardar</button></div>`);
}
async function guardarCentro() {
  const d = { id: 1, nombre_centro: $('#a-nombre').value.trim() || 'Mi centro', telefono: $('#a-tel').value.trim() || null, direccion: $('#a-dir').value.trim() || null, hora_apertura: $('#a-ab').value || '09:00', hora_cierre: $('#a-ci').value || '21:00' };
  if (toMin(d.hora_cierre) <= toMin(d.hora_apertura)) { $('#a-err').textContent = 'La hora de cierre debe ser posterior a la de apertura.'; return; }
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
    <label class="switch"><span><b>Disponible para reservar</b></span><input type="checkbox" id="s-on" ${s.activo ? 'checked' : ''}></label>
    <div class="err" id="s-err"></div>
    <div class="actions"><button class="ghost" onclick="closeSheet()">Cancelar</button><button class="primary" onclick="guardarServicio(${id ? `'${id}'` : 'null'})">Guardar</button></div>`);
}
async function guardarServicio(id) {
  const d = { actividad_id: $('#s-act').value, nombre: $('#s-nombre').value.trim(), duracion_min: parseInt($('#s-dur').value, 10) || 0, activo: $('#s-on').checked };
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
