from flask import Flask, jsonify, render_template
import requests
from PIL import Image
import yfinance as yf
from datetime import datetime, timezone
import io
import math

app = Flask(__name__)

# ── GCP color scale ───────────────────────────────────────────────────────────
# Sourced directly from gcpdot.js (global-mind.org).
# scale=0 → most coherent (red/striking); scale=1 → most random (deep blue).
# Each entry: (upper_bound, hex_color, label)
_GCP_SCALE = [
    (0.01,   '#FF1E1E', 'Striking'),
    (0.05,   '#FFB82E', 'Very Strong'),
    (0.08,   '#FFD517', 'Strong'),
    (0.15,   '#FFFA40', 'Significant'),
    (0.23,   '#F9FA00', 'Elevated'),
    (0.30,   '#AEFA00', 'Notable'),
    (0.40,   '#64FA64', 'Interesting'),
    (0.90,   '#64FA64', 'Normal'),
    (0.9125, '#64FAAB', 'Slightly Random'),
    (0.93,   '#ACF2FF', 'Random'),
    (0.96,   '#0EEEFF', 'More Random'),
    (0.98,   '#24CBFD', 'Very Random'),
    (1.01,   '#5655CA', 'Dispersed'),
]

def _scale_to_dot(scale: float):
    """Map a GCP scale value (0–1) to (hex_color, label)."""
    for upper, color, label in _GCP_SCALE:
        if scale < upper:
            return color, label
    return '#5655CA', 'Dispersed'


def fetch_gcp() -> dict:
    """
    Downloads graphy.png from global-mind.org and reads every pixel column.
    Each column = one time slice; Y position encodes the GCP scale value
    (y=0 → scale=0 → Striking; y=h-1 → scale=1 → Dispersed).
    Returns the current (rightmost) value plus the full ~2-hour history array.
    """
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://global-mind.org/gcpdot/',
    }
    try:
        r = requests.get(
            'https://global-mind.org/gcpdot/assets/graphy.png',
            headers=headers, timeout=10
        )
        r.raise_for_status()
        img = Image.open(io.BytesIO(r.content)).convert('RGB')
        w, h = img.size
        pixels = img.load()

        history = []
        for x in range(w):
            ys = [y for y in range(h) if max(pixels[x, y]) > 40]
            if ys:
                median_y = sorted(ys)[len(ys) // 2]
                history.append(round(median_y / (h - 1), 4))
            else:
                history.append(None)

        # Current value = rightmost non-null entry
        current = next((v for v in reversed(history) if v is not None), None)
        if current is None:
            raise ValueError('No chart data found in image')

        color, label = _scale_to_dot(current)
        return {
            'value':   current,
            'color':   color,
            'status':  label,
            'history': history,   # list of ~300 scale floats (None = no data)
        }

    except Exception as e:
        return {'value': None, 'color': '#444455', 'status': 'Unavailable',
                'error': str(e), 'history': []}


def _kp_to_info(kp: float):
    if kp < 1:  return '#00cc88', 'Quiet'
    if kp < 2:  return '#00bb77', 'Quiet'
    if kp < 3:  return '#44aa44', 'Quiet'
    if kp < 4:  return '#aacc00', 'Unsettled'
    if kp < 5:  return '#ffcc00', 'Active'
    if kp < 6:  return '#ff8800', 'G1 Minor'
    if kp < 7:  return '#ff4400', 'G2 Moderate'
    if kp < 8:  return '#ee1111', 'G3 Strong'
    if kp < 9:  return '#cc0099', 'G4 Severe'
    return '#9900cc', 'G5 Extreme'


def fetch_kp() -> dict:
    """Fetches 3-hour planetary Kp index from NOAA SWPC (last 3 days)."""
    try:
        r = requests.get(
            'https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json',
            timeout=10,
        )
        r.raise_for_status()
        rows = r.json()  # array of objects: {time_tag, Kp, ...}
        history = []
        for row in rows[-24:]:  # last 24 entries ≈ 3 days
            try:
                kp_val = float(row['Kp'])
                if 0 <= kp_val <= 9:
                    history.append({'time': row['time_tag'], 'kp': round(kp_val, 2)})
            except (ValueError, TypeError, KeyError):
                pass
        if not history:
            raise ValueError('No valid Kp data')
        current = history[-1]['kp']
        color, label = _kp_to_info(current)
        return {'value': current, 'color': color, 'status': label, 'history': history}
    except Exception as e:
        return {'value': None, 'color': '#444455', 'status': 'Unavailable',
                'error': str(e), 'history': []}


def fetch_sp500() -> dict:
    try:
        ticker = yf.Ticker('^GSPC')
        fi = ticker.fast_info
        current = float(fi.last_price)
        prev    = float(fi.previous_close)
        change  = current - prev
        pct     = (change / prev) * 100 if prev else 0.0
        return {
            'price':      round(current, 2),
            'change':     round(change,  2),
            'change_pct': round(pct,     2),
            'timestamp':  datetime.now().strftime('%H:%M:%S'),
        }
    except Exception:
        # fallback to daily history
        try:
            ticker = yf.Ticker('^GSPC')
            hist = ticker.history(period='5d')
            if hist.empty:
                return {'error': 'No data returned'}
            current = float(hist['Close'].iloc[-1])
            prev    = float(hist['Close'].iloc[-2]) if len(hist) > 1 else current
            change  = current - prev
            pct     = (change / prev) * 100 if prev else 0.0
            return {
                'price':      round(current, 2),
                'change':     round(change,  2),
                'change_pct': round(pct,     2),
                'timestamp':  datetime.now().strftime('%H:%M:%S'),
            }
        except Exception as e:
            return {'error': str(e)}


def fetch_moon() -> dict:
    # Known new moon: Jan 6, 2000 18:14 UTC (J2000 epoch reference)
    KNOWN_NEW_MOON = datetime(2000, 1, 6, 18, 14, tzinfo=timezone.utc)
    LUNAR_CYCLE = 29.53058867  # days

    now = datetime.now(timezone.utc)
    age_days = (now - KNOWN_NEW_MOON).total_seconds() / 86400
    phase = (age_days % LUNAR_CYCLE) / LUNAR_CYCLE  # 0=new, 0.5=full, 1=new

    illumination = round((1 - math.cos(phase * 2 * math.pi)) / 2 * 100, 1)
    age = round(age_days % LUNAR_CYCLE, 2)

    if phase < 0.0625 or phase >= 0.9375:
        name = 'New Moon'
    elif phase < 0.1875:
        name = 'Waxing Crescent'
    elif phase < 0.3125:
        name = 'First Quarter'
    elif phase < 0.4375:
        name = 'Waxing Gibbous'
    elif phase < 0.5625:
        name = 'Full Moon'
    elif phase < 0.6875:
        name = 'Waning Gibbous'
    elif phase < 0.8125:
        name = 'Last Quarter'
    else:
        name = 'Waning Crescent'

    days_to_full = ((0.5 - phase) % 1.0) * LUNAR_CYCLE
    days_to_new  = ((1.0 - phase) % 1.0) * LUNAR_CYCLE

    return {
        'phase':          round(phase, 4),
        'illumination':   illumination,
        'name':           name,
        'age_days':       age,
        'next_full_days': round(days_to_full, 1),
        'next_new_days':  round(days_to_new,  1),
    }


@app.route('/api/moon')
def api_moon():
    return jsonify(fetch_moon())


@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/kp')
def api_kp():
    return jsonify(fetch_kp())

@app.route('/api/gcp')
def api_gcp():
    return jsonify(fetch_gcp())

@app.route('/api/sp500')
def api_sp500():
    return jsonify(fetch_sp500())


if __name__ == '__main__':
    print('\n  Dashboard -> http://localhost:5000\n')
    app.run(host='127.0.0.1', port=5000, debug=False)
