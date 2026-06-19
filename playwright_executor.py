"""
QUANTUM BINARY BOT - PLAYWRIGHT EXECUTOR (PLANTILLA DE AUTOMATIZACIÓN DE COMPRA/VENTA)

Este script es una plantilla de automatización para opciones binarias.
Monitorea el API local de señales en tiempo real (Flask) y, al detectar una señal fuerte:
1. COMPRA FUERTE (STRONG_BUY) -> Simula un clic físico en el botón CALL (Verde/Arriba) del broker.
2. VENTA FUERTE (STRONG_SELL) -> Simula un clic físico en el botón PUT (Rojo/Abajo) del broker.

REQUISITOS:
pip install playwright requests
playwright install chromium

ADVERTENCIA: 
Utiliza este script SIEMPRE en una cuenta DEMO (práctica) para configurar las coordenadas/selectores.
El trading de opciones binarias conlleva un alto riesgo de pérdida de capital.
"""

import time
import requests
from playwright.sync_api import sync_playwright

# =====================================================================
# CONFIGURACIÓN
# =====================================================================
API_URL = "http://127.0.0.1:5000/api/signals"
TARGET_SYMBOL = "EURUSD"
TARGET_INTERVAL = "1m"
SCREENER = "forex"
EXCHANGE = "FX_IDC"

# CONFIGURACIÓN DEL BROKER (EJEMPLO GENÉRICO DE PLATAFORMA WEB)
# Debes inspeccionar tu plataforma del broker en el navegador y reemplazar estos selectores.
BROKER_URL = "https://pocketoption.com/es/cabinet/"  # Reemplazar por tu broker preferido
SELECTORS = {
    # Selector CSS o XPATH del botón Verde (COMPRA / ARRIBA)
    "CALL_BUTTON": ".btn-call, button.up, .buy-button", 
    # Selector CSS o XPATH del botón Rojo (VENTA / ABAJO)
    "PUT_BUTTON": ".btn-put, button.down, .sell-button",
    # Selector para el monto de la operación (opcional)
    "AMOUNT_INPUT": "input[name='amount']",
    # Selector para el tiempo de expiración (opcional)
    "EXPIRATION_SELECT": ".expiration-selector"
}

# AJUSTES DE RIESGO
TRADE_AMOUNT = "1"          # Monto por operación (Ej: $1 USD)
COOLDOWN_SECONDS = 65       # Tiempo de espera entre operaciones (evita doble entrada en la misma vela)

# =====================================================================
# MOTOR DE EJECUCIÓN
# =====================================================================
def run_bot():
    print("=" * 60)
    print("  QUANTUM BINARY BOT - INICIANDO MOTOR DE AUTOMATIZACIÓN  ")
    print("=" * 60)
    print(f"[-] Configuración de Activo: {TARGET_SYMBOL} ({TARGET_INTERVAL})")
    print(f"[-] Monto de Operación: ${TRADE_AMOUNT}")
    print(f"[-] Tiempo de Cooldown: {COOLDOWN_SECONDS} segundos")
    print(f"[-] Conectando a Señales locales en: {API_URL}")
    print("=" * 60)

    # Iniciar Playwright
    with sync_playwright() as p:
        print("[+] Lanzando navegador Chromium controlado...")
        # Lanza el navegador visible (headless=False) para que puedas ver e iniciar sesión
        browser = p.chromium.launch(headless=False)
        context = browser.new_context()
        page = context.new_page()

        print(f"[+] Navegando a la web del Broker: {BROKER_URL}")
        page.goto(BROKER_URL)
        
        print("\n" + "!" * 60)
        print("  IMPORTANTE: INICIA SESIÓN EN TU BROKER Y CONFIGURA LA PANTALLA  ")
        print("  ASEGÚRATE DE ESTAR EN LA CUENTA DEMO (PRÁCTICA) ANTES DE CONTINUAR.")
        print("!" * 60 + "\n")
        
        input("--> Una vez logueado y posicionado en la pantalla de trading, presiona ENTER aquí para activar el Bot: ")
        print("\n[+] Bot armado y escuchando señales. Analizando mercado...\n")
        
        last_trade_time = 0

        while True:
            try:
                # 1. Consultar señal del backend de Flask
                params = {
                    "symbol": TARGET_SYMBOL,
                    "screener": SCREENER,
                    "exchange": EXCHANGE,
                    "interval": TARGET_INTERVAL
                }
                
                resp = requests.get(API_URL, params=params, timeout=5)
                data = resp.json()
                
                if data.get("status") == "success":
                    rec = data["summary"]["recommendation"]
                    buy_count = data["summary"]["buy"]
                    sell_count = data["summary"]["sell"]
                    
                    print(f"[Monitoreo] {data['symbol']} | Señal: {rec} (Compras: {buy_count}, Ventas: {sell_count})", end="\r")
                    
                    current_time = time.time()
                    # Verificar si estamos fuera del periodo de cooldown
                    if current_time - last_trade_time > COOLDOWN_SECONDS:
                        
                        # 2. Lógica de Disparo
                        if rec == "STRONG_BUY":
                            print(f"\n[!!! SEÑAL DETECTADA !!!] COMPRA FUERTE (CALL) en {TARGET_SYMBOL}")
                            
                            # Configurar monto si el selector está disponible
                            try:
                                if page.locator(SELECTORS["AMOUNT_INPUT"]).is_visible():
                                    page.locator(SELECTORS["AMOUNT_INPUT"]).fill(TRADE_AMOUNT)
                            except Exception:
                                pass
                            
                            # Hacer clic físico en el botón CALL (Verde/Arriba)
                            print("--> Ejecutando Clic en botón COMPRA (CALL)...")
                            page.locator(SELECTORS["CALL_BUTTON"]).click()
                            print(f"[+] OPERACIÓN CALL ENVIADA. Entrando en Cooldown de {COOLDOWN_SECONDS}s.")
                            
                            last_trade_time = current_time
                            
                        elif rec == "STRONG_SELL":
                            print(f"\n[!!! SEÑAL DETECTADA !!!] VENTA FUERTE (PUT) en {TARGET_SYMBOL}")
                            
                            # Configurar monto si el selector está disponible
                            try:
                                if page.locator(SELECTORS["AMOUNT_INPUT"]).is_visible():
                                    page.locator(SELECTORS["AMOUNT_INPUT"]).fill(TRADE_AMOUNT)
                            except Exception:
                                pass
                            
                            # Hacer clic físico en el botón PUT (Rojo/Abajo)
                            print("--> Ejecutando Clic en botón VENTA (PUT)...")
                            page.locator(SELECTORS["PUT_BUTTON"]).click()
                            print(f"[+] OPERACIÓN PUT ENVIADA. Entrando en Cooldown de {COOLDOWN_SECONDS}s.")
                            
                            last_trade_time = current_time
                            
                else:
                    print(f"\n[Error API] {data.get('message')}")
                    
            except requests.exceptions.RequestException as req_err:
                print(f"\n[Error Conexión] No se puede contactar al servidor Flask local: {req_err}")
                print("Asegúrate de que 'app.py' esté ejecutándose en otra terminal.")
                
            except Exception as e:
                print(f"\n[Error de Ejecución] {str(e)}")
                print("Verifica si los selectores de botones en tu broker han cambiado.")
            
            # Consultar el API local cada 2 segundos
            time.sleep(2)

if __name__ == "__main__":
    try:
        run_bot()
    except KeyboardInterrupt:
        print("\n[-] Bot detenido por el usuario. Exiting...")
