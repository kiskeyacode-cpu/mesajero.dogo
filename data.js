import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getFirestore, doc, getDoc, getDocs, collection, query, where, runTransaction, writeBatch
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { FIREBASE_CONFIG } from './config.js';

/*
 Estructura en Firestore (por empresa):
   empresas/{emp}/mensajeros/{id}      nombre, nombreNorm, codigoEmpresa, alias[], zona, activo
   empresas/{emp}/guias/{codigo}       estado actual: estado, mensajeroId, cargaId, zona, zip,
                                       horaMovimiento, ultimoMovimiento, fechaEntrada, origen
   empresas/{emp}/guias/{codigo}/eventos/{id}   historial inmutable (at, tipo, de, a, motivo, usuario, lote)
   empresas/{emp}/cargas/{mensajeroId_fecha}    mensajeroId, fecha, abierta, cerrada
   empresas/{emp}/lotes/{id}           registro de cada pegado aplicado
*/

const app = initializeApp(FIREBASE_CONFIG);
const auth = getAuth(app);
const db = getFirestore(app);

export const login = (email, pass) => signInWithEmailAndPassword(auth, email, pass);
export const logout = () => signOut(auth);
export const emailActual = () => (auth.currentUser && auth.currentUser.email) || '';
export function esperarSesion() {
  return new Promise(res => {
    const off = onAuthStateChanged(auth, u => { off(); res(u); });
  });
}

const colEmp = (emp, nombre) => collection(db, 'empresas', emp, nombre);
export const refGuia = (emp, codigo) => doc(db, 'empresas', emp, 'guias', codigo);
export const refCarga = (emp, id) => doc(db, 'empresas', emp, 'cargas', id);
export const refMensajero = (emp, id) => doc(db, 'empresas', emp, 'mensajeros', id);
const aLista = s => s.docs.map(d => ({ id: d.id, ...d.data() }));

export async function cargarMensajeros(emp) {
  return aLista(await getDocs(colEmp(emp, 'mensajeros')));
}

// Solo trae las guías del pegado (no toda la base)
export async function cargarGuias(emp, codigos) {
  const mapa = new Map();
  await Promise.all([...new Set(codigos)].map(async c => {
    const s = await getDoc(refGuia(emp, c));
    if (s.exists()) mapa.set(c, { id: c, ...s.data() });
  }));
  return mapa;
}

export async function obtenerGuia(emp, codigo) {
  const s = await getDoc(refGuia(emp, codigo));
  return s.exists() ? { id: codigo, ...s.data() } : null;
}

export async function eventosDe(emp, codigo) {
  const s = await getDocs(collection(refGuia(emp, codigo), 'eventos'));
  return s.docs.map(d => d.data()).sort((a, b) => (b.at || '').localeCompare(a.at || ''));
}

export async function guiasPorEstado(emp, estado) {
  return aLista(await getDocs(query(colEmp(emp, 'guias'), where('estado', '==', estado))));
}

export async function guiasPeriodo(emp, ini, fin) {
  return aLista(await getDocs(query(colEmp(emp, 'guias'),
    where('fechaEntrada', '>=', ini), where('fechaEntrada', '<=', fin))));
}

export async function guiasDeCarga(emp, cargaId) {
  return aLista(await getDocs(query(colEmp(emp, 'guias'), where('cargaId', '==', cargaId))));
}

export async function cargasPeriodo(emp, ini, fin) {
  return aLista(await getDocs(query(colEmp(emp, 'cargas'),
    where('fecha', '>=', ini), where('fecha', '<=', fin))));
}

// Escribe una lista de operaciones en lotes de 450 (límite de Firestore: 500 por lote)
// Operaciones: { tipo: 'set', ref, data, merge? } y { tipo: 'add', ref (guía), data (evento) }
export async function escribirLote(emp, ops) {
  for (let i = 0; i < ops.length; i += 450) {
    const b = writeBatch(db);
    ops.slice(i, i + 450).forEach(o => {
      if (o.tipo === 'set') b.set(o.ref, o.data, { merge: !!o.merge });
      else if (o.tipo === 'add') b.set(doc(collection(o.ref, 'eventos')), o.data);
    });
    await b.commit();
  }
}

// Cambio de una guía con transacción: si otro usuario la cambió antes, no se sobrescribe.
// esperado: lista de estados válidos actuales, o null si la guía no debe existir.
export async function cambiarGuia(emp, codigo, { esperado, cambios, eventos }) {
  await runTransaction(db, async tx => {
    const r = refGuia(emp, codigo);
    const s = await tx.get(r);
    const actual = s.exists() ? s.data() : null;
    if (esperado === null && actual) throw new Error('YA_EXISTE');
    if (esperado && (!actual || !esperado.includes(actual.estado))) throw new Error('CAMBIO_CONCURRENTE');
    tx.set(r, { codigo, ...cambios }, { merge: true });
    eventos.forEach(ev => tx.set(doc(collection(r, 'eventos')), ev));
  });
}

export async function guardarCarga(emp, id, data) {
  await escribirLote(emp, [{ tipo: 'set', ref: refCarga(emp, id), data, merge: true }]);
}

// Aplica un pegado completo: mensajeros nuevos, cargas, guías y registro del lote
export async function aplicarPegado(emp, { mensNuevos, cargas, guias, lote }) {
  const ops = [];
  mensNuevos.forEach(m => ops.push({ tipo: 'set', ref: refMensajero(emp, m.id), data: m.data }));
  cargas.forEach(c => ops.push({ tipo: 'set', ref: refCarga(emp, c.id), data: c.data, merge: true }));
  guias.forEach(g => {
    ops.push({ tipo: 'set', ref: refGuia(emp, g.codigo), data: g.data, merge: true });
    ops.push({ tipo: 'add', ref: refGuia(emp, g.codigo), data: g.evento });
  });
  ops.push({ tipo: 'set', ref: doc(colEmp(emp, 'lotes'), lote.id), data: lote.data });
  await escribirLote(emp, ops);
}
