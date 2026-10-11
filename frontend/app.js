/**
 * Flores Hermanos · Simulación de venta de pasajes
 * Módulo Principal del Frontend (app.js)
 */

// Estado global de la aplicación
const estadoApp = {
  configuracion: null,
  asientos: new Map(), // id -> elemento DOM
  contadores: {
    pasajeros: 0,
    vendidos: 0,
    libres: 0,
    rechazos: 0,
    sinBoleto: 0
  }
};

/**
 * Inicialización de controles del tema (Oscuro / Claro)
 */
function inicializarTema() {
  const btnTema = document.getElementById('btn-tema');
  const textoTema = btnTema.querySelector('.texto-tema');
  const iconoTema = btnTema.querySelector('.icono-tema');

  btnTema.addEventListener('click', () => {
    const temaActual = document.body.getAttribute('data-theme');
    const nuevoTema = temaActual === 'dark' ? 'light' : 'dark';
    
    document.body.setAttribute('data-theme', nuevoTema);
    textoTema.textContent = nuevoTema === 'dark' ? 'Modo Oscuro' : 'Modo Claro';
    iconoTema.textContent = nuevoTema === 'dark' ? '🌙' : '☀️';
  });
}

/**
 * Función principal para renderizar la estructura del Bus de 2 Pisos.
 * Recibe un objeto de configuración que cumple con el contrato del backend.
 * @param {Object} config - { asientos: number, piso1: number, piso2: number, ... }
 */
function dibujarBus(config) {
  estadoApp.configuracion = config;
  
  const containerPiso1 = document.getElementById('grid-piso-1');
  const containerPiso2 = document.getElementById('grid-piso-2');

  // Limpiar contenedores
  containerPiso1.innerHTML = '';
  containerPiso2.innerHTML = '';
  estadoApp.asientos.clear();

  const totalAsientos = config.asientos;
  // Regla del contrato: piso1 = n / 4 (división entera)
  const limitePiso1 = config.piso1 || Math.floor(totalAsientos / 4);

  // Inicializar contador de asientos libres
  estadoApp.contadores.libres = totalAsientos;
  actualizarContadoresUI();

  // Generar asientos Piso 1 (IDs: 1..piso1)
  generarGridPiso(containerPiso1, 1, limitePiso1);

  // Generar asientos Piso 2 (IDs: piso1+1..totalAsientos)
  generarGridPiso(containerPiso2, limitePiso1 + 1, totalAsientos);

  agregarLog(`Bus generado con ${totalAsientos} asientos (Piso 1: ${limitePiso1}, Piso 2: ${totalAsientos - limitePiso1})`);
}

/**
 * Genera la cuadrícula de asientos para un piso específico (4 asientos por fila: 2 + pasillo + 2)
 */
function generarGridPiso(contenedor, idInicio, idFin) {
  let contadorColumna = 0;

  for (let id = idInicio; id <= idFin; id++) {
    // Crear elemento asiento
    const elAsiento = document.createElement('div');
    elAsiento.className = 'asiento estado-libre';
    elAsiento.setAttribute('data-id', id);

    // Etiqueta del número
    const numSpan = document.createElement('span');
    numSpan.className = 'asiento-numero';
    numSpan.textContent = id;

    // Ícono diferenciador de estado
    const iconoSpan = document.createElement('span');
    iconoSpan.className = 'asiento-icono';
    iconoSpan.textContent = '✓'; // Ícono libre

    elAsiento.appendChild(numSpan);
    elAsiento.appendChild(iconoSpan);

    // Insertar en contenedor
    contenedor.appendChild(elAsiento);
    
    // Guardar referencia en memoria
    estadoApp.asientos.set(id, elAsiento);

    contadorColumna++;

    // Insertar separador de pasillo después del segundo asiento de cada fila
    if (contadorColumna % 2 === 0 && contadorColumna % 4 !== 0) {
      const pasillo = document.createElement('div');
      pasillo.className = 'pasillo-espacio';
      contenedor.appendChild(pasillo);
    }
  }
}

/**
 * Cambia el estado visual de un asiento específico.
 * @param {number} asientoId - ID del asiento (1..n)
 * @param {string} nuevoEstado - 'libre' | 'en-proceso' | 'comprado'
 * @param {boolean} conError - Si debe ejecutar animación de choque/rechazo
 */
function actualizarEstadoAsiento(asientoId, nuevoEstado, conError = false) {
  const elAsiento = estadoApp.asientos.get(asientoId);
  if (!elAsiento) return;

  const icono = elAsiento.querySelector('.asiento-icono');

  // Limpiar clases previas
  elAsiento.classList.remove('estado-libre', 'estado-proceso', 'estado-comprado');

  switch (nuevoEstado) {
    case 'libre':
      elAsiento.classList.add('estado-libre');
      if (icono) icono.textContent = '✓';
      break;
    case 'en-proceso':
      elAsiento.classList.add('estado-proceso');
      if (icono) icono.textContent = '⏳';
      break;
    case 'comprado':
      elAsiento.classList.add('estado-comprado');
      if (icono) icono.textContent = '🔒';
      break;
  }

  // Animación de choque si hubo rechazo
  if (conError) {
    elAsiento.classList.add('animacion-rechazo');
    setTimeout(() => {
      elAsiento.classList.remove('animacion-rechazo');
    }, 400);
  }
}

/**
 * Actualiza los contadores en la interfaz gráfica
 */
function actualizarContadoresUI() {
  document.getElementById('cnt-pasajeros').textContent = estadoApp.contadores.pasajeros;
  document.getElementById('cnt-vendidos').textContent = estadoApp.contadores.vendidos;
  document.getElementById('cnt-libres').textContent = estadoApp.contadores.libres;
  document.getElementById('cnt-rechazos').textContent = estadoApp.contadores.rechazos;
  document.getElementById('cnt-sin-boleto').textContent = estadoApp.contadores.sinBoleto;
}

/**
 * Añade una línea al log visual del frontend
 */
function agregarLog(mensaje, tipo = 'sistema') {
  const logContenedor = document.getElementById('log-eventos');
  const linea = document.createElement('div');
  linea.className = `log-linea ${tipo}`;
  linea.textContent = mensaje;
  logContenedor.appendChild(linea);
  logContenedor.scrollTop = logContenedor.scrollHeight;
}

// Inicialización básica al cargar el documento
document.addEventListener('DOMContentLoaded', () => {
  inicializarTema();

  // Llamada de prueba inicial con la configuración estándar del contrato (48 asientos)
  dibujarBus({
    asientos: 48,
    piso1: 12,
    piso2: 36,
    pasajeros: 80,
    duracion: 30
  });
});

// ==========================================
// ETAPA 6: SINTETIZADOR DE SONIDOS (WEB AUDIO API)
// ==========================================
let sonidoHabilitado = false;
let audioCtx = null;

function toggleSonido() {
  sonidoHabilitado = !sonidoHabilitado;
  const btn = document.getElementById("btn-sonido");
  if (btn) btn.innerText = sonidoHabilitado ? "🔊 Sonido: ON" : "🔇 Sonido: OFF";
}

function reproducirEfecto(tipo) {
  if (!sonidoHabilitado) return;
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();

  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.connect(gain);
  gain.connect(audioCtx.destination);

  if (tipo === "compra") {
    osc.type = "sine";
    osc.frequency.setValueAtTime(587.33, audioCtx.currentTime); // D5
    osc.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.12); // A5
    gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.12);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.12);
  } else if (tipo === "rechazo") {
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(160, audioCtx.currentTime);
    osc.frequency.linearRampToValueAtTime(90, audioCtx.currentTime + 0.15);
    gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.15);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.15);
  }
}

// ==========================================
// ETAPA 6: RESUMEN Y CELEBRACIÓN
// ==========================================
function mostrarResumen(evFinal) {
  const vendidos = evFinal.vendidos || 0;
  const libres = evFinal.libres || 0;
  const sinBoleto = evFinal.sin_boleto || 0;
  const totalAsientos = vendidos + libres;

  const pctOcupacion = totalAsientos > 0 ? ((vendidos / totalAsientos) * 100).toFixed(1) : 0;
  const totalIntentos = (evFinal.total_intentos || vendidos + (evFinal.rechazos || 0));
  const tasaExito = totalIntentos > 0 ? ((vendidos / totalIntentos) * 100).toFixed(1) : (vendidos > 0 ? 100 : 0);

  document.getElementById("res-vendidos").innerText = vendidos;
  document.getElementById("res-libres").innerText = libres;
  document.getElementById("res-sin-boleto").innerText = sinBoleto;
  document.getElementById("res-ocupacion").innerText = `${pctOcupacion}%`;
  document.getElementById("res-exito").innerText = `${tasaExito}%`;

  // Renderizar cuadritos de asientos vendidos por piso
  const chipsP1 = document.getElementById("chips-piso1");
  const chipsP2 = document.getElementById("chips-piso2");
  if (chipsP1) chipsP1.innerHTML = "";
  if (chipsP2) chipsP2.innerHTML = "";

  const listaVendidos = evFinal.asientos_vendidos || [];
  const piso1Max = 12; // Asientos piso 1

  listaVendidos.sort((a, b) => a - b).forEach(aNum => {
    const chip = document.createElement("span");
    chip.className = "chip-asiento";
    chip.innerText = `#${aNum}`;

    if (aNum <= piso1Max && chipsP1) {
      chipsP1.appendChild(chip);
    } else if (chipsP2) {
      chipsP2.appendChild(chip);
    }
  });

  // Mostrar Modal
  const modal = document.getElementById("modal-resumen");
  if (modal) modal.classList.remove("hidden");
}

function cerrarModal() {
  const modal = document.getElementById("modal-resumen");
  if (modal) modal.classList.add("hidden");
}

function reiniciarYConfigurar() {
  cerrarModal();
  if (typeof reiniciarSimulacion === "function") {
    reiniciarSimulacion();
  }
}

// ==========================================
// PROCESADOR PRINCIPAL DE EVENTOS
// ==========================================
function procesarEvento(ev) {
  if (!ev || !ev.evento) return;

  switch (ev.evento) {
    case "inicio":
      dibujarBus(ev);
      break;

    case "llega":
      agregarLog(`[t=${ev.t}s] Pasajero ${ev.pasajero} llegó (Piso ${ev.preferencia})`, "info");
      break;

    case "intenta":
      marcarAsientoEnProceso(ev.asiento, ev.pasajero);
      break;

    case "compra":
      reproducirEfecto("compra"); // 🔊 Sonido compra
      marcarAsientoComprado(ev.asiento, ev.pasajero, ev.piso);
      agregarLog(`[t=${ev.t}s] ✅ Pasajero ${ev.pasajero} compró asiento #${ev.asiento}`, "exito");
      break;

    case "rechazo":
      reproducirEfecto("rechazo"); // 🔊 Sonido rechazo
      animarRechazo(ev.asiento);
      agregarLog(`[t=${ev.t}s] ❌ Asiento #${ev.asiento} ocupado`, "error");
      break;

    case "sin_boleto":
      agregarLog(`[t=${ev.t}s] ⚠️ Pasajero ${ev.pasajero} sin boleto`, "alerta");
      break;

    case "fin":
      agregarLog(`[t=${ev.t}s] 🏁 Simulación finalizada`, "sistema");
      mostrarResumen(ev); // 📊 Abrir modal
      break;
  }
}