#include <stdio.h>
#include <stdlib.h>
#include <pthread.h>
#include <unistd.h>
#include <time.h>
#include <errno.h>
#include <string.h>
#include <stdatomic.h>
#include <poll.h>

/* Estructuras y recursos compartidos */
struct Asiento {
    int id;
    int piso;
    pthread_mutex_t mutex;
    atomic_int vendido;
    int comprador;
};

time_t tiempo_inicio;
struct timespec start_time_mono;
int tiempo_simulacion;
int s_num;
int p_num;
atomic_int tiempo_agotado = 0;   /* la escribe main y la leen todos los hilos */
int modo_json = 0;
int semilla_base = -1;

int cont_vendidos = 0;
int cont_rechazos = 0;
int cont_sin_boleto = 0;

pthread_mutex_t mutex_contadores;   /* protege los contadores */
pthread_mutex_t mutex_impresion;    /* evita que se mezclen las lineas */
struct Asiento *asientos;

/* Funcion auxiliar para calcular segundos transcurridos con 2 decimales */
double get_time_t() {
    struct timespec current;
    clock_gettime(CLOCK_MONOTONIC, &current);
    double elapsed = (current.tv_sec - start_time_mono.tv_sec) + 
                     (current.tv_nsec - start_time_mono.tv_nsec) / 1000000000.0;
    return elapsed;
}

/* Funcion que ejecuta cada hilo (pasajero) */
void *rutina_pasajero(void *arg) {
    int id = *(int*)arg;
    free(arg); 
    
    unsigned int seed;
    if (semilla_base >= 0) {
        seed = (unsigned int)(semilla_base + id);
    } else {
        seed = (unsigned int)time(NULL) ^ id;
    }

    /* 1. Tiempo de llegada: 3 horas pico (10%, 40%, 70%) y el resto aleatorio */
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
    usleep(espera_llegada_us);

    /* 2. Evento: llega (70% prefiere el piso 2) */
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

    /* 3. Hasta 3 intentos */
    int comprado = 0;
    for (int intento = 1; intento <= 3 && !tiempo_agotado && !comprado; intento++) {
        int info_desactualizada = (rand_r(&seed) % 100 < 15);
        int target = -1;
        
        int *candidatos = malloc(s_num * sizeof(int));
        int num_candidatos = 0;
        
        for (int i = 0; i < s_num; i++) {
            if (asientos[i].vendido == 0) {
                if (info_desactualizada || asientos[i].piso == pref_piso) {
                    candidatos[num_candidatos++] = i;
                }
            }
        }

        /* se lee vendido sin lock solo para elegir; se confirma despues con el mutex */
        if (num_candidatos > 0) {
            target = candidatos[rand_r(&seed) % num_candidatos];
        }
        free(candidatos);

        if (target == -1) break; /* No hay asientos libres visibles */

        /* 4. Exclusion mutua con trylock */
        int lock_res = pthread_mutex_trylock(&asientos[target].mutex);
        
        if (lock_res == EBUSY) {   /* otro hilo esta pagando este asiento */
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

            /* Simular pago (seccion critica, con el mutex tomado) */
            int tiempo_pago = 300000 + (rand_r(&seed) % 900001); 
            usleep(tiempo_pago);

            asientos[target].vendido = 1;
            asientos[target].comprador = id;
            
            pthread_mutex_unlock(&asientos[target].mutex);

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

/* Compra manual: el usuario es el pasajero 0 y recibe "comprar N" por stdin.
   Usa el mismo protocolo que los pasajeros: trylock, revisar, pagar, unlock */
#define USUARIO 0
#define PAGO_USUARIO_US 1500000

static void anunciar(const char *json, const char *texto) {
    pthread_mutex_lock(&mutex_impresion);
    if (modo_json) printf("{\"t\":%.2f,%s}\n", get_time_t(), json);
    else           printf("[%.2fs] USUARIO %s\n", get_time_t(), texto);
    pthread_mutex_unlock(&mutex_impresion);
}

static void comprar_manual(struct Asiento *a) {
    char json[160], texto[96];

    pthread_mutex_lock(&mutex_contadores);
    int lleno = (cont_vendidos >= s_num);
    pthread_mutex_unlock(&mutex_contadores);
    if (lleno) {
        snprintf(json, sizeof json, "\"evento\":\"rechazo\",\"pasajero\":%d,\"asiento\":%d,\"motivo\":\"bus_lleno\"", USUARIO, a->id);
        snprintf(texto, sizeof texto, "no pudo comprar el asiento %d (bus lleno)", a->id);
        anunciar(json, texto);
        return;
    }

    if (pthread_mutex_trylock(&a->mutex) == EBUSY) {
        pthread_mutex_lock(&mutex_contadores);
        cont_rechazos++;
        pthread_mutex_unlock(&mutex_contadores);
        snprintf(json, sizeof json, "\"evento\":\"rechazo\",\"pasajero\":%d,\"asiento\":%d,\"motivo\":\"ocupado\"", USUARIO, a->id);
        snprintf(texto, sizeof texto, "rechazado en el asiento %d (otro hilo tiene el mutex)", a->id);
        anunciar(json, texto);
        return;
    }

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

    snprintf(json, sizeof json, "\"evento\":\"intenta\",\"pasajero\":%d,\"asiento\":%d,\"piso\":%d,\"intento\":1", USUARIO, a->id, a->piso);
    snprintf(texto, sizeof texto, "bloquea el asiento %d y paga...", a->id);
    anunciar(json, texto);
    usleep(PAGO_USUARIO_US);

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

/* Hilo que lee las ordenes del usuario */
void *rutina_usuario(void *arg) {
    (void)arg;
    char linea[64];
    setvbuf(stdin, NULL, _IONBF, 0);

    while (!tiempo_agotado) {
        struct pollfd entrada = { .fd = STDIN_FILENO, .events = POLLIN };
        if (poll(&entrada, 1, 200) <= 0) continue;

        if (fgets(linea, sizeof linea, stdin) == NULL) break;

        int numero;
        if (sscanf(linea, "comprar %d", &numero) != 1 || numero < 1 || numero > s_num) continue;
        if (tiempo_agotado) break;

        comprar_manual(&asientos[numero - 1]);
    }
    return NULL;
}

int main(int argc, char *argv[]) {
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

    /* Bufferizar salida linea por linea para el pipe de Node.js */
    setvbuf(stdout, NULL, _IOLBF, 0);

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

    /* Un hilo por pasajero */
    for (int i = 0; i < p_num; i++) {
        int *id_pasajero = malloc(sizeof(int));
        *id_pasajero = i + 1;
        pthread_create(&hilos[i], NULL, rutina_pasajero, id_pasajero);
    }

    /* Hilo para la compra manual */
    pthread_t hilo_usuario;
    pthread_create(&hilo_usuario, NULL, rutina_usuario, NULL);

    sleep(tiempo_simulacion);
    tiempo_agotado = 1;

    /* Esperar a que terminen todos los hilos */
    for (int i = 0; i < p_num; i++) {
        pthread_join(hilos[i], NULL);
    }
    pthread_join(hilo_usuario, NULL);

    /* Evento: fin */
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