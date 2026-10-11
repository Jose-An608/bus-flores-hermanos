/**
 * Flores Hermanos · Simulación de venta de pasajes
 * Módulo Principal del Frontend (app.js)
 */

// Estado global de la aplicación
const estadoApp = {
  configuracion: null,
  asientos: new Map(), // id -> elemento DOM
  asientosComprados: new Set(), // Registro persistente de asientos vendidos
  contadores: {
    pasajeros: 0,
    vendidos: 0,
    libres: 48,
    rechazos: 0,
    sinBoleto: 0
  }
};

/**
 * Control del tema (Oscuro / Claro)
 */
function inicializarTema() {
  const btnTema = document.getElementById('btn-tema');
  if (!btnTema) return;
  const textoTema = btnTema.querySelector('.texto-tema');
  const iconoTema = btnTema.querySelector('.icono-tema');

  btnTema.addEventListener('click', () => {
    const temaActual = document.body.getAttribute('data-theme');
    const nuevoTema = temaActual === 'dark' ? 'light' : 'dark';
    document.body.setAttribute('data-theme', nuevoTema);
    if (textoTema) textoTema.textContent = nuevoTema === 'dark' ? 'Modo Oscuro' : 'Modo Claro';
    if (iconoTema) iconoTema.textContent = nuevoTema === 'dark' ? '🌙' : '☀️';
  });
}

/**
 * Renderiza la estructura visual del Bus de 2 Pisos
 */
function dibujarBus(config) {
  estadoApp.configuracion = config;
  
  const containerPiso1 = document.getElementById('grid-piso-1');
  const containerPiso2 = document.getElementById('grid-piso-2');

  if (!containerPiso1 || !containerPiso2) return;

  containerPiso1.innerHTML = '';
  containerPiso2.innerHTML = '';
  estadoApp.asientos.clear();
  estadoApp.asientosComprados.clear();

  const totalAsientos = config.asientos || 48;
  const limitePiso1 = config.piso1 || Math.floor(totalAsientos / 4);

  estadoApp.contadores.libres = totalAsientos;
  actualizarContadoresUI();

  generarGridPiso(containerPiso1, 1, limitePiso1);
  generarGridPiso(containerPiso2, limitePiso1 + 1, totalAsientos);
}

function generarGridPiso(contenedor, idInicio, idFin) {
  let contadorColumna = 0;

  for (let id = idInicio; id <= idFin; id++) {
    const elAsiento = document.createElement('div');
    elAsiento.className = 'asiento estado-libre libre';
    elAsiento.setAttribute('data-id', id);
    elAsiento.setAttribute('data-asiento', id);

    const numSpan = document.createElement('span');
    numSpan.className = 'asiento-numero';
    numSpan.textContent = id;

    const iconoSpan = document.createElement('span');
    iconoSpan.className = 'asiento-icono';
    iconoSpan.textContent = '✓';

    elAsiento.appendChild(numSpan);
    elAsiento.appendChild(iconoSpan);

    contenedor.appendChild(elAsiento);
    estadoApp.asientos.set(Number(id), elAsiento);

    contadorColumna++;

    if (contadorColumna % 2 === 0 && contadorColumna % 4 !== 0) {
      const pasillo = document.createElement('div');
      pasillo.className = 'pasillo-espacio';
      contenedor.appendChild(pasillo);
    }
  }
}

function reseteaEstadosVisuales() {
  estadoApp.asientosComprados.clear();
  estadoApp.asientos.forEach((elAsiento) => {
    elAsiento.className = 'asiento estado-libre libre';
    const icono = elAsiento.querySelector('.asiento-icono');
    if (icono) icono.textContent = '✓';
  });
}

/**
 * REGLA DE ORO: Un asiento COMPRADO nunca vuelve a ser LIBRE
 */
function actualizarEstadoAsiento(asientoId, nuevoEstado, conError = false) {
  const idNum = Number(asientoId);
  if (!idNum) return;

  if (estadoApp.asientosComprados.has(idNum) && nuevoEstado !== 'comprado') {
    if (conError) {
      const el = estadoApp.asientos.get(idNum) || document.querySelector(`[data-id="${idNum}"]`);
      if (el) {
        el.classList.add('animacion-rechazo');
        setTimeout(() => el.classList.remove('animacion-rechazo'), 400);
      }
    }
    return;
  }

  let elAsiento = estadoApp.asientos.get(idNum);
  if (!elAsiento) {
    elAsiento = document.querySelector(`[data-id="${idNum}"], [data-asiento="${idNum}"]`);
  }
  if (!elAsiento) return;

  const icono = elAsiento.querySelector('.asiento-icono');

  elAsiento.classList.remove('estado-libre', 'estado-proceso', 'estado-comprado', 'libre', 'en-proceso', 'comprado', 'ocupado');

  switch (nuevoEstado) {
    case 'libre':
      elAsiento.classList.add('estado-libre', 'libre');
      if (icono) icono.textContent = '✓';
      break;
    case 'en-proceso':
      elAsiento.classList.add('estado-proceso', 'en-proceso');
      if (icono) icono.textContent = '⏳';
      break;
    case 'comprado':
      estadoApp.asientosComprados.add(idNum);
      elAsiento.classList.add('estado-comprado', 'comprado');
      if (icono) icono.textContent = '🔒';
      break;
  }

  if (conError) {
    elAsiento.classList.add('animacion-rechazo');
    setTimeout(() => elAsiento.classList.remove('animacion-rechazo'), 400);
  }
}

function marcarAsientoEnProceso(asientoId) {
  actualizarEstadoAsiento(asientoId, 'en-proceso');
}

function marcarAsientoComprado(asientoId) {
  actualizarEstadoAsiento(asientoId, 'comprado');
}

function animarRechazo(asientoId) {
  actualizarEstadoAsiento(asientoId, 'rechazo_anim', true);
}

function actualizarContadoresUI() {
  const p = estadoApp.contadores.pasajeros;
  const v = estadoApp.contadores.vendidos;
  const l = estadoApp.contadores.libres;
  const r = estadoApp.contadores.rechazos;
  const sb = estadoApp.contadores.sinBoleto;

  const setTexto = (ids, val) => {
    ids.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    });
  };

  setTexto(['cnt-pasajeros', 'cant-pasajeros'], p);
  setTexto(['cnt-vendidos', 'cant-vendidos'], v);
  setTexto(['cnt-libres', 'cant-libres'], l);
  setTexto(['cnt-rechazos', 'cant-rechazos'], r);
  setTexto(['cnt-sin-boleto', 'cant-sin-boleto'], sb);
}

function agregarLog(mensaje, tipo = 'sistema') {
  const logContenedor = document.getElementById('log-eventos');
  if (!logContenedor) return;
  const linea = document.createElement('div');
  linea.className = `log-linea ${tipo}`;
  linea.textContent = mensaje;
  logContenedor.appendChild(linea);
  logContenedor.scrollTop = logContenedor.scrollHeight;
}

// ==========================================
// SINTETIZADOR DE SONIDOS
// ==========================================
let sonidoHabilitado = false;
let audioCtx = null;

function reproducirEfecto(tipo) {
  if (!sonidoHabilitado) return;
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);

    if (tipo === "compra") {
      osc.type = "sine";
      osc.frequency.setValueAtTime(587.33, audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.12);
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
  } catch (e) {}
}

// ==========================================
// MODAL DE RESUMEN
// ==========================================
function mostrarResumen(evFinal) {
  const modal = document.getElementById("modal-resumen");
  if (!modal) return;

  // 1. Obtener la cantidad real de asientos comprados en memoria
  const compradosReales = estadoApp.asientosComprados.size > 0 
    ? estadoApp.asientosComprados.size 
    : estadoApp.contadores.vendidos;

  const vendidos = (evFinal && evFinal.vendidos > 0) ? evFinal.vendidos : compradosReales;
  const libres = 48 - vendidos;
  
  // 2. CÁLCULO DIRECTO: Pasajeros totales menos los que lograron comprar
  const totalPasajeros = estadoApp.contadores.pasajeros || (evFinal && evFinal.pasajeros) || 80;
  const sinBoleto = Math.max(0, totalPasajeros - vendidos);

  // Sincronizar el contador global y actualizar el panel lateral de la derecha
  estadoApp.contadores.sinBoleto = sinBoleto;
  actualizarContadoresUI();
  
  const pctOcupacion = ((vendidos / 48) * 100).toFixed(1);
  const tasaExito = totalPasajeros > 0 ? ((vendidos / totalPasajeros) * 100).toFixed(1) : "0.0";

  // 3. Renderizar valores numéricos en el Modal
  const setTexto = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };
  setTexto("res-vendidos", vendidos);
  setTexto("res-libres", libres);
  setTexto("res-sin-boleto", sinBoleto);
  setTexto("res-ocupacion", `${pctOcupacion}%`);
  setTexto("res-exito", `${tasaExito}%`);

  // 4. Ubicar contenedores de chips sin alterar los títulos de los pisos
  let chipsP1 = document.getElementById("chips-piso1") || document.getElementById("resumen-piso1");
  let chipsP2 = document.getElementById("chips-piso2") || document.getElementById("resumen-piso2");

  if (!chipsP1 || !chipsP2) {
    const contenedoresChips = modal.querySelectorAll('.chips');
    if (contenedoresChips.length >= 2) {
      chipsP1 = contenedoresChips[0];
      chipsP2 = contenedoresChips[1];
    }
  }

  if (chipsP1) chipsP1.innerHTML = "";
  if (chipsP2) chipsP2.innerHTML = "";

  const listaVendidos = (evFinal && evFinal.asientos_vendidos && evFinal.asientos_vendidos.length > 0)
    ? evFinal.asientos_vendidos
    : Array.from(estadoApp.asientosComprados);

  const piso1Max = estadoApp.configuracion ? (estadoApp.configuracion.piso1 || 12) : 12;

  if (listaVendidos.length > 0) {
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
  }

  if (chipsP1 && chipsP1.children.length === 0) {
    chipsP1.innerHTML = '<span class="vacio" style="color:#94a3b8; font-size: 0.85rem;">Ningún asiento vendido</span>';
  }
  if (chipsP2 && chipsP2.children.length === 0) {
    chipsP2.innerHTML = '<span class="vacio" style="color:#94a3b8; font-size: 0.85rem;">Ningún asiento vendido</span>';
  }

  modal.classList.remove("hidden");
  modal.classList.add("activo");
}

function cerrarModal() {
  const modal = document.getElementById("modal-resumen");
  if (modal) {
    modal.classList.add("hidden");
    modal.classList.remove("activo");
  }
}

// ==========================================
// PROCESADOR DE EVENTOS
// ==========================================
// Dentro de procesarEvento(ev)
function procesarEvento(ev) {
  if (!ev || !ev.evento) return;

  // Actualizar constantemente el contador de tiempo en pantalla
  if (ev.t !== undefined && ev.t !== null) {
    actualizarRelojUI(ev.t);
  }

  switch (ev.evento) {
    case "inicio":
      dibujarBus(ev);
      break;

    case "llega":
      estadoApp.contadores.pasajeros++;
      actualizarContadoresUI();
      agregarLog(`[t=${ev.t}s] Pasajero ${ev.pasajero} llegó (Piso ${ev.preferencia || 1})`, "info");
      break;

    case "intenta":
      marcarAsientoEnProceso(ev.asiento);
      break;

    case "compra":
      estadoApp.contadores.vendidos++;
      if (estadoApp.contadores.libres > 0) estadoApp.contadores.libres--;
      actualizarContadoresUI();
      reproducirEfecto("compra");
      marcarAsientoComprado(ev.asiento);
      agregarLog(`[t=${ev.t}s] ✅ Pasajero ${ev.pasajero} compró asiento #${ev.asiento}`, "exito");
      break;

    case "rechazo":
      estadoApp.contadores.rechazos++;
      actualizarContadoresUI();
      reproducirEfecto("rechazo");
      animarRechazo(ev.asiento);
      agregarLog(`[t=${ev.t}s] ❌ Asiento #${ev.asiento} ocupado`, "error");
      break;

    case "sin_boleto":
      estadoApp.contadores.sinBoleto++;
      actualizarContadoresUI();
      agregarLog(`[t=${ev.t}s] ⚠️ Pasajero ${ev.pasajero} sin boleto`, "alerta");
      break;

    case "fin":
      agregarLog(`[t=${ev.t}s] 🏁 Simulación finalizada`, "sistema");
      actualizarEstadoBotones(false);
      mostrarResumen(ev);
      break;
  }
}

let fuenteSeleccionada = 'simulado';
let fuenteInstanciaActiva = null;

document.addEventListener('DOMContentLoaded', () => {
  inicializarTema();

  dibujarBus({
    asientos: 48,
    piso1: 12,
    piso2: 36,
    pasajeros: 80,
    duracion: 30
  });

  const botones = document.querySelectorAll('button');
  
  botones.forEach(btn => {
    const texto = btn.innerText.trim().toLowerCase();
    
    if (texto.includes('simulada')) {
      btn.addEventListener('click', (e) => cambiarFuente('simulado', e.currentTarget));
    } else if (texto.includes('en vivo')) {
      btn.addEventListener('click', (e) => cambiarFuente('envivo', e.currentTarget));
    } else if (texto.includes('grabación') || texto.includes('grabacion')) {
      btn.addEventListener('click', (e) => cambiarFuente('grabacion', e.currentTarget));
    }
  });
});

function cambiarFuente(tipo, elemento) {
  fuenteSeleccionada = tipo;

  const contenedor = elemento.parentElement;
  if (contenedor) {
    const hermanos = contenedor.querySelectorAll('button');
    hermanos.forEach(b => {
      b.style.backgroundColor = '#334155';
      b.style.color = '#94a3b8';
    });
  }

  elemento.style.backgroundColor = '#2563eb';
  elemento.style.color = '#ffffff';
}

function actualizarEstadoBotones(enEjecucion) {
  const btnIniciar = document.getElementById('btn-iniciar');
  const btnDetener = document.getElementById('btn-detener');

  if (btnIniciar) btnIniciar.disabled = enEjecucion;
  if (btnDetener) btnDetener.disabled = !enEjecucion;
}

// Dentro de limpiarTablero()
function limpiarTablero() {
  estadoApp.contadores = {
    pasajeros: 0,
    vendidos: 0,
    libres: 48,
    rechazos: 0,
    sinBoleto: 0
  };
  actualizarContadoresUI();

  // Resetear reloj a 0.00 s antes de empezar
  actualizarRelojUI(0);

  reseteaEstadosVisuales();

  const log = document.getElementById('log-eventos');
  if (log) {
    log.innerHTML = '<div class="log-linea sistema">[0.00s] Listo para iniciar la simulación.</div>';
  }

  cerrarModal();
}

function iniciarSimulacion() {
  limpiarTablero();

  if (fuenteInstanciaActiva) {
    fuenteInstanciaActiva.detener();
  }

  const config = {
    asientos: 48,
    segundos: 30,
    pasajeros: 80,
    semilla: Math.floor(Math.random() * 1000000).toString()
  };

  actualizarEstadoBotones(true);

  if (fuenteSeleccionada === 'envivo') {
    fuenteInstanciaActiva = crearFuenteEnVivo();
  } else if (fuenteSeleccionada === 'grabacion') {
    fuenteInstanciaActiva = crearFuenteGrabacion();
  } else {
    fuenteInstanciaActiva = typeof crearFuenteSimulada === 'function' 
      ? crearFuenteSimulada() 
      : (typeof crearSimuladorJS === 'function' ? crearSimuladorJS() : null);
  }

  if (fuenteInstanciaActiva) {
    fuenteInstanciaActiva.iniciar(
      config, 
      procesarEvento, 
      () => {
        actualizarEstadoBotones(false);
      }
    );
  }
}

function detenerSimulacion() {
  if (fuenteInstanciaActiva) {
    fuenteInstanciaActiva.detener();
    fuenteInstanciaActiva = null;
  }
  actualizarEstadoBotones(false);
}

// ==========================================
// CONTROL DEL RELOJ DE SIMULACIÓN
// ==========================================
function actualizarRelojUI(segundos) {
  const tFormateado = (typeof segundos === 'number' || !isNaN(parseFloat(segundos)))
    ? parseFloat(segundos).toFixed(2) + ' s'
    : '0.00 s';

  // Buscar el elemento por múltiples IDs o clases posibles en index.html
  const selectores = [
    'tiempo-simulacion',
    'tiempo-val',
    'reloj-simulacion',
    'cronometro',
    'tiempo-transcurrido'
  ];

  selectores.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerText = tFormateado;
  });

  document.querySelectorAll('.tiempo-valor, .reloj-valor').forEach(el => {
    el.innerText = tFormateado;
  });
}