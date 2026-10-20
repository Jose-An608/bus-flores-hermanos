/* =====================================================================
 * bus.c · Flores Hermanos · Sistemas Operativos
 *
 * Simula la venta de pasajes de un bus de 2 pisos. Cada pasajero es un
 * HILO (pthread) y cada asiento tiene su propio MUTEX, así que nunca se
 * vende un asiento dos veces aunque muchos hilos compren a la vez.
 *
 * Idea en una frase: main crea un hilo por pasajero; cada hilo llega a su
 * hora, elige un asiento e intenta tomar su mutex con trylock. Si lo
 * consigue, confirma que sigue libre, paga con el candado tomado y lo
 * suelta; si no, prueba otro asiento (hasta 3 veces).
 *
 * Uso:  ./bus <asientos> <segundos> <pasajeros> [--json] [--semilla N]
 *
 * Las secciones están numeradas en el orden en que se ejecutan (igual que
 * en explicacion_bus_c.pdf): 1 librerías, 2 variables, 3 main (al final
 * del archivo), 4 rutina de cada pasajero, 5 hilo del usuario.
 * ===================================================================== */

/* ---------- 1. LIBRERÍAS ---------- */
#include <stdio.h>
#include <stdlib.h>
#include <pthread.h>     /* hilos y mutex: pthread_create, pthread_mutex_* */
#include <unistd.h>      /* usleep, sleep */
#include <time.h>
#include <errno.h>       /* EBUSY: lo que devuelve trylock si el mutex está tomado */
#include <string.h>
#include <stdatomic.h>   /* atomic_int: variables que varios hilos leen/escriben sin carrera */
#include <poll.h>        /* poll: esperar órdenes del usuario sin bloquearse para siempre */

/* ---------- 2. EL ASIENTO Y LAS VARIABLES GLOBALES ---------- */

/* Cada asiento es un objeto con su PROPIO candado (lo pide el enunciado).
   Con un mutex por asiento, dos pasajeros solo se bloquean si quieren
   el mismo asiento; los demás compran en paralelo. */
struct Asiento {
    int id;                 /* número del asiento, de 1 a s_num */
    int piso;               /* 1 o 2 */
    pthread_mutex_t mutex;  /* el candado de ESTE asiento */
    atomic_int vendido;     /* 0 = libre, 1 = vendido. Atómico: se puede MIRAR sin el
                               mutex (vista quizás desactualizada); la decisión final
                               siempre se toma con el mutex tomado */
    int comprador;          /* id del pasajero que lo compró (0 = el usuario) */
};

/* Variables globales = recursos compartidos por TODOS los hilos.
   Las que se modifican están protegidas con un mutex o son atómicas. */

time_t tiempo_inicio;            /* inicio de la simulación (segundos). Solo la escribe main */
struct timespec start_time_mono; /* reloj preciso para el campo "t" de cada evento */
int tiempo_simulacion;           /* duración total en segundos (solo lectura) */
int s_num;                       /* número de asientos, ids de 1 a n (solo lectura) */
int p_num;                       /* número de pasajeros = número de hilos (solo lectura) */
atomic_int tiempo_agotado = 0;   /* aviso de "se acabó el tiempo": lo escribe main y lo
                                    leen todos los hilos; atómica para evitar carreras */
int modo_json = 0;               /* 1 = imprimir eventos en JSON (para la página web) */
int semilla_base = -1;           /* -1 = aleatorio; otro valor = resultados repetibles */

/* Contadores del resumen: protegidos por mutex_contadores.
   OJO: "cont_vendidos++" son 3 pasos (leer, sumar, escribir); sin mutex,
   dos hilos a la vez podrían perder una venta. */
int cont_vendidos = 0;
int cont_rechazos = 0;
int cont_sin_boleto = 0;

pthread_mutex_t mutex_contadores;  /* protege los 3 contadores */
pthread_mutex_t mutex_impresion;   /* un solo hilo imprime a la vez: las líneas no se mezclan */
struct Asiento *asientos;          /* arreglo con los s_num asientos del bus */

/* Segundos transcurridos desde el inicio (se imprime con 2 decimales) */
double get_time_t() {
    struct timespec current;
    clock_gettime(CLOCK_MONOTONIC, &current);
    double elapsed = (current.tv_sec - start_time_mono.tv_sec) + 
                     (current.tv_nsec - start_time_mono.tv_nsec) / 1000000000.0;
    return elapsed;
}

/* ---------- 4. RUTINA_PASAJERO: LO QUE HACE CADA HILO ---------- */
void *rutina_pasajero(void *arg) {
    int id = *(int*)arg;   /* número de pasajero que le pasó main */
    free(arg); 
    
    /* a) Semilla propia de este hilo. rand_r(&seed) es seguro con hilos porque
          cada uno guarda su propio estado (rand() normal lo comparte).
          Con --semilla: semilla + id -> el pasajero repite siempre sus decisiones.
          Sin semilla: la hora actual -> cada ejecución es distinta. */
    unsigned int seed;
    if (semilla_base >= 0) {
        seed = (unsigned int)(semilla_base + id);
    } else {
        seed = (unsigned int)time(NULL) ^ id;
    }

    /* b) Hora de llegada con 3 HORAS PICO (10 %, 40 % y 70 % del tiempo):
          así muchos hilos llegan casi juntos y compiten por los asientos.
          El 55 % restante llega en cualquier momento del primer 80 %. */
    double proporcion = (double)rand_r(&seed) / RAND_MAX;
    double pct_llegada;
    
    if (proporcion < 0.15) {
        pct_llegada = 0.10 + ((double)rand_r(&seed) / RAND_MAX * 0.05);
    } else if (proporcion < 0.30) {
        pct_llegada = 0.40 + ((double)rand_r(&seed) / RAND_MAX * 0.05);
    } else if (proporcion < 0.45) {
        pct_llegada = 0.70 + ((double)rand_r(&seed) / RAND_MAX * 0.05);
    } else {
        pct_llegada = ((double)rand_r(&seed) / RAND_MAX * 0.80);
    }

    int espera_llegada_us = (int)(pct_llegada * tiempo_simulacion * 1000000);
    usleep(espera_llegada_us);   /* el hilo "duerme" hasta su hora de llegada */

    /* Evento: llega. El 70 % prefiere el piso 2 */
    int pref_piso = (rand_r(&seed) % 100 < 70) ? 2 : 1;
    
    if (!tiempo_agotado) {
        pthread_mutex_lock(&mutex_impresion);
        if (modo_json) {
            printf("{\"t\":%.2f,\"evento\":\"llega\",\"pasajero\":%d,\"preferencia\":%d}\n", get_time_t(), id, pref_piso);
        } else {
            printf("[%.2fs] Pasajero %d llega a boleteria (Preferencia: Piso %d)\n", get_time_t(), id, pref_piso);
        }
        pthread_mutex_unlock(&mutex_impresion);
    }

    /* Si llegó cuando ya se acabó el tiempo, se va sin boleto */
    if (tiempo_agotado) {
        pthread_mutex_lock(&mutex_contadores);
        cont_sin_boleto++;
        pthread_mutex_unlock(&mutex_contadores);
        
        pthread_mutex_lock(&mutex_impresion);
        if (modo_json) {
            printf("{\"t\":%.2f,\"evento\":\"sin_boleto\",\"pasajero\":%d,\"motivo\":\"tiempo_agotado\"}\n", get_time_t(), id);
        } else {
            printf("[%.2fs] Pasajero %d se retira (tiempo agotado)\n", get_time_t(), id);
        }
        pthread_mutex_unlock(&mutex_impresion);
        return NULL;
    }

    /* c) Hasta 3 intentos de compra */
    int comprado = 0;
    for (int intento = 1; intento <= 3 && !tiempo_agotado && !comprado; intento++) {
        /* 15 % de las veces mira todo el bus y no solo su piso: provoca más choques */
        int info_desactualizada = (rand_r(&seed) % 100 < 15);
        int target = -1;
        
        int *candidatos = malloc(s_num * sizeof(int));
        int num_candidatos = 0;
        
        /* Lista de asientos que PARECEN libres. Se lee "vendido" SIN el mutex,
           solo para elegir: el dato puede cambiar justo después, por eso
           luego se vuelve a comprobar con el candado tomado (paso e). */
        for (int i = 0; i < s_num; i++) {
            if (asientos[i].vendido == 0) {
                if (info_desactualizada || asientos[i].piso == pref_piso) {
                    candidatos[num_candidatos++] = i;
                }
            }
        }

        if (num_candidatos > 0) {
            target = candidatos[rand_r(&seed) % num_candidatos];
        }
        free(candidatos);

        if (target == -1) break; /* no ve asientos libres en su piso: se rinde */

        /* d) EXCLUSIÓN MUTUA: intentar tomar el candado del asiento SIN esperar.
              lock() dejaría al hilo bloqueado; trylock() responde al instante:
              0 = lo tengo, EBUSY = otro hilo lo tiene (está pagando ese asiento). */
        int lock_res = pthread_mutex_trylock(&asientos[target].mutex);
        
        if (lock_res == EBUSY) {
            /* Rechazo "ocupado": espera un poco y prueba otro asiento */
            pthread_mutex_lock(&mutex_contadores);
            cont_rechazos++;
            pthread_mutex_unlock(&mutex_contadores);
            
            pthread_mutex_lock(&mutex_impresion);
            if (modo_json) {
                printf("{\"t\":%.2f,\"evento\":\"rechazo\",\"pasajero\":%d,\"asiento\":%d,\"motivo\":\"ocupado\"}\n", get_time_t(), id, asientos[target].id);
            } else {
                printf("[%.2fs] Pasajero %d rechazo en asiento %d (ocupado en proceso)\n", get_time_t(), id, asientos[target].id);
            }
            pthread_mutex_unlock(&mutex_impresion);
            
            usleep(100000 + (rand_r(&seed) % 100000));
            continue;
        } else if (lock_res == 0) {
            /* e) Ya tengo el candado: confirmar que nadie lo compró antes.
                  Ahora el dato es seguro porque nadie más puede tocar este asiento. */
            if (asientos[target].vendido == 1) {
                pthread_mutex_unlock(&asientos[target].mutex);
                pthread_mutex_lock(&mutex_contadores);
                cont_rechazos++;
                pthread_mutex_unlock(&mutex_contadores);
                
                pthread_mutex_lock(&mutex_impresion);
                if (modo_json) {
                    printf("{\"t\":%.2f,\"evento\":\"rechazo\",\"pasajero\":%d,\"asiento\":%d,\"motivo\":\"vendido\"}\n", get_time_t(), id, asientos[target].id);
                } else {
                    printf("[%.2fs] Pasajero %d rechazo en asiento %d (ya vendido)\n", get_time_t(), id, asientos[target].id);
                }
                pthread_mutex_unlock(&mutex_impresion);
                
                usleep(100000 + (rand_r(&seed) % 100000));
                continue;
            }

            /* Evento: intenta (ya tiene el lock) */
            pthread_mutex_lock(&mutex_impresion);
            if (modo_json) {
                printf("{\"t\":%.2f,\"evento\":\"intenta\",\"pasajero\":%d,\"asiento\":%d,\"piso\":%d,\"intento\":%d}\n", get_time_t(), id, asientos[target].id, asientos[target].piso, intento);
            } else {
                printf("[%.2fs] Pasajero %d intenta pagar asiento %d (Piso %d) [Intento %d]\n", get_time_t(), id, asientos[target].id, asientos[target].piso, intento);
            }
            pthread_mutex_unlock(&mutex_impresion);

            /* f) SECCIÓN CRÍTICA: pagar (0.3 a 1.2 s) CON el candado tomado.
                  Mientras tanto, cualquier otro hilo que intente este asiento
                  recibe EBUSY: por eso nunca se vende dos veces. */
            int tiempo_pago = 300000 + (rand_r(&seed) % 900001); 
            usleep(tiempo_pago);

            asientos[target].vendido = 1;
            asientos[target].comprador = id;
            
            pthread_mutex_unlock(&asientos[target].mutex);   /* liberar el asiento */

            /* g) Actualizar el contador con su propio mutex */
            pthread_mutex_lock(&mutex_contadores);
            cont_vendidos++;
            pthread_mutex_unlock(&mutex_contadores);

            /* Evento: compra */
            pthread_mutex_lock(&mutex_impresion);
            if (modo_json) {
                printf("{\"t\":%.2f,\"evento\":\"compra\",\"pasajero\":%d,\"asiento\":%d,\"piso\":%d}\n", get_time_t(), id, asientos[target].id, asientos[target].piso);
            } else {
                printf("[%.2fs] Pasajero %d compro el asiento %d (Piso %d)\n", get_time_t(), id, asientos[target].id, asientos[target].piso);
            }
            pthread_mutex_unlock(&mutex_impresion);

            comprado = 1;
        }
    }

    /* h) No compró en 3 intentos (o se llenó el bus, o se acabó el tiempo) */
    if (!comprado) {
        pthread_mutex_lock(&mutex_contadores);
        cont_sin_boleto++;
        int llenos = (cont_vendidos >= s_num);
        pthread_mutex_unlock(&mutex_contadores);
        
        pthread_mutex_lock(&mutex_impresion);
        const char* motivo = llenos ? "bus_lleno" : (tiempo_agotado ? "tiempo_agotado" : "sin_intentos");
        if (modo_json) {
            printf("{\"t\":%.2f,\"evento\":\"sin_boleto\",\"pasajero\":%d,\"motivo\":\"%s\"}\n", get_time_t(), id, motivo);
        } else {
            printf("[%.2fs] Pasajero %d se retira sin boleto (%s)\n", get_time_t(), id, motivo);
        }
        pthread_mutex_unlock(&mutex_impresion);
    }

    return NULL;
}

/* ---------- 5. EL HILO DEL USUARIO (COMPRA MANUAL) ----------
 * =====================================================================
 * COMPRA MANUAL: el usuario es un pasajero más (pasajero 0).
 * Recibe órdenes "comprar N" por la entrada estándar (desde la página web
 * a través de server.js, o escribiéndolas en la terminal).
 * Usa EXACTAMENTE el mismo protocolo que los otros hilos:
 *     trylock -> ¿ya vendido? -> pagar -> marcar vendido -> unlock
 * ===================================================================== */
#define USUARIO 0
#define PAGO_USUARIO_US 1500000   /* 1.5 s de pago, para que se vea el asiento amarillo */

/* Imprime un evento del usuario en JSON o en texto, sin mezclarse con otros hilos */
static void anunciar(const char *json, const char *texto) {
    pthread_mutex_lock(&mutex_impresion);
    if (modo_json) printf("{\"t\":%.2f,%s}\n", get_time_t(), json);
    else           printf("[%.2fs] USUARIO %s\n", get_time_t(), texto);
    pthread_mutex_unlock(&mutex_impresion);
}

static void comprar_manual(struct Asiento *a) {
    char json[160], texto[96];

    /* ¿Ya no quedan asientos? */
    pthread_mutex_lock(&mutex_contadores);
    int lleno = (cont_vendidos >= s_num);
    pthread_mutex_unlock(&mutex_contadores);
    if (lleno) {
        snprintf(json, sizeof json, "\"evento\":\"rechazo\",\"pasajero\":%d,\"asiento\":%d,\"motivo\":\"bus_lleno\"", USUARIO, a->id);
        snprintf(texto, sizeof texto, "no pudo comprar el asiento %d (bus lleno)", a->id);
        anunciar(json, texto);
        return;
    }

    /* 1. Intentar tomar el mutex del asiento SIN esperar */
    if (pthread_mutex_trylock(&a->mutex) == EBUSY) {
        /* Otro hilo lo tiene tomado: está pagando ese asiento ahora mismo */
        pthread_mutex_lock(&mutex_contadores);
        cont_rechazos++;
        pthread_mutex_unlock(&mutex_contadores);
        snprintf(json, sizeof json, "\"evento\":\"rechazo\",\"pasajero\":%d,\"asiento\":%d,\"motivo\":\"ocupado\"", USUARIO, a->id);
        snprintf(texto, sizeof texto, "rechazado en el asiento %d (otro hilo tiene el mutex)", a->id);
        anunciar(json, texto);
        return;
    }

    /* 2. Tenemos el mutex: revisar si alguien ya lo compró antes */
    if (a->vendido) {
        pthread_mutex_unlock(&a->mutex);
        pthread_mutex_lock(&mutex_contadores);
        cont_rechazos++;
        pthread_mutex_unlock(&mutex_contadores);
        snprintf(json, sizeof json, "\"evento\":\"rechazo\",\"pasajero\":%d,\"asiento\":%d,\"motivo\":\"vendido\"", USUARIO, a->id);
        snprintf(texto, sizeof texto, "rechazado en el asiento %d (ya vendido)", a->id);
        anunciar(json, texto);
        return;
    }

    /* 3. Pagar con el mutex tomado: nadie más puede entrar a este asiento */
    snprintf(json, sizeof json, "\"evento\":\"intenta\",\"pasajero\":%d,\"asiento\":%d,\"piso\":%d,\"intento\":1", USUARIO, a->id, a->piso);
    snprintf(texto, sizeof texto, "bloquea el asiento %d y paga...", a->id);
    anunciar(json, texto);
    usleep(PAGO_USUARIO_US);

    /* 4. Marcar vendido y liberar el mutex */
    a->vendido = 1;
    a->comprador = USUARIO;
    pthread_mutex_unlock(&a->mutex);

    pthread_mutex_lock(&mutex_contadores);
    cont_vendidos++;
    pthread_mutex_unlock(&mutex_contadores);

    snprintf(json, sizeof json, "\"evento\":\"compra\",\"pasajero\":%d,\"asiento\":%d,\"piso\":%d", USUARIO, a->id, a->piso);
    snprintf(texto, sizeof texto, "compro el asiento %d (Piso %d)", a->id, a->piso);
    anunciar(json, texto);
}

/* Hilo que escucha las órdenes del usuario mientras dura la simulación */
void *rutina_usuario(void *arg) {
    (void)arg;
    char linea[64];
    setvbuf(stdin, NULL, _IONBF, 0);   /* sin buffer: poll() ve cada orden apenas llega */

    while (!tiempo_agotado) {
        /* Esperar una orden hasta 200 ms; así revisamos tiempo_agotado seguido */
        struct pollfd entrada = { .fd = STDIN_FILENO, .events = POLLIN };
        if (poll(&entrada, 1, 200) <= 0) continue;

        if (fgets(linea, sizeof linea, stdin) == NULL) break;   /* nadie enviará más órdenes */

        int numero;
        if (sscanf(linea, "comprar %d", &numero) != 1 || numero < 1 || numero > s_num) continue;
        if (tiempo_agotado) break;

        comprar_manual(&asientos[numero - 1]);
    }
    return NULL;
}

/* ---------- 3. MAIN: PREPARA, LANZA LOS HILOS Y ESPERA ---------- */
int main(int argc, char *argv[]) {
    /* Leer argumentos: asientos, segundos, pasajeros y opciones */
    if (argc < 4) {
        fprintf(stderr, "Uso: %s <asientos> <segundos> <pasajeros> [--json] [--semilla N]\n", argv[0]);
        return 1;
    }

    s_num = atoi(argv[1]);
    tiempo_simulacion = atoi(argv[2]);
    p_num = atoi(argv[3]);

    /* Parsear argumentos opcionales */
    for (int i = 4; i < argc; i++) {
        if (strcmp(argv[i], "--json") == 0) {
            modo_json = 1;
        } else if (strcmp(argv[i], "--semilla") == 0 && i + 1 < argc) {
            semilla_base = atoi(argv[i+1]);
            i++;
        }
    }

    if (s_num < 4 || s_num > 60 || tiempo_simulacion < 5 || tiempo_simulacion > 120 || p_num < 1 || p_num > 300) {
        fprintf(stderr, "Error: Valores fuera de rango. Asientos (4-60), Segundos (5-120), Pasajeros (1-300).\n");
        return 1;
    }

    /* Imprimir línea por línea: si no, al ir por un pipe hacia Node.js,
       los eventos llegarían todos juntos al final */
    setvbuf(stdout, NULL, _IOLBF, 0);

    /* a) Crear los asientos y SU candado. El primer cuarto es el piso 1 */
    asientos = malloc(s_num * sizeof(struct Asiento));
    int limite_piso1 = s_num / 4;
    
    for (int i = 0; i < s_num; i++) {
        asientos[i].id = i + 1;
        asientos[i].piso = (i < limite_piso1) ? 1 : 2;
        asientos[i].vendido = 0;
        asientos[i].comprador = 0;
        pthread_mutex_init(&asientos[i].mutex, NULL);
    }

    pthread_mutex_init(&mutex_contadores, NULL);
    pthread_mutex_init(&mutex_impresion, NULL);
    
    pthread_t *hilos = malloc(p_num * sizeof(pthread_t));
    tiempo_inicio = time(NULL);
    clock_gettime(CLOCK_MONOTONIC, &start_time_mono);

    /* Evento: inicio */
    if (modo_json) {
        printf("{\"t\":0.00,\"evento\":\"inicio\",\"asientos\":%d,\"piso1\":%d,\"piso2\":%d,\"pasajeros\":%d,\"duracion\":%d}\n", s_num, limite_piso1, s_num - limite_piso1, p_num, tiempo_simulacion);
    } else {
        printf("[0.00s] Simulacion iniciada: %d asientos, %d pasajeros, %d segundos\n", s_num, p_num, tiempo_simulacion);
    }

    /* b) UN HILO POR PASAJERO. Cada uno recibe su número en memoria propia:
          si se pasara &i, todos los hilos verían la misma variable cambiando. */
    for (int i = 0; i < p_num; i++) {
        int *id_pasajero = malloc(sizeof(int));
        *id_pasajero = i + 1;
        pthread_create(&hilos[i], NULL, rutina_pasajero, id_pasajero);
    }

    /* Un hilo más para las compras manuales del usuario */
    pthread_t hilo_usuario;
    pthread_create(&hilo_usuario, NULL, rutina_usuario, NULL);

    /* c) main duerme mientras los hilos compran; luego avisa el fin */
    sleep(tiempo_simulacion);
    tiempo_agotado = 1;

    /* Esperar a que TODOS los hilos terminen. Sin join, el programa podría
       terminar mientras algún pasajero sigue pagando. */
    for (int i = 0; i < p_num; i++) {
        pthread_join(hilos[i], NULL);
    }
    pthread_join(hilo_usuario, NULL);

    /* d) Evento: fin. Contar libres, armar la lista de vendidos y destruir los mutex */
    int libres = 0;
    char buffer_vendidos[2048] = "[";
    int primero = 1;
    
    for (int i = 0; i < s_num; i++) {
        if (asientos[i].vendido) {
            char num[16];
            if (primero) {
                sprintf(num, "%d", asientos[i].id);
                primero = 0;
            } else {
                sprintf(num, ",%d", asientos[i].id);
            }
            strcat(buffer_vendidos, num);
        } else {
            libres++;
        }
        pthread_mutex_destroy(&asientos[i].mutex);
    }
    strcat(buffer_vendidos, "]");

    if (modo_json) {
        printf("{\"t\":%.2f,\"evento\":\"fin\",\"vendidos\":%d,\"libres\":%d,\"sin_boleto\":%d,\"asientos_vendidos\":%s}\n", get_time_t(), cont_vendidos, libres, cont_sin_boleto, buffer_vendidos);
    } else {
        /* En terminal: tabla de asientos comprados (lo pide el enunciado) y resumen */
        printf("\n--- RESULTADOS FINALES ---\n");
        printf("Asientos comprados:\n");
        printf("  Asiento | Piso | Comprador\n");
        for (int i = 0; i < s_num; i++) {
            if (asientos[i].vendido) {
                if (asientos[i].comprador == USUARIO)
                    printf("  %7d | %4d | USUARIO\n", asientos[i].id, asientos[i].piso);
                else
                    printf("  %7d | %4d | Pasajero %d\n", asientos[i].id, asientos[i].piso, asientos[i].comprador);
            }
        }
        printf("Resumen: %d vendidos, %d libres, %d sin boleto (Rechazos totales: %d)\n", cont_vendidos, libres, cont_sin_boleto, cont_rechazos);
    }

    pthread_mutex_destroy(&mutex_contadores);
    pthread_mutex_destroy(&mutex_impresion);
    free(asientos);
    free(hilos);

    return 0;
}