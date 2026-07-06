#!/usr/bin/env python3
"""
Generate static forecast data for all resorts and elevations.
This script is run by GitHub Actions every 3 hours.
Combines data from snow-forecast.com and OpenWeatherMap for better accuracy.
"""

import json
import os
from datetime import datetime
import requests
from bs4 import BeautifulSoup

# Try to import OpenWeather integration
try:
    from openweather_integration import OpenWeatherAPI, compare_forecasts
    OPENWEATHER_AVAILABLE = True
except ImportError:
    OPENWEATHER_AVAILABLE = False
    print("OpenWeather integration not available, using snow-forecast.com only")

# Try to import Weather Unlocked integration
try:
    from weatherunlocked_integration import WeatherUnlockedAPI, compare_with_weatherunlocked
    WEATHERUNLOCKED_AVAILABLE = True
except ImportError:
    WEATHERUNLOCKED_AVAILABLE = False
    print("Weather Unlocked integration not available")

def fetch_valthorens_conditions():
    """Fetch current snow conditions from Val Thorens official website"""
    url = 'https://www.valthorens.com/infos-neige/'
    headers = {
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.9',
        'cache-control': 'no-cache',
        'dnt': '1',
        'pragma': 'no-cache',
        'sec-ch-ua': '"Chromium";v="142", "Google Chrome";v="142"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"macOS"',
        'sec-fetch-dest': 'document',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-site': 'none',
        'sec-fetch-user': '?1',
        'upgrade-insecure-requests': '1',
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36'
    }
    
    cookies = {
        'pll_language': 'en',  # Use English version
        'iris_eco_config': '{"isEcoModeActive":false,"isEcoBarHidden":true}'
    }
    
    try:
        response = requests.get(url, headers=headers, cookies=cookies, timeout=30)
        soup = BeautifulSoup(response.content, 'html.parser')
        
        conditions = {}
        
        # Look for the snow info table
        # The data might be in a specific structure - let's search for it
        table_rows = soup.find_all('tr')
        
        for row in table_rows:
            th = row.find('th')
            td = row.find('td')
            if th and td:
                field_name = th.get_text(strip=True)
                field_value = td.get_text(strip=True)
                
                # Map the fields based on the text content
                if 'Last snowfall' in field_name or 'snowfall' in field_name.lower():
                    if 'Last' in field_name:
                        conditions['Last snowfall (VT)'] = field_value
                elif 'Snow cover' in field_name or ('Bottom' in field_value and 'Top' in field_value):
                    conditions['Snow cover (VT)'] = field_value
                elif 'Total snow depth' in field_name:
                    conditions['Total snow depth (VT)'] = field_value
                elif 'Snow quality' in field_name:
                    conditions['Snow quality'] = field_value
                elif 'Avalanche risk' in field_name:
                    conditions['Avalanche risk'] = field_value
                elif 'state of the sky' in field_name.lower() or 'weather' in field_name.lower():
                    conditions['Current weather'] = field_value
                elif 'Temperature' in field_name and 'Isothermal' not in field_name:
                    conditions['Current temp'] = field_value
                elif 'Isothermal' in field_name:
                    conditions['Freezing level'] = field_value
                elif 'Wind' in field_name:
                    conditions['Current wind'] = field_value
        
        if conditions:
            print(f"  ✓ Fetched {len(conditions)} official conditions from Val Thorens")
        
        return conditions if conditions else None
    except Exception as e:
        print(f"  ⚠ Could not fetch Val Thorens official conditions: {e}")
        import traceback
        traceback.print_exc()
        return None

def fetch_openmeteo_extended(latitude, longitude, resort_name, elevation_m=2800):
    """
    Fetch 16-day extended forecast from OpenMeteo with elevation and freezing level
    """
    url = "https://api.open-meteo.com/v1/forecast"
    
    params = {
        "latitude": latitude,
        "longitude": longitude,
        "elevation": elevation_m,  # Specify elevation for more accurate forecast
        "hourly": [
            "freezing_level_height"
        ],
        "daily": [
            "temperature_2m_max",
            "temperature_2m_min",
            "precipitation_sum",
            "rain_sum",
            "snowfall_sum",
            "weathercode"
        ],
        "timezone": "Europe/Paris",
        "forecast_days": 16
    }
    
    try:
        response = requests.get(url, params=params, timeout=30)
        response.raise_for_status()
        data = response.json()
        
        extended_forecast = []
        daily = data.get("daily", {})
        hourly = data.get("hourly", {})
        
        for i in range(len(daily.get("time", []))):
            date = datetime.fromisoformat(daily["time"][i])
            
            # Calculate freezing level range for this day (min/max from hourly data)
            day_start = i * 24
            day_end = min((i + 1) * 24, len(hourly.get("freezing_level_height", [])))
            
            freeze_levels = []
            if "freezing_level_height" in hourly:
                for h in range(day_start, day_end):
                    if h < len(hourly["freezing_level_height"]):
                        fl = hourly["freezing_level_height"][h]
                        if fl is not None:
                            freeze_levels.append(fl)
            
            freeze_min = min(freeze_levels) if freeze_levels else None
            freeze_max = max(freeze_levels) if freeze_levels else None
            
            extended_forecast.append({
                "date": date.strftime("%Y-%m-%d"),
                "day_name": date.strftime("%A"),
                "temp_max": daily["temperature_2m_max"][i],
                "temp_min": daily["temperature_2m_min"][i],
                "precipitation": daily["precipitation_sum"][i],
                "rain": daily.get("rain_sum", [0])[i],
                "snowfall": daily["snowfall_sum"][i],
                "weather_code": daily["weathercode"][i],
                "freezing_level_min": freeze_min,
                "freezing_level_max": freeze_max
            })
        
        print(f"  ✓ Fetched {len(extended_forecast)}-day extended forecast for {resort_name} @ {elevation_m}m")
        
        return {
            "extended_forecast": extended_forecast,
            "last_updated": datetime.now().isoformat(),
            "source": "OpenMeteo",
            "elevation": data.get("elevation"),
            "elevation_used": elevation_m
        }
        
    except Exception as e:
        print(f"  ⚠ Could not fetch OpenMeteo extended forecast for {resort_name}: {e}")
        return None

def fetch_forecast(resort='Val-Thorens', elevation='bot'):
    """Fetch forecast data for a specific resort and elevation"""
    url = f'https://www.snow-forecast.com/resorts/{resort}/6day/{elevation}'
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
    }
    
    response = requests.get(url, headers=headers, timeout=30)
    soup = BeautifulSoup(response.content, 'html.parser')
    
    # Extract current snow conditions
    snow_conditions = {}
    snow_table = soup.find('table', class_='snow-depths-table__table')
    if snow_table:
        rows = snow_table.find_all('tr')
        for row in rows:
            header_cell = row.find('th')
            value_cell = row.find('td')
            if header_cell and value_cell:
                key = header_cell.get_text(strip=True).replace(':', '')
                value = value_cell.get_text(strip=True)
                if key:
                    snow_conditions[key] = value
    
    # Find forecast table
    forecast_table = soup.find('table', class_='forecast-table__table')
    if not forecast_table:
        return None
    
    # Extract all data rows
    days_row = forecast_table.find('tr', {'data-row': 'days'})
    time_row = forecast_table.find('tr', {'data-row': 'time'})
    weather_row = forecast_table.find('tr', {'data-row': 'weather'})
    temp_row = forecast_table.find('tr', {'data-row': 'temperature-max'})
    chill_row = forecast_table.find('tr', {'data-row': 'temperature-chill'})
    snow_row = forecast_table.find('tr', {'data-row': 'snow'})
    rain_row = forecast_table.find('tr', {'data-row': 'rain'})
    wind_row = forecast_table.find('tr', {'data-row': 'wind'})
    
    # Parse days
    day_cells = days_row.find_all('td', class_='forecast-table-days__cell')
    days_info = []
    for cell in day_cells:
        day_name_elem = cell.find('div', class_='forecast-table-days__name')
        day_date_elem = cell.find('div', class_='forecast-table-days__date')
        if day_name_elem and day_date_elem:
            days_info.append({
                'name': day_name_elem.text.strip(),
                'date': day_date_elem.text.strip()
            })
    
    # Parse time periods
    time_cells = time_row.find_all('td')[1:]  # Skip first cell (label)
    time_periods = [cell.text.strip() for cell in time_cells]
    
    # Parse weather conditions
    weather_cells = weather_row.find_all('td', class_='forecast-table__cell')
    weather_data = []
    for cell in weather_cells:
        # Try multiple methods to get weather condition
        img = cell.find('img')
        if img and img.has_attr('alt'):
            weather_data.append(img['alt'])
        else:
            condition_elem = cell.find('div', class_='weather-icon')
            condition = condition_elem.get('title', '') if condition_elem else ''
            weather_data.append(condition)
    
    # Parse temperatures
    temp_cells = temp_row.find_all('td', class_='forecast-table__cell')
    temp_data = []
    for cell in temp_cells:
        temp_elem = cell.find('div', class_='temp-value')
        if temp_elem and temp_elem.has_attr('data-value'):
            temp_data.append(temp_elem['data-value'])
        else:
            temp_data.append(None)
    
    # Parse feels like (chill) temperatures
    chill_data = []
    if chill_row:
        chill_cells = chill_row.find_all('td', class_='forecast-table__cell')
        for cell in chill_cells:
            chill_elem = cell.find('div', class_='temp-value')
            if chill_elem and chill_elem.has_attr('data-value'):
                chill_data.append(chill_elem['data-value'])
            else:
                chill_data.append(None)
    else:
        # If no chill data, use regular temp as fallback
        chill_data = temp_data.copy()
    
    # Parse snow
    snow_cells = snow_row.find_all('td', class_='forecast-table__cell')
    snow_data = []
    for cell in snow_cells:
        snow_val = cell.find('span', class_='snow-amount__value')
        if snow_val:
            snow_data.append(snow_val.text.strip())
        else:
            snow_data.append('0')
    
    # Parse rain
    rain_cells = rain_row.find_all('td', class_='forecast-table__cell')
    rain_data = []
    for cell in rain_cells:
        rain_val = cell.find('span', class_='rain-amount__value')
        if rain_val:
            rain_data.append(rain_val.text.strip())
        else:
            rain_data.append('0')
    
    # Parse wind
    wind_cells = wind_row.find_all('td', class_='forecast-table__cell')
    wind_data = []
    for cell in wind_cells:
        wind_icon = cell.find('div', class_='wind-icon')
        if wind_icon and wind_icon.has_attr('data-speed'):
            speed = wind_icon['data-speed']
            # Get wind direction from rotation
            arrow = wind_icon.find('g', class_='wind-icon__arrow')
            direction = ''
            if arrow and arrow.has_attr('transform'):
                transform = arrow['transform']
                # Extract rotation angle and convert to direction
                import re
                match = re.search(r'rotate\((\d+)\)', transform)
                if match:
                    angle = int(match.group(1))
                    # Convert angle to compass direction
                    directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
                    idx = round(angle / 45) % 8
                    direction = directions[idx]
            wind_str = f"{speed} km/h"
            if direction:
                wind_str += f" {direction}"
            wind_data.append(wind_str)
        else:
            wind_data.append('')
    
    # Organize data by days
    days = []
    cell_idx = 0
    for day_info in days_info:
        day_data = {
            'name': day_info['name'],
            'date': day_info['date'],
            'am': None,
            'pm': None,
            'night': None
        }
        
        # Each day has 3 periods: AM, PM, night
        for period in ['am', 'pm', 'night']:
            if cell_idx < len(time_periods):
                day_data[period] = {
                    'condition': weather_data[cell_idx] if cell_idx < len(weather_data) else '',
                    'temperature': temp_data[cell_idx] if cell_idx < len(temp_data) else None,
                    'feels_like': chill_data[cell_idx] if cell_idx < len(chill_data) else None,
                    'snow': snow_data[cell_idx] if cell_idx < len(snow_data) else '0',
                    'rain': rain_data[cell_idx] if cell_idx < len(rain_data) else '0',
                    'wind': wind_data[cell_idx] if cell_idx < len(wind_data) else ''
                }
                cell_idx += 1
        
        days.append(day_data)
    
    result = {
        'days': days,
        'last_updated': datetime.now().isoformat(),
        'resort': resort,
        'elevation': elevation
    }
    
    # Add snow conditions if available
    if snow_conditions:
        result['snow_conditions'] = snow_conditions
    
    return result

def fill_missing_days_from_openmeteo(snow_forecast_data, extended_forecast, target_days=7):
    """
    Fill missing days to reach target_days using OpenMeteo extended forecast data.
    Converts OpenMeteo daily data into the snow-forecast.com format with AM/PM/Night periods.
    """
    if not extended_forecast or 'extended_forecast' not in extended_forecast:
        return snow_forecast_data
    
    current_days = snow_forecast_data.get('days', [])
    if len(current_days) >= target_days:
        return snow_forecast_data  # Already have enough days
    
    # Get the dates we already have
    existing_dates = set()
    for day in current_days:
        if 'date' in day:
            # Convert to full date for comparison
            from datetime import datetime
            today = datetime.now()
            day_num = int(day['date'])
            existing_dates.add(f"{today.year}-{today.month:02d}-{day_num:02d}")
    
    # Map weather codes to conditions
    def weather_code_to_condition(code):
        weather_map = {
            0: 'clear', 1: 'clear', 2: 'part cloud', 3: 'cloud',
            45: 'fog', 48: 'fog',
            51: 'light drizzle', 53: 'drizzle', 55: 'drizzle',
            61: 'light rain', 63: 'rain', 65: 'rain',
            71: 'light snow', 73: 'snow', 75: 'snow showers',
            77: 'snow', 80: 'rain showers', 81: 'rain showers', 82: 'rain showers',
            85: 'snow showers', 86: 'snow showers',
            95: 'thunderstorm', 96: 'thunderstorm', 99: 'thunderstorm'
        }
        return weather_map.get(code, 'cloud')
    
    # Add missing days from extended forecast
    days_added = 0
    for ext_day in extended_forecast['extended_forecast']:
        if len(current_days) >= target_days:
            break
            
        # Check if this date is already in our forecast
        if ext_day['date'] in existing_dates:
            continue
        
        # Extract date parts
        date_parts = ext_day['date'].split('-')
        day_num = date_parts[2].lstrip('0')  # Remove leading zero
        
        # Create periods (AM/PM/Night) from daily data
        # We'll approximate since OpenMeteo gives us daily averages
        temp_avg = (ext_day['temp_max'] + ext_day['temp_min']) / 2
        snowfall_total = ext_day.get('snowfall', 0)
        rain_total = ext_day.get('rain', 0)
        condition = weather_code_to_condition(ext_day.get('weather_code', 3))
        
        # Distribute snow across periods (mostly at night in mountains)
        snow_night = round(snowfall_total * 0.5, 1) if snowfall_total > 0 else 0
        snow_am = round(snowfall_total * 0.3, 1) if snowfall_total > 0 else 0
        snow_pm = round(snowfall_total * 0.2, 1) if snowfall_total > 0 else 0
        
        new_day = {
            'name': ext_day['day_name'],
            'date': day_num,
            'am': {
                'condition': condition,
                'temperature': f"{ext_day['temp_min']:.1f}",
                'feels_like': f"{ext_day['temp_min'] - 3:.1f}",  # Approximate wind chill
                'snow': str(snow_am),
                'rain': str(round(rain_total * 0.3, 1)),
                'wind': '10.0 km/h W'  # Default wind
            },
            'pm': {
                'condition': condition,
                'temperature': f"{ext_day['temp_max']:.1f}",
                'feels_like': f"{ext_day['temp_max'] - 2:.1f}",
                'snow': str(snow_pm),
                'rain': str(round(rain_total * 0.4, 1)),
                'wind': '10.0 km/h W'
            },
            'night': {
                'condition': condition,
                'temperature': f"{temp_avg:.1f}",
                'feels_like': f"{temp_avg - 4:.1f}",
                'snow': str(snow_night),
                'rain': str(round(rain_total * 0.3, 1)),
                'wind': '5.0 km/h W'
            }
        }
        
        current_days.append(new_day)
        days_added += 1
    
    if days_added > 0:
        print(f"  ✓ Added {days_added} day(s) from OpenMeteo to reach {len(current_days)} days")
    
    snow_forecast_data['days'] = current_days
    return snow_forecast_data

def main():
    """Generate forecast data for all resorts and elevations."""
    
    # Create data directory if it doesn't exist
    os.makedirs('data', exist_ok=True)
    
    # Resort coordinates for extended forecast
    resort_coords = {
        'Val-Thorens': {'lat': 45.2973, 'lon': 6.5801},
        'Cervinia': {'lat': 45.9333, 'lon': 7.6294},
        'Via-Lattea': {'lat': 45.0, 'lon': 6.8833},  # Sestriere
        'Monterosa-Ski': {'lat': 45.8333, 'lon': 7.7167},  # Champoluc
        'Gudauri': {'lat': 42.4789, 'lon': 44.4728},
        'St-Anton': {'lat': 47.1275, 'lon': 10.2639},
        'Alpe-d-Huez': {'lat': 45.0908, 'lon': 6.0714},
        'La-Plagne': {'lat': 45.5052, 'lon': 6.6782},
        'Mount-Hermon': {'lat': 33.4162, 'lon': 35.8572}
    }
    
    # Elevation heights in meters for each resort
    elevation_heights = {
        'Val-Thorens': {'bot': 2300, 'mid': 2800, 'top': 3230},
        'Cervinia': {'bot': 2050, 'mid': 2900, 'top': 3480},
        'Via-Lattea': {'bot': 1350, 'mid': 2100, 'top': 2823},
        'Monterosa-Ski': {'bot': 1212, 'mid': 2200, 'top': 3275},
        'Gudauri': {'bot': 1990, 'mid': 2350, 'top': 3279},
        'St-Anton': {'bot': 1304, 'mid': 2150, 'top': 2811},
        'Alpe-d-Huez': {'bot': 1250, 'mid': 2350, 'top': 3330},
        'La-Plagne': {'bot': 1250, 'mid': 2250, 'top': 3250},
        'Mount-Hermon': {'bot': 1600, 'mid': 2000, 'top': 2236}
    }
    
    # Map internal keys to snow-forecast.com resort names
    snow_forecast_names = {
        'Val-Thorens': 'Val-Thorens',
        'Cervinia': 'Cervinia',
        'Via-Lattea': 'Sestriere',
        'Monterosa-Ski': 'Champoluc',
        'Gudauri': 'Gudauri',
        'St-Anton': 'St-Anton',
        'Alpe-d-Huez': 'Alpe-d-Huez',
        'La-Plagne': 'La-Plagne',
        'Mount-Hermon': 'mounthermon'
    }
    
    resorts = {
        'Val-Thorens': ['bot', 'mid', 'top'],
        'Cervinia': ['bot', 'mid', 'top'],
        'Via-Lattea': ['bot', 'mid', 'top'],
        'Monterosa-Ski': ['bot', 'mid', 'top'],
        'Gudauri': ['bot', 'mid', 'top'],
        'St-Anton': ['bot', 'mid', 'top'],
        'Alpe-d-Huez': ['bot', 'mid', 'top'],
        'La-Plagne': ['bot', 'mid', 'top'],
        'Mount-Hermon': ['bot', 'mid', 'top']
    }
    
    # Initialize OpenWeather API if available
    openweather_api = None
    if OPENWEATHER_AVAILABLE:
        api_key = os.environ.get('OPENWEATHER_API_KEY')
        if api_key:
            openweather_api = OpenWeatherAPI(api_key)
            print("✓ OpenWeather API initialized")
        else:
            print("⚠ OPENWEATHER_API_KEY not set, using snow-forecast.com only")
    
    # Initialize Weather Unlocked API if available
    weatherunlocked_api = None
    if WEATHERUNLOCKED_AVAILABLE:
        app_id = os.environ.get('WEATHERUNLOCKED_APP_ID')
        app_key = os.environ.get('WEATHERUNLOCKED_KEY')
        if app_id and app_key:
            weatherunlocked_api = WeatherUnlockedAPI(app_id, app_key)
            print("✓ Weather Unlocked API initialized")
        else:
            print("⚠ Weather Unlocked credentials not set")
    
    all_data = {}
    
    for resort, elevations in resorts.items():
        all_data[resort] = {}
        
        for elevation in elevations:
            print(f"\nFetching {resort} - {elevation}...")
            try:
                # Get the snow-forecast.com name for this resort
                snow_forecast_name = snow_forecast_names.get(resort, resort)
                
                # Fetch from snow-forecast.com
                forecast_data = fetch_forecast(resort=snow_forecast_name, elevation=elevation)
                
                # Try to fetch from OpenWeather and combine
                if openweather_api and forecast_data:
                    try:
                        print(f"  → Fetching OpenWeather data...")
                        ow_data = openweather_api.get_forecast(resort=resort, elevation=elevation)
                        if ow_data:
                            forecast_data = compare_forecasts(forecast_data, ow_data)
                            print(f"  ✓ Combined data from OpenWeather")
                    except Exception as e:
                        print(f"  ⚠ OpenWeather fetch failed: {e}")
                
                # Try to fetch from Weather Unlocked and combine
                if weatherunlocked_api and forecast_data:
                    try:
                        print(f"  → Fetching Weather Unlocked data...")
                        wu_data = weatherunlocked_api.get_forecast(resort=resort, elevation=elevation)
                        if wu_data:
                            forecast_data = compare_with_weatherunlocked(forecast_data, wu_data)
                            print(f"  ✓ Combined data from Weather Unlocked")
                    except Exception as e:
                        print(f"  ⚠ Weather Unlocked fetch failed: {e}")
                
                if forecast_data and 'days' in forecast_data:
                    all_data[resort][elevation] = forecast_data
                    
                    # Save individual file
                    filename = f"data/{resort.lower()}-{elevation}.json"
                    with open(filename, 'w') as f:
                        json.dump(forecast_data, f, indent=2, default=str)
                    print(f"  ✓ Saved {filename}")
                else:
                    print(f"  ✗ No data for {resort} - {elevation}")
                    
            except Exception as e:
                print(f"  ✗ Error fetching {resort} - {elevation}: {e}")
                import traceback
                traceback.print_exc()
            
            # Fetch 16-day extended forecast for this elevation
            print(f"  → Fetching extended forecast for {elevation}...")
            coords = resort_coords.get(resort)
            elev_height = elevation_heights.get(resort, {}).get(elevation)
            if coords and elev_height:
                extended = fetch_openmeteo_extended(coords['lat'], coords['lon'], resort, elevation_m=elev_height)
                if extended:
                    # Store extended forecast within the elevation data
                    if elevation in all_data[resort]:
                        all_data[resort][elevation]['extended'] = extended
                        
                        # Fill missing days to get 7-day forecast
                        if 'days' in all_data[resort][elevation]:
                            all_data[resort][elevation] = fill_missing_days_from_openmeteo(
                                all_data[resort][elevation],
                                extended,
                                target_days=7
                            )
                            
                            # Re-save individual file with complete 7 days
                            filename = f"data/{resort.lower()}-{elevation}.json"
                            with open(filename, 'w') as f:
                                json.dump(all_data[resort][elevation], f, indent=2, default=str)
                            print(f"  ✓ Updated {filename} with complete forecast")
                    else:
                        all_data[resort][elevation] = {'extended': extended}
    
    # Save combined file
    with open('data/all-forecasts.json', 'w') as f:
        json.dump(all_data, f, indent=2, default=str)
    print("\n✓ Saved data/all-forecasts.json")
    
    # Create metadata file
    metadata = {
        'last_updated': datetime.now().isoformat(),
        'resorts': list(resorts.keys()),
        'elevations': ['bot', 'mid', 'top']
    }
    with open('data/metadata.json', 'w') as f:
        json.dump(metadata, f, indent=2)
    print("✓ Saved data/metadata.json")
    
    print("\n✅ All forecast data generated successfully!")

if __name__ == '__main__':
    main()
