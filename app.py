#!/usr/bin/env python3
"""
Flask web application for Val Thorens Snow Forecast
"""

from flask import Flask, render_template_string, jsonify, send_from_directory, request
import os
import json
import requests
from bs4 import BeautifulSoup
from snow_forecast_parser import SnowForecastParser
from enhanced_snow_forecast_parser import EnhancedSnowForecastParser

app = Flask(__name__)

# Get the directory where this script is located
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

@app.route('/')
def index():
    """Serve the main forecast page"""
    html_path = os.path.join(BASE_DIR, 'forecast.html')
    try:
        with open(html_path, 'r') as f:
            return f.read()
    except FileNotFoundError:
        return "Forecast page not found", 404

@app.route('/val_thorens_forecast.json')
def get_forecast_json():
    """Serve the forecast JSON data"""
    json_path = os.path.join(BASE_DIR, 'val_thorens_forecast.json')
    try:
        with open(json_path, 'r') as f:
            data = json.load(f)
        return jsonify(data)
    except FileNotFoundError:
        return jsonify({"error": "Forecast data not found"}), 404

@app.route('/api/refresh')
def refresh_forecast():
    """API endpoint to refresh basic forecast data"""
    try:
        parser = SnowForecastParser()
        forecast_data = parser.get_forecast()
        
        if forecast_data:
            # Save updated data
            json_path = os.path.join(BASE_DIR, 'val_thorens_forecast.json')
            with open(json_path, 'w') as f:
                json.dump(forecast_data, f, indent=2, default=str)
            
            return jsonify({
                "status": "success",
                "message": "Basic forecast updated successfully",
                "data": forecast_data
            })
        else:
            return jsonify({
                "status": "error",
                "message": "Failed to fetch forecast data"
            }), 500
    
    except Exception as e:
        return jsonify({
            "status": "error",
            "message": f"Error updating forecast: {str(e)}"
        }), 500

@app.route('/api/refresh-comprehensive')
def refresh_comprehensive_forecast():
    """API endpoint to refresh comprehensive forecast data from all elevations"""
    try:
        parser = EnhancedSnowForecastParser()
        forecast_data = parser.get_comprehensive_forecast()
        
        if forecast_data:
            # Save updated data
            json_path = os.path.join(BASE_DIR, 'comprehensive_val_thorens_forecast.json')
            with open(json_path, 'w') as f:
                json.dump(forecast_data, f, indent=2, default=str)
            
            return jsonify({
                "status": "success",
                "message": "Comprehensive forecast updated successfully",
                "data": forecast_data
            })
        else:
            return jsonify({
                "status": "error",
                "message": "Failed to fetch comprehensive forecast data"
            }), 500
    
    except Exception as e:
        return jsonify({
            "status": "error",
            "message": f"Error updating comprehensive forecast: {str(e)}"
        }), 500

@app.route('/comprehensive_val_thorens_forecast.json')
def get_comprehensive_forecast_json():
    """Serve the comprehensive forecast JSON data"""
    json_path = os.path.join(BASE_DIR, 'comprehensive_val_thorens_forecast.json')
    try:
        with open(json_path, 'r') as f:
            data = json.load(f)
        return jsonify(data)
    except FileNotFoundError:
        return jsonify({"error": "Comprehensive forecast data not found"}), 404

@app.route('/api/forecast')
def get_formatted_forecast():
    """API endpoint to get forecast data in day-by-day format"""
    try:
        # Get elevation parameter (bot, mid, or top)
        elevation = request.args.get('elevation', 'bot')
        resort = request.args.get('resort', 'Val-Thorens')
        
        # Validate elevation
        if elevation not in ['bot', 'mid', 'top']:
            elevation = 'bot'
        
        # Validate resort
        valid_resorts = ['Val-Thorens', 'Cervinia']
        if resort not in valid_resorts:
            resort = 'Val-Thorens'
        
        # Fetch fresh data from snow-forecast.com
        url = f'https://www.snow-forecast.com/resorts/{resort}/6day/{elevation}'
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Cookie': 's_fid=browse'
        }
        
        response = requests.get(url, headers=headers, timeout=30)
        soup = BeautifulSoup(response.content, 'html.parser')
        
        # Find forecast table
        forecast_table = soup.find('table', class_='forecast-table__table')
        if not forecast_table:
            return jsonify({"error": "Forecast table not found"}), 404
        
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
                    'name': day_name_elem.get_text(strip=True),
                    'date': day_date_elem.get_text(strip=True),
                    'colspan': int(cell.get('colspan', '3'))
                })
        
        # Parse times
        time_cells = time_row.find_all('td', class_='forecast-table__cell')
        times = [cell.get_text(strip=True) for cell in time_cells]
        
        # Parse weather conditions
        weather_cells = weather_row.find_all('td', class_='forecast-table__cell')
        conditions = []
        for cell in weather_cells:
            img = cell.find('img')
            conditions.append(img.get('alt', 'Unknown') if img else 'N/A')
        
        # Parse temperatures
        temp_cells = temp_row.find_all('td', class_='forecast-table__cell') if temp_row else []
        temperatures = []
        for cell in temp_cells:
            # Look for div with class temp-value and data-value attribute
            temp_div = cell.find('div', class_='temp-value')
            if temp_div and temp_div.get('data-value'):
                temp_val = temp_div.get('data-value')
                temperatures.append(temp_val)
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
        
        # Build day-by-day structure
        forecast_days = []
        cell_index = 0
        
        for day in days_info:
            day_data = {
                'name': day['name'],
                'date': day['date'],
                'am': None,
                'pm': None,
                'night': None
            }
            
            # Get AM, PM, Night data
            periods = ['am', 'pm', 'night']
            for i in range(min(day['colspan'], 3)):
                if cell_index >= len(times):
                    break
                
                period_data = {
                    'condition': conditions[cell_index] if cell_index < len(conditions) else 'N/A',
                    'temperature': temperatures[cell_index] if cell_index < len(temperatures) else 'N/A',
                    'snow': snow_amounts[cell_index] if cell_index < len(snow_amounts) else '0',
                    'rain': rain_amounts[cell_index] if cell_index < len(rain_amounts) else '0',
                    'wind': wind_data[cell_index] if cell_index < len(wind_data) else 'N/A'
                }
                
                day_data[periods[i]] = period_data
                cell_index += 1
            
            forecast_days.append(day_data)
        
        return jsonify({
            'days': forecast_days,
            'last_updated': None
        })
        
    except Exception as e:
        import traceback
        print(f"Error in get_formatted_forecast: {str(e)}")
        print(traceback.format_exc())
        return jsonify({"error": str(e)}), 500

@app.route('/forecast.html')
def forecast_page():
    """Serve the forecast HTML page"""
    html_path = os.path.join(BASE_DIR, 'forecast.html')
    try:
        with open(html_path, 'r') as f:
            return f.read()
    except FileNotFoundError:
        return "Forecast page not found", 404

@app.route('/api/status')
def get_status():
    """API endpoint to check service status"""
    json_path = os.path.join(BASE_DIR, 'val_thorens_forecast.json')
    file_exists = os.path.exists(json_path)
    
    last_modified = None
    if file_exists:
        last_modified = os.path.getmtime(json_path)
    
    return jsonify({
        "status": "online",
        "forecast_available": file_exists,
        "last_updated": last_modified
    })

if __name__ == '__main__':
    print("Starting Val Thorens Snow Forecast Web App...")
    print(f"Base directory: {BASE_DIR}")
    
    # Generate initial forecast data if it doesn't exist
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
    
    # Run the app
    port = int(os.environ.get('PORT', 8080))
    app.run(debug=False, host='0.0.0.0', port=port)