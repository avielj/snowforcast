#!/usr/bin/env python3
"""Test OpenMeteo 16-day extended forecast API"""

import requests
from datetime import datetime

def test_openmeteo_extended():
    """Test OpenMeteo 16-day forecast API"""
    
    # Val Thorens coordinates
    latitude = 45.2973
    longitude = 6.5801
    
    url = "https://api.open-meteo.com/v1/forecast"
    
    params = {
        "latitude": latitude,
        "longitude": longitude,
        "daily": [
            "temperature_2m_max",
            "temperature_2m_min",
            "precipitation_sum",
            "snowfall_sum",
            "weathercode"
        ],
        "timezone": "Europe/Paris",
        "forecast_days": 16
    }
    
    print("Testing OpenMeteo Extended Forecast API...")
    print(f"Location: Val Thorens ({latitude}, {longitude})")
    print(f"URL: {url}")
    print(f"\nFetching 16-day forecast...\n")
    
    try:
        response = requests.get(url, params=params, timeout=30)
        response.raise_for_status()
        data = response.json()
        
        print("✅ API Response successful!\n")
        print(f"Timezone: {data.get('timezone')}")
        print(f"Elevation: {data.get('elevation')}m\n")
        
        daily = data.get("daily", {})
        
        print(f"Forecast days available: {len(daily.get('time', []))}\n")
        print("="*80)
        
        # Display forecast
        for i in range(len(daily.get("time", []))):
            date = datetime.fromisoformat(daily["time"][i])
            temp_max = daily["temperature_2m_max"][i]
            temp_min = daily["temperature_2m_min"][i]
            precip = daily["precipitation_sum"][i]
            snowfall = daily["snowfall_sum"][i]
            weather_code = daily["weathercode"][i]
            
            day_name = date.strftime("%A")
            date_str = date.strftime("%Y-%m-%d")
            
            snow_indicator = "❄️" if snowfall > 0 else "  "
            
            print(f"{snow_indicator} Day {i+1:2d} | {day_name:9s} {date_str} | "
                  f"Temp: {temp_min:+5.1f}°C to {temp_max:+5.1f}°C | "
                  f"Snow: {snowfall:4.1f}cm | Rain: {precip:4.1f}mm | "
                  f"Weather: {weather_code}")
        
        print("="*80)
        print("\n✅ Test completed successfully!")
        print(f"\nTotal snowfall forecast (16 days): {sum(daily['snowfall_sum']):.1f}cm")
        
        # Count snow days
        snow_days = sum(1 for s in daily['snowfall_sum'] if s > 0)
        print(f"Snow days forecast: {snow_days} out of 16 days")
        
        return True
        
    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == "__main__":
    test_openmeteo_extended()
