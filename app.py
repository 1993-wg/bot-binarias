import os
import sys
import json
import asyncio
import websockets
import pandas as pd
import numpy as np
from collections import deque
from flask import Flask, jsonify, request, render_template
from tradingview_ta import TA_Handler, Interval

app = Flask(__name__,
            static_folder='static',
            template_folder='templates')

# =====================================================================
# INTERVALS MAP
# =====================================================================
INTERVALS = {
    "1m": Interval.INTERVAL_1_MINUTE,
    "5m": Interval.INTERVAL_5_MINUTES,
    "15m": Interval.INTERVAL_15_MINUTES,
    "30m": Interval.INTERVAL_30_MINUTES,
    "1h": Interval.INTERVAL_1_HOUR,
    "4h": Interval.INTERVAL_4_HOURS,
    "1d": Interval.INTERVAL_1_DAY
}

# =====================================================================
# ML ENGINE — Per-symbol learning buffer + Random Forest
# =====================================================================
class MLEngine:
    """Stores feature samples and trains a Voting Classifier (Random Forest + MLP) and an MLP Regressor per symbol."""

    def __init__(self, min_samples=60, buffer_size=600):
        self.buffers = {}          # symbol -> deque of (features, label, next_close)
        self.models = {}           # symbol -> trained models/scalers
        self.min_samples = min_samples
        self.buffer_size = buffer_size

    def _key(self, symbol, interval):
        return f"{symbol}_{interval}"

    def push(self, symbol, interval, features, label, next_close):
        """Add a labeled sample (features dict + whether next candle went up + next candle close)."""
        key = self._key(symbol, interval)
        if key not in self.buffers:
            self.buffers[key] = deque(maxlen=self.buffer_size)
        self.buffers[key].append((features, label, next_close))

        # Retrain whenever we have enough data
        buf = self.buffers[key]
        if len(buf) >= self.min_samples:
            self._train(key, buf)

    def _train(self, key, buf):
        try:
            from sklearn.ensemble import RandomForestClassifier, VotingClassifier
            from sklearn.neural_network import MLPClassifier, MLPRegressor
            from sklearn.preprocessing import StandardScaler
            
            feature_names = list(buf[0][0].keys())
            X = []
            y_class = []
            y_reg = []
            for features, label, next_close in buf:
                row = [features.get(f, 0) for f in feature_names]
                X.append(row)
                y_class.append(label)
                y_reg.append(next_close)
                
            X = np.array(X, dtype=float)
            y_class = np.array(y_class)
            y_reg = np.array(y_reg)
            
            # Scale features
            scaler = StandardScaler()
            X_scaled = scaler.fit_transform(X)
            
            # Ensemble Classifier
            rf = RandomForestClassifier(n_estimators=100, random_state=42)
            mlp_clf = MLPClassifier(hidden_layer_sizes=(50, 25), max_iter=500, random_state=42)
            
            voting_clf = VotingClassifier(
                estimators=[('rf', rf), ('mlp', mlp_clf)],
                voting='soft'
            )
            voting_clf.fit(X_scaled, y_class)
            
            # Regressor for next_close prediction
            mlp_reg = MLPRegressor(hidden_layer_sizes=(50, 25), max_iter=500, random_state=42)
            mlp_reg.fit(X_scaled, y_reg)
            
            self.models[key] = {
                "classifier": voting_clf,
                "regressor": mlp_reg,
                "scaler": scaler,
                "feature_names": feature_names
            }
            print(f"[ML] Models trained successfully for {key}")
        except Exception as e:
            print(f"[ML] Train error for {key}: {e}")

    def predict(self, symbol, interval, features):
        """Return (call_pct, put_pct, expected_price_neural, samples_collected, trained)."""
        key = self._key(symbol, interval)
        samples = len(self.buffers.get(key, []))
        if key not in self.models:
            return 50.0, 50.0, 0.0, samples, False
        try:
            m = self.models[key]
            row = np.array([[features.get(f, 0) for f in m["feature_names"]]], dtype=float)
            row_scaled = m["scaler"].transform(row)
            
            # Predict probabilities
            proba = m["classifier"].predict_proba(row_scaled)[0]
            classes = list(m["classifier"].classes_)
            call_p = round(float(proba[classes.index(1)]) * 100, 1) if 1 in classes else 50.0
            put_p = round(float(proba[classes.index(0)]) * 100, 1) if 0 in classes else 50.0
            
            # Predict expected price
            expected_price = float(m["regressor"].predict(row_scaled)[0])
            
            return call_p, put_p, round(expected_price, 5), samples, True
        except Exception as e:
            print(f"[ML] Predict error for {key}: {e}")
            return 50.0, 50.0, 0.0, samples, False

    def stats(self, symbol, interval):
        key = self._key(symbol, interval)
        return {
            "samples": len(self.buffers.get(key, [])),
            "trained": key in self.models,
            "min_samples": self.min_samples
        }

# Global ML Engine (shared across requests)
ml_engine = MLEngine(min_samples=60, buffer_size=600)

# Store last close per key for labeling previous sample
last_close_cache = {}

# =====================================================================
# SMC ANALYSIS ENGINE
# =====================================================================
def calculate_smc_zones(df):
    """Detect SMC zones: Order Blocks, FVG, Support, Resistance, Liquidity, Breakouts."""
    close = df['close'].values
    high = df['high'].values
    low = df['low'].values
    opens = df['open'].values
    n = len(df)

    zones = {
        "bullish_ob": [],   # Bullish Order Blocks
        "bearish_ob": [],   # Bearish Order Blocks
        "bullish_fvg": [],  # Bullish Fair Value Gaps
        "bearish_fvg": [],  # Bearish Fair Value Gaps
        "support": [],      # Support levels
        "resistance": [],   # Resistance levels
        "liquidity_high": [],  # Equal highs (liquidity above)
        "liquidity_low": [],   # Equal lows (liquidity below)
        "breakout": None,   # "bullish" | "bearish" | None
        "in_bullish_ob": False,
        "in_bearish_ob": False,
        "in_bullish_fvg": False,
        "in_bearish_fvg": False,
        "in_support": False,
        "in_resistance": False,
        "in_liquidity": False,
        "breakout_active": False
    }

    current_close = close[-1]
    tolerance = current_close * 0.0005  # 0.05% tolerance for zone matching

    # --- ORDER BLOCKS ---
    # Bullish OB: last bearish candle before bullish impulse
    # Look for: bearish candle followed by strong bullish move (>0.3%)
    for i in range(5, n - 3):
        is_bearish = close[i] < opens[i]
        # Next 3 candles rise strongly
        impulse = (close[i+2] - close[i]) / close[i] * 100
        if is_bearish and impulse > 0.3:
            ob_top = opens[i]
            ob_bottom = close[i]
            zones["bullish_ob"].append({
                "top": float(ob_top),
                "bottom": float(ob_bottom),
                "index": i,
                "strength": min(round(abs(impulse), 2), 5.0)
            })
            # Check if current price is inside this OB
            if ob_bottom <= current_close <= ob_top:
                zones["in_bullish_ob"] = True

    # Bearish OB: last bullish candle before bearish impulse
    for i in range(5, n - 3):
        is_bullish = close[i] > opens[i]
        impulse = (close[i+2] - close[i]) / close[i] * 100
        if is_bullish and impulse < -0.3:
            ob_top = close[i]
            ob_bottom = opens[i]
            zones["bearish_ob"].append({
                "top": float(ob_top),
                "bottom": float(ob_bottom),
                "index": i,
                "strength": min(round(abs(impulse), 2), 5.0)
            })
            if ob_bottom <= current_close <= ob_top:
                zones["in_bearish_ob"] = True

    # Keep only the 5 most recent OBs
    zones["bullish_ob"] = zones["bullish_ob"][-5:]
    zones["bearish_ob"] = zones["bearish_ob"][-5:]

    # --- FAIR VALUE GAPS ---
    # Bullish FVG: candle[i-1].high < candle[i+1].low (gap above)
    for i in range(1, n - 1):
        gap_bottom = high[i-1]
        gap_top = low[i+1]
        if gap_top > gap_bottom:
            zones["bullish_fvg"].append({
                "top": float(gap_top),
                "bottom": float(gap_bottom),
                "index": i
            })
            if gap_bottom <= current_close <= gap_top:
                zones["in_bullish_fvg"] = True

    # Bearish FVG: candle[i-1].low > candle[i+1].high (gap below)
    for i in range(1, n - 1):
        gap_top = low[i-1]
        gap_bottom = high[i+1]
        if gap_top > gap_bottom:
            zones["bearish_fvg"].append({
                "top": float(gap_top),
                "bottom": float(gap_bottom),
                "index": i
            })
            if gap_bottom <= current_close <= gap_top:
                zones["in_bearish_fvg"] = True

    # Keep only last 8 FVGs (most recent)
    zones["bullish_fvg"] = zones["bullish_fvg"][-8:]
    zones["bearish_fvg"] = zones["bearish_fvg"][-8:]

    # --- SWING HIGHS/LOWS for SUPPORT / RESISTANCE / LIQUIDITY ---
    swing_highs = []
    swing_lows = []
    for i in range(2, n - 2):
        if high[i] > high[i-1] and high[i] > high[i-2] and high[i] > high[i+1] and high[i] > high[i+2]:
            swing_highs.append(float(high[i]))
        if low[i] < low[i-1] and low[i] < low[i-2] and low[i] < low[i+1] and low[i] < low[i+2]:
            swing_lows.append(float(low[i]))

    # Cluster nearby swing highs into resistance levels
    def cluster_levels(levels, tolerance_pct=0.05):
        if not levels:
            return []
        levels = sorted(levels)
        clusters = []
        group = [levels[0]]
        for lvl in levels[1:]:
            if abs(lvl - group[-1]) / group[-1] * 100 <= tolerance_pct:
                group.append(lvl)
            else:
                clusters.append((round(float(np.mean(group)), 5), len(group)))
                group = [lvl]
        clusters.append((round(float(np.mean(group)), 5), len(group)))
        # Filter for at least 2 touches
        return [(p, c) for p, c in clusters if c >= 2]

    resistance_clusters = cluster_levels(swing_highs, tolerance_pct=0.05)
    support_clusters = cluster_levels(swing_lows, tolerance_pct=0.05)

    zones["resistance"] = [{"price": p, "touches": c} for p, c in sorted(resistance_clusters, reverse=True)[:5]]
    zones["support"] = [{"price": p, "touches": c} for p, c in sorted(support_clusters, reverse=False)[:5]]

    # Check if current price is near support or resistance
    for s in zones["support"]:
        if abs(current_close - s["price"]) <= tolerance * 3:
            zones["in_support"] = True
    for r in zones["resistance"]:
        if abs(current_close - r["price"]) <= tolerance * 3:
            zones["in_resistance"] = True

    # --- LIQUIDITY — Equal Highs / Lows ---
    liq_tol = current_close * 0.0002  # 0.02%
    equal_highs = []
    equal_lows = []
    for i in range(len(swing_highs)):
        for j in range(i+1, len(swing_highs)):
            if abs(swing_highs[i] - swing_highs[j]) <= liq_tol:
                equal_highs.append(round((swing_highs[i] + swing_highs[j]) / 2, 5))
    for i in range(len(swing_lows)):
        for j in range(i+1, len(swing_lows)):
            if abs(swing_lows[i] - swing_lows[j]) <= liq_tol:
                equal_lows.append(round((swing_lows[i] + swing_lows[j]) / 2, 5))

    zones["liquidity_high"] = list(set(equal_highs))[-5:]
    zones["liquidity_low"] = list(set(equal_lows))[-5:]

    # Check if near liquidity
    for lh in zones["liquidity_high"]:
        if abs(current_close - lh) <= tolerance * 5:
            zones["in_liquidity"] = True
    for ll in zones["liquidity_low"]:
        if abs(current_close - ll) <= tolerance * 5:
            zones["in_liquidity"] = True

    # --- BREAKOUTS ---
    # Breakout: current close is above nearest resistance or below nearest support
    nearest_res = None
    nearest_sup = None
    for r in zones["resistance"]:
        if r["price"] > close[-20:].min():
            if nearest_res is None or r["price"] < nearest_res:
                nearest_res = r["price"]
    for s in zones["support"]:
        if s["price"] < close[-20:].max():
            if nearest_sup is None or s["price"] > nearest_sup:
                nearest_sup = s["price"]

    if nearest_res and current_close > nearest_res * 1.001:
        zones["breakout"] = "bullish"
        zones["breakout_active"] = True
    elif nearest_sup and current_close < nearest_sup * 0.999:
        zones["breakout"] = "bearish"
        zones["breakout_active"] = True

    return zones


# =====================================================================
# DERIV CANDLE FETCHER
# =====================================================================
async def fetch_deriv_candles(symbol, interval_str):
    granularity_map = {"1m": 60, "5m": 300, "15m": 900}
    granularity = granularity_map.get(interval_str, 60)

    uri = "wss://ws.derivws.com/websockets/v3?app_id=1089"
    async with websockets.connect(uri) as ws:
        req = {
            "ticks_history": symbol,
            "adjust_start_time": 1,
            "count": 300,
            "end": "latest",
            "style": "candles",
            "granularity": granularity
        }
        await ws.send(json.dumps(req))
        resp = await ws.recv()
        data = json.loads(resp)

        if "candles" in data:
            return data["candles"]
        elif "error" in data:
            raise Exception(data["error"]["message"])
        else:
            raise Exception("No candles data received from Deriv API.")


# =====================================================================
# TECHNICAL INDICATORS ENGINE (for Synthetics)
# =====================================================================
def calculate_deriv_indicators(candles):
    df = pd.DataFrame(candles)
    df = df.sort_values('epoch').reset_index(drop=True)
    # Convert columns to float
    for col in ['open', 'high', 'low', 'close']:
        df[col] = pd.to_numeric(df[col], errors='coerce')

    if len(df) < 200:
        raise Exception(f"Insufficient candles: {len(df)}")

    close = df['close']
    high = df['high']
    low = df['low']
    opens = df['open']

    # EMAs / SMAs
    for p in [10, 20, 50, 100, 200]:
        df[f'EMA{p}'] = close.ewm(span=p, adjust=False).mean()
        df[f'SMA{p}'] = close.rolling(window=p).mean()

    # ATR (14) — Average True Range
    tr = pd.concat([
        (high - low),
        (high - close.shift(1)).abs(),
        (low - close.shift(1)).abs()
    ], axis=1).max(axis=1)
    df['ATR'] = tr.rolling(14).mean()

    # RSI (14) — Wilder smoothing
    delta = close.diff()
    gain_arr = delta.clip(lower=0).to_numpy().copy()
    loss_arr = (-delta.clip(upper=0)).to_numpy().copy()
    avg_gain = pd.Series(gain_arr).rolling(14).mean().to_numpy().copy()
    avg_loss = pd.Series(loss_arr).rolling(14).mean().to_numpy().copy()
    for i in range(14, len(df)):
        if not np.isnan(avg_gain[i-1]):
            avg_gain[i] = (avg_gain[i-1] * 13 + gain_arr[i]) / 14
        if not np.isnan(avg_loss[i-1]):
            avg_loss[i] = (avg_loss[i-1] * 13 + loss_arr[i]) / 14
    with np.errstate(divide='ignore', invalid='ignore'):
        rs = np.where(avg_loss == 0, 100, avg_gain / avg_loss)
    df['RSI'] = 100 - (100 / (1 + rs))

    # Stochastic (14, 3)
    low14 = low.rolling(14).min()
    high14 = high.rolling(14).max()
    k_raw = 100 * ((close - low14) / (high14 - low14))
    df['Stoch_K'] = k_raw.rolling(3).mean()

    # CCI (20)
    tp = (high + low + close) / 3
    sma_tp = tp.rolling(20).mean()
    mad = tp.rolling(20).apply(lambda x: np.abs(x - x.mean()).mean(), raw=True)
    df['CCI'] = (tp - sma_tp) / (0.015 * mad)

    # MACD (12, 26, 9)
    df['MACD_line'] = close.ewm(span=12, adjust=False).mean() - close.ewm(span=26, adjust=False).mean()
    df['MACD_signal'] = df['MACD_line'].ewm(span=9, adjust=False).mean()

    last = df.iloc[-1]
    prev = df.iloc[-2]
    cur_close = float(last['close'])

    # SMC Zones
    smc = calculate_smc_zones(df)

    # --- Vote Counting ---
    osc_votes = {"BUY": 0, "SELL": 0, "NEUTRAL": 0}
    ma_votes = {"BUY": 0, "SELL": 0, "NEUTRAL": 0}

    rsi_val = float(last['RSI'])
    rsi_rec = "NEUTRAL"
    if rsi_val < 30: rsi_rec = "BUY"
    elif rsi_val > 70: rsi_rec = "SELL"
    osc_votes[rsi_rec] += 1

    stoch_val = float(last['Stoch_K'])
    stoch_rec = "NEUTRAL"
    if stoch_val < 20: stoch_rec = "BUY"
    elif stoch_val > 80: stoch_rec = "SELL"
    osc_votes[stoch_rec] += 1

    cci_val = float(last['CCI'])
    cci_rec = "NEUTRAL"
    if cci_val < -100: cci_rec = "BUY"
    elif cci_val > 100: cci_rec = "SELL"
    osc_votes[cci_rec] += 1

    macd_val = float(last['MACD_line'])
    macd_sig = float(last['MACD_signal'])
    macd_rec = "NEUTRAL"
    if macd_val > macd_sig: macd_rec = "BUY"
    elif macd_val < macd_sig: macd_rec = "SELL"
    osc_votes[macd_rec] += 1

    adx_val = 25.0
    adx_rec = "NEUTRAL"
    osc_votes[adx_rec] += 1

    ma_details = {}
    for mn in ['EMA10','SMA10','EMA20','SMA20','EMA50','SMA50','EMA100','SMA100','EMA200','SMA200']:
        v = float(last[mn])
        rec = "BUY" if cur_close > v else "SELL"
        ma_votes[rec] += 1
        ma_details[mn] = v

    buy = osc_votes["BUY"] + ma_votes["BUY"]
    sell = osc_votes["SELL"] + ma_votes["SELL"]
    neutral = osc_votes["NEUTRAL"] + ma_votes["NEUTRAL"]

    def get_rec(b, s):
        if b >= 9: return "STRONG_BUY"
        elif b >= 6: return "BUY"
        elif s >= 9: return "STRONG_SELL"
        elif s >= 6: return "SELL"
        return "NEUTRAL"

    def grp_rec(b, s):
        if b > s + 2: return "BUY"
        elif s > b + 2: return "SELL"
        return "NEUTRAL"

    rec_label = get_rec(buy, sell)
    osc_label = grp_rec(osc_votes["BUY"], osc_votes["SELL"])
    ma_label = "BUY" if ma_votes["BUY"] > ma_votes["SELL"] else ("SELL" if ma_votes["SELL"] > ma_votes["BUY"] else "NEUTRAL")

    # --- ML Features ---
    ema10_slope = (float(last['EMA10']) - float(prev['EMA10'])) / float(prev['EMA10']) * 1000
    features = {
        "rsi": round(rsi_val, 4),
        "stoch_k": round(stoch_val, 4),
        "cci_norm": round(cci_val / 200, 4),
        "macd_dir": 1 if macd_rec == "BUY" else (-1 if macd_rec == "SELL" else 0),
        "ema10_slope": round(ema10_slope, 6),
        "price_vs_ema20": 1 if cur_close > float(last['EMA20']) else 0,
        "price_vs_ema50": 1 if cur_close > float(last['EMA50']) else 0,
        "price_vs_ema200": 1 if cur_close > float(last['EMA200']) else 0,
        "in_bull_ob": int(smc["in_bullish_ob"]),
        "in_bear_ob": int(smc["in_bearish_ob"]),
        "in_bull_fvg": int(smc["in_bullish_fvg"]),
        "in_bear_fvg": int(smc["in_bearish_fvg"]),
        "in_support": int(smc["in_support"]),
        "in_resistance": int(smc["in_resistance"]),
        "in_liquidity": int(smc["in_liquidity"]),
        "breakout": int(smc["breakout_active"]),
        "ma_buy_ratio": round(ma_votes["BUY"] / 10, 2),
        "osc_buy_ratio": round(osc_votes["BUY"] / 5, 2),
    }

    # Label previous sample: was current close > previous close?
    label = 1 if cur_close > float(prev['close']) else 0

    # Candles for frontend chart (last 150)
    candles_out = []
    for _, row in df.tail(150).iterrows():
        candles_out.append({
            "time": int(row['epoch']),
            "open": float(row['open']),
            "high": float(row['high']),
            "low": float(row['low']),
            "close": float(row['close'])
        })

    # ATR value for entry targets
    atr_val = float(last['ATR']) if not np.isnan(last['ATR']) else cur_close * 0.001

    # --- SIGNAL OVERLAY: Entry point, targets and stop-loss per timeframe ---
    # For binary options: we predict whether the NEXT candle closes up or down
    # Target is expressed as price level after N minutes of movement
    direction = rec_label  # STRONG_BUY, BUY, NEUTRAL, SELL, STRONG_SELL
    is_call = 'BUY' in direction
    is_put = 'SELL' in direction

    # ATR multipliers: 1 candle = 0.8x ATR, 5 candles = 2x, 15 candles = 4x etc.
    tf_targets = {}
    timeframes = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15]
    for tf in timeframes:
        if tf <= 1:
            mult = 0.8
        elif tf <= 3:
            mult = tf * 0.7
        elif tf <= 5:
            mult = tf * 0.6
        elif tf <= 10:
            mult = tf * 0.5
        else:
            mult = tf * 0.4

        movement = atr_val * mult
        if is_call:
            tp = round(cur_close + movement, 5)
            sl = round(cur_close - atr_val * 0.5, 5)
        elif is_put:
            tp = round(cur_close - movement, 5)
            sl = round(cur_close + atr_val * 0.5, 5)
        else:
            tp = round(cur_close, 5)
            sl = round(cur_close, 5)

        tf_targets[str(tf)] = {
            "minutes": tf,
            "target": tp,
            "stop_loss": sl,
            "movement_pips": round(movement, 5),
            "movement_pct": round(movement / cur_close * 100, 4)
        }

    signal_overlay = {
        "direction": direction,
        "entry_price": round(cur_close, 5),
        "atr": round(atr_val, 5),
        "is_call": is_call,
        "is_put": is_put,
        "targets": tf_targets,
        "entry_time_utc": None  # filled by the client based on candle close
    }

    return {
        "rec_label": rec_label,
        "osc_label": osc_label,
        "ma_label": ma_label,
        "buy": buy, "sell": sell, "neutral": neutral,
        "osc": osc_votes, "ma": ma_votes,
        "indicators": {
            "RSI": {"value": rsi_val, "recommendation": rsi_rec},
            "Stoch_K": {"value": stoch_val, "recommendation": stoch_rec},
            "CCI": {"value": cci_val, "recommendation": cci_rec},
            "MACD": {"value": macd_val, "signal": macd_sig, "recommendation": macd_rec},
            "ADX": {"value": adx_val, "recommendation": adx_rec},
            "close": cur_close,
            **ma_details
        },
        "smc": smc,
        "features": features,
        "label": label,
        "candles": candles_out,
        "cur_close": cur_close,
        "signal_overlay": signal_overlay
    }


# =====================================================================
# TRADINGVIEW SIGNALS
# =====================================================================
def get_tradingview_signals(symbol, screener, exchange, interval_str):
    handler = TA_Handler(
        symbol=symbol, screener=screener, exchange=exchange,
        interval=INTERVALS[interval_str]
    )
    analysis = handler.get_analysis()
    summary = analysis.summary
    indicators = analysis.indicators
    oscillators = analysis.oscillators
    moving_averages = analysis.moving_averages

    cur_close = indicators.get("close") or 0

    # Minimal SMC via TV data — we don't have candles so zones are empty
    smc_stub = {
        "bullish_ob": [], "bearish_ob": [],
        "bullish_fvg": [], "bearish_fvg": [],
        "support": [], "resistance": [],
        "liquidity_high": [], "liquidity_low": [],
        "breakout": None, "breakout_active": False,
        "in_bullish_ob": False, "in_bearish_ob": False,
        "in_bullish_fvg": False, "in_bearish_fvg": False,
        "in_support": False, "in_resistance": False,
        "in_liquidity": False
    }

    return {
        "summary": {
            "recommendation": summary.get("RECOMMENDATION", "NEUTRAL"),
            "buy": summary.get("BUY", 0),
            "sell": summary.get("SELL", 0),
            "neutral": summary.get("NEUTRAL", 0),
            "total": summary.get("BUY", 0) + summary.get("SELL", 0) + summary.get("NEUTRAL", 0)
        },
        "oscillators": {
            "recommendation": oscillators.get("RECOMMENDATION", "NEUTRAL"),
            "buy": oscillators.get("BUY", 0),
            "sell": oscillators.get("SELL", 0),
            "neutral": oscillators.get("NEUTRAL", 0),
        },
        "moving_averages": {
            "recommendation": moving_averages.get("RECOMMENDATION", "NEUTRAL"),
            "buy": moving_averages.get("BUY", 0),
            "sell": moving_averages.get("SELL", 0),
            "neutral": moving_averages.get("NEUTRAL", 0),
        },
        "indicators": {
            "RSI": {"value": indicators.get("RSI"), "recommendation": oscillators.get("COMPUTE", {}).get("RSI") if oscillators else None},
            "Stoch_K": {"value": indicators.get("Stoch.K"), "recommendation": oscillators.get("COMPUTE", {}).get("Stochastic") if oscillators else None},
            "CCI": {"value": indicators.get("CCI20"), "recommendation": oscillators.get("COMPUTE", {}).get("CCI") if oscillators else None},
            "MACD": {"value": indicators.get("MACD.macd"), "signal": indicators.get("MACD.signal"), "recommendation": oscillators.get("COMPUTE", {}).get("MACD") if oscillators else None},
            "ADX": {"value": indicators.get("ADX"), "recommendation": oscillators.get("COMPUTE", {}).get("ADX") if oscillators else None},
            "EMA10": indicators.get("EMA10"), "SMA10": indicators.get("SMA10"),
            "EMA20": indicators.get("EMA20"), "SMA20": indicators.get("SMA20"),
            "EMA50": indicators.get("EMA50"), "SMA50": indicators.get("SMA50"),
            "EMA100": indicators.get("EMA100"), "SMA100": indicators.get("SMA100"),
            "EMA200": indicators.get("EMA200"), "SMA200": indicators.get("SMA200"),
            "close": cur_close
        },
        "smc": smc_stub
    }


# =====================================================================
# ROUTES
# =====================================================================
@app.route('/')
def index():
    return render_template('index.html')


@app.route('/api/signals', methods=['GET'])
def get_signals():
    symbol = request.args.get('symbol', 'EURUSD').upper()
    screener = request.args.get('screener', 'forex').lower()
    exchange = request.args.get('exchange', 'FX_IDC').upper()
    interval_str = request.args.get('interval', '1m').lower()

    if interval_str not in INTERVALS:
        return jsonify({"status": "error", "message": f"Interval '{interval_str}' not supported."}), 400

    if screener == 'synthetic':
        try:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            candles = loop.run_until_complete(fetch_deriv_candles(symbol, interval_str))
            loop.close()

            result = calculate_deriv_indicators(candles)

            # Push labeled feature sample to ML engine using the last_close_cache logic
            key = f"{symbol}_{interval_str}"
            if key in last_close_cache:
                prev_data = last_close_cache[key]
                next_close = result["cur_close"]
                label = 1 if next_close > prev_data["close"] else 0
                ml_engine.push(symbol, interval_str, prev_data["features"], label, next_close)
            
            # Cache current features and close for next query
            last_close_cache[key] = {
                "features": result["features"],
                "close": result["cur_close"]
            }

            ml_stats = ml_engine.stats(symbol, interval_str)
            call_p, put_p, expected_price_neural, samples, trained = ml_engine.predict(symbol, interval_str, result["features"])

            # Expose in signal_overlay
            result["signal_overlay"]["expected_price_neural"] = expected_price_neural

            return jsonify({
                "status": "success",
                "symbol": symbol,
                "screener": screener,
                "exchange": "DERIV",
                "interval": interval_str,
                "summary": {
                    "recommendation": result["rec_label"],
                    "buy": result["buy"],
                    "sell": result["sell"],
                    "neutral": result["neutral"],
                    "total": result["buy"] + result["sell"] + result["neutral"]
                },
                "oscillators": {
                    "recommendation": result["osc_label"],
                    "buy": result["osc"]["BUY"],
                    "sell": result["osc"]["SELL"],
                    "neutral": result["osc"]["NEUTRAL"]
                },
                "moving_averages": {
                    "recommendation": result["ma_label"],
                    "buy": result["ma"]["BUY"],
                    "sell": result["ma"]["SELL"],
                    "neutral": result["ma"]["NEUTRAL"]
                },
                "indicators": result["indicators"],
                "smc": result["smc"],
                "ml": {
                    "call_pct": call_p,
                    "put_pct": put_p,
                    "expected_price_neural": expected_price_neural if trained else None,
                    "samples": samples,
                    "trained": trained,
                    "min_samples": ml_stats["min_samples"],
                    "progress_pct": min(100, round(samples / ml_stats["min_samples"] * 100))
                },
                "candles": result["candles"],
                "signal_overlay": result["signal_overlay"]
            })

        except Exception as e:
            import traceback
            traceback.print_exc()
            return jsonify({"status": "error", "message": f"Error en índices sintéticos: {str(e)}"}), 500

    else:
        try:
            tv = get_tradingview_signals(symbol, screener, exchange, interval_str)
            ml_stats = ml_engine.stats(symbol, interval_str)
            call_p, put_p, samples, trained = 50.0, 50.0, 0, False
            return jsonify({
                "status": "success",
                "symbol": symbol,
                "screener": screener,
                "exchange": exchange,
                "interval": interval_str,
                **tv,
                "ml": {
                    "call_pct": call_p,
                    "put_pct": put_p,
                    "samples": samples,
                    "trained": trained,
                    "min_samples": 60,
                    "progress_pct": 0
                }
            })
        except Exception as e:
            msg = str(e)
            if "429" in msg:
                msg = "TradingView limitó las consultas (429). Espera unos segundos."
            print(f"TradingView error: {e}")
            return jsonify({"status": "error", "message": msg}), 500


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    print(f"\n{'='*55}")
    print(f"  QUANTUM BINARY BOT — SMC + ML ENGINE ACTIVO")
    print(f"  Dashboard: http://127.0.0.1:{port}")
    print(f"{'='*55}\n")
    app.run(host='0.0.0.0', port=port, debug=True)
