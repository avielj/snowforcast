# OpenWeatherMap Integration Setup

## Why Add OpenWeatherMap?

OpenWeatherMap Free 5-Day Forecast API provides:
- ✅ **100% FREE** - No payment info required, ever!
- ✅ **More accurate snow data** - actual snow accumulation in mm/cm
- ✅ **5-day forecast** with 3-hour intervals
- ✅ **Up to 1,000 free API calls/day**
- ✅ **Updates frequently** - fresher than web scraping
- ✅ **Rich weather data** - temperature, wind, humidity, precipitation probability

## Setup Instructions

### 1. Get Your Free API Key

1. Go to https://openweathermap.org/home/sign_up
2. Create a free account (NO payment info required)
3. Get your API key from https://home.openweathermap.org/api_keys
4. Wait 10 minutes to 2 hours for activation
5. That's it! We use the **FREE 5-Day Forecast API** - no subscription needed!

### 2. Add API Key to GitHub Secrets (for GitHub Actions)

1. Go to your GitHub repository: https://github.com/avielj/snowforcast
2. Click **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret**
4. Name: `OPENWEATHER_API_KEY`
5. Value: Paste your API key
6. Click **Add secret**

### 3. Add API Key to Vercel (for live site)

1. Go to your Vercel dashboard: https://vercel.com/dashboard
2. Select your **snowforcast** project
3. Click **Settings** → **Environment Variables**
4. Click **Add New**
5. Name: `OPENWEATHER_API_KEY`
6. Value: Paste your API key
7. Environment: Select **Production**, **Preview**, and **Development**
8. Click **Save**
9. Click **Redeploy** on your latest deployment to apply the changes

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
    "condition": "Light Snow"
  }
}
```

## Benefits

- **More reliable** - two independent sources
- **Better accuracy** - averages reduce errors
- **Richer data** - hourly forecasts + daily summaries
- **Still works without it** - gracefully falls back to snow-forecast.com only

## API Usage

**GitHub Actions** (static data generation every 3 hours):
- **6 resorts × 3 elevations = 18 calls** per run
- **18 calls × 8 runs/day = 144 calls/day**

**Vercel** (live API calls on each page load):
- Depends on traffic
- Example: 100 visitors/day × 3 elevation switches = 300 calls/day
- Total: ~450 calls/day (well under 1,000 limit!) ✅

**Combined: ~450-600 calls/day** - safe within free tier!

## Troubleshooting

**"No OpenWeather data" in output?**
- Check that OPENWEATHER_API_KEY is set in GitHub Secrets
- Verify your API key is active at https://home.openweathermap.org/api_keys
- Wait up to 2 hours after creating your account for activation

**Getting 401 Unauthorized error?**
- Your API key may not be activated yet (wait 1-2 hours)
- Double-check you copied the entire API key correctly
- Make sure you're using the FREE account (no subscription needed!)

**Want to disable OpenWeather?**
- Just don't set the OPENWEATHER_API_KEY secret
- App will automatically use snow-forecast.com only

