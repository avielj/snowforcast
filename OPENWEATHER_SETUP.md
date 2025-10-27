# OpenWeatherMap Integration Setup

## Why Add OpenWeatherMap?

OpenWeatherMap One Call API 3.0 provides:
- ✅ **More accurate snow data** - actual snow accumulation in mm/cm
- ✅ **8-day forecast** instead of 6 days  
- ✅ **Hourly forecasts** for next 48 hours
- ✅ **Updates every 10 minutes** - fresher than web scraping
- ✅ **1,000 free API calls/day** - plenty for auto-updates every 3 hours

## Setup Instructions

### 1. Get Your Free API Key

1. Go to https://openweathermap.org/home/sign_up
2. Create a free account
3. Subscribe to **"One Call by Call"** subscription:
   - Go to https://openweathermap.org/price
   - Find "One Call API 3.0"
   - Click "Subscribe" → "One Call by Call"
   - Select FREE tier (1,000 calls/day)
4. Get your API key from https://home.openweathermap.org/api_keys

### 2. Add API Key to GitHub Secrets

1. Go to your GitHub repository: https://github.com/avielj/snowforcast
2. Click **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret**
4. Name: `OPENWEATHER_API_KEY`
5. Value: Paste your API key
6. Click **Add secret**

### 3. Update GitHub Actions Workflow

The workflow will automatically use the OpenWeather API key from secrets!

### 4. Test Locally (Optional)

```bash
# Set environment variable
export OPENWEATHER_API_KEY="your_api_key_here"

# Test the integration
python3 openweather_integration.py

# Generate static data with both sources
python3 generate_static_data.py
```

## How It Works

The app now combines data from **TWO sources**:

1. **snow-forecast.com** (web scraping)
   - Provides detailed AM/PM/Night breakdown
   - Includes wind data and conditions
   
2. **OpenWeatherMap** (API)
   - Provides accurate snow accumulation
   - Hourly forecast data
   - Probability of precipitation

The system **averages snow forecasts** from both sources for better accuracy!

## Data Structure

With OpenWeather integration, each day includes:

```json
{
  "name": "Monday",
  "date": "27 Jan",
  "am": { ... },
  "pm": { ... },
  "night": { ... },
  "snow_forecast_com": 15,      // Total from snow-forecast.com
  "openweather": 18,             // Total from OpenWeather
  "average_snow": 16.5,          // AVERAGE of both sources
  "openweather_details": {
    "temp": { "min": -5, "max": 2 },
    "snow_cm": 18,
    "pop": 85,                   // 85% chance of precipitation
    "summary": "Expect a day of..."
  }
}
```

## Benefits

- **More reliable** - two independent sources
- **Better accuracy** - averages reduce errors
- **Richer data** - hourly forecasts + daily summaries
- **Still works without it** - gracefully falls back to snow-forecast.com only

## API Usage

With GitHub Actions running every 3 hours:
- **6 resorts × 3 elevations = 18 calls** per run
- **18 calls × 8 runs/day = 144 calls/day**
- Well under the 1,000 free calls/day limit! ✅

## Troubleshooting

**"No OpenWeather data" in output?**
- Check that OPENWEATHER_API_KEY is set in GitHub Secrets
- Verify your API key is active at https://home.openweathermap.org/api_keys
- Make sure you subscribed to "One Call by Call"

**Want to disable OpenWeather?**
- Just don't set the OPENWEATHER_API_KEY secret
- App will automatically use snow-forecast.com only

