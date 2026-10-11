/**
 * simulador.js - Generador de eventos simulados (Fuente Simulada - Etapa 2)
 * Cumple con el contrato desacoplado del frontend.
 */
function crearFuenteSimulada() {
  let timers = [];
  let ejecutando = false;

  function iniciar(config = {}, onEvento, onCierre) {
    detener();
    ejecutando = true;

    const asientosTotales = config.asientos || 48;
    const duracionSeg = config.segundos || 30;
    const totalPasajeros = config.pasajeros || 80;
    const piso1Max = 12;

    const estadoAsientos = new Array(asientosTotales + 1).fill(false);
    const vendidosList = [];
    let vendidosCount = 0;
    let rechazadosCount = 0;
    let sinBoletoCount = 0;

    // 1. Evento Inicio (t = 0)
    programarEvento(0, {
      t: 0,
      evento: "inicio",
      asientos: asientosTotales,
      piso1: piso1Max,
      piso2: asientosTotales - piso1Max,
      pasajeros: totalPasajeros,
      duracion: duracionSeg
    }, onEvento);

    // Ráfagas de hora pico
    const rafagas = [0.15, 0.50, 0.80];

    // Simular pasajeros
    for (let p = 1; p <= totalPasajeros; p++) {
      let tLlegada;
      if (Math.random() < 0.65) {
        const r = rafagas[Math.floor(Math.random() * rafagas.length)];
        tLlegada = (r * duracionSeg) + (Math.random() * 2 - 1);
      } else {
        tLlegada = Math.random() * (duracionSeg - 4);
      }
      tLlegada = Math.max(0.5, Math.min(duracionSeg - 3, tLlegada));

      const prefPiso = (Math.random() < 0.3) ? 1 : 2;

      // Evento llega
      programarEvento(tLlegada, {
        t: Number(tLlegada.toFixed(2)),
        evento: "llega",
        pasajero: p,
        preferencia: prefPiso
      }, onEvento);

      let tiempoPaso = tLlegada + 0.3;

      // Intentos de compra (hasta 3 intentos)
      for (let intento = 1; intento <= 3; intento++) {
        const tIntento = tiempoPaso;
        tiempoPaso += 0.8 + (Math.random() * 0.4);

        if (tIntento >= duracionSeg - 1) break;

        let minA = prefPiso === 1 ? 1 : piso1Max + 1;
        let maxA = prefPiso === 1 ? piso1Max : asientosTotales;

        if (intento > 1 && Math.random() < 0.5) {
          minA = 1;
          maxA = asientosTotales;
        }

        const asientoElegido = Math.floor(Math.random() * (maxA - minA + 1)) + minA;
        const pisoActual = asientoElegido <= piso1Max ? 1 : 2;

        // Evento intenta
        programarEvento(tIntento, {
          t: Number(tIntento.toFixed(2)),
          evento: "intenta",
          pasajero: p,
          asiento: asientoElegido,
          piso: pisoActual,
          intento: intento
        }, onEvento);

        // Resultado diferido (conflicto real de compra)
        const tResultado = tIntento + 0.3;
        const timerRes = setTimeout(() => {
          if (!ejecutando) return;

          if (estadoAsientos[asientoElegido]) {
            rechazadosCount++;
            onEvento({
              t: Number(tResultado.toFixed(2)),
              evento: "rechazo",
              pasajero: p,
              asiento: asientoElegido,
              motivo: "ocupado"
            });
          } else {
            estadoAsientos[asientoElegido] = true;
            vendidosList.push(asientoElegido);
            vendidosCount++;
            onEvento({
              t: Number(tResultado.toFixed(2)),
              evento: "compra",
              pasajero: p,
              asiento: asientoElegido,
              piso: pisoActual
            });
          }
        }, tResultado * 1000);

        timers.push(timerRes);
      }
    }

    // Evento fin
    programarEvento(duracionSeg, {
      t: duracionSeg,
      evento: "fin",
      vendidos: vendidosCount,
      libres: asientosTotales - vendidosCount,
      sin_boleto: Math.max(0, totalPasajeros - vendidosCount),
      asientos_vendidos: vendidosList
    }, (ev) => {
      onEvento(ev);
      detener();
      if (typeof onCierre === "function") onCierre();
    });
  }

  function programarEvento(segundos, eventoObj, callback) {
    const timer = setTimeout(() => {
      if (ejecutando && typeof callback === "function") {
        callback(eventoObj);
      }
    }, segundos * 1000);
    timers.push(timer);
  }

  function detener() {
    ejecutando = false;
    timers.forEach(t => clearTimeout(t));
    timers = [];
  }

  return {
    iniciar,
    detener
  };
}

/**
 * simulador.js - Generador local de eventos aleatorios
 */
function crearSimuladorJS() {
  let timerId = null;

  return {
    iniciar(config = {}, onEvento, onFin) {
      this.detener();

      const totalAsientos = config.asientos || 48;
      const totalPasajeros = config.pasajeros || 80;
      const duracion = config.segundos || 30;

      const piso1 = Math.floor(totalAsientos / 4);
      const piso2 = totalAsientos - piso1;

      // Evento de inicio
      if (onEvento) {
        onEvento({
          evento: "inicio",
          asientos: totalAsientos,
          piso1: piso1,
          piso2: piso2,
          pasajeros: totalPasajeros,
          duracion: duracion
        });
      }

      const asientosOcupados = new Set();
      let tiempoActual = 0;
      let pasajeroId = 1;

      timerId = setInterval(() => {
        tiempoActual += 0.5;

        if (tiempoActual >= duracion || pasajeroId > totalPasajeros) {
          clearInterval(timerId);
          if (onEvento) {
            onEvento({
              evento: "fin",
              t: tiempoActual,
              vendidos: asientosOcupados.size,
              libres: totalAsientos - asientosOcupados.size,
              sin_boleto: Math.max(0, totalPasajeros - asientosOcupados.size)
            });
          }
          if (onFin) onFin();
          return;
        }

        // Simular intento y compra aleatoria
        const asientoElegido = Math.floor(Math.random() * totalAsientos) + 1;
        const piso = asientoElegido <= piso1 ? 1 : 2;

        if (onEvento) {
          onEvento({
            evento: "llega",
            t: tiempoActual,
            pasajero: pasajeroId,
            preferencia: piso
          });

          if (!asientosOcupados.has(asientoElegido)) {
            asientosOcupados.add(asientoElegido);
            onEvento({
              evento: "compra",
              t: tiempoActual + 0.1,
              pasajero: pasajeroId,
              asiento: asientoElegido,
              piso: piso
            });
          } else {
            onEvento({
              evento: "rechazo",
              t: tiempoActual + 0.1,
              pasajero: pasajeroId,
              asiento: asientoElegido,
              motivo: "ocupado"
            });
          }
        }

        pasajeroId++;
      }, 400);
    },

    detener() {
      if (timerId) {
        clearInterval(timerId);
        timerId = null;
      }
    }
  };
}