import { esc } from './util.js';

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const fechaCorta = iso => { const [, m, d] = iso.split('-'); return `${parseInt(d, 10)}-${MESES[parseInt(m, 10) - 1]}`; };

/* ---------- Cuadro en columnas (como Excel): una columna por mensajero ---------- */
function bloqueColumnas(cols, titulo) {
  if (!cols.length) return '';
  const max = Math.max(...cols.map(c => c.codigos.length));
  const head = cols.map(c => `<th>${esc(c.nombre)}<small>${c.codigos.length}</small></th>`).join('');
  let filas = '';
  for (let i = 0; i < max; i++) {
    filas += `<tr><td class="xl-n">${i + 1}</td>${cols.map(c => `<td>${esc(c.codigos[i] || '')}</td>`).join('')}</tr>`;
  }
  return `
    <h3>${titulo}</h3>
    <div class="row" style="margin-bottom:8px">
      <button class="outline sm" data-lm="copiar">Copiar para Excel</button>
      <button class="outline sm" data-lm="csv">Descargar CSV</button>
    </div>
    <div class="table-wrap"><table class="xl">
      <thead><tr><th class="xl-n"></th>${head}</tr></thead>
      <tbody>${filas}</tbody>
    </table></div>`;
}

function aMatriz(cols) {
  const max = Math.max(0, ...cols.map(c => c.codigos.length));
  const filas = [cols.map(c => c.nombre)];
  for (let i = 0; i < max; i++) filas.push(cols.map(c => c.codigos[i] || ''));
  return filas;
}

/* ---------- J&T ---------- */
const RE_MENS_JT = /(?:LS)?60000640\d{3}\s+([^\t\r\n]+?)\s+0(?=\s|$)/;
// Primera fecha sin hora (las fechas con hora son de escaneo)
const RE_FECHA_JT = /(\d{4}-\d{2}-\d{2})(?!\s+\d{2}:\d{2})/;
const limpiarNombre = n => n.replace(/\.pcp$/i, '').replace(/\s+/g, ' ').trim();

function procesarJT(texto) {
  const registros = texto.split(/(?=JDM\d+)/).filter(r => /^JDM\d+/.test(r));
  if (!registros.length) return { html: '<div class="alerta">No encontré registros. Revisa que la data esté completa.</div>', cols: [] };

  const conteo = new Map();
  const fechas = new Set();
  let sinMensajero = 0, sinFecha = 0;

  for (const reg of registros) {
    const m = reg.match(RE_MENS_JT);
    if (!m) { sinMensajero++; continue; }
    const nombre = limpiarNombre(m[1]);
    const f = reg.match(RE_FECHA_JT);
    const fecha = f ? f[1] : null;
    if (!fecha) sinFecha++; else fechas.add(fecha);
    const guia = reg.match(/^JDM\d+/)[0];

    if (!conteo.has(nombre)) conteo.set(nombre, { total: 0, porFecha: new Map(), codigos: [] });
    const info = conteo.get(nombre);
    info.total++;
    if (!info.codigos.includes(guia)) info.codigos.push(guia);
    if (fecha) info.porFecha.set(fecha, (info.porFecha.get(fecha) || 0) + 1);
  }

  const fechasOrd = [...fechas].sort();
  const filas = [...conteo.entries()].sort((a, b) => b[1].total - a[1].total);
  const totPorFecha = new Map();
  filas.forEach(([, i]) => i.porFecha.forEach((n, f) => totPorFecha.set(f, (totPorFecha.get(f) || 0) + n)));

  const encFechas = fechasOrd.map(f => `<th class="num">${fechaCorta(f)}</th>`).join('');
  const celdas = filas.map(([nombre, i]) =>
    `<tr><td>${esc(nombre)}</td>${fechasOrd.map(f => `<td class="num">${i.porFecha.get(f) || ''}</td>`).join('')}<td class="num"><b>${i.total}</b></td></tr>`
  ).join('');
  const totales = fechasOrd.map(f => `<td class="num">${totPorFecha.get(f) || 0}</td>`).join('');

  const total = registros.length;
  const mTotal = texto.match(/Total\s+(\d+)/i);
  let cotejo = '';
  if (mTotal) {
    const dec = parseInt(mTotal[1], 10);
    cotejo = dec === total
      ? `<div class="alerta ok">✔ Coincide con el total declarado en el documento (${dec}).</div>`
      : `<div class="alerta fallido">✘ El documento dice ${dec} pero se contaron ${total} registros.</div>`;
  }

  const cols = filas.map(([nombre, i]) => ({ nombre, codigos: i.codigos }));
  const html = `
    <div class="chips"><div class="chip">Registros: <b>${total}</b></div><div class="chip">Mensajeros: <b>${filas.length}</b></div></div>
    <div class="panel">
      <h2>Registros por mensajero y fecha</h2>
      <div class="table-wrap"><table>
        <thead><tr><th>Mensajero</th>${encFechas}<th class="num">Total</th></tr></thead>
        <tbody>${celdas}</tbody>
        <tfoot><tr><td>Total general</td>${totales}<td class="num">${total}</td></tr></tfoot>
      </table></div>
      ${sinMensajero ? `<div class="alerta almacen" style="margin-top:12px">⚠ ${sinMensajero} registro(s) sin mensajero identificado.</div>` : ''}
      ${sinFecha ? `<div class="alerta almacen" style="margin-top:12px">⚠ ${sinFecha} registro(s) sin fecha identificada.</div>` : ''}
      ${cotejo}
    </div>
    <div class="panel">${bloqueColumnas(cols, 'Guías por mensajero (columnas)')}</div>`;
  return { html, cols };
}

/* ---------- IMILE ---------- */
const TS = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})\t/;
const RE_COD = /\bD\d{11}\b/;
const RE_GUIA = /(?<!\d)\d{13}(?!\d)/g;
const RE_NOMBRE = /^[A-Za-zÁÉÍÓÚÑáéíóúñ][A-Za-zÁÉÍÓÚÑáéíóúñ .'-]*$/;
const NO_NOMBRE = /^(OSPerdelivered|DOGO EXPRESS S\.R\.L\.)$/;

function parsearIMILE(texto) {
  const regs = [];
  let cur = null;
  for (const raw of texto.split(/\r?\n/)) {
    const m = raw.match(TS);
    if (m) {
      const cod = raw.match(RE_COD);
      cur = { fecha: m[1], hora: m[2], codigo: cod ? cod[0] : null, nombre: null, zona: null, guias: new Set() };
      regs.push(cur);
    }
    if (!cur) continue;
    (raw.match(RE_GUIA) || []).forEach(g => cur.guias.add(g));
    if (m) continue;

    const t = raw.trim();
    if (!cur.nombre && t && RE_NOMBRE.test(t) && !NO_NOMBRE.test(t)) cur.nombre = t;
    if (cur.zona === null) {
      const campos = raw.split('\t').map(s => s.trim());
      const i = campos.findIndex(c => /^G-SantoDomingo/.test(c) || c === 'DOGO EXPRESS');
      if (i >= 0) cur.zona = campos[i + 1] || '(sin zona)';
    }
  }
  return regs;
}

function procesarIMILE(texto) {
  const regs = parsearIMILE(texto);
  if (!regs.length) return { html: '<div class="alerta">No encontré registros. Revisa que la data empiece con fecha y hora.</div>', cols: [] };

  const sinCodigo = regs.filter(r => !r.codigo).length;
  const mapa = new Map();
  for (const r of regs) {
    if (!r.codigo) continue;
    if (!mapa.has(r.codigo)) mapa.set(r.codigo, { codigo: r.codigo, total: 0, nombres: new Map(), zonas: new Map(), fechas: new Set(), primera: null, ultima: null, guias: new Set() });
    const m = mapa.get(r.codigo);
    m.total++;
    const n = r.nombre || '(sin nombre)';
    m.nombres.set(n, (m.nombres.get(n) || 0) + 1);
    const z = r.zona || '(sin zona)';
    m.zonas.set(z, (m.zonas.get(z) || 0) + 1);
    m.fechas.add(r.fecha);
    r.guias.forEach(g => m.guias.add(g));
    const marca = `${r.fecha} ${r.hora}`;
    if (!m.primera || marca < m.primera) m.primera = marca;
    if (!m.ultima || marca > m.ultima) m.ultima = marca;
  }
  const mens = [...mapa.values()].sort((a, b) => b.total - a.total);
  const principal = m => [...m.nombres.entries()].sort((a, b) => b[1] - a[1])[0][0];

  const zonasTot = new Map();
  regs.forEach(r => { if (r.codigo) { const z = r.zona || '(sin zona)'; zonasTot.set(z, (zonasTot.get(z) || 0) + 1); } });
  const zonas = [...zonasTot.entries()].sort((a, b) => b[1] - a[1]).map(z => z[0]);

  const encZ = zonas.map(z => `<th class="num">${esc(z)}</th>`).join('');
  const filasAsig = mens.map(m =>
    `<tr><td>${esc(principal(m))}</td>${zonas.map(z => `<td class="num">${m.zonas.get(z) || ''}</td>`).join('')}<td class="num"><b>${m.total}</b></td></tr>`
  ).join('');
  const totZ = zonas.map(z => `<td class="num">${zonasTot.get(z)}</td>`).join('');
  const filasCod = mens.map(m => `<tr>
    <td>${esc(m.codigo)}</td><td>${esc([...m.nombres.keys()].join(' / '))}</td><td class="num">${m.total}</td>
    <td>${esc([...m.fechas].sort().join(', '))}</td><td>${esc(m.primera)}</td><td>${esc(m.ultima)}</td></tr>`).join('');

  const cols = mens.map(m => ({ nombre: principal(m), codigos: [...m.guias] })).filter(c => c.codigos.length);
  const sinGuias = !cols.length
    ? '<div class="alerta almacen">No encontré guías de 13 dígitos dentro de los registros, así que no pude armar el cuadro de guías por mensajero.</div>'
    : '';

  const html = `
    <div class="chips">
      <div class="chip">Registros: <b>${regs.length}</b></div>
      <div class="chip">Mensajeros: <b>${mens.length}</b></div>
      <div class="chip">Zonas: <b>${zonas.length}</b></div>
      <div class="chip ${sinCodigo ? 'err' : ''}">Sin código: <b>${sinCodigo}</b></div>
    </div>
    <div class="panel">
      <h2>Cuadro de asignación (registros por zona)</h2>
      <div class="table-wrap"><table>
        <thead><tr><th>Mensajero</th>${encZ}<th class="num">Total</th></tr></thead>
        <tbody>${filasAsig}</tbody>
        <tfoot><tr><td>Total</td>${totZ}<td class="num">${regs.length - sinCodigo}</td></tr></tfoot>
      </table></div>
    </div>
    <div class="panel">
      <h2>Códigos de mensajero</h2>
      <div class="table-wrap"><table>
        <thead><tr><th>Código</th><th>Nombre(s) en la data</th><th class="num">Registros</th><th>Fechas</th><th>Primer escaneo</th><th>Último escaneo</th></tr></thead>
        <tbody>${filasCod}</tbody>
      </table></div>
      ${sinCodigo ? `<div class="alerta almacen" style="margin-top:12px">⚠ ${sinCodigo} registro(s) sin código D; no se contaron.</div>` : ''}
    </div>
    <div class="panel">${sinGuias}${bloqueColumnas(cols, 'Guías por mensajero (columnas)')}</div>`;
  return { html, cols };
}

/* ---------- Pantalla ---------- */
export function iniciarLimpiador(emp, cont) {
  if (cont.dataset.listo) return;
  cont.dataset.listo = '1';
  const jt = emp === 'jt';
  cont.innerHTML = `
    <div class="panel">
      <p class="small" style="margin-top:0">${jt
        ? 'Pega la data de J&amp;T tal cual: cada registro empieza con su guía JDM.'
        : 'Pega los escaneos de IMILE tal cual: cada registro empieza con fecha y hora.'}</p>
      <textarea id="lmTexto" placeholder="Pega la data aquí..."></textarea>
      <div class="row" style="margin-top:10px">
        <button class="primary" id="lmProcesar">Procesar</button>
        <button class="outline" id="lmLimpiar">Limpiar</button>
      </div>
    </div>
    <div id="lmSalida"></div>`;

  const salida = cont.querySelector('#lmSalida');
  let cols = [];

  cont.querySelector('#lmProcesar').onclick = () => {
    const texto = cont.querySelector('#lmTexto').value;
    if (!texto.trim()) { salida.innerHTML = '<div class="alerta">Pega primero la data.</div>'; return; }
    const r = jt ? procesarJT(texto) : procesarIMILE(texto);
    cols = r.cols;
    salida.innerHTML = r.html;
  };
  cont.querySelector('#lmLimpiar').onclick = () => {
    cont.querySelector('#lmTexto').value = '';
    salida.innerHTML = '';
    cols = [];
  };

  salida.addEventListener('click', async e => {
    const b = e.target.closest('button[data-lm]');
    if (!b || !cols.length) return;
    const matriz = aMatriz(cols);
    if (b.dataset.lm === 'copiar') {
      const tsv = matriz.map(f => f.join('\t')).join('\n');
      try { await navigator.clipboard.writeText(tsv); b.textContent = '¡Copiado!'; }
      catch { b.textContent = 'No se pudo copiar'; }
      setTimeout(() => { b.textContent = 'Copiar para Excel'; }, 1800);
    } else {
      const q = v => `"${String(v).replace(/"/g, '""')}"`;
      const csv = '\uFEFF' + matriz.map(f => f.map(q).join(',')).join('\n');
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `guias_por_mensajero_${jt ? 'jt' : 'imile'}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    }
  });
}
