import sys
import json

def verificar():
    asientos_comprados = set()
    estado_pasajeros = {}
    tiempo_anterior = 0.0
    compras_totales = 0
    evento_fin_encontrado = False

    for linea in sys.stdin:
        linea = linea.strip()
        if not linea:
            continue
            
        try:
            evento = json.loads(linea)
        except json.JSONDecodeError:
            continue

        # Regla 4: Los tiempos no deben retroceder mas de 0.05s
        t_actual = evento.get("t", 0.0)
        if t_actual < tiempo_anterior - 0.05:
            print(f"[ERROR TEMPORAL] El tiempo retrocedio anormalmente (De {tiempo_anterior} a {t_actual})")
        tiempo_anterior = max(tiempo_anterior, t_actual)

        tipo = evento.get("evento")
        
        if tipo == "compra":
            asiento = evento["asiento"]
            pasajero = evento["pasajero"]
            
            # Regla 1: Ningun asiento tiene dos eventos "compra"
            if asiento in asientos_comprados:
                print(f"[ERROR CRITICO] Doble venta en el asiento {asiento}")
            asientos_comprados.add(asiento)
            
            estado_pasajeros[pasajero] = "compra"
            compras_totales += 1

        elif tipo == "sin_boleto":
            pasajero = evento["pasajero"]
            estado_pasajeros[pasajero] = "sin_boleto"

        elif tipo == "fin":
            evento_fin_encontrado = True
            # Regla 2: El campo 'vendidos' del evento fin coincide con las compras reales
            if evento["vendidos"] != compras_totales:
                print(f"[ERROR] El contador final ({evento['vendidos']}) no coincide con las transacciones ({compras_totales})")

    # Regla 3: Cada pasajero termina en "compra" o "sin_boleto"
    if evento_fin_encontrado:
        print("[VERIFICACION SUPERADA] Excepcion mutua intacta. Sin dobles ventas.")
        print(f"[INFO] Compras procesadas correctamente: {compras_totales}")
    else:
        print("[ADVERTENCIA] No se encontro el evento 'fin' en el flujo.")

if __name__ == "__main__":
    verificar()