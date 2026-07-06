#!/usr/bin/env python3
"""
Flask web application for Snow Forecast.
"""

from flask import Flask, render_template_string, jsonify, send_from_directory, request, Response, redirect
import os
import json
import html
import re
import requests
from bs4 import BeautifulSoup
from snow_forecast_parser import SnowForecastParser
from enhanced_snow_forecast_parser import EnhancedSnowForecastParser

try:
    from openweather_integration import OpenWeatherAPI, compare_forecasts
    OPENWEATHER_AVAILABLE = True
except ImportError:
    OPENWEATHER_AVAILABLE = False
    print("⚠ OpenWeather integration not available")

app = Flask(__name__)
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

openweather_api = None
if OPENWEATHER_AVAILABLE:
    api_key = os.environ.get('OPENWEATHER_API_KEY')
    if api_key:
        openweather_api = OpenWeatherAPI(api_key)
        print("✓ OpenWeather API initialized for Vercel")
    else:
        print("⚠ OPENWEATHER_API_KEY not set, using snow-forecast.com only")

RESORT_INFO = {
    'Val-Thorens': {'name': 'Val Thorens', 'flag': '🇫🇷', 'country': 'France', 'elevations': {'bot': '2300m', 'mid': '2800m', 'top': '3230m'}},
    'Alpe-d-Huez': {'name': 'Alpe d’Huez', 'flag': '🇫🇷', 'country': 'France', 'elevations': {'bot': '1250m', 'mid': '2350m', 'top': '3330m'}},
    'La-Plagne': {'name': 'La Plagne', 'flag': '🇫🇷', 'country': 'France', 'elevations': {'bot': '1250m', 'mid': '2250m', 'top': '3250m'}},
    'Cervinia': {'name': 'Cervinia', 'flag': '🇮🇹', 'country': 'Italy', 'elevations': {'bot': '2050m', 'mid': '2900m', 'top': '3480m'}},
    'Via-Lattea': {'name': 'Via Lattea', 'flag': '🇮🇹', 'country': 'Italy', 'elevations': {'bot': '1350m', 'mid': '2100m', 'top': '2823m'}},
    'Monterosa-Ski': {'name': 'Monterosa Ski', 'flag': '🇮🇹', 'country': 'Italy', 'elevations': {'bot': '1212m', 'mid': '2200m', 'top': '3275m'}},
    'Gudauri': {'name': 'Gudauri', 'flag': '🇬🇪', 'country': 'Georgia', 'elevations': {'bot': '1990m', 'mid': '2350m', 'top': '3279m'}},
    'St-Anton': {'name': 'St. Anton', 'flag': '🇦🇹', 'country': 'Austria', 'elevations': {'bot': '1304m', 'mid': '2150m', 'top': '2811m'}},
    'Mount-Hermon': {'name': 'Mount Hermon', 'flag': '🇮🇱', 'country': 'Israel', 'elevations': {'bot': '1600m', 'mid': '2000m', 'top': '2236m'}},
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
    path = os.path.join(BASE_DIR, 'data', 'all-forecasts.json')
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)


def _resort_info(resort):
    return RESORT_INFO.get(resort, {
        'name': str(resort).replace('-', ' '),
        'flag': '🏔️',
        'country': 'Mountain',
        'elevations': {}
    })


def _periods(day):
    return [day.get(p) for p in ['am', 'pm', 'night'] if day.get(p)]


def _day_snow(day):
    if day.get('average_snow') is not None:
        return _num(day.get('average_snow'))
    return sum(_num(period.get('snow')) for period in _periods(day))


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
        status = 'Good'
        status_icon = '✅'
    elif total_snow >= 6 or total_rain <= 18:
        status = 'Watch'
        status_icon = '⚠️'
    else:
        status = 'Low'
        status_icon = '⛔'
    info = _resort_info(resort)
    elevation_label = ELEVATION_LABELS.get(elevation, elevation.title())
    height = info.get('elevations', {}).get(elevation, elevation_label)
    best_day_text = f"{best_day.get('name')} {_cm(_day_snow(best_day))}" if best_day else "No clear snow window"
    temp_text = f"{round(temp_range[0])}°/{round(temp_range[1])}°" if temp_range else "temperature unavailable"
    desc = f"{elevation_label} {height}: {_cm(total_snow)} snow, {_mm(total_rain)} rain, peak wind {round(peak_wind)} km/h. Best window: {best_day_text}."
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
        'description': desc,
        'all_elevations': sorted(all_elevations, key=lambda item: ['bot', 'mid', 'top'].index(item['key']) if item['key'] in ['bot', 'mid', 'top'] else 99)
    }


@app.route('/')
def index():
    html_path = os.path.join(BASE_DIR, 'forecast.html')
    try:
        with open(html_path, 'r', encoding='utf-8') as f:
            return f.read()
    except FileNotFoundError:
        return "Forecast page not found", 404


@app.route('/share/<resort>/<elevation>')
def share_preview(resort, elevation):
    resort = _safe_key(resort)
    elevation = _safe_key(elevation)
    try:
        summary = _forecast_summary(resort, elevation)
    except Exception:
        summary = _forecast_summary('Val-Thorens', 'top')
    share_url = request.url_root.rstrip('/') + f"/share/{summary['resort']}/{summary['elevation']}"
    app_url = request.url_root.rstrip('/') + f"/#${summary['resort']}/{summary['elevation']}".replace('#$', '#')
    image_url = request.url_root.rstrip('/') + f"/share-card/{summary['resort']}/{summary['elevation']}.svg"
    title = f"{summary['flag']} {summary['resort_name']} {summary['elevation_label']} snow forecast"
    description = f"{summary['status_icon']} {summary['status']} · {summary['description']}"
    return render_template_string("""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{{ title }}</title>
  <meta name="description" content="{{ description }}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Snow Forecast">
  <meta property="og:title" content="{{ title }}">
  <meta property="og:description" content="{{ description }}">
  <meta property="og:url" content="{{ share_url }}">
  <meta property="og:image" content="{{ image_url }}">
  <meta property="og:image:type" content="image/svg+xml">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="{{ title }}">
  <meta name="twitter:description" content="{{ description }}">
  <meta name="twitter:image" content="{{ image_url }}">
  <meta http-equiv="refresh" content="0; url={{ app_url }}">
  <style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#06111f;color:#f6fbff;font-family:system-ui,sans-serif}a{color:#7dd3fc}.card{max-width:720px;padding:32px}.muted{color:#9fb3c8}</style>
</head>
<body><main class="card"><h1>{{ title }}</h1><p>{{ description }}</p><p class="muted">Opening the live dashboard…</p><p><a href="{{ app_url }}">Open forecast</a></p></main></body>
</html>""", title=title, description=description, share_url=share_url, image_url=image_url, app_url=app_url)


@app.route('/share-card/<resort>/<elevation>.svg')
def share_card(resort, elevation):
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
  <defs>
    <linearGradient id='bg' x1='0' y1='0' x2='1' y2='1'><stop offset='0%' stop-color='#06111f'/><stop offset='45%' stop-color='#0b2842'/><stop offset='100%' stop-color='#17142a'/></linearGradient>
    <radialGradient id='glow' cx='20%' cy='10%' r='70%'><stop offset='0%' stop-color='#38bdf8' stop-opacity='.42'/><stop offset='70%' stop-color='#38bdf8' stop-opacity='0'/></radialGradient>
    <filter id='shadow'><feDropShadow dx='0' dy='18' stdDeviation='24' flood-color='#000' flood-opacity='.45'/></filter>
  </defs>
  <rect width='1200' height='630' fill='url(#bg)'/>
  <rect width='1200' height='630' fill='url(#glow)'/>
  <circle cx='1020' cy='95' r='180' fill='#a78bfa' opacity='.16'/>
  <path d='M0 500 L130 345 L255 455 L390 270 L560 500 Z' fill='#e0f7ff' opacity='.30'/>
  <path d='M260 510 L430 330 L590 455 L730 260 L980 510 Z' fill='#ffffff' opacity='.18'/>
  <path d='M0 560 L240 420 L490 545 L730 380 L1200 560 L1200 630 L0 630 Z' fill='#ffffff' opacity='.12'/>
  <g filter='url(#shadow)'>
    <rect x='58' y='58' width='1084' height='514' rx='44' fill='rgba(5,16,30,.72)' stroke='rgba(255,255,255,.20)'/>
  </g>
  <text x='92' y='125' fill='#7dd3fc' font-size='28' font-weight='800'>SNOW FORECAST · {html.escape(s['country'].upper())}</text>
  <text x='92' y='210' fill='#f6fbff' font-size='72' font-weight='900'>{html.escape(s['resort_name'])}</text>
  <text x='92' y='266' fill='#c9d8e8' font-size='36'>{html.escape(s['elevation_label'])} · {html.escape(s['height'])}</text>
  <text x='92' y='365' fill='#f6fbff' font-size='86' font-weight='900'>{html.escape(_cm(s['snow']))}</text>
  <text x='92' y='414' fill='#9fb3c8' font-size='31'>7-day snowfall · {html.escape(s['status_icon'])} {html.escape(s['status'])}</text>
  <text x='92' y='476' fill='#c9d8e8' font-size='30'>Best window: {html.escape(s['best_day'])}</text>
  <text x='92' y='520' fill='#c9d8e8' font-size='30'>Rain {html.escape(_mm(s['rain']))} · Wind {round(s['wind'])} km/h · Temp {html.escape(s['temp'])}</text>
  <text x='760' y='268' fill='#f6fbff' font-size='36' font-weight='800'>All elevations</text>
  {rows}
</svg>"""
    return Response(svg, mimetype='image/svg+xml')


@app.route('/val_thorens_forecast.json')
def get_forecast_json():
    json_path = os.path.join(BASE_DIR, 'val_thorens_forecast.json')
    try:
        with open(json_path, 'r') as f:
            data = json.load(f)
        return jsonify(data)
    except FileNotFoundError:
        return jsonify({"error": "Forecast data not found"}), 404


@app.route('/api/refresh')
def refresh_forecast():
    try:
        parser = SnowForecastParser()
        forecast_data = parser.get_forecast()
        if forecast_data:
            json_path = os.path.join(BASE_DIR, 'val_thorens_forecast.json')
            with open(json_path, 'w') as f:
                json.dump(forecast_data, f, indent=2, default=str)
            return jsonify({"status": "success", "message": "Basic forecast updated successfully", "data": forecast_data})
        return jsonify({"status": "error", "message": "Failed to fetch forecast data"}), 500
    except Exception as e:
        return jsonify({"status": "error", "message": f"Error updating forecast: {str(e)}"}), 500


@app.route('/api/refresh-comprehensive')
def refresh_comprehensive_forecast():
    try:
        parser = EnhancedSnowForecastParser()
        forecast_data = parser.get_comprehensive_forecast()
        if forecast_data:
            json_path = os.path.join(BASE_DIR, 'comprehensive_val_thorens_forecast.json')
            with open(json_path, 'w') as f:
                json.dump(forecast_data, f, indent=2, default=str)
            return jsonify({"status": "success", "message": "Comprehensive forecast updated successfully", "data": forecast_data})
        return jsonify({"status": "error", "message": "Failed to fetch comprehensive forecast data"}), 500
    except Exception as e:
        return jsonify({"status": "error", "message": f"Error updating comprehensive forecast: {str(e)}"}), 500


@app.route('/comprehensive_val_thorens_forecast.json')
def get_comprehensive_forecast_json():
    json_path = os.path.join(BASE_DIR, 'comprehensive_val_thorens_forecast.json')
    try:
        with open(json_path, 'r') as f:
            data = json.load(f)
        return jsonify(data)
    except FileNotFoundError:
        return jsonify({"error": "Comprehensive forecast data not found"}), 404


@app.route('/api/forecast')
def get_formatted_forecast():
    try:
        elevation = request.args.get('elevation', 'bot')
        resort = request.args.get('resort', 'Val-Thorens')
        if elevation not in ['bot', 'mid', 'top']:
            elevation = 'bot'
        valid_resorts = ['Val-Thorens', 'Cervinia', 'Via-Lattea', 'Monterosa-Ski', 'Gudauri', 'St-Anton', 'Alpe-d-Huez', 'La-Plagne', 'Mount-Hermon']
        if resort not in valid_resorts:
            resort = 'Val-Thorens'
        resort_url_mapping = {
            'Val-Thorens': 'Val-Thorens', 'Cervinia': 'Cervinia', 'Via-Lattea': 'Sestriere',
            'Monterosa-Ski': 'Champoluc', 'Gudauri': 'Gudauri', 'St-Anton': 'St-Anton',
            'Alpe-d-Huez': 'Alpe-d-Huez', 'La-Plagne': 'La-Plagne', 'Mount-Hermon': 'mounthermon'
        }
        resort_url = resort_url_mapping.get(resort, resort)
        url = f'https://www.snow-forecast.com/resorts/{resort_url}/6day/{elevation}'
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Cookie': 's_fid=browse'
        }
        response = requests.get(url, headers=headers, timeout=30)
        soup = BeautifulSoup(response.content, 'html.parser')
        forecast_table = soup.find('table', class_='forecast-table__table')
        if not forecast_table:
            return jsonify({"error": "Forecast table not found"}), 404
        days_row = forecast_table.find('tr', {'data-row': 'days'})
        time_row = forecast_table.find('tr', {'data-row': 'time'})
        weather_row = forecast_table.find('tr', {'data-row': 'weather'})
        temp_row = forecast_table.find('tr', {'data-row': 'temperature-max'})
        snow_row = forecast_table.find('tr', {'data-row': 'snow'})
        rain_row = forecast_table.find('tr', {'data-row': 'rain'})
        wind_row = forecast_table.find('tr', {'data-row': 'wind'})
        day_cells = days_row.find_all('td', class_='forecast-table-days__cell')
        days_info = []
        for cell in day_cells:
            day_name_elem = cell.find('div', class_='forecast-table-days__name')
            day_date_elem = cell.find('div', class_='forecast-table-days__date')
            if day_name_elem and day_date_elem:
                days_info.append({'name': day_name_elem.get_text(strip=True), 'date': day_date_elem.get_text(strip=True), 'colspan': int(cell.get('colspan', '3'))})
        time_cells = time_row.find_all('td', class_='forecast-table__cell')
        times = [cell.get_text(strip=True) for cell in time_cells]
        weather_cells = weather_row.find_all('td', class_='forecast-table__cell')
        conditions = []
        for cell in weather_cells:
            img = cell.find('img')
            conditions.append(img.get('alt', 'Unknown') if img else 'N/A')
        temp_cells = temp_row.find_all('td', class_='forecast-table__cell') if temp_row else []
        temperatures = []
        for cell in temp_cells:
            temp_div = cell.find('div', class_='temp-value')
            temperatures.append(temp_div.get('data-value') if temp_div and temp_div.get('data-value') else 'N/A')
        snow_cells = snow_row.find_all('td', class_='forecast-table__cell') if snow_row else []
        snow_amounts = []
        for cell in snow_cells:
            snow_span = cell.find('span', class_='snow-amount__value')
            snow_amounts.append(snow_span.get_text(strip=True) if snow_span else '0')
        rain_cells = rain_row.find_all('td', class_='forecast-table__cell') if rain_row else []
        rain_amounts = []
        for cell in rain_cells:
            rain_span = cell.find('span', class_='rain-amount__value')
            rain_amounts.append(rain_span.get_text(strip=True) if rain_span else '0')
        wind_cells = wind_row.find_all('td', class_='forecast-table__cell') if wind_row else []
        wind_data = []
        for cell in wind_cells:
            wind_speed_span = cell.find('span', class_='wind-icon__val')
            wind_direction = cell.find('div', class_='wind-icon__tooltip')
            if wind_speed_span:
                speed = wind_speed_span.get_text(strip=True)
                direction = wind_direction.get_text(strip=True) if wind_direction else 'N/A'
                wind_data.append(f"{speed} km/h {direction}")
            else:
                wind_data.append('N/A')
        forecast_days = []
        cell_index = 0
        for day in days_info:
            day_data = {'name': day['name'], 'date': day['date'], 'am': None, 'pm': None, 'night': None}
            periods = ['am', 'pm', 'night']
            for i in range(min(day['colspan'], 3)):
                if cell_index >= len(times):
                    break
                day_data[periods[i]] = {
                    'condition': conditions[cell_index] if cell_index < len(conditions) else 'N/A',
                    'temperature': temperatures[cell_index] if cell_index < len(temperatures) else 'N/A',
                    'snow': snow_amounts[cell_index] if cell_index < len(snow_amounts) else '0',
                    'rain': rain_amounts[cell_index] if cell_index < len(rain_amounts) else '0',
                    'wind': wind_data[cell_index] if cell_index < len(wind_data) else 'N/A'
                }
                cell_index += 1
            forecast_days.append(day_data)
        response_data = {'days': forecast_days, 'last_updated': None, 'sources': ['snow-forecast.com']}
        if openweather_api:
            try:
                ow_data = openweather_api.get_forecast(resort=resort, elevation=elevation)
                if ow_data:
                    response_data = compare_forecasts(response_data, ow_data)
                    response_data['sources'].append('OpenWeatherMap')
            except Exception as e:
                print(f"⚠ OpenWeather fetch failed: {e}")
        return jsonify(response_data)
    except Exception as e:
        import traceback
        print(f"Error in get_formatted_forecast: {str(e)}")
        print(traceback.format_exc())
        return jsonify({"error": str(e)}), 500


@app.route('/forecast.html')
def forecast_page():
    html_path = os.path.join(BASE_DIR, 'forecast.html')
    try:
        with open(html_path, 'r', encoding='utf-8') as f:
            return f.read()
    except FileNotFoundError:
        return "Forecast page not found", 404


@app.route('/api/status')
def get_status():
    json_path = os.path.join(BASE_DIR, 'val_thorens_forecast.json')
    file_exists = os.path.exists(json_path)
    last_modified = os.path.getmtime(json_path) if file_exists else None
    return jsonify({"status": "online", "forecast_available": file_exists, "last_updated": last_modified})


if __name__ == '__main__':
    print("Starting Snow Forecast Web App...")
    print(f"Base directory: {BASE_DIR}")
    json_path = os.path.join(BASE_DIR, 'val_thorens_forecast.json')
    if not os.path.exists(json_path):
        print("Generating initial forecast data...")
        try:
            parser = SnowForecastParser()
            forecast_data = parser.get_forecast()
            if forecast_data:
                with open(json_path, 'w') as f:
                    json.dump(forecast_data, f, indent=2, default=str)
                print("Initial forecast data created")
        except Exception as e:
            print(f"Could not generate initial data: {e}")
    port = int(os.environ.get('PORT', 8080))
    app.run(debug=False, host='0.0.0.0', port=port)
