#!/usr/bin/env python3
"""
Compare forecasts from different sources to understand discrepancies
Investigate snow line / freezing level calculations
"""

import requests
from datetime import datetime

def fetch_openmeteo_detailed(latitude, longitude, elevation_m):
    """
    Fetch OpenMeteo forecast with ALL available parameters including freezing level
    """
    url = "https://api.open-meteo.com/v1/forecast"
    
    params = {
        "latitude": latitude,
        "longitude": longitude,
        "elevation": elevation_m,  # Specify elevation
        "hourly": [
            "temperature_2m",
            "precipitation",
            "snowfall",
            "freezing_level_height",
            "snow_depth"
        ],
        "daily": [
            "temperature_2m_max",
            "temperature_2m_min",
            "precipitation_sum",
            "rain_sum",
            "snowfall_sum",
            "precipitation_hours",
            "weathercode",
            "sunrise",
            "sunset"
        ],
        "timezone": "Europe/Paris",
        "forecast_days": 16
    }
    
    print(f"\n{'='*80}")
    print(f"Fetching OpenMeteo Detailed Forecast")
    print(f"Location: {latitude}, {longitude} @ {elevation_m}m")
    print(f"{'='*80}\n")
    
    try:
        response = requests.get(url, params=params, timeout=30)
        response.raise_for_status()
        data = response.json()
        
        print(f"✅ Success! Elevation used: {data.get('elevation')}m")
        print(f"Timezone: {data.get('timezone')}\n")
        
        # Print daily summary
        daily = data.get("daily", {})
        hourly = data.get("hourly", {})
        
        print(f"{'Day':<4} {'Date':<12} {'Temp Range':<15} {'Snow':<8} {'Rain':<8} {'Precip Hrs':<12} {'Weather'}")
        print("-" * 80)
        
        for i in range(min(14, len(daily.get("time", [])))):
            date = datetime.fromisoformat(daily["time"][i])
            day_name = date.strftime("%a")
            date_str = date.strftime("%d-%b")
            temp_min = daily["temperature_2m_min"][i]
            temp_max = daily["temperature_2m_max"][i]
            snowfall = daily["snowfall_sum"][i]
            rain = daily["rain_sum"][i]
            precip_hrs = daily.get("precipitation_hours", [None])[i]
            weather = daily["weathercode"][i]
            
            snow_icon = "❄️" if snowfall > 0 else "  "
            
            print(f"{snow_icon}{day_name:<3} {date_str:<12} "
                  f"{temp_min:>4.0f}°C to {temp_max:>4.0f}°C "
                  f"{snowfall:>5.1f}cm "
                  f"{rain:>5.1f}mm "
                  f"{precip_hrs if precip_hrs else 'N/A':>10} "
                  f"{weather}")
        
        # Analyze hourly freezing levels for first 7 days
        print(f"\n{'='*80}")
        print("FREEZING LEVEL ANALYSIS (First 7 days, every 6 hours)")
        print(f"{'='*80}\n")
        
        for i in range(0, min(168, len(hourly.get("time", []))), 6):  # Every 6 hours for 7 days
            time = datetime.fromisoformat(hourly["time"][i])
            freezing_level = hourly.get("freezing_level_height", [None])[i]
            temp = hourly.get("temperature_2m", [None])[i]
            snow = hourly.get("snowfall", [None])[i]
            precip = hourly.get("precipitation", [None])[i]
            
            if freezing_level is not None:
                snow_indicator = "❄️" if snow and snow > 0 else "  "
                print(f"{snow_indicator}{time.strftime('%a %d %H:%M')} | "
                      f"Temp: {temp:>5.1f}°C | "
                      f"Freezing Level: {freezing_level:>6.0f}m | "
                      f"Snow: {snow if snow else 0:>4.1f}cm | "
                      f"Precip: {precip if precip else 0:>4.1f}mm")
        
        return data
        
    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()
        return None


def compare_elevations():
    """
    Compare forecasts at different elevations for Val Thorens
    """
    print(f"\n{'#'*80}")
    print("COMPARING FORECASTS AT DIFFERENT ELEVATIONS")
    print(f"{'#'*80}\n")
    
    # Val Thorens coordinates
    lat = 45.2973
    lon = 6.5801
    
    elevations = {
        "Bottom (2300m)": 2300,
        "Mid (2800m)": 2800,
        "Top (3230m)": 3230
    }
    
    results = {}
    
    for name, elev in elevations.items():
        print(f"\n{'*'*80}")
        print(f"ELEVATION: {name}")
        print(f"{'*'*80}")
        results[name] = fetch_openmeteo_detailed(lat, lon, elev)
    
    # Compare snow differences
    print(f"\n{'#'*80}")
    print("SNOWFALL COMPARISON BY ELEVATION")
    print(f"{'#'*80}\n")
    
    print(f"{'Date':<12} {'Bottom':<10} {'Mid':<10} {'Top':<10}")
    print("-" * 50)
    
    for i in range(7):  # First 7 days
        date_str = datetime.fromisoformat(
            results["Bottom (2300m)"]["daily"]["time"][i]
        ).strftime("%a %d-%b")
        
        bottom_snow = results["Bottom (2300m)"]["daily"]["snowfall_sum"][i]
        mid_snow = results["Mid (2800m)"]["daily"]["snowfall_sum"][i]
        top_snow = results["Top (3230m)"]["daily"]["snowfall_sum"][i]
        
        print(f"{date_str:<12} {bottom_snow:>8.1f}cm {mid_snow:>8.1f}cm {top_snow:>8.1f}cm")


def analyze_j2ski_logic():
    """
    Analyze how J2Ski determines snow line from data
    """
    print(f"\n{'#'*80}")
    print("J2SKI SNOW LINE LOGIC ANALYSIS")
    print(f"{'#'*80}\n")
    
    print("J2Ski shows patterns like:")
    print("- 'Snow falling to resort level' (2300m)")
    print("- 'Snow Line from 2,589m to 2,259m'")
    print("- 'with rain below'")
    print()
    print("This suggests J2Ski uses:")
    print("1. Freezing level height from weather models")
    print("2. Precipitation type transition zone")
    print("3. Likely uses ECMWF or GFS models with vertical resolution")
    print()
    print("OpenMeteo DOES provide freezing_level_height!")
    print("Let's see if we can replicate this logic...")
    print()
    
    # Fetch data with freezing level
    lat, lon = 45.2973, 6.5801
    resort_elevation = 2300
    
    url = "https://api.open-meteo.com/v1/forecast"
    params = {
        "latitude": lat,
        "longitude": lon,
        "hourly": ["freezing_level_height", "temperature_2m", "precipitation", "snowfall"],
        "daily": ["snowfall_sum", "rain_sum"],
        "timezone": "Europe/Paris",
        "forecast_days": 7
    }
    
    response = requests.get(url, params=params, timeout=30)
    data = response.json()
    
    print("\nFREEZING LEVEL PREDICTIONS:")
    print(f"{'Date/Time':<16} {'Freezing Level':<15} {'Resort Elev':<12} {'Precipitation Type'}")
    print("-" * 70)
    
    hourly = data["hourly"]
    for i in range(0, min(len(hourly["time"]), 168), 6):  # Every 6 hours, 7 days
        time = datetime.fromisoformat(hourly["time"][i])
        freeze_level = hourly["freezing_level_height"][i]
        precip = hourly["precipitation"][i]
        snow = hourly["snowfall"][i]
        
        if precip > 0:
            if freeze_level > resort_elevation + 200:
                precip_type = "RAIN (freeze above resort)"
            elif freeze_level < resort_elevation - 200:
                precip_type = "SNOW (freeze below resort)"
            else:
                precip_type = f"MIXED (freeze ~{freeze_level:.0f}m, resort {resort_elevation}m)"
            
            print(f"{time.strftime('%a %d %H:%M'):<16} {freeze_level:>12.0f}m {resort_elevation:>10}m  {precip_type}")


if __name__ == "__main__":
    # Run comparison
    compare_elevations()
    
    print("\n" + "="*80 + "\n")
    
    # Analyze J2Ski logic
    analyze_j2ski_logic()
    
    print(f"\n{'#'*80}")
    print("CONCLUSIONS & RECOMMENDATIONS")
    print(f"{'#'*80}\n")
    print("1. OpenMeteo DOES support elevation-specific forecasts")
    print("2. OpenMeteo provides freezing_level_height (like J2Ski uses)")
    print("3. We should:")
    print("   - Fetch forecasts for each elevation (bot/mid/top)")
    print("   - Include freezing level in our data")
    print("   - Show 'snow line' calculations")
    print("   - Indicate mixed precip zones")
    print("4. For extended forecast, use mid-elevation as reference")
    print("5. Consider averaging overlapping days between sources")
