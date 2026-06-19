# Quantum Binary Signal Bot ⚡ (Edición Especial Deriv)

Este proyecto es un bot de señales para opciones binarias, **100% gratuito y de código abierto**, ahora integrado de manera nativa con la API de opciones de **Deriv** a través de WebSockets y autenticación OTP.

El bot utiliza el **Método 2**: extrae el consolidado de análisis técnico en tiempo real directo de los servidores de **TradingView** (sin renderizar gráficos pesados en el servidor) mediante la librería `tradingview-ta` y lo conecta a los servicios de trading de Deriv.

---

## 🛠️ Requisitos e Instalación

Asegúrate de tener instalado Python 3.8 o superior.

1. **Clonar o situarse en el directorio del proyecto**:
   Abre una terminal en la carpeta `binary_bot`.

2. **Instalar las dependencias necesarias**:
   Ejecuta el siguiente comando para instalar Flask, el conector de TradingView y las librerías de red:
   ```bash
   pip install -r requirements.txt
   pip install websockets requests
   ```

---

## 🚀 Cómo Iniciar el Bot

1. **Lanzar el servidor local (API de señales)**:
   Desde tu terminal en la carpeta `binary_bot`, ejecuta:
   ```bash
   python app.py
   ```

2. **Acceder al panel de control**:
   Abre tu navegador de preferencia e ingresa a:
   [http://127.0.0.1:5000](http://127.0.0.1:5000)

---

## 🔌 Conexión Directa con Deriv Options API

El bot se conecta directamente a los servidores de Deriv mediante WebSockets utilizando autenticación por **OTP (One-Time Password)** de corta duración.

### ¿Cómo obtener tu Token OTP?
1. Inicia sesión en tu cuenta de Deriv en la plataforma web.
2. Dirígete a la configuración de cuenta o la sección de Desarrolladores/API Tokens.
3. Genera un token OTP de un solo uso (One-Time Password).
4. Elige en la interfaz de la página web si vas a operar en cuenta **Demo** o **Real**, introduce el **OTP** y haz clic en **Conectar**.

---

## 📊 Características del Panel Web

* **Broker: Deriv Options API**: Conecta tu cuenta y opera en cuenta Demo o Real directamente desde el navegador de forma ultrarrápida.
* **Duración Personalizable**: Configura tu rango preferido de expiración desde **1 minuto hasta 15 minutos** (1m, 2m, 3m... hasta 15m), tal como lo desees.
* **Auto-Trading Integrado**: Activa el Auto-trading para que la interfaz web envíe órdenes de compra (`CALL`) o venta (`PUT`) a Deriv cada vez que el velocímetro registre una señal de `STRONG_BUY` o `STRONG_SELL`.
* **Consola de Registros Deriv**: Terminal interna que muestra cada respuesta, balance después de operar, ID de contrato e ID de transacción en tiempo real.
* **Velocímetro de Señal**: Medidor visual del sentimiento técnico del mercado en vivo.
* **Alertas Sonoras**: Tonos futuristas sintetizados directamente desde el navegador para notificarte entradas válidas.
* **Gráfica de TradingView en vivo**: Gráfico interactivo y dinámico que se actualiza instantáneamente con el activo que elijas.

---

## 🤖 Auto-Trading de Consola (`deriv_backend_executor.py`)

Si prefieres operar sin necesidad de mantener la página web abierta, puedes ejecutar el bot directamente desde tu terminal.

1. Abre `deriv_backend_executor.py` y edita las constantes al inicio del archivo (Stake, Duración, Activo).
2. Asegúrate de tener `app.py` ejecutándose en otra terminal.
3. Corre el script de consola:
   ```bash
   python deriv_backend_executor.py
   ```
4. El script te pedirá que introduzcas tu token OTP y se conectará automáticamente a los WebSockets de Deriv en segundo plano para procesar las señales de compra/venta enviadas por Flask.

---

## ⚠️ Advertencia de Riesgo

El trading de opciones binarias implica un alto nivel de especulación y riesgo. El análisis técnico provisto representa una consolidación estadística basada en indicadores históricos y no garantiza resultados futuros. **Utiliza siempre este sistema en cuenta DEMO** hasta que verifiques la correcta calibración de tus operaciones.
