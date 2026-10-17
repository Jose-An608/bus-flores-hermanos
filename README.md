# Simulación de venta de pasajes · Bus Flores Hermanos

Trabajo de Unidad I de **Sistemas Operativos**. Muchos pasajeros (hilos) intentan comprar asientos de un bus de 2 pisos al mismo tiempo. Cada asiento tiene su propio **mutex**, así que nunca se vende dos veces.

**Demo:** https://bus-flores-hermanos.onrender.com · **Integrantes:** José (frontend) · Chura (backend)

## Cómo funciona

```
bus.c (hilos + mutex) ──JSON por línea──▶ server.js ──SSE──▶ navegador (frontend/)
```

1. `backend/bus.c` crea un hilo por pasajero. Para comprar, el hilo hace `pthread_mutex_trylock` sobre el asiento:
   - si lo consigue, "paga" (`usleep`), marca el asiento como vendido y lo libera;
   - si el mutex está tomado o el asiento ya se vendió, es un **rechazo** y prueba con otro asiento (hasta 3 intentos).
2. Con `--json`, cada suceso se imprime como una línea JSON (`llega`, `intenta`, `compra`, `rechazo`, `sin_boleto`, `fin`).
3. `backend/server.js` ejecuta `./bus` y reenvía cada línea al navegador en tiempo real (Server-Sent Events).
4. `frontend/` pinta el bus: verde = libre, amarillo = pagando (mutex tomado), rojo = vendido.

| Archivo | Qué hace |
|---|---|
| `backend/bus.c` | Simulación con pthreads y mutex |
| `backend/server.js` | Lanza `./bus` y envía sus eventos al navegador |
| `backend/verificar.py` | Comprueba que ningún asiento se vendió dos veces |
| `frontend/fuentes.js` | Recibe los eventos: **en vivo** (programa C) o **grabación** (respaldo) |
| `frontend/app.js` | Dibuja asientos, contadores, registro y resumen |
| `grabaciones/eventos_demo.jsonl` | Salida real de `./bus 48 30 80 --json --semilla 7` |

## Ejecutar en Ubuntu / WSL

```bash
npm run build     # compila backend/bus con make
npm start         # http://localhost:3000
```

Solo la terminal:

```bash
cd backend
./bus 10 20 15 --semilla 42                       # caso de la diapositiva
./bus 48 30 80 --json | python3 verificar.py      # prueba de exclusión mutua
make tsan                                         # ThreadSanitizer
```

## Render

- **Build command:** `npm run build`
- **Start command:** `npm start`

Nota: el servidor ejecuta una simulación a la vez. Si dos personas abren la demo al mismo tiempo, la segunda reinicia la del primero.
