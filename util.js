export const pad = n => String(n).padStart(2, '0');

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function ymd(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function hoy() {
  return ymd();
}

// Fecha y hora local en formato "YYYY-MM-DD HH:MM:SS" (se puede ordenar como texto)
export function ahora() {
  const d = new Date();
  return `${ymd(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function nuevoId(prefijo) {
  return prefijo + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// Nombre sin acentos, en mayúsculas y con espacios limpios
export function normNombre(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase().replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

// Parecido entre dos nombres (0 a 1), por palabras en común
export function similitud(a, b) {
  const A = new Set(normNombre(a).split(' ').filter(Boolean));
  const B = new Set(normNombre(b).split(' ').filter(Boolean));
  if (!A.size || !B.size) return 0;
  const comunes = [...A].filter(x => B.has(x)).length;
  return comunes / new Set([...A, ...B]).size;
}

const RESERVADOS = ['FALLIDO', 'DEVOLUCION', 'DEVOLUCIONES', 'ALMACEN', 'OFICINA', 'PENDIENTE', 'NINGUNO', 'SIN MENSAJERO'];

// Nombres que el sistema usa para estados: nunca se pueden registrar como mensajeros
export function nombreReservado(s) {
  const n = normNombre(s);
  return !n || RESERVADOS.some(r => n === r || n.startsWith(r + ' '));
}

// Periodo: quincena 1 (1-15), quincena 2 (16-fin), o mes completo ('m')
export function periodoDe(mes, quin) {
  const [y, m] = mes.split('-').map(Number);
  const ult = new Date(y, m, 0).getDate();
  if (quin === '1') return { ini: `${y}-${pad(m)}-01`, fin: `${y}-${pad(m)}-15` };
  if (quin === '2') return { ini: `${y}-${pad(m)}-16`, fin: `${y}-${pad(m)}-${pad(ult)}` };
  return { ini: `${y}-${pad(m)}-01`, fin: `${y}-${pad(m)}-${pad(ult)}` };
}
