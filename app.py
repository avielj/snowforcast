#!/usr/bin/env python3
"""Flask web application for Snow Forecast."""

from flask import Flask, Response, jsonify, render_template_string, request, send_from_directory
import html
import io
import json
import os
import re

try:
    from PIL import Image, ImageDraw, ImageFont, ImageFilter
    PIL_AVAILABLE = True
except Exception:
    PIL_AVAILABLE = False

app = Flask(__name__)
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

RESORT_INFO = {
    'Val-Thorens': {'name': 'Val Thorens', 'flag': '🇫🇷', 'country': 'France', 'elevations': {'bot': '2300m', 'mid': '2800m', 'top': '3230m'}},
    'Alpe-d-Huez': {'name': 'Alpe d’Huez', 'flag': '🇫🇷', 'country': 'France', 'elevations': {'bot': '1250m', 'mid': '2350m', 'top': '3330m'}},
    'La-Plagne': {'name': 'La Plagne', 'flag': '🇫🇷', 'country': 'France', 'elevations': {'bot': '1250m', 'mid': '2250m', 'top': '3250m'}},
    'Cervinia': {'name': 'Cervinia', 'flag': '🇮🇹', 'country': 'Italy', 'elevations': {'bot': '2050m', 'mid': '2900m', 'top': '3480m'}},
    'Via-Lattea': {'name': 'Via Lattea', 'flag': '🇮🇹', 'country': 'Italy', 'elevations': {'bot': '1350m', 'mid': '2100m', 'top': '2823m'}},
    'Monterosa-Ski': {'name': 'Monterosa Ski', 'flag': '🇮🇹', 'country': 'Italy', 'elevations': {'bot': '1212m', 'mid': '2200m', 'top': '3275m'}},
    'Mount-Hermon': {'name': 'Mount Hermon', 'flag': '🇮🇱', 'country': 'Israel', 'elevations': {'bot': '1600m', 'mid': '2000m', 'top': '2236m'}},
    'St-Anton': {'name': 'St. Anton', 'flag': '🇦🇹', 'country': 'Austria', 'elevations': {'bot': '1304m', 'mid': '2150m', 'top': '2811m'}},
    'Gudauri': {'name': 'Gudauri', 'flag': '🇬🇪', 'country': 'Georgia', 'elevations': {'bot': '1990m', 'mid': '2350m', 'top': '3279m'}},
}
ELEVATION_LABELS = {'bot': 'Bottom', 'mid': 'Mid', 'top': 'Top'}
COUNTRY_ORDER = ['France', 'Italy', 'Israel', 'Austria', 'Georgia']


def _safe_key(value):
    return re.sub(r'[^a-z0-9-]', '', str(value or '').strip(), flags=re.I)


def _num(value):
    if value is None:
        return 0.0
    match = re.search(r'-?\d+(?:\.\d+)?', str(value).replace(',', '.'))
    return float(match.group(0)) if match else 0.0


def _cm(value):
    n = _num(value)
    return f"{int(n) if n == int(n) else round(n, 1)} cm"


def _mm(value):
    n = _num(value)
    return f"{int(n) if n == int(n) else round(n, 1)} mm"


def _load_all_forecasts():
    with open(os.path.join(BASE_DIR, 'data', 'all-forecasts.json'), 'r', encoding='utf-8') as f:
        return json.load(f)


def _resort_info(resort):
    return RESORT_INFO.get(resort, {
        'name': str(resort).replace('-', ' '),
        'flag': '🏔️',
        'country': 'Mountain',
        'elevations': {},
    })


def _periods(day):
    return [day.get(p) for p in ['am', 'pm', 'night'] if day.get(p)]


def _day_snow(day):
    if day and day.get('average_snow') is not None:
        return _num(day.get('average_snow'))
    return sum(_num(period.get('snow')) for period in _periods(day or {}))


def _total_snow(days):
    return sum(_day_snow(day) for day in days)


def _total_rain(days):
    return sum(_num(period.get('rain')) for day in days for period in _periods(day))


def _peak_wind(days):
    values = [_num(period.get('wind')) for day in days for period in _periods(day)]
    return max(values) if values else 0


def _temp_range(days):
    values = [_num(period.get('temperature')) for day in days for period in _periods(day)]
    return (min(values), max(values)) if values else None


def _best_day(days):
    return max(days, key=_day_snow) if days else None


def _forecast_summary(resort, elevation):
    forecasts = _load_all_forecasts()
    if resort not in forecasts:
        resort = next(iter(forecasts.keys()))
    resort_data = forecasts.get(resort, {})
    if not resort_data:
        raise ValueError('No forecast data available')
    if elevation not in resort_data:
        elevation = 'top' if 'top' in resort_data else next(iter(resort_data.keys()))

    data = resort_data.get(elevation, {})
    days = data.get('days', [])
    total_snow = _total_snow(days)
    total_rain = _total_rain(days)
    peak_wind = _peak_wind(days)
    best_day = _best_day(days)
    temp_range = _temp_range(days)

    all_elevations = []
    for key, value in resort_data.items():
        e_days = value.get('days', [])
        all_elevations.append({
            'key': key,
            'label': ELEVATION_LABELS.get(key, key.title()),
            'height': _resort_info(resort).get('elevations', {}).get(key, key),
            'snow': _total_snow(e_days),
            'rain': _total_rain(e_days),
            'wind': _peak_wind(e_days),
        })

    if total_snow >= 20 and total_rain <= 8 and peak_wind <= 45:
        status, status_icon = 'Good', '✅'
    elif total_snow >= 6 or total_rain <= 18:
        status, status_icon = 'Watch', '⚠️'
    else:
        status, status_icon = 'Low', '⛔'

    info = _resort_info(resort)
    elevation_label = ELEVATION_LABELS.get(elevation, elevation.title())
    height = info.get('elevations', {}).get(elevation, elevation_label)
    best_day_text = f"{best_day.get('name')} {_cm(_day_snow(best_day))}" if best_day else 'No clear snow window'
    temp_text = f"{round(temp_range[0])}°/{round(temp_range[1])}°" if temp_range else 'temperature unavailable'
    description = f"{elevation_label} {height}: {_cm(total_snow)} snow, {_mm(total_rain)} rain, peak wind {round(peak_wind)} km/h. Best window: {best_day_text}."

    return {
        'resort': resort,
        'resort_name': info['name'],
        'country': info['country'],
        'flag': info['flag'],
        'elevation': elevation,
        'elevation_label': elevation_label,
        'height': height,
        'snow': total_snow,
        'rain': total_rain,
        'wind': peak_wind,
        'status': status,
        'status_icon': status_icon,
        'best_day': best_day_text,
        'temp': temp_text,
        'description': description,
        'all_elevations': sorted(all_elevations, key=lambda item: ['bot', 'mid', 'top'].index(item['key']) if item['key'] in ['bot', 'mid', 'top'] else 99),
    }


def _enhance_forecast_html(page_html):
    country_map = {key: value['country'] for key, value in RESORT_INFO.items()}
    country_order = {country: index for index, country in enumerate(COUNTRY_ORDER)}
    enhancement = """
<script>
(function() {
  const COUNTRY_MAP = __COUNTRY_MAP__;
  const COUNTRY_ORDER = __COUNTRY_ORDER__;

  if (typeof resortKeys === 'function') {
    const originalResortKeys = resortKeys;
    resortKeys = function() {
      const keys = originalResortKeys();
      const favorite = typeof getFavoriteResort === 'function' && getFavoriteResort();
      return keys.slice().sort((a, b) => {
        const countryA = COUNTRY_MAP[a] || 'ZZZ';
        const countryB = COUNTRY_MAP[b] || 'ZZZ';
        const countryDiff = (COUNTRY_ORDER[countryA] ?? 99) - (COUNTRY_ORDER[countryB] ?? 99);
        if (countryDiff !== 0) return countryDiff;
        if (favorite && a === favorite && b !== favorite) return -1;
        if (favorite && b === favorite && a !== favorite) return 1;
        return metaForResort(a).name.localeCompare(metaForResort(b).name);
      });
    };
  }

  function sharePreviewUrlSafe() {
    const resort = typeof currentResort !== 'undefined' ? currentResort : 'Val-Thorens';
    const elevation = typeof currentElevation !== 'undefined' ? currentElevation : 'top';
    return `${window.location.origin}/share/${resort}/${elevation}`;
  }

  function shareButtons() {
    return Array.from(document.querySelectorAll('#top-share-btn, #share-btn, [data-share-button]'));
  }

  function showShareStatus(message) {
    shareButtons().forEach(button => {
      if (!button.dataset.originalText) button.dataset.originalText = button.textContent;
      button.textContent = message;
      window.clearTimeout(button._shareResetTimer);
      button._shareResetTimer = window.setTimeout(() => {
        button.textContent = button.dataset.originalText || '🔗 Share forecast';
      }, 1700);
    });
    let toast = document.getElementById('share-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'share-toast';
      toast.setAttribute('role', 'status');
      toast.style.cssText = 'position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:120;background:rgba(5,16,30,.96);border:1px solid rgba(125,211,252,.35);box-shadow:0 18px 55px rgba(0,0,0,.35);color:#f6fbff;border-radius:999px;padding:12px 16px;font:800 14px system-ui,sans-serif;max-width:calc(100% - 28px);text-align:center;';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.style.opacity = '1';
    window.clearTimeout(toast._timer);
    toast._timer = window.setTimeout(() => { toast.style.opacity = '0'; }, 2200);
  }

  async function copyFallback(text) {
    if (navigator.clipboard && window.isSecureContext) {
      try { await navigator.clipboard.writeText(text); return true; } catch (error) {}
    }
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      document.body.appendChild(textarea);
      textarea.select();
      textarea.setSelectionRange(0, textarea.value.length);
      const copied = document.execCommand('copy');
      textarea.remove();
      return copied;
    } catch (error) { return false; }
  }

  async function robustShareForecast() {
    const url = sharePreviewUrlSafe();

    if (navigator.share) {
      try {
        await navigator.share({ url });
        showShareStatus('✓ Shared');
        return;
      } catch (error) {
        if (error && error.name === 'AbortError') {
          showShareStatus('Share cancelled');
          return;
        }
      }
    }

    const copied = await copyFallback(url);
    if (copied) {
      showShareStatus('✓ Link copied');
    } else {
      window.prompt('Copy this share link:', url);
      showShareStatus('Share link ready');
    }
  }

  window.copyShareLink = robustShareForecast;

  if (typeof updateResortLinks === 'function') {
    const originalUpdateResortLinks = updateResortLinks;
    updateResortLinks = function() {
      originalUpdateResortLinks();
      const heroShare = document.getElementById('share-btn');
      if (heroShare) heroShare.remove();
    };
  }

  if (typeof renderHero === 'function') {
    const originalRenderHero = renderHero;
    renderHero = function(days) {
      originalRenderHero(days);
      const eyebrow = document.getElementById('hero-eyebrow');
      if (eyebrow) eyebrow.remove();
    };
  }

  function ensureTopShareButton() {
    const topActions = document.querySelector('.top-actions');
    if (!topActions) return;
    let button = document.getElementById('top-share-btn');
    if (!button) {
      button = document.createElement('button');
      button.id = 'top-share-btn';
      button.type = 'button';
      button.className = 'btn secondary';
      topActions.prepend(button);
    }
    button.dataset.shareButton = 'true';
    button.textContent = '🔗 Share forecast';
    button.onclick = robustShareForecast;
  }

  if (typeof loadForecast === 'function') {
    const originalLoadForecast = loadForecast;
    loadForecast = function() {
      originalLoadForecast();
      ensureTopShareButton();
      const eyebrow = document.getElementById('hero-eyebrow');
      if (eyebrow) eyebrow.remove();
    };
  }

  ensureTopShareButton();
})();
</script>
""".replace('__COUNTRY_MAP__', json.dumps(country_map)).replace('__COUNTRY_ORDER__', json.dumps(country_order))
    style_patch = "<style>.eyebrow{display:none!important}#share-toast{transition:opacity .18s ease}</style>"
    return page_html.replace('</head>', style_patch + '</head>').replace('</body>', enhancement + '</body>')


def _serve_forecast_html():
    html_path = os.path.join(BASE_DIR, 'forecast.html')
    with open(html_path, 'r', encoding='utf-8') as f:
        return _enhance_forecast_html(f.read())


def _font(size, bold=False):
    if not PIL_AVAILABLE:
        return None
    candidates = [
        '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf' if bold else '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
        '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf' if bold else '/usr/share/fonts/dejavu/DejaVuSans.ttf',
    ]
    for path in candidates:
        try:
            return ImageFont.truetype(path, size)
        except Exception:
            pass
    return ImageFont.load_default()


def _draw_text(draw, xy, text, font, fill, max_width=None, line_height=None, max_lines=2):
    if max_width is None:
        draw.text(xy, text, font=font, fill=fill)
        return xy[1] + (line_height or 34)
    words = str(text).split()
    lines, line = [], ''
    for word in words:
        candidate = f"{line} {word}".strip()
        width = draw.textbbox((0, 0), candidate, font=font)[2]
        if width <= max_width or not line:
            line = candidate
        else:
            lines.append(line)
            line = word
            if len(lines) >= max_lines:
                break
    if line and len(lines) < max_lines:
        lines.append(line)
    if words and len(lines) == max_lines and ' '.join(lines).split() != words:
        lines[-1] = lines[-1].rstrip('…') + '…'
    y = xy[1]
    step = line_height or 38
    for line in lines:
        draw.text((xy[0], y), line, font=font, fill=fill)
        y += step
    return y


def _share_card_png(summary):
    if not PIL_AVAILABLE:
        raise RuntimeError('Pillow unavailable')

    W, H = 1200, 630
    img = Image.new('RGB', (W, H), '#101418')
    draw = ImageDraw.Draw(img)
    for y in range(H):
        shade = int(16 + y * 0.018)
        draw.line([(0, y), (W, y)], fill=(shade, min(shade + 4, 34), min(shade + 10, 52)))

    glow = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    gdraw = ImageDraw.Draw(glow)
    gdraw.ellipse((760, -260, 1330, 260), fill=(134, 239, 172, 62))
    gdraw.ellipse((500, -260, 1050, 260), fill=(125, 211, 252, 45))
    glow = glow.filter(ImageFilter.GaussianBlur(72))
    img = Image.alpha_composite(img.convert('RGBA'), glow)
    draw = ImageDraw.Draw(img)

    # Main WhatsApp/Open Graph card: white top, navy strip, dark footer.
    x0, y0, x1, y1 = 78, 58, 1122, 572
    draw.rounded_rectangle((x0, y0, x1, y1), radius=32, fill=(30, 30, 30, 255))
    draw.rounded_rectangle((x0, y0, x1, y0 + 318), radius=32, fill=(250, 252, 255, 255))
    draw.rectangle((x0, y0 + 280, x1, y0 + 330), fill=(250, 252, 255, 255))
    draw.rectangle((x0, y0 + 318, x1, y0 + 408), fill=(3, 8, 48, 255))
    draw.rectangle((x0, y0 + 408, x1, y1 - 28), fill=(31, 31, 31, 255))
    draw.rounded_rectangle((x0, y1 - 70, x1, y1), radius=32, fill=(31, 31, 31, 255))

    f_title = _font(48, True)
    f_metric = _font(34, True)
    f_metric_label = _font(31, True)
    f_footer = _font(29, True)
    f_small = _font(25, False)
    f_brand = _font(33, True)

    title = f"{summary['resort_name']} {summary['elevation_label']}"
    if len(title) > 34:
        title = title[:31] + '…'
    draw.text((112, 104), title, font=f_title, fill=(25, 31, 39, 255))

    def metric(x, y, icon, label, value, color):
        draw.text((x, y), icon, font=f_metric_label, fill=color)
        draw.text((x + 55, y + 2), label, font=f_metric_label, fill=(28, 32, 40, 255))
        draw.text((x + 55 + draw.textbbox((0, 0), label, font=f_metric_label)[2] + 10, y + 2), value, font=f_metric_label, fill=(28, 32, 40, 255))

    metric(116, 198, '❄', 'Snow:', _cm(summary['snow']), (221, 171, 24, 255))
    metric(608, 198, '↗', 'Best:', summary['best_day'], (34, 197, 94, 255))
    metric(116, 283, '⚠', 'Rain:', _mm(summary['rain']), (90, 96, 112, 255))
    metric(608, 283, '↘', 'Wind:', f"{round(summary['wind'])} km/h", (225, 29, 72, 255))

    # Simple snowflake/diamond mark, similar role to OptionStrat logo strip.
    cx, cy = 132, 363
    for dx, dy in [(-18, 0), (0, -18), (18, 0), (0, 18), (-10, -10), (10, -10), (-10, 10), (10, 10)]:
        draw.ellipse((cx + dx - 4, cy + dy - 4, cx + dx + 4, cy + dy + 4), fill=(56, 189, 248, 255))
    draw.text((176, 344), 'SnowForecast', font=f_brand, fill=(246, 251, 255, 255))
    draw.text((830, 349), 'Mountain Decision Card', font=f_small, fill=(226, 232, 240, 255))

    footer_title = f"{summary['resort_name']} {summary['elevation_label']} {summary['height']}"
    draw.text((110, 435), footer_title, font=f_footer, fill=(226, 232, 240, 255))
    details = f"{summary['status_icon']} {summary['status']} | Snow {_cm(summary['snow'])} | Rain {_mm(summary['rain'])} | Wind {round(summary['wind'])} km/h"
    draw.text((110, 482), details, font=f_footer, fill=(226, 232, 240, 255))
    draw.text((110, 532), 'Open live forecast on SnowForecast', font=f_small, fill=(157, 163, 175, 255))

    output = io.BytesIO()
    img.convert('RGB').save(output, format='PNG', optimize=True)
    output.seek(0)
    return output.getvalue()


@app.route('/')
@app.route('/forecast.html')
def index():
    try:
        return _serve_forecast_html()
    except FileNotFoundError:
        return 'Forecast page not found', 404


@app.route('/share/<resort>/<elevation>')
def share_preview(resort, elevation):
    resort = _safe_key(resort)
    elevation = _safe_key(elevation)
    try:
        summary = _forecast_summary(resort, elevation)
    except Exception:
        summary = _forecast_summary('Val-Thorens', 'top')

    share_url = request.url_root.rstrip('/') + f"/share/{summary['resort']}/{summary['elevation']}"
    app_url = request.url_root.rstrip('/') + f"/#{summary['resort']}/{summary['elevation']}"
    image_url = request.url_root.rstrip('/') + f"/share-card/{summary['resort']}/{summary['elevation']}.png?v=2"
    title = f"{summary['flag']} {summary['resort_name']} {summary['elevation_label']} snow forecast"
    description = f"{summary['status_icon']} {summary['status']} · {_cm(summary['snow'])} snow · {_mm(summary['rain'])} rain · wind {round(summary['wind'])} km/h"

    return render_template_string("""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{{ title }}</title>
  <meta name="description" content="{{ description }}">
  <link rel="canonical" href="{{ share_url }}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="SnowForecast">
  <meta property="og:title" content="{{ title }}">
  <meta property="og:description" content="{{ description }}">
  <meta property="og:url" content="{{ share_url }}">
  <meta property="og:image" content="{{ image_url }}">
  <meta property="og:image:secure_url" content="{{ image_url }}">
  <meta property="og:image:type" content="image/png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="{{ title }}">
  <meta name="twitter:description" content="{{ description }}">
  <meta name="twitter:image" content="{{ image_url }}">
  <style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#06111f;color:#f6fbff;font-family:system-ui,sans-serif}a{color:#7dd3fc}.card{max-width:720px;padding:32px}.button{display:inline-block;margin-top:12px;padding:13px 18px;border-radius:999px;background:#7dd3fc;color:#06111f;text-decoration:none;font-weight:900}.muted{color:#9fb3c8}</style>
</head>
<body><main class="card"><h1>{{ title }}</h1><p>{{ description }}</p><p class="muted">This page creates the WhatsApp preview card.</p><p><a class="button" href="{{ app_url }}">Open live forecast</a></p></main></body>
</html>""", title=title, description=description, share_url=share_url, image_url=image_url, app_url=app_url)


@app.route('/share-card/<resort>/<elevation>.png')
def share_card_png(resort, elevation):
    resort = _safe_key(resort)
    elevation = _safe_key(elevation)
    try:
        summary = _forecast_summary(resort, elevation)
    except Exception:
        summary = _forecast_summary('Val-Thorens', 'top')
    try:
        png = _share_card_png(summary)
        response = Response(png, mimetype='image/png')
        response.headers['Cache-Control'] = 'public, max-age=300'
        return response
    except Exception:
        return share_card_svg(summary['resort'], summary['elevation'])


@app.route('/share-card/<resort>/<elevation>.svg')
def share_card_svg(resort, elevation):
    resort = _safe_key(resort)
    elevation = _safe_key(elevation)
    try:
        s = _forecast_summary(resort, elevation)
    except Exception:
        s = _forecast_summary('Val-Thorens', 'top')
    rows = ''.join([
        f"<text x='760' y='{330 + i*48}' fill='#c9d8e8' font-size='30'>{html.escape(item['label'])} {html.escape(item['height'])}: {html.escape(_cm(item['snow']))}</text>"
        for i, item in enumerate(s['all_elevations'][:3])
    ])
    svg = f"""<svg xmlns='http://www.w3.org/2000/svg' width='1200' height='630' viewBox='0 0 1200 630'>
  <rect width='1200' height='630' fill='#06111f'/>
  <rect x='58' y='58' width='1084' height='514' rx='44' fill='#081727' stroke='rgba(255,255,255,.20)'/>
  <rect x='58' y='58' width='1084' height='108' rx='44' fill='#f5fbff'/>
  <text x='92' y='126' fill='#06111f' font-size='38' font-weight='800'>Snow Forecast</text>
  <text x='92' y='230' fill='#f6fbff' font-size='72' font-weight='900'>{html.escape(s['resort_name'])}</text>
  <text x='92' y='286' fill='#c9d8e8' font-size='36'>{html.escape(s['elevation_label'])} · {html.escape(s['height'])}</text>
  <text x='92' y='385' fill='#7dd3fc' font-size='86' font-weight='900'>{html.escape(_cm(s['snow']))}</text>
  <text x='92' y='434' fill='#9fb3c8' font-size='31'>7-day snowfall · {html.escape(s['status_icon'])} {html.escape(s['status'])}</text>
  <text x='92' y='496' fill='#c9d8e8' font-size='30'>Best window: {html.escape(s['best_day'])}</text>
  <text x='92' y='540' fill='#c9d8e8' font-size='30'>Rain {html.escape(_mm(s['rain']))} · Wind {round(s['wind'])} km/h · Temp {html.escape(s['temp'])}</text>
  <text x='760' y='268' fill='#f6fbff' font-size='36' font-weight='800'>All elevations</text>
  {rows}
</svg>"""
    return Response(svg, mimetype='image/svg+xml')


@app.route('/data/<path:filename>')
def data_file(filename):
    return send_from_directory(os.path.join(BASE_DIR, 'data'), filename)


@app.route('/api/forecast')
def api_forecast():
    resort = _safe_key(request.args.get('resort', 'Val-Thorens'))
    elevation = _safe_key(request.args.get('elevation', 'bot'))
    try:
        summary = _forecast_summary(resort, elevation)
        forecasts = _load_all_forecasts()
        data = forecasts.get(summary['resort'], {}).get(summary['elevation'], {})
        return jsonify({'summary': summary, 'forecast': data})
    except Exception as exc:
        return jsonify({'error': str(exc)}), 500


@app.route('/val_thorens_forecast.json')
def legacy_val_thorens_forecast():
    try:
        forecasts = _load_all_forecasts()
        return jsonify(forecasts.get('Val-Thorens', {}).get('bot', {}))
    except Exception:
        return jsonify({'error': 'Forecast data not found'}), 404


@app.route('/comprehensive_val_thorens_forecast.json')
def legacy_comprehensive_forecast():
    try:
        forecasts = _load_all_forecasts()
        return jsonify(forecasts.get('Val-Thorens', {}))
    except Exception:
        return jsonify({'error': 'Forecast data not found'}), 404


if __name__ == '__main__':
    app.run(debug=True)
