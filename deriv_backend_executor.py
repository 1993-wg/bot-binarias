"""
QUANTUM BINARY BOT - EXECUTOR DE CONSOLA PARA DERIV OPTIONS API (OTP)

Este script es un bot de ejecución por consola que conecta directamente con la API oficial 
de Deriv mediante WebSockets utilizando autenticación por OTP (One-Time Password) en la URL.

Monitorea el API local de señales (Flask) y, al detectar una señal fuerte:
1. COMPRA FUERTE (STRONG_BUY) -> Envía una compra CALL (Rise/Sube) a Deriv.
2. VENTA FUERTE (STRONG_SELL) -> Envía una venta PUT (Fall/Baja) a Deriv.

REQUISITOS:
pip install websockets requests

USO:
python deriv_backend_executor.py
"""

import time
import json
import asyncio
import threading
import requests
import websockets

# =====================================================================
# CONFIGURACIÓN DE OPERACIÓN
# =====================================================================
API_URL = "http://127.0.0.1:5000/api/signals"
TARGET_SYMBOL = "EURUSD"
TARGET_INTERVAL = "1m"
SCREENER = "forex"
EXCHANGE = "FX_IDC"

# CONFIGURACIÓN DE DERIV
# Elige 'demo' o 'real' según tu cuenta
DERIV_ENV = "demo"  # 'demo' o 'real'
# El token OTP es obligatorio y de corta duración. Genéralo en el portal de Deriv.
DERIV_OTP = "YOUR_OTP_HERE" 

# AJUSTES DE DINERO Y TIEMPO
TRADE_STAKE = 1.0       # Monto por operación en USD
TRADE_DURATION = 1      # Expiración en minutos (1 a 15)
COOLDOWN_SECONDS = 65   # Cooldown entre operaciones (evita compras duplicadas en la misma vela)

# Símbolos mapeados oficiales de Deriv para opciones binarias
SYMBOL_MAP = {
    'EURUSD': 'frxEURUSD',
    'GBPUSD': 'frxGBPUSD',
    'USDJPY': 'frxUSDJPY',
    'AUDUSD': 'frxAUDUSD',
    'USDCAD': 'frxUSDCAD',
    'EURGBP': 'frxEURGBP',
    'GBPJPY': 'frxGBPJPY',
    'BTCUSD': 'cryBTCUSD',
    'ETHUSD': 'cryETHUSD',
    'SOLUSD': 'crySOLUSD',
    'SPX500': 'SPC500',
    'USOIL': 'OILUSD',
    'XAUUSD': 'frxXAUUSD'
}

# =====================================================================
# LÓGICA DE NEGOCIO
# =====================================================================
class DerivConsoleBot:
    def __init__(self):
        self.deriv_ws = None
        self.loop = None
        self.cooldown_active = False
        self.running = True

    def log(self, tag, message):
        timestamp = time.strftime("%H:%M:%S")
        print(f"[{timestamp}] [{tag}] {message}")

    async def connect_deriv_ws(self):
        """Mantiene y gestiona la conexión WebSocket con Deriv."""
        ws_url = f"wss://api.derivws.com/trading/v1/options/ws/{DERIV_ENV}?otp={DERIV_OTP}"
        
        self.log("SISTEMA", f"Conectando a Deriv WS ({DERIV_ENV.upper()})...")
        
        while self.running:
            try:
                async with websockets.connect(ws_url) as ws:
                    self.deriv_ws = ws
                    self.log("CONEXIÓN", "WebSocket conectado con éxito y autenticado por OTP.")
                    
                    # Escuchar respuestas del servidor
                    async for message in ws:
                        data = json.loads(message)
                        
                        if "error" in data:
                            self.log("DERIV ERROR", f"{data['error']['message']} (Código: {data['error']['code']})")
                            continue
                            
                        if data.get("msg_type") == "buy":
                            buy = data["buy"]
                            self.log("COMPRA EXITOSA", "¡Operación tomada en Deriv!")
                            self.log("COMPRA DETALLE", f"  ↳ ID Contrato: {buy['contract_id']}")
                            self.log("COMPRA DETALLE", f"  ↳ Monto Riesgo: ${buy.get('price')}")
                            self.log("COMPRA DETALLE", f"  ↳ Balance Restante: ${buy.get('balance_after')}")
                        else:
                            self.log("RESPUESTA WS", f"Tipo mensaje recibido: '{data.get('msg_type')}'")
                            
            except websockets.exceptions.ConnectionClosed:
                self.log("CONEXIÓN", "El WebSocket fue cerrado por el servidor.")
            except Exception as e:
                self.log("ERROR WS", f"Error en la conexión WebSocket: {e}")
            
            self.deriv_ws = None
            if self.running:
                self.log("SISTEMA", "Reconectando en 5 segundos...")
                await asyncio.sleep(5)

    async def send_buy_order(self, contract_type):
        """Envía la solicitud de compra al WebSocket de Deriv."""
        if not self.deriv_ws:
            self.log("TRADING", "ERROR: WebSocket desconectado. No se puede enviar la orden.")
            return

        mapped_symbol = SYMBOL_MAP.get(TARGET_SYMBOL)
        if not mapped_symbol:
            self.log("TRADING", f"ERROR: Símbolo '{TARGET_SYMBOL}' no mapeado para Deriv.")
            return

        payload = {
            "buy": 1,
            "price": float(TRADE_STAKE),
            "parameters": {
                "amount": float(TRADE_STAKE),
                "basis": "stake",
                "contract_type": contract_type,  # 'CALL' o 'PUT'
                "currency": "USD",
                "duration": int(TRADE_DURATION),
                "duration_unit": "m",
                "symbol": mapped_symbol
            }
        }
        
        try:
            self.log("TRADING", f"Transmitiendo orden {contract_type} para {mapped_symbol}...")
            self.log("TRADING", f"  ↳ Stake: ${TRADE_STAKE} | Duración: {TRADE_DURATION}m")
            await self.deriv_ws.send(json.dumps(payload))
            
            # Activar Cooldown
            self.cooldown_active = True
            
            # Liberar Cooldown después del periodo establecido
            def release_cooldown():
                time.sleep(COOLDOWN_SECONDS)
                self.cooldown_active = False
                self.log("TRADING", "Cooldown finalizado. Escuchando nuevas señales...")
                
            threading.Thread(target=release_cooldown, daemon=True).start()
            self.log("TRADING", f"Cooldown activado por {COOLDOWN_SECONDS} segundos.")

        except Exception as e:
            self.log("ERROR TRADING", f"No se pudo enviar la orden a través del WebSocket: {e}")

    def monitor_signals(self):
        """Consulta periódicamente la API local de Flask buscando señales."""
        self.log("SISTEMA", f"Iniciando monitoreo de señal de {TARGET_SYMBOL} ({TARGET_INTERVAL})...")
        
        while self.running:
            try:
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
                    buy_cnt = data["summary"]["buy"]
                    sell_cnt = data["summary"]["sell"]
                    
                    self.log("SCAN", f"Señal: {rec} (MAs: {data['moving_averages']['recommendation']}, Osc: {data['oscillators']['recommendation']})")
                    
                    if not self.cooldown_active:
                        if rec == "STRONG_BUY":
                            self.log("SEÑAL", f"¡¡¡ SEÑAL ALCISTA FUERTE !!! Generando orden CALL...")
                            asyncio.run_coroutine_threadsafe(self.send_buy_order("CALL"), self.loop)
                        elif rec == "STRONG_SELL":
                            self.log("SEÑAL", f"¡¡¡ SEÑAL BAJISTA FUERTE !!! Generando orden PUT...")
                            asyncio.run_coroutine_threadsafe(self.send_buy_order("PUT"), self.loop)
                else:
                    self.log("API ERROR", data.get("message", "Error desconocido."))
                    
            except requests.exceptions.RequestException:
                self.log("SISTEMA ERROR", "No se puede conectar al backend de Flask local. ¿Está corriendo app.py?")
            except Exception as e:
                self.log("SISTEMA ERROR", f"Ocurrió un error en el bucle: {e}")
                
            time.sleep(3) # Consultar señal local cada 3 segundos

    def start(self):
        # 1. Configurar bucle de eventos para el WebSocket en un hilo secundario
        self.loop = asyncio.new_event_loop()
        
        def run_async_loop():
            asyncio.set_event_loop(self.loop)
            self.loop.run_until_complete(self.connect_deriv_ws())

        threading.Thread(target=run_async_loop, daemon=True).start()
        
        # 2. Configurar el OTP si se dejó el valor por defecto
        global DERIV_OTP
        if DERIV_OTP == "YOUR_OTP_HERE":
            self.log("SISTEMA", "!" * 50)
            self.log("SISTEMA", "ADVERTENCIA: No has configurado tu token OTP en el código.")
            DERIV_OTP = input("--> Introduce tu token OTP de Deriv para continuar: ").strip()
            self.log("SISTEMA", "!" * 50)

        # 3. Iniciar el monitoreo en el hilo principal
        self.monitor_signals()

if __name__ == "__main__":
    bot = DerivConsoleBot()
    try:
        bot.start()
    except KeyboardInterrupt:
        bot.running = False
        print("\n[-] Deteniendo bot y cerrando hilos de ejecución...")
