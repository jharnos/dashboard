/* ── Gridstack init ──────────────────────────────── */
const grid = GridStack.init({
  cellHeight: 70,
  margin: 0,
  animate: true,
  float: true,
  staticGrid: true,
  resizable: { handles: 'se,sw,ne,nw,e,w,n,s' },
});

/* ── Layout persistence ──────────────────────────── */
const LAYOUT_KEY = 'dashboard_layout_v2';

function saveLayout() {
  try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(grid.save())); } catch (_) {}
}
function restoreLayout() {
  try {
    const saved = localStorage.getItem(LAYOUT_KEY);
    if (saved) grid.load(JSON.parse(saved));
  } catch (_) {}
}
grid.on('change dragstop resizestop', saveLayout);
restoreLayout();

/* ── Theme helpers (applied after overlay is wired) ─ */
const btnTheme = document.getElementById('btn-theme');

function getChartTheme() {
  const light = document.documentElement.dataset.theme === 'light';
  return {
    tickColor:      light ? '#888899' : '#44445a',
    gridColor:      light ? 'rgba(0,0,0,0.06)'   : 'rgba(255,255,255,0.04)',
    borderColor:    light ? 'rgba(0,0,0,0.10)'   : 'rgba(255,255,255,0.08)',
    tooltipBg:      light ? '#ffffff'             : '#1a1a28',
    tooltipBorder:  light ? '#ddddee'             : '#333345',
    tooltipTitle:   light ? '#666677'             : '#888',
    tooltipBody:    light ? '#333344'             : '#ccc',
  };
}

/* ── Lock / unlock toggle ────────────────────────── */
const btnLock = document.getElementById('btn-lock');
let locked = true;
btnLock.addEventListener('click', () => {
  locked = !locked;
  grid.setStatic(locked);
  btnLock.textContent = locked ? 'UNLOCK' : 'LOCK';
  btnLock.classList.toggle('locked', locked);
});

/* ── Clock ───────────────────────────────────────── */
function tickClock() {
  document.getElementById('clock').textContent =
    new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
setInterval(tickClock, 1000);
tickClock();

/* ── GCP color helpers ───────────────────────────── */
const GCP_SCALE = [
  [0.01,   '#FF1E1E', 'Striking'],
  [0.05,   '#FFB82E', 'Very Strong'],
  [0.08,   '#FFD517', 'Strong'],
  [0.15,   '#FFFA40', 'Significant'],
  [0.23,   '#F9FA00', 'Elevated'],
  [0.30,   '#AEFA00', 'Notable'],
  [0.40,   '#64FA64', 'Interesting'],
  [0.90,   '#64FA64', 'Normal'],
  [0.9125, '#64FAAB', 'Slightly Random'],
  [0.93,   '#ACF2FF', 'Random'],
  [0.96,   '#0EEEFF', 'More Random'],
  [0.98,   '#24CBFD', 'Very Random'],
  [1.01,   '#5655CA', 'Dispersed'],
];

function scaleToColor(s) {
  for (const [upper, color] of GCP_SCALE) {
    if (s < upper) return color;
  }
  return '#5655CA';
}

function scaleToLabel(s) {
  for (const [upper,, label] of GCP_SCALE) {
    if (s < upper) return label;
  }
  return 'Dispersed';
}

/* ── Chart state (declared early for theme toggle) ── */
let gcpChart       = null;
let gcpMiniChart   = null;
let kpChart        = null;
let _lastGcpHistory = [];
let _lastKpHistory  = [];

/* ── GCP overlay open / close ────────────────────── */
const overlay    = document.getElementById('gcp-overlay');
const moduleCard = document.getElementById('gcp-module-card');

/* ── Theme toggle ────────────────────────────────── */
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  btnTheme.textContent = theme === 'light' ? 'DARK' : 'LIGHT';
  if (gcpChart)  { gcpChart.destroy();  gcpChart  = null; }
  if (kpChart)   { kpChart.destroy();   kpChart   = null; }
  if (_lastGcpHistory.length && overlay.classList.contains('open')) renderChart(_lastGcpHistory);
  if (_lastKpHistory.length) renderKpChart(_lastKpHistory);
}
applyTheme(localStorage.getItem('dashboard_theme') || 'dark');
btnTheme.addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  localStorage.setItem('dashboard_theme', next);
  applyTheme(next);
});

function openOverlay() {
  overlay.classList.add('open');
  overlay.setAttribute('aria-hidden', 'false');
  // Render chart now that the canvas is visible
  if (_lastGcpHistory.length) renderChart(_lastGcpHistory);
}

function closeOverlay() {
  overlay.classList.remove('open');
  overlay.setAttribute('aria-hidden', 'true');
}

// Open on module click (but not when the user is dragging)
let _dragStarted = false;
moduleCard.addEventListener('mousedown', () => { _dragStarted = false; });
moduleCard.addEventListener('mousemove', () => { _dragStarted = true; });
moduleCard.addEventListener('click', () => {
  if (!_dragStarted) openOverlay();
});

// Close on backdrop click or × button
overlay.addEventListener('click', e => { if (e.target === overlay) closeOverlay(); });
document.getElementById('gcp-overlay-close').addEventListener('click', closeOverlay);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeOverlay(); });

/* ── GCP history chart ───────────────────────────── */
const gcpBandsPlugin = {
  id: 'gcpBands',
  beforeDraw(chart) {
    const { ctx, chartArea: { top, left, right }, scales: { y } } = chart;
    [
      [0,    0.05,  'rgba(255, 30,  30,  0.07)'],
      [0.05, 0.15,  'rgba(255,184,  46,  0.06)'],
      [0.15, 0.40,  'rgba(255,250,  64,  0.04)'],
      [0.40, 0.90,  'rgba(100,250, 100,  0.04)'],
      [0.90, 1.0,   'rgba( 86, 85, 202,  0.07)'],
    ].forEach(([from, to, color]) => {
      ctx.fillStyle = color;
      ctx.fillRect(left, y.getPixelForValue(from), right - left,
                   y.getPixelForValue(to) - y.getPixelForValue(from));
    });
  },
};

function renderChart(history) {
  const n = history.length;
  const labels = history.map((_, i) => {
    const m = Math.round((n - 1 - i) * 120 / (n - 1));
    if (m === 0) return 'now';
    if (m % 30 === 0) return `-${m}m`;
    return '';
  });

  const pts = history.filter(v => v !== null).length;
  const winEl = document.getElementById('ov-hist-window');
  if (winEl) winEl.textContent = `~2h  ·  ${pts} readings`;

  const chartData = {
    labels,
    datasets: [{
      data: history,
      borderWidth: 1.5,
      pointRadius: 0,
      spanGaps: true,
      tension: 0.3,
      fill: false,
      segment: {
        borderColor: ctx => {
          const v = ctx.p0.parsed.y;
          return v == null ? 'transparent' : scaleToColor(v);
        },
      },
    }],
  };

  if (gcpChart) {
    gcpChart.data = chartData;
    gcpChart.update('none');
    return;
  }

  const t = getChartTheme();
  gcpChart = new Chart(document.getElementById('gcp-chart'), {
    type: 'line',
    data: chartData,
    plugins: [gcpBandsPlugin],
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      layout: { padding: { top: 4, right: 8, bottom: 0, left: 4 } },
      scales: {
        y: {
          reverse: true,
          min: 0, max: 1,
          grid:   { color: t.gridColor },
          border: { color: t.borderColor },
          ticks: {
            color: t.tickColor,
            font: { size: 9 },
            maxTicksLimit: 6,
            callback: v => ({ 0: 'Striking', 0.1: 'Strong', 0.4: 'Normal', 0.9: 'Random', 1: 'Dispersed' }[v] ?? ''),
          },
        },
        x: {
          grid: { display: false },
          border: { color: t.borderColor },
          ticks: {
            color: t.tickColor,
            font: { size: 9 },
            maxRotation: 0,
            autoSkip: false,
            callback: (_, i) => labels[i] || '',
          },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: t.tooltipBg,
          borderColor: t.tooltipBorder,
          borderWidth: 1,
          titleColor: t.tooltipTitle,
          bodyColor: t.tooltipBody,
          padding: 8,
          callbacks: {
            title: items => {
              const m = Math.round((n - 1 - items[0].dataIndex) * 120 / (n - 1));
              return m === 0 ? 'Now' : `~${m} min ago`;
            },
            label: item => {
              const v = item.parsed.y;
              return v == null ? 'No data' : `${scaleToLabel(v)}  (${v.toFixed(3)})`;
            },
          },
        },
      },
    },
  });
}

/* ── GCP mini chart (inline module) ─────────────── */
function renderMiniChart(history) {
  const chartData = {
    labels: history.map(() => ''),
    datasets: [{
      data: history,
      borderWidth: 1.5,
      pointRadius: 0,
      spanGaps: true,
      tension: 0.3,
      fill: false,
      segment: {
        borderColor: ctx => {
          const v = ctx.p0.parsed.y;
          return v == null ? 'transparent' : scaleToColor(v);
        },
      },
    }],
  };

  if (gcpMiniChart) {
    gcpMiniChart.data = chartData;
    gcpMiniChart.update('none');
    return;
  }

  gcpMiniChart = new Chart(document.getElementById('gcp-mini-chart'), {
    type: 'line',
    data: chartData,
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      layout: { padding: { top: 2, right: 2, bottom: 2, left: 2 } },
      scales: {
        x: { display: false },
        y: { display: false, reverse: true, min: 0, max: 1 },
      },
      plugins: {
        legend: { display: false },
        tooltip: { enabled: false },
      },
    },
  });
}

/* ── GCP Dot ─────────────────────────────────────── */
async function refreshGCP() {
  try {
    const res  = await fetch('/api/gcp');
    const data = await res.json();

    // ── compact module dot
    signalLive();
    const dot    = document.getElementById('gcp-dot');
    dot.style.background = data.color;
    dot.style.boxShadow  = `0 0 60px ${data.color}55, 0 0 120px ${data.color}22`;
    document.getElementById('gcp-status').textContent = data.status ?? '—';
    document.getElementById('gcp-value').textContent  =
      data.value != null ? `INDEX  ${data.value}` : '';

    // ── overlay dot + text
    const ovDot = document.getElementById('ov-dot');
    ovDot.style.background = data.color;
    ovDot.style.boxShadow  = `0 0 50px ${data.color}55, 0 0 100px ${data.color}22`;
    document.getElementById('ov-status').textContent   = data.status ?? '—';
    document.getElementById('ov-value').textContent    =
      data.value != null ? `INDEX  ${data.value}` : '';
    document.getElementById('ov-subtitle').textContent = data.status ?? '';

    // ── legend highlight (in overlay)
    document.querySelectorAll('.legend-item').forEach(el => {
      el.classList.toggle('active', el.dataset.statuses.split(',').includes(data.status));
    });

    // ── cache history; render mini chart always, overlay chart only when open
    if (data.history && data.history.length) {
      _lastGcpHistory = data.history;
      renderMiniChart(_lastGcpHistory);
      if (overlay.classList.contains('open')) renderChart(_lastGcpHistory);
    }
  } catch (_) {
    document.getElementById('gcp-status').textContent = 'Error';
  }
}

/* ── S&P 500 ─────────────────────────────────────── */
async function refreshSP500() {
  const priceEl  = document.getElementById('sp-price');
  const changeEl = document.getElementById('sp-change');
  const timeEl   = document.getElementById('sp-time');
  try {
    const res  = await fetch('/api/sp500');
    const data = await res.json();
    if (data.error) {
      priceEl.textContent = 'ERR'; changeEl.textContent = data.error;
      changeEl.className  = 'sp-change flat'; return;
    }
    priceEl.textContent = data.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const sign = data.change >= 0 ? '+' : '';
    changeEl.textContent = `${sign}${data.change.toFixed(2)}  (${sign}${data.change_pct.toFixed(2)}%)`;
    changeEl.className   = 'sp-change ' + (data.change > 0 ? 'up' : data.change < 0 ? 'down' : 'flat');
    timeEl.textContent   = `AS OF  ${data.timestamp}`;
    signalLive();
  } catch (_) { priceEl.textContent = 'ERR'; }
}

/* ── Moon Phase ──────────────────────────────────── */
function drawMoon(canvas, phase) {
  const ctx = canvas.getContext('2d');
  const size = canvas.width;
  const r = size / 2 - 3, cx = size / 2, cy = size / 2;
  const DARK = '#12121c', LIGHT = '#fdf5c8';
  ctx.clearRect(0, 0, size, size);
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = DARK; ctx.fill();
  if (phase > 0.01 && phase < 0.99) {
    const waxing = phase < 0.5;
    const termRx = Math.abs(Math.cos(phase * Math.PI * 2)) * r;
    const innerCCW = phase > 0.25 && phase < 0.75;
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
    ctx.beginPath();
    if (waxing) {
      ctx.arc(cx, cy, r, -Math.PI / 2, Math.PI / 2, false);
      ctx.ellipse(cx, cy, termRx < 0.5 ? 0.5 : termRx, r, 0, Math.PI / 2, -Math.PI / 2, innerCCW);
    } else {
      ctx.arc(cx, cy, r, -Math.PI / 2, Math.PI / 2, true);
      ctx.ellipse(cx, cy, termRx < 0.5 ? 0.5 : termRx, r, 0, Math.PI / 2, -Math.PI / 2, !innerCCW);
    }
    ctx.closePath(); ctx.fillStyle = LIGHT; ctx.fill(); ctx.restore();
  } else if (phase >= 0.99) {
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = LIGHT; ctx.fill();
  }
  ctx.beginPath(); ctx.arc(cx, cy, r + 1, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(253,245,200,0.08)'; ctx.lineWidth = 2; ctx.stroke();
}

async function refreshMoon() {
  try {
    const res  = await fetch('/api/moon');
    const data = await res.json();
    signalLive();
    drawMoon(document.getElementById('moon-canvas'), data.phase);
    document.getElementById('moon-name').textContent  = data.name;
    document.getElementById('moon-illum').textContent = `${data.illumination}% illuminated`;
    const toFull = data.next_full_days < 1 ? 'Full moon today' : `Full in ${data.next_full_days}d`;
    const toNew  = data.next_new_days  < 1 ? 'New moon today'  : `New in ${data.next_new_days}d`;
    document.getElementById('moon-next').innerHTML = `${toFull}<br>${toNew}`;
  } catch (_) { document.getElementById('moon-name').textContent = 'Error'; }
}

/* ── Kp Index ────────────────────────────────────── */
function kpToColor(kp) {
  if (kp < 1)  return '#00cc88';
  if (kp < 2)  return '#00bb77';
  if (kp < 3)  return '#44aa44';
  if (kp < 4)  return '#aacc00';
  if (kp < 5)  return '#ffcc00';
  if (kp < 6)  return '#ff8800';
  if (kp < 7)  return '#ff4400';
  if (kp < 8)  return '#ee1111';
  if (kp < 9)  return '#cc0099';
  return '#9900cc';
}

function kpToLabel(kp) {
  if (kp < 4)  return 'Quiet';
  if (kp < 5)  return 'Active';
  if (kp < 6)  return 'G1 Minor';
  if (kp < 7)  return 'G2 Moderate';
  if (kp < 8)  return 'G3 Strong';
  if (kp < 9)  return 'G4 Severe';
  return 'G5 Extreme';
}

const kpBandsPlugin = {
  id: 'kpBands',
  beforeDraw(chart) {
    const { ctx, chartArea: { left, right, bottom }, scales: { y } } = chart;
    [
      [0, 4, 'rgba(  0,204,136, 0.05)'],
      [4, 5, 'rgba(255,204,  0, 0.07)'],
      [5, 6, 'rgba(255,136,  0, 0.07)'],
      [6, 7, 'rgba(255, 68,  0, 0.07)'],
      [7, 9, 'rgba(238, 17, 17, 0.07)'],
    ].forEach(([from, to, color]) => {
      const top = y.getPixelForValue(to);
      const bot = Math.min(y.getPixelForValue(from), bottom);
      ctx.fillStyle = color;
      ctx.fillRect(left, top, right - left, bot - top);
    });
  },
};

function renderKpChart(history) {
  const labels = history.map(d => {
    const dt = new Date(d.time.replace(' ', 'T') + 'Z');
    const day = dt.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
    const hr  = dt.getUTCHours().toString().padStart(2, '0');
    return `${day} ${hr}`;
  });
  const values  = history.map(d => d.kp);
  const bgColors = values.map(v => kpToColor(v) + 'bb');
  const bdColors = values.map(v => kpToColor(v));

  const chartData = {
    labels,
    datasets: [{
      data: values,
      backgroundColor: bgColors,
      borderColor: bdColors,
      borderWidth: 1,
      borderRadius: 2,
    }],
  };

  if (kpChart) {
    kpChart.data = chartData;
    kpChart.update('none');
    return;
  }

  const t = getChartTheme();
  kpChart = new Chart(document.getElementById('kp-chart'), {
    type: 'bar',
    data: chartData,
    plugins: [kpBandsPlugin],
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      layout: { padding: { top: 4, right: 8, bottom: 0, left: 4 } },
      scales: {
        y: {
          min: 0, max: 9,
          grid:   { color: t.gridColor },
          border: { color: t.borderColor },
          ticks: {
            color: t.tickColor,
            font: { size: 9 },
            stepSize: 1,
            callback: v => ({ 0:'0', 3:'3', 5:'G1', 6:'G2', 7:'G3', 8:'G4', 9:'G5' }[v] ?? ''),
          },
        },
        x: {
          grid: { display: false },
          border: { color: t.borderColor },
          ticks: {
            color: t.tickColor,
            font: { size: 9 },
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 8,
          },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: t.tooltipBg,
          borderColor: t.tooltipBorder,
          borderWidth: 1,
          titleColor: t.tooltipTitle,
          bodyColor: t.tooltipBody,
          padding: 8,
          callbacks: {
            title: items => {
              const d = history[items[0].dataIndex];
              const dt = new Date(d.time.replace(' ', 'T') + 'Z');
              return dt.toLocaleString('en-US', {
                weekday: 'short', month: 'short', day: 'numeric',
                hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC',
              }) + ' UTC';
            },
            label: item => `Kp ${item.parsed.y.toFixed(2)}  —  ${kpToLabel(item.parsed.y)}`,
          },
        },
      },
    },
  });
}

async function refreshKP() {
  try {
    const res  = await fetch('/api/kp');
    const data = await res.json();
    const valEl    = document.getElementById('kp-value');
    const statusEl = document.getElementById('kp-status');
    const timeEl   = document.getElementById('kp-time');
    if (data.error && !data.value) {
      valEl.textContent    = 'ERR';
      statusEl.textContent = data.status ?? 'Unavailable';
      return;
    }
    signalLive();
    valEl.textContent    = data.value != null ? data.value.toFixed(1) : '—';
    statusEl.textContent = data.status ?? '';
    statusEl.style.color = data.color  ?? 'var(--muted)';
    if (timeEl && data.history && data.history.length) {
      const last = data.history[data.history.length - 1];
      const dt   = new Date(last.time.replace(' ', 'T') + 'Z');
      timeEl.textContent = 'AS OF  ' + dt.toLocaleTimeString('en-US', {
        hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC',
      }) + ' UTC';
    }
    if (data.history && data.history.length) {
      _lastKpHistory = data.history;
      renderKpChart(_lastKpHistory);
    }
  } catch (_) {
    document.getElementById('kp-value').textContent = 'ERR';
  }
}

/* ── Live indicator ──────────────────────────────── */
const liveDot = document.getElementById('live-dot');
function signalLive() {
  liveDot.classList.remove('pulse');
  void liveDot.offsetWidth;
  liveDot.classList.add('pulse');
}

/* ── Initial load + staggered refresh ───────────── */
function refreshAll() { refreshGCP(); refreshSP500(); refreshMoon(); refreshKP(); }
refreshAll();

setInterval(refreshGCP,   30_000);   // graphy.png updates every ~2 min
setInterval(refreshSP500, 30_000);   // fast_info gives near-live quotes
setInterval(refreshMoon,  300_000);  // changes over hours
setInterval(refreshKP,    300_000);  // NOAA updates every 3 hours
