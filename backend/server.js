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

        // Lanzar el proceso hijo (el binario C)
        const rutaEjecutable = path.join(__dirname, 'bus');
        procesoSimulacion = spawn(rutaEjecutable, args);

        // Interceptar la salida estándar (stdout) usando readline
        const rl = readline.createInterface({
            input: procesoSimulacion.stdout,
            terminal: false
        });

        // Por cada línea impresa en C (un JSON válido), se reenvía al navegador web
        rl.on('line', (linea) => {
            if (linea.trim() !== '') {
                res.write(`data: ${linea}\n\n`);
            }
        });

        // Registrar errores en consola si ocurren (stderr)
        procesoSimulacion.stderr.on('data', (data) => {
            console.error(`[SIMULACIÓN ERROR]: ${data}`);
        });

        // Manejar el fin del proceso
        procesoSimulacion.on('close', (codigo) => {
            console.log(`[SIMULACIÓN] Terminada con código de salida ${codigo}`);
            // Enviar evento finalizador y cerrar la conexión limpia
            res.write(`event: cierre\ndata: {}\n\n`);
            res.end();
            procesoSimulacion = null;
        });

        // Si el usuario cierra el navegador o cambia de pestaña, matar el proceso
        req.on('close', () => {
            if (procesoSimulacion) {
                console.log('[SIMULACIÓN] Cliente desconectado. Deteniendo proceso...');
                procesoSimulacion.kill('SIGKILL');
                procesoSimulacion = null;
            }
        });

        return;
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