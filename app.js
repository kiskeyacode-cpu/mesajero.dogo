import { EMPRESAS } from './config.js';
import { esc, hoy, ahora, nuevoId, normNombre, nombreReservado, similitud, periodoDe } from './util.js';
import { parseEntrada } from './parsers.js';
import { planificar, evento } from './domain.js';
import * as D from './data.js';

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

/* ============ CARGAS Y RUTAS ============ */
async function renderCargas() {
  if (!$('cDesde').value) { $('cDesde').value = hoy(); $('cHasta').value = hoy(); }
  const cargas = await D.cargasPeriodo(emp, $('cDesde').value, $('cHasta').value);
  const filas = await Promise.all(cargas.map(async c => {
    const gs = await D.guiasDeCarga(emp, c.id);
    return {
      c,
      ruta: gs.filter(g => g.estado === 'asignada').length,
      ent: gs.filter(g => g.estado === 'entregada').length,
      dev: gs.filter(g => g.estado === 'almacen' || g.estado === 'fallido').length
    };
  }));
  $('cTabla').innerHTML = filas.sort((a, b) => b.c.fecha.localeCompare(a.c.fecha)).map(({ c, ruta, ent, dev }) => `
    <tr>
      <td>${esc(c.fecha)}</td>
      <td>${esc(nombreDe(c.mensajeroId))}</td>
      <td><span class="badge ${c.abierta ? 'b-asignada' : 'b-cerrada'}">${c.abierta ? 'Abierta' : 'Cerrada'}</span></td>
      <td>${ruta}</td><td>${ent}</td><td>${dev}</td>
      <td class="acciones">
        ${c.abierta
          ? `<button class="outline sm" data-carga="terminar" data-id="${esc(c.id)}" data-mid="${esc(c.mensajeroId)}">Terminar ruta</button>`
          : `<button class="outline sm" data-carga="reabrir" data-id="${esc(c.id)}">Reabrir</button>`}
      </td>
    </tr>`).join('') || '<tr><td colspan="7" class="small">No hay cargas en este rango.</td></tr>';
}
$('cDesde').onchange = renderCargas;
$('cHasta').onchange = renderCargas;

$('cTabla').addEventListener('click', async e => {
  const b = e.target.closest('button[data-carga]');
  if (!b) return;
  try {
    if (b.dataset.carga === 'terminar') await abrirTerminar(b.dataset.id, b.dataset.mid);
    else await reabrirCarga(b.dataset.id);
  } catch (err) {
    toast(errMsg(err));
  }
});

// Muestra las guías en ruta para que marques cuáles sí se entregaron
async function abrirTerminar(cid, mid) {
  const gs = (await D.guiasDeCarga(emp, cid)).filter(g => g.estado === 'asignada');
  if (!gs.length) return toast('La ruta no tiene guías en camino');
  $('tTitulo').textContent = `Terminar ruta · ${nombreDe(mid)} · ${cid.split('_').pop()}`;
  $('tLista').innerHTML = gs.map(g => `
    <label class="item">
      <span><input type="checkbox" value="${esc(g.id)}" checked> <code>${esc(g.id)}</code></span>
      <small>${esc(g.zona || '')}</small>
    </label>`).join('');
  $('tConfirmar').dataset.carga = cid;
  $('tConfirmar').dataset.mid = mid;
  $('tPanel').classList.remove('oculto');
}

$('tCancelar').onclick = () => $('tPanel').classList.add('oculto');

$('tConfirmar').onclick = async () => {
  const cid = $('tConfirmar').dataset.carga;
  const mid = $('tConfirmar').dataset.mid;
  const todas = [...$('tLista').querySelectorAll('input')].map(i => i.value);
  const entregadas = [...$('tLista').querySelectorAll('input:checked')].map(i => i.value);
  const quedan = todas.filter(c => !entregadas.includes(c));
  const usuario = D.emailActual();
  const ops = [];
  entregadas.forEach(c => {
    ops.push({ tipo: 'set', ref: D.refGuia(emp, c), data: { estado: 'entregada', ultimoMovimiento: ahora() }, merge: true });
    ops.push({ tipo: 'add', ref: D.refGuia(emp, c), data: evento('Entregada', { de: nombreDe(mid), motivo: 'Ruta terminada', usuario }) });
  });
  ops.push({ tipo: 'set', ref: D.refCarga(emp, cid), data: { abierta: quedan.length > 0, cerrada: quedan.length ? null : ahora() }, merge: true });
  try {
    await D.escribirLote(emp, ops);
    $('tPanel').classList.add('oculto');
    toast(`${entregadas.length} entregada(s)${quedan.length ? ` · ${quedan.length} siguen en ruta` : ' · ruta cerrada'}`);
    renderCargas();
  } catch (e) {
    toast('No se guardó: ' + errMsg(e));
  }
};

async function reabrirCarga(cid) {
  const gs = (await D.guiasDeCarga(emp, cid)).filter(g => g.estado === 'entregada');
  if (!confirm(`¿Reabrir la carga? ${gs.length} guía(s) volverán a ruta.`)) return;
  const usuario = D.emailActual();
  const ops = [];
  gs.forEach(g => {
    ops.push({ tipo: 'set', ref: D.refGuia(emp, g.id), data: { estado: 'asignada', ultimoMovimiento: ahora() }, merge: true });
    ops.push({ tipo: 'add', ref: D.refGuia(emp, g.id), data: evento('Reabierta', { motivo: 'Carga reabierta', usuario }) });
  });
  ops.push({ tipo: 'set', ref: D.refCarga(emp, cid), data: { abierta: true, cerrada: null }, merge: true });
  await D.escribirLote(emp, ops);
  toast('Carga reabierta');
  renderCargas();
}

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
