import { ahora, normNombre, similitud, nombreReservado } from './util.js';
import { EMPRESAS } from './config.js';

// Evento inmutable del historial. Nunca se edita: solo se agregan.
export function evento(tipo, o = {}) {
  return {
    at: ahora(),
    tipo,
    de: o.de || '',
    a: o.a || '',
    motivo: o.motivo || '',
    usuario: o.usuario || '',
    lote: o.lote || ''
  };
}

/*
 Clasifica cada fila del pegado sin escribir nada:
   nueva            guía que no existe
   repetida         ya está en ruta con ese mismo mensajero
   repetida_otro    ya está en ruta con otro mensajero (solo se reasigna si lo marcas)
   reactivar        ya fue entregada, devuelta o despachada (solo si lo marcas)
   sin_mensajero    la fila no trae mensajero (modo automático)
   invalida         formato de código incorrecto o nombre reservado
 Los mensajeros que no existen quedan como "pendientes" para que decidas:
 crearlos o vincularlos a uno existente.
*/
export function planificar({ items, empresa, guias, mensajeros, modo, mensajeroFijoId }) {
  const porCodigo = new Map();
  const porNombre = new Map();
  mensajeros.forEach(m => {
    if (m.codigoEmpresa) porCodigo.set(m.codigoEmpresa, m);
    if (m.nombreNorm) porNombre.set(m.nombreNorm, m);
    (m.alias || []).forEach(a => porNombre.set(a, m));
  });
  const nombreDe = id => (mensajeros.find(m => m.id === id) || {}).nombre || '';

  const pendientes = new Map();
  const filas = [];

  items.forEach(it => {
    const g = guias.get(it.codigo) || null;
    const fila = {
      codigo: it.codigo,
      zona: it.zona || '',
      zip: it.zip || '',
      horaMovimiento: it.horaMovimiento || '',
      guia: g,
      mensajeroId: null,
      pendienteKey: null,
      nombreMensajero: '',
      accion: '',
      motivo: ''
    };
    filas.push(fila);

    if (!EMPRESAS[empresa].valido(it.codigo)) {
      fila.accion = 'invalida';
      fila.motivo = `Formato no válido (${EMPRESAS[empresa].formato})`;
      return;
    }

    if (modo === 'fijo') {
      fila.mensajeroId = mensajeroFijoId || null;
    } else {
      const nombreTxt = it.mNombre || '';
      if (nombreTxt && nombreReservado(nombreTxt)) {
        fila.accion = 'invalida';
        fila.motivo = `Nombre reservado: ${nombreTxt}`;
        return;
      }
      const porC = it.mCod ? porCodigo.get(it.mCod) : null;
      const porN = nombreTxt ? porNombre.get(normNombre(nombreTxt)) : null;
      if (porC) fila.mensajeroId = porC.id;
      else if (porN) fila.mensajeroId = porN.id;
      else if (it.mCod || nombreTxt) {
        const key = it.mCod || normNombre(nombreTxt);
        fila.pendienteKey = key;
        if (!pendientes.has(key)) {
          pendientes.set(key, {
            key,
            nombre: nombreTxt,
            codigo: it.mCod || '',
            cantidad: 0,
            sugerencias: nombreTxt
              ? mensajeros.filter(m => similitud(m.nombre, nombreTxt) >= 0.5).map(m => ({ id: m.id, nombre: m.nombre }))
              : []
          });
        }
        pendientes.get(key).cantidad++;
      }
    }

    if (!fila.mensajeroId && !fila.pendienteKey) {
      fila.accion = 'sin_mensajero';
      fila.motivo = 'La fila no trae mensajero';
      return;
    }

    fila.nombreMensajero = fila.mensajeroId
      ? nombreDe(fila.mensajeroId)
      : (pendientes.get(fila.pendienteKey) || {}).nombre || `Mensajero ${it.mCod}`;

    if (!g) fila.accion = 'nueva';
    else if (g.estado !== 'asignada') fila.accion = 'reactivar';
    else fila.accion = fila.mensajeroId && g.mensajeroId === fila.mensajeroId ? 'repetida' : 'repetida_otro';
  });

  const resumen = {};
  filas.forEach(f => { resumen[f.accion] = (resumen[f.accion] || 0) + 1; });
  return { filas, pendientes: [...pendientes.values()], resumen };
}
