#!/usr/bin/env python3
"""
OpenWeatherMap One Call API 3.0 Integration
Provides snow forecast data with more accuracy and detail
"""

import requests
import os
from datetime import datetime

class OpenWeatherAPI:
    """Integration with OpenWeatherMap One Call API 3.0"""
    
    def __init__(self, api_key=None):
        self.api_key = api_key or os.environ.get('OPENWEATHER_API_KEY')
        self.base_url = 'https://api.openweathermap.org/data/3.0/onecall'
        
        # Resort coordinates
        self.resort_coords = {
            'Val-Thorens': {
                'bot': {'lat': 45.2958, 'lon': 6.5847},  # 2300m
                'mid': {'lat': 45.2975, 'lon': 6.5875},  # 2800m
                'top': {'lat': 45.2991, 'lon': 6.5891}   # 3230m
            },
            'Cervinia': {
                'bot': {'lat': 45.9339, 'lon': 7.6297},  # 2050m
                'mid': {'lat': 45.9356, 'lon': 7.6314},  # 2700m
                'top': {'lat': 45.9372, 'lon': 7.6331}   # 3480m
            }
        }
    
    def get_forecast(self, resort='Val-Thorens', elevation='mid'):
        """
        Fetch 8-day forecast with snow data
        
        Returns:
            dict: Forecast data with daily snow accumulation, temps, conditions
        """
        if not self.api_key:
            raise ValueError("OpenWeather API key not set. Set OPENWEATHER_API_KEY environment variable.")
        
        coords = self.resort_coords.get(resort, {}).get(elevation)
        if not coords:
            raise ValueError(f"Invalid resort/elevation: {resort}/{elevation}")
        
        params = {
            'lat': coords['lat'],
            'lon': coords['lon'],
            'appid': self.api_key,
            'units': 'metric',  # Celsius, m/s
            'exclude': 'minutely,alerts'  # We only need current, hourly, daily
        }
        
        try:
            response = requests.get(self.base_url, params=params, timeout=30)
            response.raise_for_status()
            data = response.json()
            
            return self._format_forecast(data, resort, elevation)
            
        except requests.RequestException as e:
            print(f"Error fetching OpenWeather data: {e}")
            return None
    
    def _format_forecast(self, data, resort, elevation):
        """Format OpenWeather data to match our app structure"""
        
        daily_forecasts = []
        
        for day in data.get('daily', [])[:8]:  # 8 days
            dt = datetime.fromtimestamp(day['dt'])
            
            # Extract snow data (in mm, convert to cm)
            snow_mm = day.get('snow', 0)
            snow_cm = round(snow_mm / 10, 1) if snow_mm else 0
            
            # Extract rain data
            rain_mm = day.get('rain', 0)
            
            # Weather condition
            weather = day.get('weather', [{}])[0]
            condition = weather.get('description', 'N/A')
            
            daily_forecasts.append({
                'date': dt.strftime('%Y-%m-%d'),
                'day_name': dt.strftime('%A'),
                'day_short': dt.strftime('%a'),
                'temp': {
                    'min': round(day['temp']['min'], 1),
                    'max': round(day['temp']['max'], 1),
                    'morning': round(day['temp']['morn'], 1),
                    'day': round(day['temp']['day'], 1),
                    'evening': round(day['temp']['eve'], 1),
                    'night': round(day['temp']['night'], 1)
                },
                'feels_like': {
                    'morning': round(day['feels_like']['morn'], 1),
                    'day': round(day['feels_like']['day'], 1),
                    'evening': round(day['feels_like']['eve'], 1),
                    'night': round(day['feels_like']['night'], 1)
                },
                'snow_cm': snow_cm,
                'rain_mm': rain_mm,
                'condition': condition.title(),
                'clouds': day.get('clouds', 0),
                'humidity': day.get('humidity', 0),
                'wind_speed': round(day.get('wind_speed', 0), 1),
                'wind_deg': day.get('wind_deg', 0),
                'pressure': day.get('pressure', 0),
                'uvi': day.get('uvi', 0),
                'pop': int(day.get('pop', 0) * 100),  # Probability of precipitation as %
                'summary': day.get('summary', '')
            })
        
        # Also include hourly forecast for next 48 hours
        hourly_forecasts = []
        for hour in data.get('hourly', [])[:48]:
            dt = datetime.fromtimestamp(hour['dt'])
            
            snow_mm = hour.get('snow', {}).get('1h', 0)
            snow_cm = round(snow_mm / 10, 1) if snow_mm else 0
            
            weather = hour.get('weather', [{}])[0]
            
            hourly_forecasts.append({
                'datetime': dt.isoformat(),
                'hour': dt.strftime('%H:%M'),
                'temp': round(hour['temp'], 1),
                'feels_like': round(hour['feels_like'], 1),
                'snow_cm': snow_cm,
                'rain_mm': hour.get('rain', {}).get('1h', 0),
                'condition': weather.get('description', 'N/A').title(),
                'wind_speed': round(hour.get('wind_speed', 0), 1),
                'pop': int(hour.get('pop', 0) * 100)
            })
        
        return {
            'resort': resort,
            'elevation': elevation,
            'coordinates': self.resort_coords[resort][elevation],
            'daily': daily_forecasts,
            'hourly': hourly_forecasts,
            'last_updated': datetime.now().isoformat(),
            'source': 'OpenWeatherMap One Call API 3.0'
        }


def compare_forecasts(snow_forecast_data, openweather_data):
    """
    Compare and average snow forecasts from both sources
    
    Returns:
        dict: Combined forecast with averages and comparison
    """
    if not openweather_data:
        return snow_forecast_data
    
    # Match days from both sources
    combined_days = []
    
    for sf_day in snow_forecast_data.get('days', []):
        # Find matching day in OpenWeather data
        ow_day = None
        for ow in openweather_data.get('daily', []):
            if ow['day_short'] == sf_day['name'][:3]:  # Match by day name
                ow_day = ow
                break
        
        if ow_day:
            # Calculate average snow from AM + PM + Night from snow-forecast
            sf_total_snow = 0
            for period in ['am', 'pm', 'night']:
                if sf_day.get(period):
                    sf_total_snow += float(sf_day[period].get('snow', 0) or 0)
            
            ow_snow = ow_day['snow_cm']
            
            # Average the two sources
            avg_snow = round((sf_total_snow + ow_snow) / 2, 1)
            
            combined_days.append({
                **sf_day,
                'snow_forecast_com': sf_total_snow,
                'openweather': ow_snow,
                'average_snow': avg_snow,
                'openweather_details': ow_day
            })
        else:
            combined_days.append(sf_day)
    
    return {
        **snow_forecast_data,
        'days': combined_days,
        'sources': ['snow-forecast.com', 'OpenWeatherMap']
    }


if __name__ == '__main__':
    # Test the API
    api_key = input("Enter your OpenWeather API key (or press Enter to use env var): ").strip()
    
    api = OpenWeatherAPI(api_key or None)
    
    print("\nFetching Val Thorens Mid forecast...")
    forecast = api.get_forecast('Val-Thorens', 'mid')
    
    if forecast:
        print(f"\n✅ Success! Got {len(forecast['daily'])} days of forecast")
        print(f"\nNext 3 days snow forecast:")
        for day in forecast['daily'][:3]:
            print(f"  {day['day_name']}: {day['snow_cm']} cm snow, {day['temp']['min']}°C to {day['temp']['max']}°C")
            print(f"    Condition: {day['condition']}, Precipitation chance: {day['pop']}%")
    else:
        print("\n❌ Failed to fetch forecast")
