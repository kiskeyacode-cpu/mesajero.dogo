// 1) Pega aquí la configuración de tu proyecto de Firebase (Configuración del proyecto → Tus apps → SDK).
export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyAOSwYgy2rDGnTNr07Ss8SyqTn_MGf1EUY",
  authDomain: "mensajero-dogo-61859.firebaseapp.com",
  projectId: "mensajero-dogo-61859",
  storageBucket: "mensajero-dogo-61859.firebasestorage.app",
  messagingSenderId: "910157638452",
  appId: "1:910157638452:web:d09db9d1b9e10eeb929361",
  measurementId: "G-3V4E4E3PP6"
};

// Formato de código de guía por empresa
export const EMPRESAS = {
  imile: {
    nombre: 'IMILE',
    clase: 'imile',
    letra: 'I',
    valido: c => /^\d{13}$/.test(c),
    formato: '13 dígitos'
  },
  jt: {
    nombre: 'J&T',
    clase: 'jt',
    letra: 'J',
    valido: c => /^JDM\d{12}$/.test(c),
    formato: 'JDM + 12 dígitos'
  }
};
