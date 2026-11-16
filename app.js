import { EMPRESAS } from './config.js';
import { esc, pad, hoy, ahora, nuevoId, normNombre, nombreReservado, similitud, periodoDe } from './util.js';
import { parseEntrada } from './parsers.js';
import { planificar, evento } from './domain.js';
import * as D from './data.js';
import { iniciarLimpiador } from './limpiadores.js';
import { iniciarBarras } from './barras.js';

const $ = id => document.getElementById(id);
const ETQ_ESTADO = { asignada: 'En ruta', entregada: 'Entregada', almacen: 'En oficina', fallido: 'Fallido devolución' };

let emp = null;
let mensajeros = [];
let preview = null;               // { plan, duplicadas, fecha, zona }
let sesion = [];                  // lecturas del escáner en pantalla
const resolucion = {};            // pendiente.key -> 'crear' | id de mensajero existente
const reactivarSel = new Set();   // guías ya entregadas/devueltas que sí se reactivan
let reasignarOtros = false;

/* ============ utilidades de pantalla ============ */
function toast(m) {
  const t = $('toast');
  t.textContent = m;
  t.classList.add('visible');
  clearTimeout(window._toast);
  window._toast = setTimeout(() => t.classList.remove('visible'), 3800);
}
const nombreDe = id => (mensajeros.find(m => m.id === id) || {}).nombre || '—';
const badge = e => `<span class="badge b-${esc(e)}">${esc(ETQ_ESTADO[e] || e)}</span>`;
function errMsg(e) {
  if (e && e.message === 'YA_EXISTE') return 'La guía ya existe';
  if (e && e.message === 'CAMBIO_CONCURRENTE') return 'La guía cambió mientras la procesabas. Vuelve a escanearla.';
  return (e && e.message) || String(e);
}

const VISTAS = {
  panel: () => renderPanel(),
  pegado: () => renderPegado(),
  escaner: () => renderEscaner(),
  cargas: () => renderCargas(),
  devoluciones: () => renderDevoluciones(),
  buscador: () => {},
  mensajeros: () => renderMensajeros(),
  limpiador: () => iniciarLimpiador(emp, $('limpiadorCont')),
  barras: () => iniciarBarras(emp, $('barrasCont')),
  config: () => {}
};
function mostrarVista(v) {
  document.querySelectorAll('.view').forEach(x => x.classList.toggle('activa', x.id === 'v-' + v));
  document.querySelectorAll('.nav').forEach(n => n.classList.toggle('activo', n.dataset.view === v));
  if (VISTAS[v]) VISTAS[v]();
}
document.querySelectorAll('.nav').forEach(n => n.onclick = () => mostrarVista(n.dataset.view));

/* ============ inicio, empresa y sesión ============ */
document.querySelectorAll('.empresa-card').forEach(b => b.onclick = () => elegirEmpresa(b.dataset.emp));

async function elegirEmpresa(e) {
  emp = e;
  const c = EMPRESAS[e];
  document.body.className = e;
  $('brandNombre').textContent = 'Mensajería ' + c.nombre;
  $('brandMark').textContent = c.letra;
  $('brandMark').className = 'brand-mark ' + c.clase;
  $('home').classList.add('oculto');
  const usuario = await D.esperarSesion();
  if (!usuario) { $('login').classList.remove('oculto'); return; }
  await entrar();
}

$('formLogin').onsubmit = async ev => {
  ev.preventDefault();
  try {
    await D.login($('loginEmail').value.trim(), $('loginPass').value);
    $('login').classList.add('oculto');
    await entrar();
  } catch (err) {
    toast('No se pudo iniciar sesión. Revisa correo y contraseña.');
  }
};

$('btnSalir').onclick = async () => { await D.logout(); location.reload(); };

async function entrar() {
  $('shell').classList.remove('oculto');
  await recargarMensajeros();
  mostrarVista('panel');
}

async function recargarMensajeros() {
  mensajeros = await D.cargarMensajeros(emp);
}

function llenarMensajeros(sel) {
  const prev = sel.value;
  const lista = mensajeros.filter(m => m.activo).sort((a, b) => a.nombre.localeCompare(b.nombre));
  sel.innerHTML = lista.length
    ? lista.map(m => `<option value="${esc(m.id)}">${esc(m.nombre)}${m.zona ? ' · ' + esc(m.zona) : ''}</option>`).join('')
    : '<option value="">Registra un mensajero primero</option>';
  if (prev && [...sel.options].some(o => o.value === prev)) sel.value = prev;
}

/* ============ PANEL ============ */
async function renderPanel() {
  if (!$('pMes').value) $('pMes').value = hoy().slice(0, 7);
  const { ini, fin } = periodoDe($('pMes').value, $('pQuin').value);
  $('pPeriodo').textContent = `Período del ${ini} al ${fin}`;
  const [periodo, enRuta, almacen] = await Promise.all([
    D.guiasPeriodo(emp, ini, fin),
    D.guiasPorEstado(emp, 'asignada'),
    D.guiasPorEstado(emp, 'almacen')
  ]);
  const enFecha = g => (g.ultimoMovimiento || '').slice(0, 10) >= ini && (g.ultimoMovimiento || '').slice(0, 10) <= fin;
  $('mEntradas').textContent = periodo.length;
  $('mRuta').textContent = enRuta.length;
  $('mEntregadas').textContent = periodo.filter(g => g.estado === 'entregada' && enFecha(g)).length;
  $('mAlmacen').textContent = almacen.length;
  $('mFallidos').textContent = periodo.filter(g => g.estado === 'fallido' && enFecha(g)).length;
  $('mMensajeros').textContent = mensajeros.filter(m => m.activo).length;
}
$('pMes').onchange = renderPanel;
$('pQuin').onchange = renderPanel;

/* ============ PEGADO CON VISTA PREVIA ============ */
function renderPegado() {
  if (!$('pFecha').value) $('pFecha').value = hoy();
  const jt = emp === 'jt';
  $('pModoWrap').classList.toggle('oculto', !jt);
  const fijo = !jt || $('pModo').value === 'fijo';
  $('pMensFijoWrap').classList.toggle('oculto', !fijo);
  llenarMensajeros($('pMensFijo'));
  renderPreview();
}
$('pModo').onchange = renderPegado;

$('btnPrevia').onclick = async () => {
  const texto = $('pTexto').value;
  if (!texto.trim()) return toast('Pega primero las guías');
  try {
    const modo = emp === 'jt' ? $('pModo').value : 'fijo';
    const mensajeroFijoId = $('pMensFijo').value;
    if (modo === 'fijo' && !mensajeroFijoId) return toast('Selecciona el mensajero');
    const { items, duplicadas } = parseEntrada(texto, emp);
    if (!items.length) return toast('No encontré guías en el texto');
    const guias = await D.cargarGuias(emp, items.map(i => i.codigo));
    const plan = planificar({ items, empresa: emp, guias, mensajeros, modo, mensajeroFijoId });
    Object.keys(resolucion).forEach(k => delete resolucion[k]);
    plan.pendientes.forEach(p => { resolucion[p.key] = 'crear'; });
    reactivarSel.clear();
    reasignarOtros = false;
    $('pReasOtros').checked = false;
    preview = { plan, duplicadas, fecha: $('pFecha').value || hoy(), zona: $('pZona').value.trim() };
    renderPreview();
  } catch (e) {
    toast('Error al revisar: ' + errMsg(e));
  }
};

// Filas que se escribirían si confirmas
function filasAplicables() {
  if (!preview) return [];
  return preview.plan.filas.filter(f =>
    f.accion === 'nueva' ||
    (f.accion === 'repetida_otro' && reasignarOtros) ||
    (f.accion === 'reactivar' && reactivarSel.has(f.codigo))
  );
}

function renderPreview() {
  if (!preview) {
    $('pPreview').innerHTML = '';
    $('pAplicar').disabled = true;
    $('pAplicar').textContent = 'Confirmar y guardar';
    return;
  }
  const { plan, duplicadas } = preview;
  const r = plan.resumen;
  const chip = (t, n, c) => `<div class="chip ${c}">${t}: <b>${n}</b></div>`;
  let h = `<div class="chips">
    ${chip('Nuevas', r.nueva || 0, 'ok')}
    ${chip('Repetidas', r.repetida || 0, 'warn')}
    ${chip('Con otro mensajero', r.repetida_otro || 0, 'warn')}
    ${chip('Ya entregadas/devueltas', r.reactivar || 0, 'warn')}
    ${chip('Sin mensajero', r.sin_mensajero || 0, 'err')}
    ${chip('Inválidas', r.invalida || 0, 'err')}
    ${chip('Repetidas en el texto', duplicadas, '')}
  </div>`;

  if (plan.pendientes.length) {
    h += '<h3>Mensajeros que no están registrados</h3><p class="small">Decide si se crean como nuevos o se vinculan a uno existente.</p>';
    h += plan.pendientes.map(p => `
      <div class="item">
        <span><b>${esc(p.nombre || 'Sin nombre')}</b> <small>${esc(p.codigo)} · ${p.cantidad} guía(s)</small></span>
        <select data-pend="${esc(p.key)}">
          <option value="crear" ${resolucion[p.key] === 'crear' ? 'selected' : ''}>Crear como mensajero nuevo</option>
          ${mensajeros.slice().sort((a, b) => a.nombre.localeCompare(b.nombre)).map(m =>
            `<option value="${esc(m.id)}" ${resolucion[p.key] === m.id ? 'selected' : ''}>Vincular a: ${esc(m.nombre)}${p.sugerencias.some(s => s.id === m.id) ? ' (parecido)' : ''}</option>`
          ).join('')}
        </select>
      </div>`).join('');
  }

  const reactivar = plan.filas.filter(f => f.accion === 'reactivar');
  if (reactivar.length) {
    h += '<h3>Ya estaban entregadas o devueltas</h3><p class="small">Solo se reactivan las que marques.</p>';
    h += reactivar.map(f => `
      <label class="item">
        <span><input type="checkbox" data-react="${esc(f.codigo)}" ${reactivarSel.has(f.codigo) ? 'checked' : ''}> <code>${esc(f.codigo)}</code></span>
        <small>${badge(f.guia.estado)}</small>
      </label>`).join('');
  }

  const grupos = [
    ['nueva', 'Nuevas'],
    ['repetida', 'Repetidas (ya con ese mensajero)'],
    ['repetida_otro', 'Repetidas con otro mensajero'],
    ['sin_mensajero', 'Sin mensajero en la fila'],
    ['invalida', 'Inválidas']
  ];
  grupos.forEach(([k, t]) => {
    const fs = plan.filas.filter(f => f.accion === k);
    if (fs.length) {
      h += `<details><summary>${t} (${fs.length})</summary><div class="codigos">${fs.map(f =>
        `<div><code>${esc(f.codigo)}</code> ${esc(f.nombreMensajero)}${f.motivo ? ' · ' + esc(f.motivo) : ''}</div>`
      ).join('')}</div></details>`;
    }
  });

  $('pPreview').innerHTML = h;
  const n = filasAplicables().length;
  $('pAplicar').disabled = n === 0;
  $('pAplicar').textContent = n ? `Confirmar y guardar ${n} guía(s)` : 'Nada que guardar';
}

$('pPreview').addEventListener('change', e => {
  const s = e.target.closest('select[data-pend]');
  if (s) { resolucion[s.dataset.pend] = s.value; return; }
  const c = e.target.closest('input[data-react]');
  if (c) {
    c.checked ? reactivarSel.add(c.dataset.react) : reactivarSel.delete(c.dataset.react);
    renderPreview();
  }
});

$('pReasOtros').onchange = e => { reasignarOtros = e.target.checked; renderPreview(); };

$('pAplicar').onclick = async () => {
  if (!preview) return;
  const { plan, fecha, zona } = preview;
  const usuario = D.emailActual();
  const loteId = nuevoId('L');
  const ahoraS = ahora();

  // Mensajeros nuevos y vinculaciones
  const mensNuevos = [];
  const mapa = {};
  plan.pendientes.forEach(p => {
    const v = resolucion[p.key] || 'crear';
    if (v === 'crear') {
      const id = nuevoId('m');
      const nombre = p.nombre || `Mensajero ${p.codigo}`;
      if (nombreReservado(nombre)) return toast(`Nombre reservado: ${nombre}`);
      mensNuevos.push({ id, data: { nombre, nombreNorm: normNombre(nombre), codigoEmpresa: p.codigo || '', alias: [], zona: '', activo: true, creado: hoy() } });
      mapa[p.key] = id;
    } else {
      mapa[p.key] = v;
    }
  });

  const cargas = new Map();
  const guias = [];
  filasAplicables().forEach(f => {
    const mid = f.mensajeroId || (f.pendienteKey ? mapa[f.pendienteKey] : null);
    if (!mid) return;
    const cid = `${mid}_${fecha}`;
    cargas.set(cid, { id: cid, data: { mensajeroId: mid, fecha, abierta: true } });
    const g = f.guia;
    const tipo = !g ? 'Asignada' : (g.estado === 'asignada' ? 'Reasignada' : 'Reactivada');
    const nuevo = mensNuevos.find(m => m.id === mid);
    guias.push({
      codigo: f.codigo,
      data: {
        estado: 'asignada',
        mensajeroId: mid,
        cargaId: cid,
        zona: zona || f.zona || (g && g.zona) || '',
        zip: f.zip || (g && g.zip) || '',
        horaMovimiento: f.horaMovimiento || '',
        ultimoMovimiento: ahoraS,
        fechaEntrada: (g && g.fechaEntrada) || fecha,
        origen: 'Pegado'
      },
      evento: evento(tipo, {
        de: g && g.mensajeroId ? nombreDe(g.mensajeroId) : '',
        a: nuevo ? nuevo.data.nombre : nombreDe(mid),
        motivo: 'Pegado',
        usuario,
        lote: loteId
      })
    });
  });

  if (!guias.length) return toast('No hay guías para guardar');
  try {
    await D.aplicarPegado(emp, {
      mensNuevos,
      cargas: [...cargas.values()],
      guias,
      lote: { id: loteId, data: { fecha, usuario, total: guias.length, tipo: 'pegado', creado: ahoraS } }
    });
    toast(`${guias.length} guía(s) guardadas`);
    preview = null;
    $('pTexto').value = '';
    await recargarMensajeros();
    renderPegado();
  } catch (e) {
    toast('No se guardó el pegado: ' + errMsg(e));
  }
};

$('pCancelar').onclick = () => { preview = null; renderPreview(); };

/* ============ ESCÁNER ============ */
function renderEscaner() {
  llenarMensajeros($('sMens'));
  if (!$('sFecha').value) $('sFecha').value = hoy();
  const modo = $('sMod').value;
  $('sMensWrap').classList.toggle('oculto', modo !== 'asignar');
  $('sZonaWrap').classList.toggle('oculto', modo !== 'asignar');
  $('sMotivoWrap').classList.toggle('oculto', modo !== 'fallido');
  $('sInput').disabled = modo === 'asignar' && !$('sMens').value;
  const ok = sesion.filter(s => s.tipo === 'ok').length;
  $('sContador').textContent = `${ok} procesadas · ${sesion.length - ok} con aviso`;
  $('sLista').innerHTML = sesion.slice(0, 60).map(s =>
    `<div class="item"><code>${esc(s.codigo)}</code><span class="${s.tipo === 'ok' ? 'ok-t' : s.tipo === 'warn' ? 'warn-t' : 'err-t'}">${esc(s.texto)}</span></div>`
  ).join('') || '<div class="small">Sin lecturas todavía.</div>';
}
$('sMod').onchange = renderEscaner;
$('sMens').onchange = renderEscaner;

function registrarSesion(codigo, tipo, texto) {
  sesion.unshift({ codigo, tipo, texto });
  renderEscaner();
}

async function escanear(valor) {
  const codigo = (valor || '').trim().toUpperCase();
  $('sInput').value = '';
  $('sInput').focus();
  if (!codigo) return;
  if (!EMPRESAS[emp].valido(codigo)) return registrarSesion(codigo, 'err', `Formato no válido (${EMPRESAS[emp].formato})`);
  if (sesion.some(s => s.codigo === codigo && s.tipo === 'ok')) return registrarSesion(codigo, 'warn', 'Ya procesada en esta sesión');

  const modo = $('sMod').value;
  const fecha = $('sFecha').value || hoy();
  const zona = $('sZona').value.trim();
  const usuario = D.emailActual();
  try {
    const g = await D.obtenerGuia(emp, codigo);

    if (modo === 'asignar') {
      const mid = $('sMens').value;
      if (!mid) return registrarSesion(codigo, 'err', 'Selecciona un mensajero');
      if (g && g.estado === 'asignada') return registrarSesion(codigo, 'warn', `Repetida: ya está con ${nombreDe(g.mensajeroId)}`);
      const cid = `${mid}_${fecha}`;
      const cambios = {
        estado: 'asignada',
        mensajeroId: mid,
        cargaId: cid,
        ultimoMovimiento: ahora(),
        fechaEntrada: g ? (g.fechaEntrada || fecha) : fecha,
        origen: 'Escáner'
      };
      if (zona) cambios.zona = zona;
      await D.guardarCarga(emp, cid, { mensajeroId: mid, fecha, abierta: true });
      await D.cambiarGuia(emp, codigo, {
        esperado: g ? [g.estado] : null,
        cambios,
        eventos: [evento(g ? 'Nuevo ciclo: asignada' : 'Asignada', {
          de: g ? nombreDe(g.mensajeroId) : '', a: nombreDe(mid), motivo: 'Escáner', usuario
        })]
      });
      return registrarSesion(codigo, 'ok', `→ ${nombreDe(mid)}${g ? ' (nuevo ciclo)' : ''}`);
    }

    if (modo === 'entregada') {
      if (!g) return registrarSesion(codigo, 'err', 'No existe en la base');
      if (g.estado !== 'asignada') return registrarSesion(codigo, 'err', `Estado actual: ${ETQ_ESTADO[g.estado]}`);
      await D.cambiarGuia(emp, codigo, {
        esperado: ['asignada'],
        cambios: { estado: 'entregada', ultimoMovimiento: ahora() },
        eventos: [evento('Entregada', { de: nombreDe(g.mensajeroId), motivo: 'Escáner', usuario })]
      });
      if (g.cargaId) await sincronizarCarga(g.cargaId);
      return registrarSesion(codigo, 'ok', `✔ Entregada · ${nombreDe(g.mensajeroId)}`);
    }

    if (modo === 'devolucion') {
      if (!g) return registrarSesion(codigo, 'err', 'No existe en la base');
      if (g.estado !== 'asignada') return registrarSesion(codigo, 'err', `Estado actual: ${ETQ_ESTADO[g.estado]}`);
      const de = nombreDe(g.mensajeroId);
      await D.cambiarGuia(emp, codigo, {
        esperado: ['asignada'],
        cambios: { estado: 'almacen', ultimoMovimiento: ahora() },
        eventos: [evento('Devuelta por mensajero', { de, a: 'Oficina', motivo: 'Escáner', usuario })]
      });
      return registrarSesion(codigo, 'ok', `↩ Devuelta por ${de} → oficina`);
    }

    if (modo === 'fallido') {
      if (!g) return registrarSesion(codigo, 'err', 'No existe en la base');
      if (!['asignada', 'almacen'].includes(g.estado)) return registrarSesion(codigo, 'err', `Estado actual: ${ETQ_ESTADO[g.estado]}`);
      const motivo = $('sMotivo').value;
      const eventos = [];
      if (g.estado === 'asignada') {
        eventos.push(evento('Devuelta por mensajero', { de: nombreDe(g.mensajeroId), a: 'Almacén principal', motivo: 'Devolución directa', usuario }));
      }
      eventos.push(evento('Fallido devolución', { a: 'Almacén principal', motivo, usuario }));
      await D.cambiarGuia(emp, codigo, {
        esperado: [g.estado],
        cambios: { estado: 'fallido', ultimoMovimiento: ahora() },
        eventos
      });
      return registrarSesion(codigo, 'ok', `✕ Fallido devolución${motivo ? ' · ' + motivo : ''}`);
    }
  } catch (e) {
    registrarSesion(codigo, 'err', errMsg(e));
  }
}

$('sInput').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); escanear($('sInput').value); } });
$('sBtn').onclick = () => escanear($('sInput').value);
$('sLimpiar').onclick = () => { sesion = []; renderEscaner(); };

/* ============ CARGAS Y RUTAS (calendario por día) ============ */
let calMes = hoy().slice(0, 7);
let diaSel = hoy();
let cargasMes = [];
let diaDatos = [];      // [{ c, gs }] del día seleccionado
let ocupado = false;

async function renderCargas() {
  await cargarMes();
  pintarCalendario();
  await dibujarDia();
}

async function cargarMes() {
  const { ini, fin } = periodoDe(calMes, 'm');
  cargasMes = await D.cargasPeriodo(emp, ini, fin);
}

function pintarCalendario() {
  const [y, m] = calMes.split('-').map(Number);
  const porDia = {};
  cargasMes.forEach(c => {
    const x = porDia[c.fecha] || (porDia[c.fecha] = { n: 0, abiertas: 0 });
    x.n++;
    if (c.abierta) x.abiertas++;
  });
  $('calTitulo').textContent = new Date(y, m - 1, 1).toLocaleDateString('es', { month: 'long', year: 'numeric' });
  const offset = (new Date(y, m - 1, 1).getDay() + 6) % 7;   // semana empieza en lunes
  const ult = new Date(y, m, 0).getDate();
  let h = ['L', 'M', 'M', 'J', 'V', 'S', 'D'].map(d => `<div class="cal-dow">${d}</div>`).join('');
  for (let i = 0; i < offset; i++) h += '<div class="cal-dia vacio"></div>';
  for (let d = 1; d <= ult; d++) {
    const f = `${y}-${pad(m)}-${pad(d)}`;
    const info = porDia[f];
    const cls = ['cal-dia', info ? (info.abiertas ? 'abierta' : 'cerrada') : '', f === hoy() ? 'hoy' : '', f === diaSel ? 'sel' : ''].join(' ');
    h += `<button class="${cls}" data-dia="${f}">${d}<small>${info ? info.n + (info.n > 1 ? ' rutas' : ' ruta') : ''}</small></button>`;
  }
  $('calGrid').innerHTML = h;
}

async function moverMes(delta) {
  const [y, m] = calMes.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  calMes = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  await cargarMes();
  pintarCalendario();
}

$('calPrev').onclick = () => moverMes(-1).catch(e => toast(errMsg(e)));
$('calNext').onclick = () => moverMes(1).catch(e => toast(errMsg(e)));
$('calHoy').onclick = () => { calMes = hoy().slice(0, 7); diaSel = hoy(); renderCargas().catch(e => toast(errMsg(e))); };
$('calGrid').addEventListener('click', e => {
  const b = e.target.closest('button[data-dia]');
  if (!b) return;
  diaSel = b.dataset.dia;
  pintarCalendario();
  dibujarDia().catch(err => toast(errMsg(err)));
});

let tokenDia = 0;
async function dibujarDia() {
  const token = ++tokenDia;
  const cont = $('diaDetalle');
  const [y, m, d] = diaSel.split('-').map(Number);
  const titulo = new Date(y, m - 1, d).toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const cargas = (await D.cargasPeriodo(emp, diaSel, diaSel))
    .sort((a, b) => nombreDe(a.mensajeroId).localeCompare(nombreDe(b.mensajeroId)));
  const datos = await Promise.all(cargas.map(async c => ({
    c, gs: (await D.guiasDeCarga(emp, c.id)).sort((a, b) => a.id.localeCompare(b.id))
  })));
  if (token !== tokenDia) return;      // el usuario cambió de día mientras cargaba
  diaDatos = datos;

  if (!datos.length) {
    cont.innerHTML = `<div class="panel"><h2 style="text-transform:capitalize">${esc(titulo)}</h2><div class="small">No hay rutas este día.</div></div>`;
    return;
  }

  const cuenta = (gs, est) => gs.filter(g => g.estado === est).length;
  const totRuta = datos.reduce((n, x) => n + cuenta(x.gs, 'asignada'), 0);
  const totEnt = datos.reduce((n, x) => n + cuenta(x.gs, 'entregada'), 0);
  const totDev = datos.reduce((n, x) => n + x.gs.filter(g => g.estado === 'almacen' || g.estado === 'fallido').length, 0);

  let h = `<div class="panel">
    <div class="ruta-head">
      <div>
        <h2 style="margin:0;text-transform:capitalize">${esc(titulo)}</h2>
        <div class="small">${datos.length} ruta(s) · ${totRuta} en ruta · ${totEnt} entregadas · ${totDev} devueltas</div>
      </div>
      <div class="acciones">
        <button class="primary" id="btnSel" data-acc="sel" disabled>Registrar seleccionadas (0)</button>
        <button class="outline" data-acc="dia" ${totRuta ? '' : 'disabled'}>Marcar todas las del día entregadas</button>
      </div>
    </div>
  </div>`;

  datos.forEach(({ c, gs }) => {
    const ruta = cuenta(gs, 'asignada'), ent = cuenta(gs, 'entregada');
    const dev = gs.filter(g => g.estado === 'almacen' || g.estado === 'fallido').length;
    h += `<div class="panel">
      <div class="ruta-head">
        <div>
          <b>${esc(nombreDe(c.mensajeroId))}</b>
          <span class="badge ${c.abierta ? 'b-asignada' : 'b-cerrada'}">${c.abierta ? 'Abierta' : 'Cerrada'}</span>
          <div class="small">${ruta} en ruta · ${ent} entregadas · ${dev} devueltas</div>
        </div>
        <div class="acciones">
          <button class="outline sm" data-acc="selruta" data-cid="${esc(c.id)}" ${ruta ? '' : 'disabled'}>Seleccionar en ruta</button>
          <button class="outline sm" data-acc="ruta" data-cid="${esc(c.id)}" ${ruta ? '' : 'disabled'}>Todas entregadas</button>
          <button class="outline sm" data-acc="reabrir" data-cid="${esc(c.id)}" ${ent ? '' : 'disabled'}>Reabrir ruta</button>
        </div>
      </div>
      <details open><summary>${gs.length} guía(s)</summary>
        <div class="table-wrap"><table>
          <thead><tr><th></th><th>Guía</th><th>Zona</th><th>Estado</th><th></th></tr></thead>
          <tbody>${gs.map(g => `<tr>
            <td>${g.estado === 'asignada' ? `<input type="checkbox" data-sel="${esc(g.id)}" data-cid="${esc(c.id)}">` : ''}</td>
            <td><code>${esc(g.id)}</code></td>
            <td>${esc(g.zona || '—')}</td>
            <td>${badge(g.estado)}</td>
            <td class="acciones">${g.estado === 'asignada'
              ? `<button class="outline sm" data-acc="uno" data-id="${esc(g.id)}" data-cid="${esc(c.id)}">Entregada</button>`
              : g.estado === 'entregada'
                ? `<button class="outline sm" data-acc="deshacer" data-id="${esc(g.id)}" data-cid="${esc(c.id)}">Deshacer</button>`
                : ''}</td>
          </tr>`).join('')}</tbody>
        </table></div>
      </details>
    </div>`;
  });
  cont.innerHTML = h;
}

// Guías en ruta del día (o de una sola carga) listas para procesar
function enRutaDelDia(cid) {
  const lista = [];
  diaDatos.forEach(({ c, gs }) => {
    if (cid && c.id !== cid) return;
    gs.filter(g => g.estado === 'asignada').forEach(g => lista.push({ codigo: g.id, cid: c.id, mid: c.mensajeroId }));
  });
  return lista;
}

function actualizarSel() {
  const n = $('diaDetalle').querySelectorAll('input[data-sel]:checked').length;
  const b = $('btnSel');
  if (b) { b.textContent = `Registrar seleccionadas (${n})`; b.disabled = n === 0; }
}
$('diaDetalle').addEventListener('change', e => { if (e.target.matches('input[data-sel]')) actualizarSel(); });

// Cambia el estado de varias guías con transacción (si alguien más la tocó, esa se omite)
async function moverGuias(lista, esperado, nuevoEstado, tipoEvento, motivo) {
  const usuario = D.emailActual();
  let ok = 0, fallo = 0;
  const tocadas = new Set();
  for (let i = 0; i < lista.length; i += 15) {
    await Promise.all(lista.slice(i, i + 15).map(async it => {
      try {
        await D.cambiarGuia(emp, it.codigo, {
          esperado: [esperado],
          cambios: { estado: nuevoEstado, ultimoMovimiento: ahora() },
          eventos: [evento(tipoEvento, { de: nombreDe(it.mid), motivo, usuario })]
        });
        ok++;
        tocadas.add(it.cid);
      } catch (e) { fallo++; }
    }));
  }
  for (const cid of tocadas) await sincronizarCarga(cid);
  return { ok, fallo };
}

// Una ruta queda cerrada cuando ya no tiene guías en camino
async function sincronizarCarga(cid) {
  const gs = await D.guiasDeCarga(emp, cid);
  const quedan = gs.filter(g => g.estado === 'asignada').length;
  await D.guardarCarga(emp, cid, { abierta: quedan > 0, cerrada: quedan ? null : ahora() });
}

async function ejecutarDia(fn, textoOk) {
  if (ocupado) return;
  ocupado = true;
  try {
    const { ok, fallo } = await fn();
    toast(`${textoOk(ok)}${fallo ? ` · ${fallo} no se pudieron cambiar (otra persona las modificó)` : ''}`);
    await cargarMes();
    pintarCalendario();
    await dibujarDia();
  } catch (e) {
    toast(errMsg(e));
  } finally {
    ocupado = false;
  }
}

$('diaDetalle').addEventListener('click', e => {
  const b = e.target.closest('button[data-acc]');
  if (!b || b.disabled) return;
  const acc = b.dataset.acc, cid = b.dataset.cid, id = b.dataset.id;
  const mid = cid ? (diaDatos.find(x => x.c.id === cid) || { c: {} }).c.mensajeroId : '';

  if (acc === 'uno') {
    return ejecutarDia(() => moverGuias([{ codigo: id, cid, mid }], 'asignada', 'entregada', 'Entregada', 'Registro de entrega'), () => 'Entrega registrada');
  }
  if (acc === 'deshacer') {
    return ejecutarDia(() => moverGuias([{ codigo: id, cid, mid }], 'entregada', 'asignada', 'Reabierta', 'Entrega deshecha'), () => 'Entrega deshecha, la guía vuelve a ruta');
  }
  if (acc === 'sel') {
    const lista = [...$('diaDetalle').querySelectorAll('input[data-sel]:checked')].map(i => ({
      codigo: i.dataset.sel, cid: i.dataset.cid,
      mid: (diaDatos.find(x => x.c.id === i.dataset.cid) || { c: {} }).c.mensajeroId
    }));
    return ejecutarDia(() => moverGuias(lista, 'asignada', 'entregada', 'Entregada', 'Registro de entrega'),
      ok => `${ok} entregada(s); el resto sigue en ruta`);
  }
  if (acc === 'selruta') {
    const cajas = [...$('diaDetalle').querySelectorAll(`input[data-sel][data-cid="${CSS.escape(cid)}"]`)];
    const todas = cajas.every(c => c.checked);
    cajas.forEach(c => { c.checked = !todas; });
    return actualizarSel();
  }
  if (acc === 'ruta' || acc === 'dia') {
    const lista = enRutaDelDia(acc === 'ruta' ? cid : null);
    if (!lista.length) return toast('No hay guías en ruta');
    const donde = acc === 'ruta' ? `de ${nombreDe(mid)}` : 'de todas las rutas de este día';
    if (!confirm(`¿Marcar como entregadas las ${lista.length} guía(s) en ruta ${donde}?`)) return;
    return ejecutarDia(() => moverGuias(lista, 'asignada', 'entregada', 'Entregada', 'Ruta entregada'), ok => `${ok} entregada(s)`);
  }
  if (acc === 'reabrir') {
    const ent = (diaDatos.find(x => x.c.id === cid) || { gs: [] }).gs.filter(g => g.estado === 'entregada');
    if (!confirm(`¿Reabrir la ruta? ${ent.length} guía(s) entregadas volverán a ruta.`)) return;
    return ejecutarDia(() => moverGuias(ent.map(g => ({ codigo: g.id, cid, mid })), 'entregada', 'asignada', 'Reabierta', 'Ruta reabierta'), ok => `${ok} guía(s) vuelven a ruta`);
  }
});

/* ============ DEVOLUCIONES ============ */
async function renderDevoluciones() {
  const [alm, fal] = await Promise.all([D.guiasPorEstado(emp, 'almacen'), D.guiasPorEstado(emp, 'fallido')]);
  const opts = mensajeros.filter(m => m.activo).sort((a, b) => a.nombre.localeCompare(b.nombre))
    .map(m => `<option value="${esc(m.id)}">${esc(m.nombre)}</option>`).join('');
  $('dAlmacen').innerHTML = alm.map(g => `
    <tr>
      <td><code>${esc(g.id)}</code></td>
      <td>${esc(g.zona || '—')}</td>
      <td>${esc(g.ultimoMovimiento || '')}</td>
      <td class="acciones">
        <select data-dev-sel="${esc(g.id)}"><option value="">Reenviar a…</option>${opts}</select>
        <button class="outline sm" data-dev="reenviar" data-id="${esc(g.id)}">Reenviar</button>
        <button class="outline sm" data-dev="fallido" data-id="${esc(g.id)}">→ Fallido</button>
      </td>
    </tr>`).join('') || '<tr><td colspan="4" class="small">Oficina vacía.</td></tr>';
  $('dFallido').innerHTML = fal.map(g => `
    <tr>
      <td><code>${esc(g.id)}</code></td>
      <td>${esc(g.ultimoMovimiento || '')}</td>
      <td><button class="outline sm" data-ver="${esc(g.id)}">Ver historial</button></td>
    </tr>`).join('') || '<tr><td colspan="3" class="small">Sin fallidos.</td></tr>';
}

$('v-devoluciones').addEventListener('click', async e => {
  const ver = e.target.closest('button[data-ver]');
  if (ver) { $('bBuscar').value = ver.dataset.ver; mostrarVista('buscador'); return buscar(); }
  const b = e.target.closest('button[data-dev]');
  if (!b) return;
  const codigo = b.dataset.id;
  const usuario = D.emailActual();
  try {
    if (b.dataset.dev === 'reenviar') {
      const mid = document.querySelector(`select[data-dev-sel="${codigo}"]`).value;
      if (!mid) return toast('Elige el mensajero');
      const fecha = hoy();
      const cid = `${mid}_${fecha}`;
      await D.guardarCarga(emp, cid, { mensajeroId: mid, fecha, abierta: true });
      await D.cambiarGuia(emp, codigo, {
        esperado: ['almacen'],
        cambios: { estado: 'asignada', mensajeroId: mid, cargaId: cid, ultimoMovimiento: ahora() },
        eventos: [evento('Reenviada', { de: 'Oficina', a: nombreDe(mid), motivo: 'Desde oficina', usuario })]
      });
      toast('Guía reenviada');
    } else {
      const motivo = prompt('Motivo (opcional). Déjalo vacío si no aplica:', '');
      if (motivo === null) return;
      await D.cambiarGuia(emp, codigo, {
        esperado: ['almacen'],
        cambios: { estado: 'fallido', ultimoMovimiento: ahora() },
        eventos: [evento('Fallido devolución', { a: 'Almacén principal', motivo: motivo.trim(), usuario })]
      });
      toast('Despachada al almacén principal');
    }
    renderDevoluciones();
  } catch (err) {
    toast(errMsg(err));
  }
});

/* ============ BUSCADOR ============ */
async function buscar() {
  const codigo = $('bBuscar').value.trim().toUpperCase();
  if (!codigo) return;
  const g = await D.obtenerGuia(emp, codigo);
  if (!g) { $('bResultado').innerHTML = `<div class="alerta">No encontré la guía ${esc(codigo)}.</div>`; return; }
  const ev = await D.eventosDe(emp, codigo);
  const fall = ev.find(x => x.tipo === 'Fallido devolución');
  let aviso;
  if (g.estado === 'fallido') {
    aviso = `<div class="alerta fallido">Devuelta al almacén principal${fall ? ' el ' + esc(fall.at.slice(0, 10)) : ''}${fall && fall.motivo ? '. Motivo: ' + esc(fall.motivo) : ''}. Ya no está en la oficina ni con un mensajero.</div>`;
  } else if (g.estado === 'entregada') {
    aviso = `<div class="alerta ok">Entregada por ${esc(nombreDe(g.mensajeroId))}.</div>`;
  } else if (g.estado === 'almacen') {
    aviso = '<div class="alerta almacen">En oficina.</div>';
  } else {
    aviso = `<div class="alerta ok">En ruta con ${esc(nombreDe(g.mensajeroId))}.</div>`;
  }
  $('bResultado').innerHTML = `
    ${aviso}
    <div class="panel">
      <div class="grid2">
        <div><small>Guía</small><div class="code grande">${esc(g.id)}</div></div>
        <div>${badge(g.estado)}</div>
        <div><small>Mensajero actual</small><div>${esc(nombreDe(g.mensajeroId))}</div></div>
        <div><small>Carga</small><div>${esc(g.cargaId || '—')}</div></div>
        <div><small>Zona</small><div>${esc(g.zona || '—')}</div></div>
        <div><small>Entrada</small><div>${esc(g.fechaEntrada || '')}</div></div>
      </div>
      <h3>Historial completo</h3>
      <div class="table-wrap"><table>
        <thead><tr><th>Cuándo</th><th>Acción</th><th>De</th><th>A</th><th>Motivo</th></tr></thead>
        <tbody>${ev.map(x => `<tr><td>${esc(x.at)}</td><td>${esc(x.tipo)}</td><td>${esc(x.de || '—')}</td><td>${esc(x.a || '—')}</td><td>${esc(x.motivo || '')}</td></tr>`).join('') || '<tr><td colspan="5">Sin eventos</td></tr>'}</tbody>
      </table></div>
    </div>`;
}
$('bBuscar').addEventListener('keydown', e => { if (e.key === 'Enter') buscar(); });
$('bBtn').onclick = buscar;

/* ============ MENSAJEROS ============ */
function renderMensajeros() {
  const lista = mensajeros.slice().sort((a, b) => a.nombre.localeCompare(b.nombre));
  $('mTabla').innerHTML = lista.map(m => `
    <tr>
      <td>${esc(m.nombre)}</td>
      <td><code>${esc(m.codigoEmpresa || '—')}</code></td>
      <td>${esc(m.zona || '—')}</td>
      <td><span class="badge ${m.activo ? 'b-entregada' : 'b-cerrada'}">${m.activo ? 'Activo' : 'Inactivo'}</span></td>
      <td class="acciones">
        <button class="outline sm" data-m="renombrar" data-id="${esc(m.id)}">Renombrar</button>
        <button class="outline sm" data-m="activo" data-id="${esc(m.id)}">${m.activo ? 'Desactivar' : 'Activar'}</button>
      </td>
    </tr>`).join('') || '<tr><td colspan="5" class="small">Todavía no hay mensajeros.</td></tr>';
}

$('mNuevo').onclick = async () => {
  const nombre = $('mNombre').value.trim();
  if (!nombre) return toast('Escribe el nombre');
  if (nombreReservado(nombre)) return toast('Ese nombre está reservado para el sistema');
  if (mensajeros.some(m => normNombre(m.nombre) === normNombre(nombre))) return toast('Ya existe un mensajero con ese nombre');
  const parecido = mensajeros.find(m => similitud(m.nombre, nombre) >= 0.6);
  if (parecido && !confirm(`Ya existe "${parecido.nombre}", que se parece. ¿Crear como nuevo de todos modos?`)) return;
  const id = nuevoId('m');
  await D.escribirLote(emp, [{ tipo: 'set', ref: D.refMensajero(emp, id), data: {
    nombre, nombreNorm: normNombre(nombre), codigoEmpresa: '', alias: [],
    zona: $('mZona').value.trim(), activo: true, creado: hoy()
  } }]);
  $('mNombre').value = '';
  $('mZona').value = '';
  await recargarMensajeros();
  renderMensajeros();
  toast('Mensajero registrado');
};

$('mTabla').addEventListener('click', async e => {
  const b = e.target.closest('button[data-m]');
  if (!b) return;
  const m = mensajeros.find(x => x.id === b.dataset.id);
  if (!m) return;
  let data;
  if (b.dataset.m === 'renombrar') {
    const n = prompt('Nuevo nombre', m.nombre);
    if (!n || !n.trim()) return;
    if (nombreReservado(n)) return toast('Ese nombre está reservado');
    data = { nombre: n.trim(), nombreNorm: normNombre(n) };
  } else {
    data = { activo: !m.activo };
  }
  await D.escribirLote(emp, [{ tipo: 'set', ref: D.refMensajero(emp, m.id), data, merge: true }]);
  await recargarMensajeros();
  renderMensajeros();
});

/* ============ CONFIGURACIÓN: IMPORTAR LA BASE ANTERIOR (JSON) ============ */
$('btnImportar').onclick = () => $('fImport').click();
$('fImport').onchange = e => {
  const f = e.target.files[0];
  if (!f) return;
  const lector = new FileReader();
  lector.onload = () => importar(JSON.parse(lector.result)).catch(err => toast('Error al importar: ' + errMsg(err)));
  lector.readAsText(f);
  e.target.value = '';
};

async function importar(d) {
  if (!d || !d.guias) return toast('El archivo no tiene el formato de la versión anterior');
  const nG = Object.keys(d.guias).length, nM = Object.keys(d.mensajeros || {}).length;
  if (!confirm(`Importar ${nG} guías y ${nM} mensajeros a ${EMPRESAS[emp].nombre}?`)) return;
  const ops = [];
  Object.values(d.mensajeros || {}).forEach(m => ops.push({ tipo: 'set', ref: D.refMensajero(emp, m.id), merge: true, data: {
    nombre: m.nombre, nombreNorm: normNombre(m.nombre), codigoEmpresa: m.codigo || m.codigoEmpresa || '',
    alias: [], zona: m.zona || '', activo: m.activo !== false, creado: hoy()
  } }));
  Object.values(d.cargas || {}).forEach(c => ops.push({ tipo: 'set', ref: D.refCarga(emp, c.id), merge: true, data: {
    mensajeroId: c.mensajeroId, fecha: c.fecha, abierta: !c.cerrada, cerrada: c.cerrada || null
  } }));
  Object.values(d.guias).forEach(g => {
    const estado = g.estado === 'devuelta' ? 'almacen' : (g.estado || 'asignada');
    ops.push({ tipo: 'set', ref: D.refGuia(emp, g.codigo), merge: true, data: {
      estado, mensajeroId: g.mensajeroId || '', cargaId: g.cargaId || '',
      zona: g.ciudad || '', zip: g.zip || '', horaMovimiento: '',
      ultimoMovimiento: g.ultimoMov || '', fechaEntrada: (g.creada || hoy()).slice(0, 10),
      origen: g.origen || 'Importado'
    } });
    (g.historial || []).forEach(h => ops.push({ tipo: 'add', ref: D.refGuia(emp, g.codigo), data: {
      at: h.at || '', tipo: h.accion || '', de: h.de || '', a: h.a || '',
      motivo: h.motivo || h.detalle || '', usuario: 'importado', lote: 'importacion'
    } }));
  });
  await D.escribirLote(emp, ops);
  toast(`Importación lista: ${nG} guías`);
  await recargarMensajeros();
  mostrarVista('panel');
}

/* ============ ZONAS (conteo por zona en el período) ============ */
$('btnZonas').onclick = async () => {
  if (!$('pMes').value) $('pMes').value = hoy().slice(0, 7);
  const { ini, fin } = periodoDe($('pMes').value, $('pQuin').value);
  const guias = await D.guiasPeriodo(emp, ini, fin);
  const conteo = {};
  guias.forEach(g => { const k = g.zona || 'Sin zona'; conteo[k] = (conteo[k] || 0) + 1; });
  const max = Math.max(...Object.values(conteo), 1);
  $('zonasTiles').innerHTML = Object.entries(conteo).sort((a, b) => b[1] - a[1]).map(([k, n]) =>
    `<div class="zona" style="background:rgba(138,180,248,${(0.12 + 0.6 * n / max).toFixed(2)})"><span>${esc(k)}</span><b>${n}</b></div>`
  ).join('') || '<div class="small">Sin guías en este período.</div>';
};

/* ============ ARRANQUE ============ */
$('pMes').value = hoy().slice(0, 7);
$('pQuin').value = Number(hoy().slice(8, 10)) <= 15 ? '1' : '2';
$('sFecha').value = hoy();
$('pFecha').value = hoy();
