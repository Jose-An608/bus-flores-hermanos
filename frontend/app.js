/**
 * app.js — Dibuja el bus y reacciona a los eventos del programa C.
 *
 * Flujo:
 *   1. El usuario pulsa Iniciar.
 *   2. Una fuente (en vivo o grabación) entrega eventos uno por uno.
 *   3. procesarEvento(evento) actualiza asientos, contadores y registro.
 *
 * Eventos (ver CONTRATO_EVENTOS.md):
 *   inicio · llega · intenta · compra · rechazo · sin_boleto · fin
 */

// ---------- Atajos ----------
const $ = (id) => document.getElementById(id);

// ---------- Estado de la página ----------
const estado = {
  config: null,          // datos del evento "inicio"
  asientos: new Map(),   // id del asiento -> elemento HTML
  vendidos: new Set(),   // ids de asientos ya vendidos
  tuyos: new Set(),      // asientos que compró el usuario (pasajero 0)
  compraManual: false,   // true mientras se puede hacer clic para comprar
  llegaron: 0,
  rechazos: 0,
  sinBoleto: 0,
  fuente: null,          // fuente de eventos en uso
  relojInicio: 0,        // momento (ms) en que empezó la simulación
  relojTimer: null,
};

/* =========================================================
 * 1. DIBUJAR EL BUS
 * ========================================================= */
function dibujarBus(config) {
  estado.config = config;
  estado.asientos.clear();
  estado.vendidos.clear();
  estado.tuyos.clear();

  // Piso 1: asientos 1..piso1   ·   Piso 2: el resto
  llenarPiso($('grid-piso-1'), 1, config.piso1);
  llenarPiso($('grid-piso-2'), config.piso1 + 1, config.asientos);
  actualizarContadores();
}

function llenarPiso(contenedor, desde, hasta) {
  contenedor.innerHTML = '';
  for (let id = desde, posicion = 0; id <= hasta; id++, posicion++) {
    // Cada fila: 2 asientos, pasillo, 2 asientos
    if (posicion % 4 === 2) contenedor.appendChild(crearElemento('div', 'pasillo'));

    const asiento = crearElemento('div', 'asiento');
    asiento.dataset.id = id;
    asiento.innerHTML = `${id}<svg class="icono"><use href="#i-libre"/></svg>`;
    contenedor.appendChild(asiento);
    estado.asientos.set(id, asiento);
    pintarAsiento(id, 'libre');
  }
}

function crearElemento(etiqueta, clase) {
  const el = document.createElement(etiqueta);
  el.className = clase;
  return el;
}

/* Estados posibles: 'libre', 'en-proceso', 'comprado'.
   Cada estado tiene su ícono SVG en index.html (#i-libre, #i-en-proceso, #i-comprado). */

function pintarAsiento(id, nuevoEstado) {
  const asiento = estado.asientos.get(id);
  if (!asiento) return;
  asiento.className = 'asiento ' + nuevoEstado;
  const esTuyo = estado.tuyos.has(id) && nuevoEstado === 'comprado';
  if (esTuyo) asiento.classList.add('tuyo');
  asiento.querySelector('.icono use').setAttribute('href', esTuyo ? '#i-tuyo' : '#i-' + nuevoEstado);
  asiento.title = `Asiento ${id}: ${nuevoEstado}`;
}

/* Rechazo: el asiento NO cambia de estado, solo se sacude */
function sacudirAsiento(id) {
  const asiento = estado.asientos.get(id);
  if (!asiento) return;
  asiento.classList.remove('choque');
  void asiento.offsetWidth;            // reinicia la animación
  asiento.classList.add('choque');
}

/* =========================================================
 * 2. PROCESAR CADA EVENTO DEL PROGRAMA C
 * ========================================================= */
const USUARIO = 0;   // en bus.c el usuario es el pasajero 0
const nombre = (p) => p === USUARIO ? 'TÚ' : `Pasajero ${p}`;

function procesarEvento(ev) {
  const esUsuario = ev.pasajero === USUARIO;
  switch (ev.evento) {
    case 'inicio':
      dibujarBus(ev);
      iniciarReloj();
      registrar(ev, `Inicio: ${ev.asientos} asientos, ${ev.pasajeros} pasajeros, ${ev.duracion} s`, 'sistema');
      break;

    case 'llega':
      estado.llegaron++;
      registrar(ev, `Pasajero ${ev.pasajero} llega (prefiere piso ${ev.preferencia})`);
      break;

    case 'intenta':      // el hilo tomó el mutex del asiento y está pagando
      pintarAsiento(ev.asiento, 'en-proceso');
      registrar(ev, `${nombre(ev.pasajero)} bloquea asiento ${ev.asiento} y paga…`, esUsuario ? 'usuario' : '');
      if (esUsuario) avisar(`Tienes el mutex del asiento ${ev.asiento}. Pagando…`);
      break;

    case 'compra':       // pagó y liberó el mutex
      estado.vendidos.add(ev.asiento);
      if (esUsuario) estado.tuyos.add(ev.asiento);
      pintarAsiento(ev.asiento, 'comprado');
      registrar(ev, `${nombre(ev.pasajero)} compró asiento ${ev.asiento}`, esUsuario ? 'usuario' : 'compra');
      if (esUsuario) avisar(`¡Compraste el asiento ${ev.asiento}!`, 'exito');
      break;

    case 'rechazo':      // el mutex estaba tomado o el asiento ya vendido
      estado.rechazos++;
      sacudirAsiento(ev.asiento);
      registrar(ev, `${nombre(ev.pasajero)}: asiento ${ev.asiento} ${MOTIVOS[ev.motivo] || ev.motivo}`, esUsuario ? 'usuario' : 'rechazo');
      if (esUsuario) avisar(`Rechazado: el asiento ${ev.asiento} ${MOTIVOS[ev.motivo] || ev.motivo}.`, 'error');
      break;

    case 'sin_boleto':
      estado.sinBoleto++;
      registrar(ev, `Pasajero ${ev.pasajero} se queda sin boleto (${ev.motivo.replace('_', ' ')})`, 'sin_boleto');
      break;

    case 'fin':
      detenerReloj();
      mostrarTiempo(Math.min(ev.t, estado.config.duracion));
      registrar(ev, `Fin: ${ev.vendidos} vendidos, ${ev.libres} libres`, 'sistema');
      mostrarResumen(ev);
      break;
  }
  actualizarContadores();
}

/* Por qué se rechaza una compra */
const MOTIVOS = {
  ocupado: 'está ocupado (otro hilo tiene su mutex)',
  vendido: 'ya estaba vendido',
  bus_lleno: 'no está disponible (bus lleno)',
};

/* =========================================================
 * COMPRA MANUAL: hacer clic en un asiento = un hilo más compitiendo
 * El programa C recibe "comprar N" y responde con eventos normales.
 * ========================================================= */
function alHacerClicEnAsiento(e) {
  const asiento = e.target.closest('.asiento');
  if (!asiento || !estado.compraManual) return;
  const id = Number(asiento.dataset.id);
  avisar(`Pediste el asiento ${id}…`);
  fetch('/comprar?asiento=' + id)
    .then(r => { if (!r.ok) avisar('La simulación ya terminó.', 'error'); })
    .catch(() => avisar('No se pudo contactar al servidor.', 'error'));
}

function activarCompraManual(activa) {
  estado.compraManual = activa;
  document.body.classList.toggle('compra-manual', activa);
  avisar(activa
    ? 'Haz clic en un asiento para intentar comprarlo tú también.'
    : 'La compra manual funciona con "Programa C (en vivo)" mientras corre la simulación.');
}

function avisar(texto, tipo = '') {
  $('aviso-usuario').textContent = texto;
  $('aviso-usuario').className = 'aviso ' + tipo;
}

/* =========================================================
 * 3. CONTADORES, RELOJ Y REGISTRO
 * ========================================================= */
function actualizarContadores() {
  const total = estado.config ? estado.config.asientos : 0;
  const piso1 = estado.config ? estado.config.piso1 : 0;
  const vendidosPiso1 = [...estado.vendidos].filter(id => id <= piso1).length;

  $('cnt-llegaron').textContent = estado.llegaron;
  $('cnt-vendidos').textContent = estado.vendidos.size;
  $('cnt-libres').textContent = total - estado.vendidos.size;
  $('cnt-rechazos').textContent = estado.rechazos;
  $('cnt-sin-boleto').textContent = estado.sinBoleto;
  $('ocupacion-piso-1').textContent = `${vendidosPiso1} / ${piso1}`;
  $('ocupacion-piso-2').textContent = `${estado.vendidos.size - vendidosPiso1} / ${total - piso1}`;
}

function iniciarReloj() {
  estado.relojInicio = performance.now();
  clearInterval(estado.relojTimer);
  estado.relojTimer = setInterval(() => {
    const segundos = (performance.now() - estado.relojInicio) / 1000;
    mostrarTiempo(Math.min(segundos, estado.config.duracion));
  }, 100);
}

function detenerReloj() {
  clearInterval(estado.relojTimer);
}

function mostrarTiempo(segundos) {
  $('reloj').textContent = segundos.toFixed(2) + ' s';
  const avance = estado.config ? (segundos / estado.config.duracion) * 100 : 0;
  $('ruta-progreso').style.width = avance + '%';
  $('ruta-bus').style.left = avance + '%';
}

const MAX_LINEAS_LOG = 200;

function registrar(ev, texto, tipo = '') {
  const log = $('log');
  const linea = crearElemento('li', tipo);
  linea.innerHTML = `<span class="t">${ev.t.toFixed(2)}s</span>`;
  linea.append(texto);
  log.appendChild(linea);
  if (log.children.length > MAX_LINEAS_LOG) log.firstChild.remove();
  log.scrollTop = log.scrollHeight;
}

/* =========================================================
 * 4. RESUMEN FINAL (usa los números que calculó el programa C)
 * ========================================================= */
function mostrarResumen(fin) {
  const total = fin.vendidos + fin.libres;
  $('res-vendidos').textContent = fin.vendidos;
  $('res-libres').textContent = fin.libres;
  $('res-sin-boleto').textContent = fin.sin_boleto;
  $('res-ocupacion').textContent = Math.round((fin.vendidos / total) * 100) + '%';

  $('chips-piso-1').innerHTML = '';
  $('chips-piso-2').innerHTML = '';
  for (const id of fin.asientos_vendidos) {
    const chip = crearElemento('span', 'chip');
    chip.textContent = id;
    $(id <= estado.config.piso1 ? 'chips-piso-1' : 'chips-piso-2').appendChild(chip);
  }
  setTimeout(() => $('modal-resumen').showModal(), 600);
}

/* =========================================================
 * 5. CONTROLES: INICIAR / DETENER / ELEGIR FUENTE
 * ========================================================= */
function fuenteElegida() {
  return document.querySelector('input[name="fuente"]:checked').value;
}

function leerConfiguracion() {
  const campos = ['asientos', 'segundos', 'pasajeros', 'semilla'];
  const config = {};
  for (const campo of campos) {
    const input = $('in-' + campo);
    if (!input.checkValidity()) {
      mostrarNota(`Revisa "${campo}": debe estar entre ${input.min} y ${input.max}.`, true);
      return null;
    }
    config[campo] = input.value;
  }
  return config;
}

function iniciar() {
  const tipo = fuenteElegida();
  const config = leerConfiguracion();
  if (!config) return;

  limpiarPantalla();
  enEjecucion(true);
  activarCompraManual(tipo === 'envivo');

  estado.fuente = tipo === 'envivo' ? crearFuenteEnVivo() : crearFuenteGrabacion();
  estado.fuente.iniciar(
    config,
    procesarEvento,
    () => enEjecucion(false),              // terminó bien
    (mensaje) => {                         // no se pudo
      enEjecucion(false);
      if (tipo === 'envivo') {
        // Plan B automático: reproducir la grabación
        mostrarNota(mensaje + ' Reproduciendo la grabación.', true);
        document.querySelector('input[value="grabacion"]').checked = true;
        actualizarFormulario(false);
        iniciar();
      } else {
        mostrarNota(mensaje, true);
      }
    }
  );
}

function detener() {
  if (estado.fuente) estado.fuente.detener();
  enEjecucion(false);
}

function enEjecucion(activa) {
  if (!activa) { detenerReloj(); activarCompraManual(false); }
  $('btn-iniciar').disabled = activa;
  $('btn-detener').disabled = !activa;
  document.querySelectorAll('input[name="fuente"]').forEach(r => r.disabled = activa);
  $('estado').textContent = activa ? 'En curso' : 'Detenido';
  $('estado').classList.toggle('activo', activa);
}

function limpiarPantalla() {
  estado.llegaron = estado.rechazos = estado.sinBoleto = 0;
  $('log').innerHTML = '';
  mostrarTiempo(0);
}

function mostrarNota(texto, esError = false) {
  $('nota-fuente').textContent = texto;
  $('nota-fuente').classList.toggle('error', esError);
}

/* La grabación ya tiene sus valores fijos (48 asientos, 30 s, 80 pasajeros) */
function actualizarFormulario(limpiarNota = true) {
  const esGrabacion = fuenteElegida() === 'grabacion';
  document.querySelectorAll('#form-config input').forEach(i => i.disabled = esGrabacion);
  if (limpiarNota) {
    mostrarNota(esGrabacion
      ? 'Reproduce una ejecución real guardada de bus.c (48 asientos, 30 s, 80 pasajeros).'
      : 'El servidor ejecuta ./bus con estos valores.');
  }
}

/* ---------- Arranque ---------- */
$('btn-iniciar').addEventListener('click', iniciar);
$('btn-detener').addEventListener('click', detener);
document.querySelector('.pisos').addEventListener('click', alHacerClicEnAsiento);
$('form-config').addEventListener('submit', (e) => { e.preventDefault(); iniciar(); });
document.querySelectorAll('input[name="fuente"]').forEach(r => r.addEventListener('change', () => actualizarFormulario()));

dibujarBus({ asientos: 48, piso1: 12, duracion: 30 });
actualizarFormulario();
activarCompraManual(false);
