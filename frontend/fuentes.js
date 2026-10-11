/**
 * fuentes.js - Fuentes de eventos para la simulación (Etapa 5)
 * Implementa:
 *  1. crearFuenteEnVivo(): Conexión real con servidor Node.js vía SSE (EventSource)
 *  2. crearFuenteGrabacion(): Reproductor de archivos .jsonl registrados
 */

// ==========================================
// 1. FUENTE EN VIVO (Server-Sent Events)
// ==========================================
function crearFuenteEnVivo() {
  let eventSource = null;
  let ejecutando = false;

  function iniciar(config = {}, onEvento, onCierre) {
    detener();
    ejecutando = true;

    // Construir la URL con los parámetros del formulario
    const params = new URLSearchParams({
      asientos: config.asientos || 48,
      segundos: config.segundos || 30,
      pasajeros: config.pasajeros || 80,
      semilla: config.semilla || ""
    });

    const url = `/iniciar?${params.toString()}`;

    try {
      eventSource = new EventSource(url);

      // Escuchar eventos SSE recibidos del servidor Node.js
      eventSource.onmessage = (e) => {
        if (!ejecutando) return;
        try {
          const eventoObj = JSON.parse(e.data);
          
          if (typeof onEvento === "function") {
            onEvento(eventoObj);
          }

          // Si el evento es "fin", cerrar la conexión para evitar autoreconexión de SSE
          if (eventoObj.evento === "fin") {
            cerrarConexion();
            if (typeof onCierre === "function") onCierre();
          }
        } catch (err) {
          console.error("Error al parsear JSON del evento SSE:", err);
        }
      };

      // Evento explícito de cierre enviado por el backend
      eventSource.addEventListener("cierre", () => {
        cerrarConexion();
        if (typeof onCierre === "function") onCierre();
      });

      // Manejo de errores de conexión
      eventSource.onerror = (err) => {
        console.error("Error en conexión SSE:", err);
        cerrarConexion();
        alert("No se pudo conectar con el servidor. ¿Verificaste que 'node server.js' esté corriendo en la terminal?");
        if (typeof onCierre === "function") onCierre();
      };

    } catch (err) {
      console.error("No se pudo instanciar EventSource:", err);
      alert("Error al iniciar EventSource. Verifica si estás ejecutando en un servidor HTTP válido.");
      if (typeof onCierre === "function") onCierre();
    }
  }

  function cerrarConexion() {
    ejecutando = false;
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
  }

  function detener() {
    cerrarConexion();
    // Notificar al servidor que se abortó la simulación
    fetch("/detener", { method: "POST" }).catch(() => {});
  }

  return {
    iniciar,
    detener
  };
}


// ==========================================
// 2. FUENTE GRABACIÓN (Reproductor .jsonl)
// ==========================================
function crearFuenteGrabacion() {
  let timers = [];
  let ejecutando = false;
  let velocidad = 1; // Factor de velocidad: 1x, 2x, 4x

  function setVelocidad(v) {
    velocidad = v || 1;
  }

  function iniciar(config = {}, onEvento, onCierre) {
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

        // Parsear líneas .jsonl
        const lineas = texto.split("\n").map(l => l.trim()).filter(l => l.length > 0);
        const eventos = [];

        for (const linea of lineas) {
          try {
            eventos.push(JSON.parse(linea));
          } catch (e) {
            console.warn("Línea omitida por error de formato JSON:", linea);
          }
        }

        if (eventos.length === 0) {
          alert("El archivo de grabación está vacío o no contiene eventos válidos.");
          if (typeof onCierre === "function") onCierre();
          return;
        }

        // Programar reproducción respetando la propiedad "t" y el multiplicador de velocidad
        eventos.forEach(ev => {
          const tMs = (ev.t || 0) * 1000 / velocidad;
          const timer = setTimeout(() => {
            if (!ejecutando) return;

            if (typeof onEvento === "function") {
              onEvento(ev);
            }

            if (ev.evento === "fin") {
              detener();
              if (typeof onCierre === "function") onCierre();
            }
          }, tMs);

          timers.push(timer);
        });
      })
      .catch(err => {
        console.error("Error al reproducir la grabación:", err);
        alert(`No se encontró el archivo de grabación (${rutaGrabacion}). Puedes usar la opción Simulada o En Vivo.`);
        detener();
        if (typeof onCierre === "function") onCierre();
      });
  }

  function detener() {
    ejecutando = false;
    timers.forEach(t => clearTimeout(t));
    timers = [];
  }

  return {
    iniciar,
    detener,
    setVelocidad
  };
}