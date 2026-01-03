# Weather Unlocked API Setup

This document explains how to use the Weather Unlocked API integration for enhanced weather forecasts.

## Overview

Weather Unlocked provides detailed weather forecasts with:
- 7-day forecasts
- Snow accumulation data
- Hourly breakdowns (Morning, Afternoon, Evening, Night)
- Current weather conditions
- High accuracy for ski resorts

## API Credentials

**App ID:** `24fbe7db`  
**API Key:** `c553a3a126b8b8eb808f36548c1ed467`

These credentials are for the "nope's App" on Weather Unlocked.

## Configuration

### Environment Variables (Recommended)

Set these environment variables for production:

```bash
export WEATHERUNLOCKED_APP_ID="24fbe7db"
export WEATHERUNLOCKED_KEY="c553a3a126b8b8eb808f36548c1ed467"
```

### Default Configuration

If environment variables are not set, the integration will use the hardcoded credentials from the setup.

## Usage

### In generate_static_data.py

The Weather Unlocked API is automatically integrated:

```python
# It will fetch and merge data from:
# 1. snow-forecast.com (primary)
# 2. OpenWeatherMap (if configured)
# 3. Weather Unlocked (if configured)
```

### Manual Usage

```python
from weatherunlocked_integration import WeatherUnlockedAPI

# Initialize API
api = WeatherUnlockedAPI()

# Get 7-day forecast
forecast = api.get_forecast(resort='Val-Thorens', elevation='mid')

# Get current weather
current = api.get_current_weather(resort='Val-Thorens', elevation='mid')
```

## Supported Resorts

All 8 resorts are supported:
- Val-Thorens
- Cervinia
- Via-Lattea
- Monterosa-Ski
- Gudauri
- St-Anton
- Alpe-d-Huez
- Mount-Hermon

Each with 3 elevations: `bot`, `mid`, `top`

## API Endpoints Used

### Forecast
- **Endpoint:** `http://api.weatherunlocked.com/api/forecast/{lat},{lon}`
- **Parameters:** `app_id`, `app_key`
- **Returns:** 7-day forecast with timeframes

### Current Weather
- **Endpoint:** `http://api.weatherunlocked.com/api/current/{lat},{lon}`
- **Parameters:** `app_id`, `app_key`
- **Returns:** Current conditions

## Data Merging

The integration uses a smart merging strategy:

1. **Primary Source:** snow-forecast.com (ski-specific data)
2. **Enhancement:** Weather Unlocked adds alternative temperature and snow predictions
3. **Additional Fields:** `wu_temp`, `wu_snow`, `wu_condition` added to each period

This allows the frontend to:
- Show multiple predictions
- Calculate averages
- Display confidence ranges

## Rate Limits

Check your Weather Unlocked dashboard for current rate limits:
https://developer.weatherunlocked.com/admin

**Free Plan Limits:**
- Local Weather Free plan
- Check dashboard for specific limits

## Testing

Test the integration:

```bash
# Test module loading
python3 -c "from weatherunlocked_integration import WeatherUnlockedAPI; print('✓ Loaded')"

# Test API call (uses 1 API credit)
python3 -c "
from weatherunlocked_integration import WeatherUnlockedAPI
api = WeatherUnlockedAPI()
data = api.get_forecast('Val-Thorens', 'mid')
print(f'Days: {len(data[\"days\"])}')
"
```

## Troubleshooting

### Authentication Error
- Verify credentials in dashboard
- Check environment variables
- Ensure credentials are not expired

### No Data Returned
- Check API rate limits
- Verify coordinates are valid
- Check network connectivity

### Integration Not Working
```python
# Check if integration is available
from generate_static_data import WEATHERUNLOCKED_AVAILABLE
print(f"Weather Unlocked available: {WEATHERUNLOCKED_AVAILABLE}")
```

## Contact

**Weather Unlocked Support:**
- UK: +44 (0) 141 628 7527
- USA: +1 844 217 1131
- Email: info@weatherunlocked.com
- Website: https://www.weatherunlocked.com

## Plan Upgrade

To increase API limits or access additional features, visit:
https://developer.weatherunlocked.com/admin

Current Plan: **Local Weather Free**
