/**
 * fuentes.js — De dónde vienen los eventos.
 *
 * Hay dos fuentes y las dos tienen la MISMA forma:
 *     fuente.iniciar(config, alRecibirEvento, alTerminar, alFallar)
 *     fuente.detener()
 *
 * Así app.js no necesita saber si los datos vienen del programa C en vivo
 * o de una grabación: solo recibe eventos y los dibuja.
 */

/* ---------------------------------------------------------
 * 1) EN VIVO: el servidor ejecuta ./bus y nos reenvía cada
 *    línea JSON que imprime el programa C (Server-Sent Events).
 * --------------------------------------------------------- */
function crearFuenteEnVivo() {
  let conexion = null;

  function iniciar(config, alRecibirEvento, alTerminar, alFallar) {
    const parametros = new URLSearchParams({
      asientos: config.asientos,
      segundos: config.segundos,
      pasajeros: config.pasajeros,
    });
    if (config.semilla !== '') parametros.set('semilla', config.semilla);

    let recibioAlgo = false;
    conexion = new EventSource('/iniciar?' + parametros);

    // Cada mensaje es una línea JSON impresa por bus.c
    conexion.onmessage = (mensaje) => {
      recibioAlgo = true;
      const evento = JSON.parse(mensaje.data);
      alRecibirEvento(evento);
      if (evento.evento === 'fin') terminar();
    };

    // El servidor avisa que el proceso C terminó
    conexion.addEventListener('cierre', terminar);

    // Si no se pudo conectar (o se cortó), cerramos para que el
    // navegador no reintente solo y vuelva a lanzar la simulación.
    conexion.onerror = () => {
      cerrar();
      if (recibioAlgo) alTerminar();
      else alFallar('No se pudo conectar con el servidor (node backend/server.js).');
    };

    function terminar() {
      if (!conexion) return;
      cerrar();
      alTerminar();
    }
  }

  function cerrar() {
    if (conexion) conexion.close();
    conexion = null;
  }

  function detener() {
    cerrar();
    fetch('/detener').catch(() => {});
  }

  return { iniciar, detener };
}

/* ---------------------------------------------------------
 * 2) GRABACIÓN: una salida real de bus.c guardada en un archivo
 *    (./bus 48 30 80 --json --semilla 7 > grabaciones/eventos_demo.jsonl).
 *    Se reproduce respetando el tiempo "t" de cada evento.
 *    Sirve de respaldo si el servidor falla en la exposición.
 * --------------------------------------------------------- */
function crearFuenteGrabacion() {
  let temporizadores = [];

  async function iniciar(config, alRecibirEvento, alTerminar, alFallar) {
    let eventos;
    try {
      const respuesta = await fetch('grabaciones/eventos_demo.jsonl');
      if (!respuesta.ok) throw new Error();
      const texto = await respuesta.text();
      eventos = texto.split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
    } catch {
      alFallar('No se encontró la grabación (grabaciones/eventos_demo.jsonl).');
      return;
    }

    // Programamos cada evento para el segundo en que ocurrió
    for (const evento of eventos) {
      const id = setTimeout(() => {
        alRecibirEvento(evento);
        if (evento.evento === 'fin') { detener(); alTerminar(); }
      }, evento.t * 1000);
      temporizadores.push(id);
    }
  }

  function detener() {
    temporizadores.forEach(clearTimeout);
    temporizadores = [];
  }

  return { iniciar, detener };
}
