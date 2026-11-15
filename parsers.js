// Cada lector devuelve filas normalizadas:
// { codigo, horaMovimiento, zona, zip, mCod, mNombre }
// horaMovimiento = último movimiento real del paquete (despacho u OFD), formato "YYYY-MM-DD HH:MM:SS"

const FECHA_HORA = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
// Fecha fija de sistema que aparece en todos los registros: no es un movimiento
const FECHA_SISTEMA = / 01:00:00$/;

// IMILE: rastreo con "OFD Time" o códigos sueltos de 13 dígitos
function leerIMILE(texto) {
  const filas = [];
  const vistos = new Set();
  const re = /(\d{13})\s*OFD Time:\s*(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\s*(?:Ciudad|City):([^\r\n]*)\s*zipCode:\s*(\d+)/gi;
  let m;
  while ((m = re.exec(texto))) {
    filas.push({ codigo: m[1], horaMovimiento: m[2], zona: m[3].trim(), zip: m[4], mCod: '', mNombre: '' });
    vistos.add(m[1]);
  }
  (texto.match(/(?<!\d)\d{13}(?!\d)/g) || []).forEach(c => {
    if (!vistos.has(c)) {
      vistos.add(c);
      filas.push({ codigo: c, horaMovimiento: '', zona: '', zip: '', mCod: '', mNombre: '' });
    }
  });
  return filas;
}

// J&T: cada guía empieza con su número JDM + 12 dígitos; el bloque siguiente son sus datos
function leerJT(texto) {
  const lineas = texto.split(/\r?\n|\t/).map(x => x.trim()).filter(x => x !== '');
  const inicios = [];
  lineas.forEach((l, i) => { if (/^JDM\d{12}$/i.test(l)) inicios.push(i); });

  return inicios.map((s, k) => {
    const fin = k + 1 < inicios.length ? inicios[k + 1] : lineas.length;
    const b = lineas.slice(s + 1, fin);

    const iz = b.findIndex(l => /^\d{5}$/.test(l));
    const zip = iz >= 0 ? b[iz] : '';
    const colonia = iz >= 0 && b[iz + 1] && !/^\d{4}-/.test(b[iz + 1]) && b[iz + 1] !== 'other' ? b[iz + 1] : '';

    const fechas = b.filter(l => FECHA_HORA.test(l) && !FECHA_SISTEMA.test(l)).sort();
    const ultimo = fechas.length ? fechas[fechas.length - 1] : '';

    const ic = b.findIndex(l => /^6\d{10}$/.test(l));
    let mCod = '', mNombre = '';
    if (ic >= 0) {
      mCod = b[ic];
      const linea = b.slice(ic + 1).find(l => /\.pcp$/i.test(l) || /^[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ .]+$/.test(l));
      mNombre = linea ? linea.replace(/\.pcp$/i, '').trim() : '';
    }
    return { codigo: lineas[s].toUpperCase(), horaMovimiento: ultimo, zona: colonia, zip, mCod, mNombre };
  });
}

export function parseEntrada(texto, empresa) {
  const crudas = empresa === 'jt' ? leerJT(texto) : leerIMILE(texto);
  const vistos = new Set();
  const items = [];
  let duplicadas = 0;
  crudas.forEach(f => {
    if (vistos.has(f.codigo)) duplicadas++;
    else { vistos.add(f.codigo); items.push(f); }
  });
  return { items, duplicadas };
}
