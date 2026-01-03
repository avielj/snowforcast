#!/usr/bin/env python3
"""
Weather Unlocked API Integration
Provides detailed weather and snow forecast data
"""

import requests
import os
from datetime import datetime

class WeatherUnlockedAPI:
    """Integration with Weather Unlocked API"""
    
    def __init__(self, app_id=None, app_key=None):
        self.app_id = app_id or os.environ.get('WEATHERUNLOCKED_APP_ID', '24fbe7db')
        self.app_key = app_key or os.environ.get('WEATHERUNLOCKED_KEY', 'c553a3a126b8b8eb808f36548c1ed467')
        self.base_url = 'http://api.weatherunlocked.com/api'
        
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
            },
            'Via-Lattea': {
                'bot': {'lat': 45.0, 'lon': 6.88},       # 1350m
                'mid': {'lat': 45.01, 'lon': 6.89},      # 2100m
                'top': {'lat': 45.02, 'lon': 6.90}       # 2823m
            },
            'Monterosa-Ski': {
                'bot': {'lat': 45.83, 'lon': 7.71},      # 1212m
                'mid': {'lat': 45.84, 'lon': 7.72},      # 2200m
                'top': {'lat': 45.85, 'lon': 7.73}       # 3275m
            },
            'Gudauri': {
                'bot': {'lat': 42.47, 'lon': 44.47},     # 1990m
                'mid': {'lat': 42.48, 'lon': 44.48},     # 2350m
                'top': {'lat': 42.49, 'lon': 44.49}      # 3279m
            },
            'St-Anton': {
                'bot': {'lat': 47.12, 'lon': 10.26},     # 1304m
                'mid': {'lat': 47.13, 'lon': 10.27},     # 2150m
                'top': {'lat': 47.14, 'lon': 10.28}      # 2811m
            },
            'Alpe-d-Huez': {
                'bot': {'lat': 45.09, 'lon': 6.07},      # 1250m
                'mid': {'lat': 45.10, 'lon': 6.08},      # 2350m
                'top': {'lat': 45.11, 'lon': 6.09}       # 3330m
            },
            'Mount-Hermon': {
                'bot': {'lat': 33.4150, 'lon': 35.8560}, # 1600m
                'mid': {'lat': 33.4162, 'lon': 35.8572}, # 2000m
                'top': {'lat': 33.4174, 'lon': 35.8584}  # 2236m
            }
        }
    
    def get_forecast(self, resort='Val-Thorens', elevation='mid', days=7):
        """
        Fetch weather forecast with snow data
        
        Args:
            resort: Resort name
            elevation: 'bot', 'mid', or 'top'
            days: Number of days (up to 7)
        
        Returns:
            dict: Forecast data with daily snow accumulation, temps, conditions
        """
        if not self.app_id or not self.app_key:
            raise ValueError("Weather Unlocked API credentials not set")
        
        coords = self.resort_coords.get(resort, {}).get(elevation)
        if not coords:
            raise ValueError(f"Invalid resort/elevation: {resort}/{elevation}")
        
        # Weather Unlocked uses lat,lon format
        location = f"{coords['lat']},{coords['lon']}"
        
        # Forecast endpoint
        url = f"{self.base_url}/forecast/{location}"
        
        params = {
            'app_id': self.app_id,
            'app_key': self.app_key
        }
        
        try:
            response = requests.get(url, params=params, timeout=30)
            response.raise_for_status()
            data = response.json()
            
            return self._format_forecast(data, resort, elevation, days)
            
        except requests.RequestException as e:
            print(f"Error fetching Weather Unlocked data: {e}")
            return None
    
    def _format_forecast(self, data, resort, elevation, days=7):
        """Format Weather Unlocked forecast data to match our app structure"""
        
        forecast_days = []
        
        # Weather Unlocked returns 'Days' array
        raw_days = data.get('Days', [])[:days]
        
        for day_data in raw_days:
            date_str = day_data.get('date', '')
            date = datetime.strptime(date_str, '%d/%m/%Y') if date_str else datetime.now()
            
            # Get timeframes (Morning, Afternoon, Evening, Night)
            timeframes = day_data.get('Timeframes', [])
            
            # Initialize period data
            am_data = None
            pm_data = None
            night_data = None
            
            for tf in timeframes:
                time = tf.get('time', '')
                
                # Extract weather data
                temp = tf.get('temp_c', 0)
                feels_like = tf.get('feelslike_c', temp)
                precip = tf.get('precip_mm', 0)
                snow = tf.get('snow_cm', 0)
                wind_speed = tf.get('windspd_kmh', 0)
                wind_dir = tf.get('winddir_compass', '')
                weather_desc = tf.get('wx_desc', 'Clear')
                
                period_data = {
                    'condition': weather_desc.lower(),
                    'temperature': str(temp),
                    'feels_like': str(feels_like),
                    'snow': str(snow) if snow > 0 else '0',
                    'rain': str(precip - (snow * 10)) if precip > 0 and snow == 0 else '0',  # Rough conversion
                    'wind': f"{wind_speed} km/h {wind_dir}"
                }
                
                # Map timeframes to our periods
                if '0' <= time < '12':  # Morning
                    am_data = period_data
                elif '12' <= time < '18':  # Afternoon
                    pm_data = period_data
                else:  # Evening/Night
                    night_data = period_data
            
            # Use default values if periods are missing
            default_period = {
                'condition': 'cloud',
                'temperature': '0',
                'feels_like': '0',
                'snow': '0',
                'rain': '0',
                'wind': '0 km/h'
            }
            
            forecast_days.append({
                'name': date.strftime('%A'),
                'date': date.strftime('%d'),
                'am': am_data or default_period.copy(),
                'pm': pm_data or default_period.copy(),
                'night': night_data or default_period.copy()
            })
        
        return {
            'days': forecast_days,
            'last_updated': datetime.now().isoformat(),
            'resort': resort,
            'elevation': elevation,
            'source': 'WeatherUnlocked'
        }
    
    def get_current_weather(self, resort='Val-Thorens', elevation='mid'):
        """
        Fetch current weather conditions
        
        Returns:
            dict: Current weather data
        """
        if not self.app_id or not self.app_key:
            raise ValueError("Weather Unlocked API credentials not set")
        
        coords = self.resort_coords.get(resort, {}).get(elevation)
        if not coords:
            raise ValueError(f"Invalid resort/elevation: {resort}/{elevation}")
        
        location = f"{coords['lat']},{coords['lon']}"
        url = f"{self.base_url}/current/{location}"
        
        params = {
            'app_id': self.app_id,
            'app_key': self.app_key
        }
        
        try:
            response = requests.get(url, params=params, timeout=30)
            response.raise_for_status()
            data = response.json()
            
            return {
                'temperature': data.get('temp_c'),
                'feels_like': data.get('feelslike_c'),
                'condition': data.get('wx_desc'),
                'humidity': data.get('humid_pct'),
                'wind_speed': data.get('windspd_kmh'),
                'wind_direction': data.get('winddir_compass'),
                'visibility': data.get('vis_km'),
                'pressure': data.get('slp_mb'),
                'last_updated': datetime.now().isoformat()
            }
            
        except requests.RequestException as e:
            print(f"Error fetching current weather: {e}")
            return None


def compare_with_weatherunlocked(snow_forecast_data, wu_data):
    """
    Compare and merge snow-forecast.com data with Weather Unlocked data
    Returns enhanced forecast with best data from both sources
    """
    if not wu_data or 'days' not in wu_data:
        return snow_forecast_data
    
    # Add Weather Unlocked as additional data source
    if 'sources' not in snow_forecast_data:
        snow_forecast_data['sources'] = ['snow-forecast.com']
    
    if 'WeatherUnlocked' not in snow_forecast_data['sources']:
        snow_forecast_data['sources'].append('WeatherUnlocked')
    
    # Merge the forecasts day by day
    sf_days = snow_forecast_data.get('days', [])
    wu_days = wu_data.get('days', [])
    
    for i, sf_day in enumerate(sf_days):
        if i < len(wu_days):
            wu_day = wu_days[i]
            
            # Add Weather Unlocked data as comparison
            for period in ['am', 'pm', 'night']:
                if period in sf_day and period in wu_day:
                    sf_period = sf_day[period]
                    wu_period = wu_day[period]
                    
                    # Add WU data as alternative
                    sf_period['wu_temp'] = wu_period.get('temperature')
                    sf_period['wu_snow'] = wu_period.get('snow')
                    sf_period['wu_condition'] = wu_period.get('condition')
    
    return snow_forecast_data
