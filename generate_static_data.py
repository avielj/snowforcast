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
    weather_cells = weather_row.find_all('td')[1:]
    weather_data = []
    for cell in weather_cells:
        condition_elem = cell.find('div', class_='weather-icon')
        condition = condition_elem.get('title', '') if condition_elem else ''
        weather_data.append(condition)
    
    # Parse temperatures
    temp_cells = temp_row.find_all('td')[1:]
    temp_data = []
    for cell in temp_cells:
        temp_elem = cell.find('div', class_='temp-value')
        if temp_elem and temp_elem.has_attr('data-value'):
            temp_data.append(temp_elem['data-value'])
        else:
            temp_data.append(None)
    
    # Parse snow
    snow_cells = snow_row.find_all('td')[1:]
    snow_data = []
    for cell in snow_cells:
        snow_val = cell.find('span', class_='snow-amount__value')
        if snow_val:
            snow_data.append(snow_val.text.strip())
        else:
            snow_data.append('0')
    
    # Parse rain
    rain_cells = rain_row.find_all('td')[1:]
    rain_data = []
    for cell in rain_cells:
        rain_val = cell.find('span', class_='rain-amount__value')
        if rain_val:
            rain_data.append(rain_val.text.strip())
        else:
            rain_data.append('0')
    
    # Parse wind
    wind_cells = wind_row.find_all('td')[1:]
    wind_data = []
    for cell in wind_cells:
        wind_speed = cell.find('span', class_='wind-icon__val')
        wind_dir = cell.find('span', class_='wind-icon__tooltip')
        if wind_speed:
            wind_str = wind_speed.text.strip()
            if wind_dir:
                wind_str += f" {wind_dir.text.strip()}"
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

def main():
    """Generate forecast data for all resorts and elevations."""
    
    # Create data directory if it doesn't exist
    os.makedirs('data', exist_ok=True)
    
    resorts = {
        'Val-Thorens': ['bot', 'mid', 'top'],
        'Cervinia': ['bot', 'mid', 'top']
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
    
    all_data = {}
    
    for resort, elevations in resorts.items():
        all_data[resort] = {}
        
        for elevation in elevations:
            print(f"\nFetching {resort} - {elevation}...")
            try:
                # Fetch from snow-forecast.com
                forecast_data = fetch_forecast(resort=resort, elevation=elevation)
                
                # Try to fetch from OpenWeather and combine
                if openweather_api and forecast_data:
                    try:
                        print(f"  → Fetching OpenWeather data...")
                        ow_data = openweather_api.get_forecast(resort=resort, elevation=elevation)
                        if ow_data:
                            forecast_data = compare_forecasts(forecast_data, ow_data)
                            print(f"  ✓ Combined data from both sources")
                    except Exception as e:
                        print(f"  ⚠ OpenWeather fetch failed: {e}, using snow-forecast.com only")
                
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
