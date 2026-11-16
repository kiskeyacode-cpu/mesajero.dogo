# Mensajería v6 (Firestore)

## Qué cambió frente a la versión anterior

- **Datos en Firestore**, no en el navegador ni en un archivo de Drive. Varias personas trabajan a la vez sin pisarse.
- **Historial inmutable:** cada movimiento es un evento nuevo en `guias/{codigo}/eventos`. Nada se borra ni se sobrescribe.
- **Transacciones en cada cambio de guía:** si dos personas tocan la misma guía, la segunda recibe aviso en vez de pisar el cambio.
- **Vista previa antes de guardar:** el pegado muestra nuevas, repetidas, sin mensajero, reactivables e inválidas. Nada se escribe hasta que confirmas.
- **Reactivar y reasignar son opciones marcadas:** una guía ya entregada o con otro mensajero no cambia sola.
- **Mensajeros nuevos o parecidos:** en la vista previa decides si se crean o se vinculan a uno existente.
- **Nombres reservados** (FALLIDO, DEVOLUCION, ALMACEN, etc.) no se pueden registrar como mensajeros.
- **Escáner de J&T:** acepta el formato JDM + 12 dígitos.
- **Hora real del movimiento:** el tiempo sin movimiento se cuenta desde el despacho (J&T) u OFD (IMILE), no desde el momento en que pegaste.
- **Terminar ruta pide confirmación:** marcas las guías entregadas; las que no marques siguen en ruta.
- **Reenviar desde oficina** usa un selector, no escribir el nombre.
- **Cargas por día:** cada mensajero tiene una carga por fecha.

## Novedades de esta actualización

- **Cargas y rutas con calendario:** los días con rutas se resaltan (amarillo = aún hay guías en ruta, verde = todo cerrado). Al elegir un día se ven todas sus rutas y puedes marcar entregas una por una, por selección, por ruta completa o todas las del día. Las que no marques siguen en ruta y la ruta se cierra sola cuando no queda ninguna. Cada guía entregada tiene botón "Deshacer".
- **Escáner:** nuevo modo "Entregada" para registrar entregas escaneando.
- **Limpiador de datos** (J&T e IMILE) con un segundo cuadro en columnas, una por mensajero con sus guías, que se puede copiar a Excel o descargar en CSV.
- **Códigos de barras** (Code 128) en ambas empresas, con impresión y exportación de la lista.
- Las entregas del calendario usan transacción por guía: si otra persona la cambió antes, se omite y se avisa.

## Lo que todavía no está en esta versión

- Gráfico de zonas más detallado.

## Configuración (una sola vez)

1. **Crear el proyecto** en https://console.firebase.google.com con tu cuenta Haiku.
2. **Activar Firestore:** Compilación → Firestore Database → Crear base de datos. Elige modo de producción y la región más cercana.
3. **Activar Autenticación:** Compilación → Authentication → Comenzar → Correo electrónico/contraseña → Habilitar.
4. **Crear usuarios:** Authentication → Usuarios → Agregar usuario, con correo y contraseña para cada persona autorizada.
5. **Reglas de seguridad:** Firestore → Reglas. Pega el contenido de `firestore.rules`, cambia la lista de correos por los reales y publica.
6. **Registrar la app web:** Configuración del proyecto → Tus apps → Web (`</>`). Copia el objeto `firebaseConfig`.
7. **Pegar la configuración** en `config.js`, reemplazando los valores `PEGAR_AQUI`.
8. **Subir a GitHub Pages:** sube todos los archivos (todos en la misma carpeta, sin subcarpeta `js/`) al repositorio. Abre la URL de Pages.

## Pruebas antes de usarlo con datos reales

1. Inicia sesión con una cuenta autorizada. Una cuenta no autorizada debe recibir error de permisos.
2. En **IMILE**, pega 3 guías con un mensajero elegido. Revisa la vista previa y confirma.
3. Pega las mismas 3 guías otra vez. Deben aparecer como **repetidas**, sin cambios.
4. En **J&T**, pega una fila de prueba con un mensajero que no existe. Debe aparecer como **pendiente**, decide crearlo y confirma.
5. En el **escáner**, asigna una guía, luego devuélvela a oficina y luego despáchala como fallido. Revisa el **buscador**: debe mostrar el historial en ese orden.
6. En **Cargas**, elige un día del calendario y marca solo algunas guías como entregadas. Las no marcadas deben seguir en ruta. Luego usa "Todas entregadas" y verifica que la ruta pase a Cerrada.
7. Abre la misma app en otra computadora con la otra cuenta. Debe ver los mismos datos.
8. En **Configuración**, importa tu `base_guias.json` anterior de IMILE o J&T, y revisa que las cifras del panel cuadren con lo que tenías.

## Límites a tener en cuenta

- El panel calcula entregas por fecha de entrada en el período. Una guía que entró en una quincena y se entregó en otra se cuenta en la de entrada.
- La vista previa se calcula con los datos de ese momento. Si otra persona cambia una guía entre la vista previa y la confirmación, el lote la sobrescribe. Para el volumen actual es un riesgo bajo.
- Con 3 mil guías al mes, el plan gratuito de Firestore es suficiente.
