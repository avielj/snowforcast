#!/usr/bin/env python3
"""
OpenWeatherMap Free 5-Day Forecast API Integration
Provides snow forecast data with more accuracy and detail
Uses the FREE forecast API (no payment required)
"""

import requests
import os
from datetime import datetime

class OpenWeatherAPI:
    """Integration with OpenWeatherMap Free 5-Day Forecast API"""
    
    def __init__(self, api_key=None):
        self.api_key = api_key or os.environ.get('OPENWEATHER_API_KEY')
        self.base_url = 'https://api.openweathermap.org/data/2.5/forecast'
        
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
        Fetch 5-day forecast with snow data (FREE API)
        
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
            'cnt': 40  # 40 * 3-hour periods = 5 days
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
        """Format OpenWeather 5-day forecast data to match our app structure"""
        
        # Group 3-hour forecasts by day
        daily_data = {}
        
        for item in data.get('list', []):
            dt = datetime.fromtimestamp(item['dt'])
            date_key = dt.strftime('%Y-%m-%d')
            
            if date_key not in daily_data:
                daily_data[date_key] = {
                    'datetime': dt,
                    'day_name': dt.strftime('%A'),
                    'day_short': dt.strftime('%a'),
                    'temps': [],
                    'feels_like': [],
                    'snow': 0,
                    'rain': 0,
                    'conditions': [],
                    'clouds': [],
                    'humidity': [],
                    'wind_speed': [],
                    'wind_deg': [],
                    'pressure': [],
                    'pop': []
                }
            
            # Aggregate data for the day
            daily_data[date_key]['temps'].append(item['main']['temp'])
            daily_data[date_key]['feels_like'].append(item['main']['feels_like'])
            
            # Snow in 3h period (mm), convert to cm
            if 'snow' in item and '3h' in item['snow']:
                daily_data[date_key]['snow'] += item['snow']['3h'] / 10  # mm to cm
            
            # Rain in 3h period (mm)
            if 'rain' in item and '3h' in item['rain']:
                daily_data[date_key]['rain'] += item['rain']['3h']
            
            # Weather conditions
            if item.get('weather'):
                daily_data[date_key]['conditions'].append(item['weather'][0]['description'])
            
            # Other metrics
            daily_data[date_key]['clouds'].append(item.get('clouds', {}).get('all', 0))
            daily_data[date_key]['humidity'].append(item['main'].get('humidity', 0))
            daily_data[date_key]['wind_speed'].append(item['wind'].get('speed', 0))
            daily_data[date_key]['wind_deg'].append(item['wind'].get('deg', 0))
            daily_data[date_key]['pressure'].append(item['main'].get('pressure', 0))
            daily_data[date_key]['pop'].append(item.get('pop', 0))
        
        # Format daily forecasts
        daily_forecasts = []
        for date_key in sorted(daily_data.keys())[:7]:  # Max 7 days to match snow-forecast
            day = daily_data[date_key]
            
            # Most common condition
            condition = max(set(day['conditions']), key=day['conditions'].count) if day['conditions'] else 'N/A'
            
            daily_forecasts.append({
                'date': date_key,
                'day_name': day['day_name'],
                'day_short': day['day_short'],
                'temp': {
                    'min': round(min(day['temps']), 1),
                    'max': round(max(day['temps']), 1),
                    'avg': round(sum(day['temps']) / len(day['temps']), 1)
                },
                'feels_like': {
                    'min': round(min(day['feels_like']), 1),
                    'max': round(max(day['feels_like']), 1),
                    'avg': round(sum(day['feels_like']) / len(day['feels_like']), 1)
                },
                'snow_cm': round(day['snow'], 1),
                'rain_mm': round(day['rain'], 1),
                'condition': condition.title(),
                'clouds': round(sum(day['clouds']) / len(day['clouds'])) if day['clouds'] else 0,
                'humidity': round(sum(day['humidity']) / len(day['humidity'])) if day['humidity'] else 0,
                'wind_speed': round(sum(day['wind_speed']) / len(day['wind_speed']), 1) if day['wind_speed'] else 0,
                'wind_deg': round(sum(day['wind_deg']) / len(day['wind_deg'])) if day['wind_deg'] else 0,
                'pressure': round(sum(day['pressure']) / len(day['pressure'])) if day['pressure'] else 0,
                'pop': round(max(day['pop']) * 100) if day['pop'] else 0  # Max probability of precipitation as %
            })
        
        return {
            'resort': resort,
            'elevation': elevation,
            'coordinates': self.resort_coords[resort][elevation],
            'daily': daily_forecasts,
            'last_updated': datetime.now().isoformat(),
            'source': 'OpenWeatherMap Free 5-Day Forecast API'
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
