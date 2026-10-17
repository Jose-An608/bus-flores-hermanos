// backend/server.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const readline = require('readline');

// Configuración global
const PORT = process.env.PORT || 3000;
const DIRECTORIO_BASE = path.join(__dirname, '../');
const DIRECTORIO_FRONTEND = path.join(DIRECTORIO_BASE, 'frontend');
const DIRECTORIO_GRABACIONES = path.join(DIRECTORIO_BASE, 'grabaciones');

// Tipos MIME permitidos
const MIME_TYPES = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.jsonl': 'application/x-ndjson',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.json': 'application/json'
};

// Variable para controlar que solo haya UNA simulación ejecutándose a la vez
let procesoSimulacion = null;

const server = http.createServer((req, res) => {
    // Parsear la URL de la petición
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;

    // =====================================================================
    // ENDPOINT: Iniciar Simulación (Server-Sent Events)
    // =====================================================================
    if (pathname === '/iniciar' && req.method === 'GET') {
        // Regla: Solo un proceso a la vez. Matar el anterior si existe.
        if (procesoSimulacion) {
            console.log('Matando proceso anterior para iniciar uno nuevo...');
            procesoSimulacion.kill('SIGKILL');
            procesoSimulacion = null;
        }

        // Obtener parámetros y validar que sean enteros
        const asientos = parseInt(url.searchParams.get('asientos'), 10);
        const segundos = parseInt(url.searchParams.get('segundos'), 10);
        const pasajeros = parseInt(url.searchParams.get('pasajeros'), 10);
        const semilla = url.searchParams.get('semilla');

        // Validar rangos establecidos en el contrato del backend en C
        if (
            isNaN(asientos) || asientos < 4 || asientos > 60 ||
            isNaN(segundos) || segundos < 5 || segundos > 120 ||
            isNaN(pasajeros) || pasajeros < 1 || pasajeros > 300
        ) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'Parámetros inválidos o fuera del rango permitido.' }));
        }

        // Configurar las cabeceras obligatorias para Server-Sent Events (SSE)
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no' // Evitar que proxies (ej. Nginx) guarden el stream en buffer
        });

        // Construir arreglo de argumentos de manera segura (prevención de inyección)
        const args = [asientos.toString(), segundos.toString(), pasajeros.toString(), '--json'];
        
        // Agregar la semilla si se proporcionó y es un número válido
        if (semilla && !isNaN(parseInt(semilla, 10))) {
            args.push('--semilla', parseInt(semilla, 10).toString());
        }

        console.log(`[SIMULACIÓN] Iniciando: ./bus ${args.join(' ')}`);

        // Lanzar el proceso hijo (el binario C).
        // Se guarda en una variable LOCAL ("hijo") para que los eventos de este
        // proceso no afecten a una simulación más nueva que se haya iniciado después.
        const rutaEjecutable = path.join(__dirname, 'bus');
        const hijo = spawn(rutaEjecutable, args);
        procesoSimulacion = hijo;
        hijo.stdin.on('error', () => {});   // el proceso pudo terminar justo antes de escribir

        // Interceptar la salida estándar (stdout) usando readline
        const rl = readline.createInterface({ input: hijo.stdout, terminal: false });

        // Por cada línea impresa en C (un JSON válido), se reenvía al navegador web
        rl.on('line', (linea) => {
            if (linea.trim() !== '') {
                res.write(`data: ${linea}\n\n`);
            }
        });

        // Registrar errores en consola si ocurren (stderr)
        hijo.stderr.on('data', (data) => {
            console.error(`[SIMULACIÓN ERROR]: ${data}`);
        });

        // Si el binario no existe o no se puede ejecutar (falta compilar con make)
        hijo.on('error', (err) => {
            console.error(`[SIMULACIÓN] No se pudo ejecutar ./bus: ${err.message}`);
        });

        // Manejar el fin del proceso: avisar al navegador y cerrar la conexión
        hijo.on('close', (codigo) => {
            console.log(`[SIMULACIÓN] Terminada con código de salida ${codigo}`);
            res.write(`event: cierre\ndata: {}\n\n`);
            res.end();
            if (procesoSimulacion === hijo) procesoSimulacion = null;
        });

        // Si el usuario cierra la pestaña, matar SOLO este proceso
        res.on('close', () => {
            if (hijo.exitCode === null) {
                console.log('[SIMULACIÓN] Cliente desconectado. Deteniendo proceso...');
                hijo.kill('SIGKILL');
            }
        });

        return;
    }

    // =====================================================================
    // ENDPOINT: Compra manual del usuario
    // Escribe "comprar N" en la entrada estándar del programa C. Allí, el hilo
    // del usuario intenta comprar con el mismo mutex que los demás pasajeros.
    // El resultado (intenta / compra / rechazo) llega por el mismo canal SSE.
    // =====================================================================
    if (pathname === '/comprar' && req.method === 'GET') {
        const asiento = parseInt(url.searchParams.get('asiento'), 10);
        if (!procesoSimulacion || procesoSimulacion.exitCode !== null) {
            res.writeHead(409, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'No hay una simulación en curso.' }));
        }
        if (isNaN(asiento) || asiento < 1 || asiento > 60) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'Número de asiento inválido.' }));
        }
        procesoSimulacion.stdin.write(`comprar ${asiento}\n`);
        res.writeHead(202, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ mensaje: `Orden enviada: comprar ${asiento}` }));
    }

    // =====================================================================
    // ENDPOINT: Detener Simulación a la fuerza
    // =====================================================================
    if (pathname === '/detener' && req.method === 'GET') {
        if (procesoSimulacion) {
            console.log('[SISTEMA] Solicitud manual de detención recibida.');
            procesoSimulacion.kill('SIGKILL');
            procesoSimulacion = null;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ mensaje: 'Simulación detenida correctamente.' }));
    }

    // =====================================================================
    // RUTEO: Servir archivos estáticos (HTML, CSS, JS) con protección Traversal
    // =====================================================================
    let rutaSolicitada = pathname;
    if (rutaSolicitada === '/') {
        rutaSolicitada = '/index.html';
    }

    let rutaArchivo;
    
    // Mapear rutas
    if (rutaSolicitada.startsWith('/grabaciones/')) {
        const subRuta = rutaSolicitada.replace('/grabaciones/', '');
        rutaArchivo = path.join(DIRECTORIO_GRABACIONES, subRuta);
        
        // Protección Path Traversal (evitar rutas con ../../)
        if (!rutaArchivo.startsWith(DIRECTORIO_GRABACIONES)) {
            res.writeHead(403, { 'Content-Type': 'text/plain' });
            return res.end('Acceso Denegado');
        }
    } else {
        rutaArchivo = path.join(DIRECTORIO_FRONTEND, rutaSolicitada);
        
        // Protección Path Traversal
        if (!rutaArchivo.startsWith(DIRECTORIO_FRONTEND)) {
            res.writeHead(403, { 'Content-Type': 'text/plain' });
            return res.end('Acceso Denegado');
        }
    }

    // Verificar si existe y servirlo
    fs.stat(rutaArchivo, (err, stats) => {
        if (err || !stats.isFile()) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            return res.end('404 - Archivo No Encontrado');
        }

        const extension = path.extname(rutaArchivo).toLowerCase();
        const mimeType = MIME_TYPES[extension] || 'application/octet-stream';

        res.writeHead(200, { 'Content-Type': mimeType });
        const readStream = fs.createReadStream(rutaArchivo);
        readStream.pipe(res);
    });
});

// Iniciar servidor
server.listen(PORT, () => {
    console.log(`===============================================`);
    console.log(`Servidor puente listo en http://localhost:${PORT}`);
    console.log(`Modo: Server-Sent Events Activo`);
    console.log(`===============================================`);
});