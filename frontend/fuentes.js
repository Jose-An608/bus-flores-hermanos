/**
 * fuentes.js - Fuentes de eventos para la simulación
 *  1. crearFuenteSimulada(): Simulación local en JS
 *  2. crearFuenteEnVivo(): Conexión real SSE con backend Node.js / C
 *  3. crearFuenteGrabacion(): Reproductor de archivos .jsonl respetando tiempos 't'
 */

// ==========================================
// 1. FUENTE SIMULADA (JavaScript Local)
// ==========================================
function crearFuenteSimulada() {
  let instanciaSimulador = null;

  return {
    iniciar(config = {}, onEvento, onFin) {
      this.detener();
      if (typeof crearSimuladorJS === 'function') {
        instanciaSimulador = crearSimuladorJS();
        instanciaSimulador.iniciar(config, onEvento, onFin);
      } else if (typeof crearSimulador === 'function') {
        instanciaSimulador = crearSimulador();
        instanciaSimulador.iniciar(config, onEvento, onFin);
      } else {
        console.error("No se encontró la función del simulador local en simulador.js");
        if (typeof onFin === 'function') onFin();
      }
    },

    detener() {
      if (instanciaSimulador && typeof instanciaSimulador.detener === 'function') {
        instanciaSimulador.detener();
        instanciaSimulador = null;
      }
    }
  };
}

// ==========================================
// 2. FUENTE EN VIVO (Server-Sent Events)
// ==========================================
function crearFuenteEnVivo() {
  let eventSource = null;
  let ejecutando = false;

  function cerrarConexion() {
    ejecutando = false;
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
  }

  function iniciar(config = {}, onEvento, onFin) {
    detener();
    ejecutando = true;

    // Asegurar semilla única para que cada corrida en C genere datos distintos
    const semilla = config.semilla || Math.floor(Math.random() * 900000 + 100000).toString();

    const params = new URLSearchParams({
      asientos: config.asientos || 48,
      segundos: config.segundos || 30,
      pasajeros: config.pasajeros || 80,
      semilla: semilla
    });

    const url = `/iniciar?${params.toString()}`;

    try {
      eventSource = new EventSource(url);

      eventSource.onmessage = (e) => {
        if (!ejecutando) return;
        try {
          const ev = JSON.parse(e.data);
          if (typeof onEvento === "function") onEvento(ev);

          // Si el evento es "fin", cerrar SSE para evitar la reconexión automática
          if (ev.evento === "fin") {
            cerrarConexion();
            if (typeof onFin === "function") onFin();
          }
        } catch (err) {
          console.error("Error al parsear JSON del evento SSE:", err);
        }
      };

      eventSource.addEventListener("cierre", () => {
        cerrarConexion();
        if (typeof onFin === "function") onFin();
      });

      eventSource.onerror = (err) => {
        console.error("Error en conexión SSE:", err);
        cerrarConexion();
        alert("No se pudo conectar con el servidor. ¿Verificaste que 'node server.js' esté corriendo en la terminal?");
        if (typeof onFin === "function") onFin();
      };

    } catch (err) {
      console.error("No se pudo instanciar EventSource:", err);
      if (typeof onFin === "function") onFin();
    }
  }

  function detener() {
    cerrarConexion();
    fetch("/detener").catch(() => {});
  }

  return {
    iniciar,
    detener
  };
}

// ==========================================
// 3. FUENTE GRABACIÓN (Reproductor .jsonl por tiempo t)
// ==========================================
function crearFuenteGrabacion() {
  let timers = [];
  let ejecutando = false;
  let velocidad = 1;

  function detener() {
    ejecutando = false;
    timers.forEach(t => clearTimeout(t));
    timers = [];
  }

  function iniciar(config = {}, onEvento, onFin) {
    detener();
    ejecutando = true;

    const rutaGrabacion = config.archivo || "/grabaciones/eventos_demo.jsonl";

    fetch(rutaGrabacion)
      .then(res => {
        if (!res.ok) throw new Error(`No se pudo cargar la grabación desde ${rutaGrabacion}`);
        return res.text();
      })
      .then(texto => {
        if (!ejecutando) return;

        const lineas = texto.split("\n").map(l => l.trim()).filter(l => l.length > 0);
        const eventos = [];

        for (const linea of lineas) {
          try {
            eventos.push(JSON.parse(linea));
          } catch (e) {
            console.warn("Línea omitida por formato no válido:", linea);
          }
        }

        if (eventos.length === 0) {
          alert("El archivo de grabación está vacío o no contiene eventos válidos.");
          if (typeof onFin === "function") onFin();
          return;
        }

        // Programar reproducción respetando el tiempo 't' real de cada evento
        eventos.forEach(ev => {
          const tMs = ((ev.t || 0) * 1000) / velocidad;
          const timer = setTimeout(() => {
            if (!ejecutando) return;

            if (typeof onEvento === "function") onEvento(ev);

            if (ev.evento === "fin") {
              detener();
              if (typeof onFin === "function") onFin();
            }
          }, tMs);

          timers.push(timer);
        });
      })
      .catch(err => {
        console.error("Error al reproducir la grabación:", err);
        alert(`No se encontró el archivo de grabación (${rutaGrabacion}). Puedes usar la opción Simulada o En Vivo.`);
        detener();
        if (typeof onFin === "function") onFin();
      });
  }

  return {
    iniciar,
    detener,
    setVelocidad: (v) => { velocidad = v || 1; }
  };
}