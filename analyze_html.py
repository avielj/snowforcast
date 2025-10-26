#!/usr/bin/env python3
"""
Script to analyze the HTML structure of snow-forecast.com
and extract real forecast data in a day-by-day format
"""

import requests
from bs4 import BeautifulSoup
import json

def fetch_and_analyze(url, elevation_name):
    """Fetch and analyze HTML structure, displaying day-by-day forecast"""
    print(f"\n{'='*80}")
    print(f"📍 {elevation_name}")
    print(f"{'='*80}")
    
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Cookie': 's_fid=browse'
    }
    
    response = requests.get(url, headers=headers, timeout=30)
    soup = BeautifulSoup(response.content, 'html.parser')
    
    # Save HTML to file for inspection
    with open('forecast_page.html', 'w', encoding='utf-8') as f:
        f.write(soup.prettify())
    print("✓ HTML saved to forecast_page.html")
    
    # Find forecast table
    forecast_table = soup.find('table', class_='forecast-table__table')
    if not forecast_table:
        print("❌ Forecast table not found")
        return
    
    # Extract all data rows
    days_row = forecast_table.find('tr', {'data-row': 'days'})
    time_row = forecast_table.find('tr', {'data-row': 'time'})
    weather_row = forecast_table.find('tr', {'data-row': 'weather'})
    temp_row = forecast_table.find('tr', {'data-row': 'temperature'})
    snow_row = forecast_table.find('tr', {'data-row': 'snow'})
    rain_row = forecast_table.find('tr', {'data-row': 'rain'})
    wind_row = forecast_table.find('tr', {'data-row': 'wind'})
    
    if not days_row or not time_row:
        print("❌ Required rows not found")
        return
    
    # Parse days
    day_cells = days_row.find_all('td', class_='forecast-table-days__cell')
    days_info = []
    for cell in day_cells:
        day_name_elem = cell.find('div', class_='forecast-table-days__name')
        day_date_elem = cell.find('div', class_='forecast-table-days__date')
        if day_name_elem and day_date_elem:
            days_info.append({
                'name': day_name_elem.get_text(strip=True),
                'date': day_date_elem.get_text(strip=True),
                'colspan': int(cell.get('colspan', '3'))
            })
    
    # Parse times
    time_cells = time_row.find_all('td', class_='forecast-table__cell')
    times = [cell.get_text(strip=True) for cell in time_cells]
    
    # Parse weather conditions
    weather_cells = weather_row.find_all('td', class_='forecast-table__cell') if weather_row else []
    conditions = []
    for cell in weather_cells:
        img = cell.find('img')
        conditions.append(img.get('alt', 'Unknown') if img else 'N/A')
    
    # Parse temperatures
    temp_cells = temp_row.find_all('td', class_='forecast-table__cell') if temp_row else []
    temperatures = []
    for cell in temp_cells:
        temp_span = cell.find('span', class_='temp-value')
        if temp_span:
            temperatures.append(temp_span.get('data-value', temp_span.get_text(strip=True)))
        else:
            temperatures.append('N/A')
    
    # Parse snow
    snow_cells = snow_row.find_all('td', class_='forecast-table__cell') if snow_row else []
    snow_amounts = []
    for cell in snow_cells:
        snow_span = cell.find('span', class_='snow-amount__value')
        snow_amounts.append(snow_span.get_text(strip=True) if snow_span else '0')
    
    # Parse rain
    rain_cells = rain_row.find_all('td', class_='forecast-table__cell') if rain_row else []
    rain_amounts = []
    for cell in rain_cells:
        rain_span = cell.find('span', class_='rain-amount__value')
        rain_amounts.append(rain_span.get_text(strip=True) if rain_span else '0')
    
    # Parse wind
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
    
    # Display day by day
    cell_index = 0
    for day in days_info:
        print(f"\n📅 {day['name']} - {day['date']}")
        print(f"{'─'*80}")
        
        # Display 3 columns (AM, PM, Night) for each day
        for i in range(day['colspan']):
            if cell_index >= len(times):
                break
                
            time_label = times[cell_index] if cell_index < len(times) else 'N/A'
            condition = conditions[cell_index] if cell_index < len(conditions) else 'N/A'
            temp = temperatures[cell_index] if cell_index < len(temperatures) else 'N/A'
            snow = snow_amounts[cell_index] if cell_index < len(snow_amounts) else '0'
            rain = rain_amounts[cell_index] if cell_index < len(rain_amounts) else '0'
            wind = wind_data[cell_index] if cell_index < len(wind_data) else 'N/A'
            
            print(f"\n  {time_label:^12}")
            print(f"  ⛅ {condition}")
            print(f"  🌡️  {temp}°C")
            print(f"  ❄️  Snow: {snow} cm")
            print(f"  🌧️  Rain: {rain} mm")
            print(f"  💨 Wind: {wind}")
            
            cell_index += 1

if __name__ == '__main__':
    # Test with bottom elevation first
    urls_to_test = [
        ('https://www.snow-forecast.com/resorts/Val-Thorens/6day/bot', 'Bottom (2300m)'),
    ]
    
    for url, name in urls_to_test:
        fetch_and_analyze(url, name)
