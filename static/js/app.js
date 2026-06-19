// QUANTUM BINARY BOT - FRONTEND ENGINE

// Application State
const state = {
    symbol: 'EURUSD',
    screener: 'forex',
    exchange: 'FX_IDC',
    interval: '1m',
    autoRefreshIntervalId: null,
    lastRecommendation: null,
    history: [],
    tradingViewWidget: null,
    audioContext: null,

    // Deriv API State
    derivWs: null,
    derivConnected: false,
    derivCooldown: false,

    // Lightweight Charts for Synthetic Indices
    lightweightChart: null,
    candleSeries: null,

    // Entry Signal Overlay
    signalOverlay: null,         // last signal_overlay from API
    selectedExpiry: 1,           // selected expiry in minutes (from etf-btn)
    countdownIntervalId: null,   // setInterval for candle-close countdown
    tpLine: null,                // TP price line on chart
    slLine: null,                // SL price line on chart
    entryMarker: null,           // Entry marker stored
    lastCandleTime: null,        // Unix time of last candle (to compute countdown)

    // Live Tick WebSocket (Deriv real-time)
    tickWs: null,                // WebSocket for live ticks
    tickWsConnected: false,
    currentCandle: null,         // current live candle being built tick by tick
    intervalSecs: 60             // candle interval in seconds
};

// Map interface intervals to TradingView chart widget intervals
const chartIntervalMap = {
    '1m': '1',
    '5m': '5',
    '15m': '15',
    '30m': '30',
    '1h': '60',
    '4h': '240',
    '1d': 'D'
};

// Map standard assets to Deriv options symbols
const derivSymbolMap = {
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
    'XAUUSD': 'frxXAUUSD',
    // Synthetic mapping
    'R_10': 'R_10',
    'R_25': 'R_25',
    'R_50': 'R_50',
    'R_75': 'R_75',
    'R_100': 'R_100',
    '1HZ10V': '1HZ10V',
    '1HZ100V': '1HZ100V'
};

// Map TradingView-ta recommendations to gauge angles (in degrees)
const gaugeAngles = {
    'STRONG_SELL': -75,
    'SELL': -35,
    'NEUTRAL': 0,
    'BUY': 35,
    'STRONG_BUY': 75
};

// DOM Elements
const elements = {
    assetSelect: document.getElementById('asset-select'),
    tfButtons: document.querySelectorAll('.tf-btn'),
    soundToggle: document.getElementById('sound-toggle'),
    autoRefreshToggle: document.getElementById('auto-refresh'),
    refreshBtn: document.getElementById('refresh-btn'),
    refreshIcon: document.getElementById('refresh-icon'),
    mainSignalCard: document.getElementById('main-signal-card'),
    gaugeValText: document.getElementById('gauge-val-text'),
    gaugeNeedleGroup: document.getElementById('gauge-needle-group'),
    signalDirection: document.getElementById('signal-direction'),
    signalAction: document.getElementById('signal-action'),
    summaryBuy: document.getElementById('summary-buy'),
    summaryNeutral: document.getElementById('summary-neutral'),
    summarySell: document.getElementById('summary-sell'),
    confidencePct: document.getElementById('confidence-pct'),
    confidenceBar: document.getElementById('confidence-bar'),
    lastUpdateTime: document.getElementById('last-update-time'),
    liveClock: document.getElementById('live-clock'),
    oscillatorsTbody: document.getElementById('oscillators-tbody'),
    maTbody: document.getElementById('ma-tbody'),
    historyTbody: document.getElementById('history-tbody'),
    tabButtons: document.querySelectorAll('.tab-btn'),
    tabPanes: document.querySelectorAll('.tab-pane'),
    connectionStatus: document.getElementById('connection-status'),

    // Charts Elements
    tradingViewChartDiv: document.getElementById('tradingview_chart'),
    derivChartContainer: document.getElementById('deriv_chart_container'),

    // Deriv Elements
    derivEnv: document.getElementById('deriv-env'),
    derivOtp: document.getElementById('deriv-otp'),
    derivStake: document.getElementById('deriv-stake'),
    derivDuration: document.getElementById('deriv-duration'),
    derivAutotrade: document.getElementById('deriv-autotrade'),
    btnConnectDeriv: document.getElementById('btn-connect-deriv'),
    derivStatusBar: document.getElementById('deriv-status-bar'),
    derivConsoleLog: document.getElementById('deriv-console-log'),

    // Entry Signal Panel
    entrySignalPanel: document.getElementById('entry-signal-panel'),
    entryBadge: document.getElementById('entry-badge'),
    entryPriceVal: document.getElementById('entry-price-val'),
    entryDirIcon: document.getElementById('entry-dir-icon'),
    entryDirLabel: document.getElementById('entry-dir-label'),
    entryAtrVal: document.getElementById('entry-atr-val'),
    entryCountdown: document.getElementById('entry-countdown'),
    entryTimingHint: document.getElementById('entry-timing-hint'),
    entryTfButtons: document.querySelectorAll('.etf-btn'),
    entryTpVal: document.getElementById('entry-tp-val'),
    entryTpPct: document.getElementById('entry-tp-pct'),
    entrySlVal: document.getElementById('entry-sl-val'),
    entrySlPct: document.getElementById('entry-sl-pct'),
    movementTf: document.getElementById('movement-tf'),
    movementBar: document.getElementById('movement-bar'),
    movementPips: document.getElementById('movement-pips'),
    chartBadges: document.getElementById('chart-badges')
};

// Initialize Application
document.addEventListener('DOMContentLoaded', () => {
    initClock();
    initTradingViewChart();
    initTabNavigation();
    initEventListeners();
    initEntryPanel();
    fetchSignal();
    setupAutoRefresh();
});

// Real-time Clock
function initClock() {
    setInterval(() => {
        const now = new Date();
        elements.liveClock.innerText = now.toTimeString().split(' ')[0];
    }, 1000);
}

// Interactive TradingView Advanced Chart Widget or Lightweight Charts
function initTradingViewChart() {
    // Check if it is a synthetic asset (Calculated locally)
    if (state.screener === 'synthetic') {
        // 1. Display/Hide appropriate divs
        elements.tradingViewChartDiv.style.display = 'none';
        elements.derivChartContainer.style.display = 'block';

        // 2. Initialize Lightweight Charts if not already done
        if (!state.lightweightChart) {
            state.lightweightChart = LightweightCharts.createChart(elements.derivChartContainer, {
                width: elements.derivChartContainer.clientWidth || 600,
                height: elements.derivChartContainer.clientHeight || 350,
                layout: {
                    background: { type: 'solid', color: '#0c1020' },
                    textColor: '#8a99ad',
                },
                grid: {
                    vertLines: { color: 'rgba(255, 255, 255, 0.04)' },
                    horzLines: { color: 'rgba(255, 255, 255, 0.04)' },
                },
                crosshair: {
                    mode: LightweightCharts.CrosshairMode.Normal,
                },
                rightPriceScale: {
                    borderColor: 'rgba(255, 255, 255, 0.08)',
                },
                timeScale: {
                    borderColor: 'rgba(255, 255, 255, 0.08)',
                    timeVisible: true,
                    secondsVisible: false
                },
            });

            state.candleSeries = state.lightweightChart.addCandlestickSeries({
                upColor: '#39ff14',
                downColor: '#ff3131',
                borderUpColor: '#39ff14',
                borderDownColor: '#ff3131',
                wickUpColor: '#39ff14',
                wickDownColor: '#ff3131',
            });

            // Handle Resize
            window.addEventListener('resize', () => {
                if (state.lightweightChart && state.screener === 'synthetic') {
                    state.lightweightChart.resize(elements.derivChartContainer.clientWidth, elements.derivChartContainer.clientHeight);
                }
            });
        }
        
        // Trigger a force resize since container might have transitioned from hidden
        setTimeout(() => {
            if (state.lightweightChart) {
                state.lightweightChart.resize(elements.derivChartContainer.clientWidth, elements.derivChartContainer.clientHeight);
            }
        }, 150);

        // Update interval seconds for countdown
        const iMap = { '1m': 60, '5m': 300, '15m': 900, '30m': 1800, '1h': 3600, '4h': 14400, '1d': 86400 };
        state.intervalSecs = iMap[state.interval] || 60;

        // Start live tick WebSocket stream
        startTickStream();

        return;
    }

    // Standard Asset (Forex / Crypto / Stock)
    elements.derivChartContainer.style.display = 'none';
    elements.tradingViewChartDiv.style.display = 'block';

    const symbolStr = `${state.exchange}:${state.symbol}`;
    
    // Clean up container before rebuild
    if (state.tradingViewWidget) {
        try {
            elements.tradingViewChartDiv.innerHTML = '';
        } catch(e) {
            console.error("Error resetting container: ", e);
        }
    }

    state.tradingViewWidget = new TradingView.widget({
        "width": "100%",
        "height": "100%",
        "symbol": symbolStr,
        "interval": chartIntervalMap[state.interval],
        "timezone": "Etc/UTC",
        "theme": "dark",
        "style": "1", // Candlesticks
        "locale": "es",
        "toolbar_bg": "#0c1020",
        "enable_publishing": false,
        "hide_side_toolbar": false,
        "allow_symbol_change": false,
        "container_id": "tradingview_chart",
        "studies": [
            "RSI@tv-basicstudies",
            "MASimple@tv-basicstudies"
        ],
        "colors": {
            "bg": "#0c1020",
            "grid": "rgba(255, 255, 255, 0.05)"
        }
    });
}

// Tab Panels Navigation
function initTabNavigation() {
    elements.tabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            elements.tabButtons.forEach(b => b.classList.remove('active'));
            elements.tabPanes.forEach(p => p.classList.remove('active'));
            
            btn.classList.add('active');
            
            const tabId = btn.getAttribute('data-tab');
            document.getElementById(tabId).classList.add('active');
        });
    });
}

// Setup Event Listeners
function initEventListeners() {
    // Asset Select Change
    elements.assetSelect.addEventListener('change', (e) => {
        const selectedOption = e.target.options[e.target.selectedIndex];
        state.symbol = e.target.value;
        state.screener = selectedOption.getAttribute('data-screener');
        state.exchange = selectedOption.getAttribute('data-exchange');
        
        // Stop tick stream (will restart in initTradingViewChart for synthetics)
        stopTickStream();
        state.currentCandle = null;

        // Reinitialize Chart
        initTradingViewChart();
        // Fetch new data
        fetchSignal(true);
    });

    // Timeframe Change Buttons
    elements.tfButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            elements.tfButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            state.interval = btn.getAttribute('data-interval');
            const iMap = { '1m': 60, '5m': 300, '15m': 900, '30m': 1800, '1h': 3600, '4h': 14400, '1d': 86400 };
            state.intervalSecs = iMap[state.interval] || 60;

            // Restart tick stream with new interval
            stopTickStream();
            state.currentCandle = null;

            // Reinitialize Chart
            initTradingViewChart();
            // Fetch new data
            fetchSignal(true);
        });
    });

    // Manual Refresh Button
    elements.refreshBtn.addEventListener('click', () => {
        fetchSignal();
    });

    // Auto-refresh switch change
    elements.autoRefreshToggle.addEventListener('change', () => {
        setupAutoRefresh();
    });

    // Connect Deriv WebSocket Button
    elements.btnConnectDeriv.addEventListener('click', () => {
        toggleDerivConnection();
    });
}

// Auto-Refresh handler (polling)
function setupAutoRefresh() {
    if (state.autoRefreshIntervalId) {
        clearInterval(state.autoRefreshIntervalId);
        state.autoRefreshIntervalId = null;
    }
    
    if (elements.autoRefreshToggle.checked) {
        state.autoRefreshIntervalId = setInterval(() => {
            fetchSignal();
        }, 10000); // Poll every 10 seconds
    }
}

// Synthesize alert sound (Web Audio API)
function playAlertSound(type) {
    if (!elements.soundToggle.checked) return;

    try {
        if (!state.audioContext) {
            state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }

        const ctx = state.audioContext;
        if (ctx.state === 'suspended') {
            ctx.resume();
        }

        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        
        osc.connect(gain);
        gain.connect(ctx.destination);

        const now = ctx.currentTime;

        if (type === 'CALL') {
            osc.type = 'sine';
            osc.frequency.setValueAtTime(520, now);
            osc.frequency.exponentialRampToValueAtTime(1040, now + 0.15);
            
            gain.gain.setValueAtTime(0.15, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.25);
            
            osc.start(now);
            osc.stop(now + 0.25);
            
            setTimeout(() => {
                const osc2 = ctx.createOscillator();
                const gain2 = ctx.createGain();
                osc2.connect(gain2);
                gain2.connect(ctx.destination);
                
                osc2.type = 'sine';
                osc2.frequency.setValueAtTime(1040, ctx.currentTime);
                osc2.frequency.setValueAtTime(1560, ctx.currentTime + 0.1);
                
                gain2.gain.setValueAtTime(0.15, ctx.currentTime);
                gain2.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);
                
                osc2.start();
                osc2.stop(ctx.currentTime + 0.2);
            }, 100);

        } else if (type === 'PUT') {
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(700, now);
            osc.frequency.exponentialRampToValueAtTime(350, now + 0.18);
            
            gain.gain.setValueAtTime(0.1, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
            
            osc.start(now);
            osc.stop(now + 0.3);

            setTimeout(() => {
                const osc2 = ctx.createOscillator();
                const gain2 = ctx.createGain();
                osc2.connect(gain2);
                gain2.connect(ctx.destination);
                
                osc2.type = 'sawtooth';
                osc2.frequency.setValueAtTime(350, ctx.currentTime);
                osc2.frequency.exponentialRampToValueAtTime(180, ctx.currentTime + 0.2);
                
                gain2.gain.setValueAtTime(0.1, ctx.currentTime);
                gain2.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.25);
                
                osc2.start();
                osc2.stop(ctx.currentTime + 0.25);
            }, 120);
        }
    } catch(e) {
        console.error("Web Audio API not supported or blocked: ", e);
    }
}

// Fetch Signals API
async function fetchSignal(isAssetChange = false) {
    elements.refreshIcon.style.transform = 'rotate(360deg)';
    
    const url = `/api/signals?symbol=${state.symbol}&screener=${state.screener}&exchange=${state.exchange}&interval=${state.interval}`;
    
    try {
        const response = await fetch(url);
        const data = await response.json();
        
        setTimeout(() => {
            elements.refreshIcon.style.transform = 'rotate(0deg)';
        }, 500);

        if (data.status === 'success') {
            updateDashboard(data, isAssetChange);
            elements.connectionStatus.className = 'status-indicator online';
            elements.connectionStatus.querySelector('.status-label').innerText = 'CONECTADO';
        } else {
            console.error("API returned error: ", data.message);
            showErrorState(data.message);
        }
    } catch (error) {
        console.error("Network error fetching signals: ", error);
        showErrorState("Error de conexión con el backend local.");
        
        setTimeout(() => {
            elements.refreshIcon.style.transform = 'rotate(0deg)';
        }, 500);
        
        elements.connectionStatus.className = 'status-indicator offline';
        elements.connectionStatus.querySelector('.status-label').innerText = 'DESCONECTADO';
    }
}

// Show Error message in Signal box
function showErrorState(msg) {
    elements.gaugeValText.innerText = "ERROR";
    elements.signalDirection.innerText = "API ERROR";
    elements.signalDirection.style.color = "var(--neon-red)";
    elements.signalAction.innerText = msg;
    elements.mainSignalCard.className = "panel-card signal-card neon-strong-sell";
}

// Update the UI Dashboard components
function updateDashboard(data, isAssetChange) {
    const rec = data.summary.recommendation;
    const buy = data.summary.buy;
    const neutral = data.summary.neutral;
    const sell = data.summary.sell;

    // 1. Update Recommendation Card Theme and Text
    elements.mainSignalCard.className = 'panel-card signal-card';
    
    let directionText = 'NEUTRAL';
    let actionText = 'ESPERAR NUEVA VELA';
    let cardThemeClass = 'neon-neutral';

    if (rec.includes('STRONG_BUY')) {
        directionText = 'CALL';
        actionText = 'COMPRA FUERTE';
        cardThemeClass = 'neon-strong-buy';
    } else if (rec.includes('BUY')) {
        directionText = 'CALL';
        actionText = 'COMPRA SUGERIDA';
        cardThemeClass = 'neon-buy';
    } else if (rec.includes('STRONG_SELL')) {
        directionText = 'PUT';
        actionText = 'VENTA FUERTE';
        cardThemeClass = 'neon-strong-sell';
    } else if (rec.includes('SELL')) {
        directionText = 'PUT';
        actionText = 'VENTA SUGERIDA';
        cardThemeClass = 'neon-sell';
    }

    elements.mainSignalCard.classList.add(cardThemeClass);
    elements.signalDirection.innerText = directionText;
    elements.signalAction.innerText = actionText;
    
    elements.gaugeValText.innerText = rec.replace('_', ' ');

    // 2. Play Alarm Sound and Trigger Auto-Trading on state change
    if (rec === 'STRONG_BUY' || rec === 'STRONG_SELL') {
        if (!isAssetChange && state.lastRecommendation !== rec) {
            if (rec === 'STRONG_BUY') playAlertSound('CALL');
            else playAlertSound('PUT');
        }
        
        const derivContractType = rec === 'STRONG_BUY' ? 'CALL' : 'PUT';
        executeDerivTrade(derivContractType);
    }
    state.lastRecommendation = rec;

    // 3. Update Gauge Meter Needle
    const angle = gaugeAngles[rec] !== undefined ? gaugeAngles[rec] : 0;
    elements.gaugeNeedleGroup.setAttribute('transform', `translate(100, 100) rotate(${angle})`);

    // 4. Update Stats Numbers
    elements.summaryBuy.innerText = buy;
    elements.summaryNeutral.innerText = neutral;
    elements.summarySell.innerText = sell;

    // 5. Update Confidence Indicator
    const activeTotal = buy + sell;
    let confidence = 0;
    if (activeTotal > 0) {
        confidence = Math.round((Math.max(buy, sell) / activeTotal) * 100);
    }
    elements.confidencePct.innerText = `${confidence}%`;
    elements.confidenceBar.style.width = `${confidence}%`;
    
    if (confidence >= 75) {
        elements.confidenceBar.style.background = 'linear-gradient(90deg, var(--neon-cyan), var(--neon-green))';
    } else if (confidence >= 55) {
        elements.confidenceBar.style.background = 'linear-gradient(90deg, var(--neon-yellow), var(--neon-cyan))';
    } else {
        elements.confidenceBar.style.background = 'linear-gradient(90deg, #505869, var(--text-muted))';
    }

    // 6. Update timestamp
    const now = new Date();
    elements.lastUpdateTime.innerText = now.toTimeString().split(' ')[0];

    // 7. Update Tables Details
    renderTables(data);

    // 8. Update SMC Panels
    if (data.smc) {
        const smc = data.smc;
        const setVal = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.innerText = val;
        };
        const setDot = (id, active) => {
            const el = document.getElementById(id);
            if (el) el.className = active ? 'smc-status active' : 'smc-status';
        };

        setVal('smc-ob-val', (smc.bullish_ob ? smc.bullish_ob.length : 0) + (smc.bearish_ob ? smc.bearish_ob.length : 0));
        setVal('smc-fvg-val', (smc.bullish_fvg ? smc.bullish_fvg.length : 0) + (smc.bearish_fvg ? smc.bearish_fvg.length : 0));
        setVal('smc-sup-val', smc.support ? smc.support.length : 0);
        setVal('smc-res-val', smc.resistance ? smc.resistance.length : 0);
        setVal('smc-liq-val', (smc.liquidity_high ? smc.liquidity_high.length : 0) + (smc.liquidity_low ? smc.liquidity_low.length : 0));
        setVal('smc-brk-val', smc.breakout || '—');

        setDot('smc-ob-dot', smc.in_bullish_ob || smc.in_bearish_ob);
        setDot('smc-fvg-dot', smc.in_bullish_fvg || smc.in_bearish_fvg);
        setDot('smc-sup-dot', smc.in_support);
        setDot('smc-res-dot', smc.in_resistance);
        setDot('smc-liq-dot', smc.in_liquidity);
        setDot('smc-brk-dot', smc.breakout_active);
    } else {
        const smcIds = ['smc-ob-val', 'smc-fvg-val', 'smc-sup-val', 'smc-res-val', 'smc-liq-val', 'smc-brk-val'];
        smcIds.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.innerText = '—';
        });
        const smcDots = ['smc-ob-dot', 'smc-fvg-dot', 'smc-sup-dot', 'smc-res-dot', 'smc-liq-dot', 'smc-brk-dot'];
        smcDots.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.className = 'smc-status';
        });
    }

    // 9. Update Machine Learning Panel
    if (data.ml) {
        const ml = data.ml;
        const setVal = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.innerText = val;
        };

        setVal('ml-samples', ml.samples || 0);
        setVal('ml-min', ml.min_samples || 60);

        const pct = ml.samples && ml.min_samples ? Math.min((ml.samples / ml.min_samples) * 100, 100) : 0;
        const learnBar = document.getElementById('ml-learn-bar');
        if (learnBar) learnBar.style.width = `${pct}%`;

        const trainedBadge = document.getElementById('ml-trained-badge');
        if (trainedBadge) {
            if (ml.trained) {
                trainedBadge.innerHTML = "<i class='fa-solid fa-circle-check'></i> Entrenado";
                trainedBadge.classList.remove('disabled');
            } else {
                trainedBadge.innerHTML = "<i class='fa-solid fa-circle-xmark'></i> Sin entrenar";
                trainedBadge.classList.add('disabled');
            }
        }

        setVal('ml-call-pct', `${ml.call_pct || 0}%`);
        setVal('ml-put-pct', `${ml.put_pct || 0}%`);

        const callBar = document.getElementById('ml-call-bar');
        const putBar = document.getElementById('ml-put-bar');
        if (callBar) callBar.style.height = `${ml.call_pct || 0}%`;
        if (putBar) putBar.style.height = `${ml.put_pct || 0}%`;

        const hint = document.getElementById('ml-hint');
        if (hint) hint.style.display = ml.trained ? 'none' : 'block';
    }

    // 10. Draw Candles on Lightweight Charts (Synthetic Indices only)
    if (state.screener === 'synthetic' && data.candles && state.candleSeries) {
        state.candleSeries.setData(data.candles);
        // Record last candle time for countdown
        if (data.candles.length > 0) {
            state.lastCandleTime = data.candles[data.candles.length - 1].time;
        }
        if (state.lightweightChart) {
            state.lightweightChart.resize(elements.derivChartContainer.clientWidth, elements.derivChartContainer.clientHeight);
        }
        // Draw signal markers on chart if we have overlay data
        if (data.signal_overlay) {
            drawChartSignalOverlay(data.signal_overlay, data.candles);
        }
    }

    // 11. Update Entry Signal Panel
    if (data.signal_overlay) {
        state.signalOverlay = data.signal_overlay;
        updateEntryPanel(data.signal_overlay);
    }

    // 12. Update SMC chart badges
    if (data.smc) {
        updateChartBadges(data.smc);
    }

    // 13. Register to history if it's a new state or pair
    addToHistory(data, directionText, confidence);
}

// Render data lists into HTML tables
function renderTables(data) {
    const inds = data.indicators;
    
    const oscData = [
        { name: 'RSI (14)', val: inds.RSI.value, rec: inds.RSI.recommendation },
        { name: 'Stochastic %K', val: inds.Stoch_K.value, rec: inds.Stoch_K.recommendation },
        { name: 'CCI (20)', val: inds.CCI.value, rec: inds.CCI.recommendation },
        { name: 'MACD (12, 26)', val: formatMACD(inds.MACD), rec: inds.MACD.recommendation },
        { name: 'ADX (14)', val: inds.ADX.value, rec: inds.ADX.recommendation }
    ];

    let oscHtml = '';
    oscData.forEach(row => {
        const valStr = row.val !== null && row.val !== undefined ? (typeof row.val === 'number' ? row.val.toFixed(4) : row.val) : '--';
        const recStr = row.rec || 'NEUTRAL';
        const statusClass = getStatusClass(recStr);
        
        oscHtml += `
            <tr>
                <td><strong>${row.name}</strong></td>
                <td>${valStr}</td>
                <td class="status-cell ${statusClass}">${recStr}</td>
            </tr>
        `;
    });
    elements.oscillatorsTbody.innerHTML = oscHtml;

    const maKeys = ['10', '20', '50', '100', '200'];
    let maHtml = '';
    const close = inds.close || 0;

    maKeys.forEach(period => {
        const emaVal = inds[`EMA${period}`];
        const smaVal = inds[`SMA${period}`];
        
        if (emaVal) {
            const emaRec = emaVal < close ? 'BUY' : (emaVal > close ? 'SELL' : 'NEUTRAL');
            const emaStatusClass = getStatusClass(emaRec);
            maHtml += `
                <tr>
                    <td><strong>EMA (${period})</strong></td>
                    <td>${close.toFixed(5)}</td>
                    <td>${emaVal.toFixed(5)}</td>
                    <td class="status-cell ${emaStatusClass}">${emaRec === 'BUY' ? 'CALL (COMPRA)' : 'PUT (VENTA)'}</td>
                </tr>
            `;
        }

        if (smaVal) {
            const smaRec = smaVal < close ? 'BUY' : (smaVal > close ? 'SELL' : 'NEUTRAL');
            const smaStatusClass = getStatusClass(smaRec);
            maHtml += `
                <tr>
                    <td><strong>SMA (${period})</strong></td>
                    <td>${close.toFixed(5)}</td>
                    <td>${smaVal.toFixed(5)}</td>
                    <td class="status-cell ${smaStatusClass}">${smaRec === 'BUY' ? 'CALL (COMPRA)' : 'PUT (VENTA)'}</td>
                </tr>
            `;
        }
    });

    if (maHtml === '') {
        maHtml = `<tr><td colspan="4" class="text-center">No hay datos de medias móviles disponibles.</td></tr>`;
    }
    elements.maTbody.innerHTML = maHtml;
}

function formatMACD(macdObj) {
    if (macdObj && macdObj.value !== null && macdObj.signal !== null) {
        return `Val: ${macdObj.value.toFixed(5)} | Sig: ${macdObj.signal.toFixed(5)}`;
    }
    return '--';
}

function getStatusClass(rec) {
    if (rec.includes('BUY')) return 'status-buy';
    if (rec.includes('SELL')) return 'status-sell';
    return 'status-neutral';
}

function addToHistory(data, signalDir, confidence) {
    const timeStr = new Date().toTimeString().split(' ')[0];
    const asset = data.symbol;
    const tf = data.interval;
    
    if (state.history.length > 0) {
        const last = state.history[0];
        if (last.asset === asset && last.tf === tf && last.signal === signalDir) {
            last.time = timeStr;
            last.confidence = confidence;
            renderHistoryTable();
            return;
        }
    }

    state.history.unshift({
        time: timeStr,
        asset: asset,
        tf: tf,
        signal: signalDir,
        confidence: confidence
    });

    if (state.history.length > 20) {
        state.history.pop();
    }

    renderHistoryTable();
}

function renderHistoryTable() {
    if (state.history.length === 0) {
        elements.historyTbody.innerHTML = `<tr><td colspan="5" class="text-center">No hay señales registradas en esta sesión.</td></tr>`;
        return;
    }

    let html = '';
    state.history.forEach(item => {
        const statusClass = item.signal === 'CALL' ? 'status-buy' : (item.signal === 'PUT' ? 'status-sell' : 'status-neutral');
        const badgeIcon = item.signal === 'CALL' ? '<i class="fa-solid fa-arrow-trend-up"></i>' : (item.signal === 'PUT' ? '<i class="fa-solid fa-arrow-trend-down"></i>' : '=');
        
        html += `
            <tr>
                <td>${item.time}</td>
                <td><strong>${item.asset}</strong></td>
                <td><span class="tf-btn" style="padding: 2px 6px; font-size: 10px; cursor: default;">${item.tf}</span></td>
                <td class="status-cell ${statusClass}">${badgeIcon} ${item.signal}</td>
                <td style="font-family: 'Orbitron', sans-serif; font-weight: 700; color: var(--neon-cyan)">${item.confidence}%</td>
            </tr>
        `;
    });
    elements.historyTbody.innerHTML = html;
}

// =====================================================================
// DERIV OPTIONS API WEBSOCKET INTEGRATION
// =====================================================================

function logDeriv(message) {
    const timeStr = new Date().toTimeString().split(' ')[0];
    const logDiv = elements.derivConsoleLog;
    logDiv.innerHTML += `\n[${timeStr}] ${message}`;
    logDiv.scrollTop = logDiv.scrollHeight;
}

function toggleDerivConnection() {
    if (state.derivConnected) {
        logDeriv("[CONEXIÓN] Cerrando canal con Deriv de forma voluntaria...");
        if (state.derivWs) {
            state.derivWs.close();
        }
        return;
    }

    const otp = elements.derivOtp.value.trim();
    const env = elements.derivEnv.value;

    if (!otp) {
        alert("Por favor introduce tu token OTP para conectarte a tu cuenta de Deriv.");
        logDeriv("[CONFIG] ERROR: Falta el token OTP.");
        return;
    }

    elements.derivStatusBar.className = "deriv-status-bar connecting";
    elements.derivStatusBar.innerText = "ESTADO: CONECTANDO...";
    logDeriv(`[SISTEMA] Iniciando conexión WebSocket con Deriv (${env.toUpperCase()})...`);

    const wsUrl = `wss://api.derivws.com/trading/v1/options/ws/${env}?otp=${otp}`;

    try {
        state.derivWs = new WebSocket(wsUrl);

        state.derivWs.onopen = () => {
            state.derivConnected = true;
            elements.btnConnectDeriv.innerText = "Desconectar";
            elements.btnConnectDeriv.classList.add('connected');
            
            elements.derivStatusBar.className = "deriv-status-bar online";
            elements.derivStatusBar.innerText = `ESTADO: CONECTADO (${env.toUpperCase()})`;
            
            logDeriv("[CONEXIÓN] WebSocket conectado y autenticado por OTP. Listo para operar.");
        };

        state.derivWs.onmessage = (event) => {
            try {
                const response = JSON.parse(event.data);
                
                if (response.error) {
                    logDeriv(`[DERIV ERROR] ${response.error.message} (Código: ${response.error.code})`);
                    return;
                }

                if (response.msg_type === 'buy') {
                    const buyData = response.buy;
                    logDeriv(`[COMPRA EXITOSA] Contrato comprado.`);
                    logDeriv(`  ↳ ID Contrato: ${buyData.contract_id}`);
                    logDeriv(`  ↳ Transacción: ${buyData.transaction_id}`);
                    logDeriv(`  ↳ Payout Estimado: $${buyData.payout}`);
                    logDeriv(`  ↳ Balance posterior: $${buyData.balance_after}`);
                } else {
                    logDeriv(`[RESPUESTA] Recibido msg_type: '${response.msg_type}'`);
                }
            } catch (jsonErr) {
                logDeriv(`[SISTEMA] No se pudo parsear el mensaje: ${event.data}`);
            }
        };

        state.derivWs.onerror = (error) => {
            logDeriv("[ERROR WS] Ocurrió un error en la conexión de datos con Deriv.");
            console.error("Deriv WS Error: ", error);
        };

        state.derivWs.onclose = (closeEvent) => {
            resetDerivState();
            logDeriv(`[CONEXIÓN] Canal de Deriv cerrado. Código: ${closeEvent.code}. Razón: ${closeEvent.reason || 'Ninguna'}`);
        };

    } catch (wsErr) {
        logDeriv(`[ERROR SISTEMA] Falla al crear el WebSocket: ${wsErr.message}`);
        resetDerivState();
    }
}

function resetDerivState() {
    state.derivWs = null;
    state.derivConnected = false;
    state.derivCooldown = false;
    
    elements.btnConnectDeriv.innerText = "Conectar";
    elements.btnConnectDeriv.classList.remove('connected');
    
    elements.derivStatusBar.className = "deriv-status-bar offline";
    elements.derivStatusBar.innerText = "ESTADO: DESCONECTADO";
}

function executeDerivTrade(contractType) {
    if (!state.derivConnected) return;

    if (!elements.derivAutotrade.checked) {
        logDeriv(`[AUTO] Señal ${contractType} detectada, pero el Auto-Trading está DESACTIVADO.`);
        return;
    }

    if (state.derivCooldown) {
        logDeriv(`[AUTO] Señal ${contractType} ignorada debido a Cooldown activo.`);
        return;
    }

    const mappedSymbol = derivSymbolMap[state.symbol];
    if (!mappedSymbol) {
        logDeriv(`[CONFIG] ERROR: El activo '${state.symbol}' no tiene equivalente configurado en Deriv.`);
        return;
    }

    const stake = parseFloat(elements.derivStake.value);
    const duration = parseInt(elements.derivDuration.value);

    if (isNaN(stake) || stake < 0.35) {
        logDeriv(`[CONFIG] ERROR: Stake inválido (${stake}). El mínimo en Deriv es $0.35 USD.`);
        return;
    }

    if (isNaN(duration) || duration < 1 || duration > 15) {
        logDeriv(`[CONFIG] ERROR: Duración inválida (${duration}m). Debe ser de 1 a 15 minutos.`);
        return;
    }

    logDeriv(`[ORDEN] Enviando compra ${contractType} (${mappedSymbol})...`);
    logDeriv(`  ↳ Stake: $${stake} USD | Expiración: ${duration} minuto(s)`);

    const buyPayload = {
        "buy": 1,
        "price": stake,
        "parameters": {
            "amount": stake,
            "basis": "stake",
            "contract_type": contractType,
            "currency": "USD",
            "duration": duration,
            "duration_unit": "m",
            "symbol": mappedSymbol
        }
    };

    try {
        state.derivWs.send(JSON.stringify(buyPayload));
        
        state.derivCooldown = true;
        const cooldownMs = Math.max(65000, (duration * 60 + 5) * 1000);
        logDeriv(`[TRADING] Orden transmitida. Cooldown activado por ${Math.round(cooldownMs/1000)}s.`);

        setTimeout(() => {
            state.derivCooldown = false;
            logDeriv("[TRADING] Cooldown finalizado. Buscando nuevas señales de entrada...");
        }, cooldownMs);

    } catch (sendErr) {
        logDeriv(`[ERROR TRADING] Error al transmitir datos por el WebSocket: ${sendErr.message}`);
    }
}

// =====================================================================
// LIVE TICK STREAM — Real-time candle updates via Deriv WebSocket
// =====================================================================

function startTickStream() {
    if (!state.candleSeries || state.screener !== 'synthetic') return;

    // Close any existing tick stream
    stopTickStream();

    const symbol = state.symbol;
    const wsUrl = 'wss://ws.derivws.com/websockets/v3?app_id=1089';

    try {
        state.tickWs = new WebSocket(wsUrl);
        state.tickWsConnected = false;

        state.tickWs.onopen = () => {
            state.tickWsConnected = true;
            // Subscribe to ticks stream
            const req = {
                ticks: symbol,
                subscribe: 1
            };
            state.tickWs.send(JSON.stringify(req));
            console.log(`[TICK] Live stream started for ${symbol}`);
        };

        state.tickWs.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);

                if (msg.error) {
                    console.warn('[TICK] Error from Deriv:', msg.error.message);
                    return;
                }

                if (msg.msg_type === 'tick' && msg.tick) {
                    processTick(msg.tick);
                }
            } catch (e) {
                console.warn('[TICK] Parse error:', e);
            }
        };

        state.tickWs.onerror = (err) => {
            console.warn('[TICK] WebSocket error', err);
        };

        state.tickWs.onclose = () => {
            state.tickWsConnected = false;
            console.log('[TICK] Stream closed.');
        };

    } catch (e) {
        console.error('[TICK] Failed to start stream:', e);
    }
}

function stopTickStream() {
    if (state.tickWs) {
        try {
            // Unsubscribe before closing
            if (state.tickWsConnected) {
                state.tickWs.send(JSON.stringify({ forget_all: 'ticks' }));
            }
            state.tickWs.close();
        } catch (e) {}
        state.tickWs = null;
        state.tickWsConnected = false;
    }
}

function processTick(tick) {
    if (!state.candleSeries) return;

    const price = parseFloat(tick.quote);
    const tickTime = tick.epoch; // Unix timestamp in seconds
    const intervalSecs = state.intervalSecs || 60;

    // Calculate the open time of the current candle (aligned to interval)
    const candleOpenTime = Math.floor(tickTime / intervalSecs) * intervalSecs;

    // If there's no current candle or tick belongs to a new candle period
    if (!state.currentCandle || state.currentCandle.time !== candleOpenTime) {
        // Start a new candle
        state.currentCandle = {
            time: candleOpenTime,
            open: price,
            high: price,
            low: price,
            close: price
        };
    } else {
        // Update existing candle
        state.currentCandle.close = price;
        if (price > state.currentCandle.high) state.currentCandle.high = price;
        if (price < state.currentCandle.low) state.currentCandle.low = price;
    }

    // Update chart with live candle
    try {
        state.candleSeries.update(state.currentCandle);
    } catch (e) {
        // Chart might not be ready yet
    }

    // Update entry price display live
    if (state.signalOverlay) {
        const liveOverlay = { ...state.signalOverlay, entry_price: price };
        if (elements.entryPriceVal) {
            elements.entryPriceVal.textContent = price.toFixed(
                price > 100 ? 3 : 5
            );
        }
    }
}

// =====================================================================
// ENTRY SIGNAL PANEL ENGINE
// =====================================================================

function initEntryPanel() {
    // Handle expiry timeframe button clicks
    elements.entryTfButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            elements.entryTfButtons.forEach(b => {
                b.classList.remove('active', 'active-call', 'active-put');
            });
            btn.classList.add('active');
            state.selectedExpiry = parseInt(btn.getAttribute('data-etf'));
            // Re-apply color based on direction
            if (state.signalOverlay) {
                if (state.signalOverlay.is_call) btn.classList.add('active-call');
                else if (state.signalOverlay.is_put) btn.classList.add('active-put');
                updateEntryTargets(state.signalOverlay);
            }
        });
    });

    // Start candle countdown
    startCandleCountdown();
}

function updateEntryPanel(overlay) {
    const card = elements.entrySignalPanel;
    const isCall = overlay.is_call;
    const isPut = overlay.is_put;

    // Update card theme
    card.classList.remove('signal-call', 'signal-put');
    if (isCall) card.classList.add('signal-call');
    else if (isPut) card.classList.add('signal-put');

    // Badge
    elements.entryBadge.className = 'entry-signal-badge';
    if (isCall) {
        elements.entryBadge.className = 'entry-signal-badge badge-call';
        elements.entryBadge.textContent = '▲ CALL — COMPRAR';
    } else if (isPut) {
        elements.entryBadge.className = 'entry-signal-badge badge-put';
        elements.entryBadge.textContent = '▼ PUT — VENDER';
    } else {
        elements.entryBadge.textContent = 'EN ESPERA';
    }

    // Entry price
    elements.entryPriceVal.textContent = overlay.entry_price.toFixed(5);

    // ATR
    elements.entryAtrVal.textContent = overlay.atr.toFixed(5);

    // Direction icon and label
    elements.entryDirIcon.className = 'entry-dir-icon';
    elements.entryDirLabel.className = 'entry-dir-label';
    if (isCall) {
        elements.entryDirIcon.innerHTML = '<i class="fa-solid fa-arrow-trend-up"></i>';
        elements.entryDirIcon.classList.add('call');
        elements.entryDirLabel.textContent = 'CALL ▲';
        elements.entryDirLabel.classList.add('call');
    } else if (isPut) {
        elements.entryDirIcon.innerHTML = '<i class="fa-solid fa-arrow-trend-down"></i>';
        elements.entryDirIcon.classList.add('put');
        elements.entryDirLabel.textContent = 'PUT ▼';
        elements.entryDirLabel.classList.add('put');
    } else {
        elements.entryDirIcon.innerHTML = '<i class="fa-solid fa-minus"></i>';
        elements.entryDirLabel.textContent = 'NEUTRAL';
    }

    // Update ETF button colors based on direction
    elements.entryTfButtons.forEach(btn => {
        if (btn.classList.contains('active')) {
            btn.classList.remove('active-call', 'active-put');
            if (isCall) btn.classList.add('active-call');
            else if (isPut) btn.classList.add('active-put');
        }
    });

    // Update targets for selected expiry
    updateEntryTargets(overlay);
}

function updateEntryTargets(overlay) {
    const tf = state.selectedExpiry;
    const targets = overlay.targets;
    const tfData = targets[String(tf)];
    if (!tfData) return;

    const entryPrice = overlay.entry_price;
    const tp = tfData.target;
    const sl = tfData.stop_loss;
    const movement = tfData.movement_pips;
    const movPct = tfData.movement_pct;

    elements.entryTpVal.textContent = tp.toFixed(5);
    elements.entrySlVal.textContent = sl.toFixed(5);

    const tpDiff = ((tp - entryPrice) / entryPrice * 100);
    const slDiff = ((sl - entryPrice) / entryPrice * 100);

    elements.entryTpPct.textContent = (tpDiff >= 0 ? '+' : '') + tpDiff.toFixed(4) + '%';
    elements.entrySlPct.textContent = (slDiff >= 0 ? '+' : '') + slDiff.toFixed(4) + '%';

    // Movement bar — max movement is 5 ATR → 100%
    const maxMov = overlay.atr * 5;
    const movPct2 = Math.min((movement / maxMov) * 100, 100);
    elements.movementBar.style.width = `${movPct2}%`;
    elements.movementBar.style.background = overlay.is_call ? 'var(--neon-green)' : (overlay.is_put ? 'var(--neon-red)' : 'var(--neon-cyan)');
    elements.movementPips.textContent = `${overlay.is_call ? '+' : overlay.is_put ? '-' : '±'} ${movement.toFixed(5)}`;
    elements.movementPips.style.color = overlay.is_call ? 'var(--neon-green)' : (overlay.is_put ? 'var(--neon-red)' : 'var(--neon-cyan)');

    // Update movement-tf label
    elements.movementTf.textContent = tf;
}

// Candle countdown timer (time until next candle closes)
function startCandleCountdown() {
    if (state.countdownIntervalId) clearInterval(state.countdownIntervalId);

    state.countdownIntervalId = setInterval(() => {
        const intervalMinutes = parseInt(state.interval) || 1;
        const now = Math.floor(Date.now() / 1000); // current Unix time

        // Candles close every `intervalMinutes` minutes aligned to epoch
        const intervalSecs = intervalMinutes * 60;
        const secondsIntoCandle = now % intervalSecs;
        const secondsLeft = intervalSecs - secondsIntoCandle;

        const mins = Math.floor(secondsLeft / 60);
        const secs = secondsLeft % 60;
        const timerStr = `${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`;
        elements.entryCountdown.textContent = timerStr;

        // Urgent: last 5 seconds of candle
        if (secondsLeft <= 5) {
            elements.entryCountdown.classList.add('urgent');
            elements.entryTimingHint.textContent = '⚡ VELA CERRANDO — PREPARA LA ORDEN AHORA';
        } else if (secondsLeft <= 15) {
            elements.entryCountdown.classList.remove('urgent');
            elements.entryTimingHint.textContent = '⏳ Casi cierre — posiciónate para la entrada';
        } else if (secondsLeft > intervalSecs - 5) {
            elements.entryCountdown.classList.remove('urgent');
            elements.entryTimingHint.textContent = '✅ VELA NUEVA — MOMENTO ÓPTIMO PARA ENTRAR';
        } else {
            elements.entryCountdown.classList.remove('urgent');
            elements.entryTimingHint.textContent = 'Espera el cierre de vela para confirmar entrada';
        }
    }, 1000);
}

// Draw signal markers and TP/SL lines on Lightweight Charts
function drawChartSignalOverlay(overlay, candles) {
    if (!state.candleSeries || !state.lightweightChart) return;

    const lastCandle = candles[candles.length - 1];
    if (!lastCandle) return;

    const entryTime = lastCandle.time;
    const entryPrice = overlay.entry_price;
    const isCall = overlay.is_call;
    const isPut = overlay.is_put;

    if (!isCall && !isPut) {
        // Remove old markers and lines if neutral
        try { state.candleSeries.setMarkers([]); } catch(e) {}
        return;
    }

    // === MARKER: Entry arrow on last candle ===
    const markerShape = isCall ? 'arrowUp' : 'arrowDown';
    const markerPos = isCall ? 'belowBar' : 'aboveBar';
    const markerColor = isCall ? '#39ff14' : '#ff3131';
    const markerText = isCall ? '▲ CALL' : '▼ PUT';

    const markers = [{
        time: entryTime,
        position: markerPos,
        color: markerColor,
        shape: markerShape,
        text: markerText,
        size: 2
    }];

    try {
        state.candleSeries.setMarkers(markers);
    } catch(e) {
        console.warn('Chart marker error:', e);
    }

    // === PRICE LINES: TP and SL for selected timeframe ===
    const tf = state.selectedExpiry;
    const tfData = overlay.targets[String(tf)];
    if (!tfData) return;

    // Remove old price lines
    if (state.tpLine) {
        try { state.candleSeries.removePriceLine(state.tpLine); } catch(e) {}
        state.tpLine = null;
    }
    if (state.slLine) {
        try { state.candleSeries.removePriceLine(state.slLine); } catch(e) {}
        state.slLine = null;
    }

    // TP line
    try {
        state.tpLine = state.candleSeries.createPriceLine({
            price: tfData.target,
            color: isCall ? '#39ff14' : '#ff3131',
            lineWidth: 1,
            lineStyle: 2, // dashed
            axisLabelVisible: true,
            title: `TP ${tf}m: ${tfData.target.toFixed(5)}`
        });
    } catch(e) {
        console.warn('TP price line error:', e);
    }

    // SL line
    try {
        state.slLine = state.candleSeries.createPriceLine({
            price: tfData.stop_loss,
            color: isCall ? '#ff3131' : '#39ff14',
            lineWidth: 1,
            lineStyle: 2, // dashed
            axisLabelVisible: true,
            title: `SL: ${tfData.stop_loss.toFixed(5)}`
        });
    } catch(e) {
        console.warn('SL price line error:', e);
    }

    // Entry price line
    try {
        const existingEntryLine = state.candleSeries.createPriceLine({
            price: entryPrice,
            color: '#00f3ff',
            lineWidth: 2,
            lineStyle: 0, // solid
            axisLabelVisible: true,
            title: `Entrada: ${entryPrice.toFixed(5)}`
        });
        // Store so we can remove it later
        if (!state.entryMarker) state.entryMarker = existingEntryLine;
    } catch(e) {
        console.warn('Entry price line error:', e);
    }
}

// Update chart badges based on SMC zones
function updateChartBadges(smc) {
    if (!elements.chartBadges) return;
    let html = '';
    if (smc.in_bullish_ob || smc.in_bearish_ob) html += `<span class="chart-zone-badge badge-ob"><i class="fa-solid fa-cubes"></i> OB</span>`;
    if (smc.in_bullish_fvg || smc.in_bearish_fvg) html += `<span class="chart-zone-badge badge-fvg"><i class="fa-solid fa-arrows-left-right"></i> FVG</span>`;
    if (smc.in_support) html += `<span class="chart-zone-badge badge-sup">↑ SOPORTE</span>`;
    if (smc.in_resistance) html += `<span class="chart-zone-badge badge-res">↓ RESISTENCIA</span>`;
    if (smc.breakout_active) html += `<span class="chart-zone-badge badge-brk"><i class="fa-solid fa-bolt"></i> ROMPIMIENTO</span>`;
    elements.chartBadges.innerHTML = html;
}
