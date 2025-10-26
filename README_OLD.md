# Val Thorens Snow Forecast

A web application that fetches and displays snow forecast data for Val Thorens ski resort using data from snow-forecast.com.

## Features

- **Real-time Snow Forecast**: Fetches current 6-day forecast data
- **Weather Details**: Temperature, snow depth, weather conditions, freezing level, humidity
- **Web Interface**: Clean, responsive web interface for viewing forecasts
- **API Endpoints**: RESTful API for programmatic access
- **Auto-refresh**: Manual refresh capability to get latest data

## Installation

1. **Clone or download** this project to your local machine

2. **Install Python dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

3. **Run the application**:
   ```bash
   python3 app.py
   ```

4. **Open your browser** and navigate to:
   ```
   http://localhost:5000
   ```

## Files

- `snow_forecast_parser.py` - Main parser that fetches and extracts forecast data
- `app.py` - Flask web application server
- `index.html` - Web interface for displaying forecasts
- `requirements.txt` - Python dependencies
- `val_thorens_forecast.json` - Cached forecast data (generated automatically)

## Usage

### Web Interface
- Visit `http://localhost:5000` to view the forecast
- Click "🔄 Refresh Forecast" to fetch the latest data

### Command Line
Run the parser directly to get forecast data:
```bash
python3 snow_forecast_parser.py
```

### API Endpoints

- `GET /` - Main web interface
- `GET /val_thorens_forecast.json` - Get current forecast data as JSON
- `GET /api/refresh` - Refresh forecast data from source
- `GET /api/status` - Check service status

## Data Sources

This application fetches data from snow-forecast.com using their publicly available forecast pages. The parser extracts:

- Current snow conditions
- 6-day detailed forecast
- Temperature, snow depth, weather conditions
- Freezing level and humidity data
- Weather summaries

## Technical Details

### Parser Features
- **BeautifulSoup** for HTML parsing
- **Requests** for HTTP data fetching
- **Error handling** for network issues
- **Data validation** and cleaning
- **JSON export** for data persistence

### Web Application
- **Flask** web framework
- **Responsive design** with CSS Grid/Flexbox
- **AJAX** for dynamic data loading
- **Real-time updates** without page refresh

## Customization

### Different Resorts
To adapt for other ski resorts, modify the `base_url` in `SnowForecastParser`:

```python
self.base_url = "https://www.snow-forecast.com/resorts/[RESORT-NAME]/6day/bot"
```

### Elevation Levels
Change the elevation level by modifying the URL suffix:
- `/bot` - Bottom elevation
- `/mid` - Middle elevation  
- `/top` - Top elevation

## Troubleshooting

### Common Issues

1. **Import errors**: Make sure all dependencies are installed
   ```bash
   pip install -r requirements.txt
   ```

2. **Network errors**: Check internet connection and try again

3. **Data parsing errors**: The website structure may have changed - check the parser logic

4. **Port conflicts**: If port 5000 is in use, modify the port in `app.py`:
   ```python
   app.run(debug=True, host='0.0.0.0', port=8080)
   ```

## Example Output

```
============================================================
SNOW FORECAST FOR VAL THORENS
Elevation: 2300m (bottom)
Last Updated: 2025-10-26T12:45:17.358258
============================================================

CURRENT SNOW CONDITIONS:
------------------------------
Fresh snowfall depth: 30cm
Last snowfall: 25 Oct 2025

DETAILED FORECAST:
------------------------------
Time     Temp(°C)   Snow(cm)   Wind            Weather              Freezing(m)  Humidity(%)
AM       -12        1          5 km/h W        light snow           1700         84
PM       -8         8          10 km/h NW      mod snow             1600         94
night    -9         4          8 km/h N        light snow           1150         57
...
```

## License

This project is for educational and personal use. Please respect the terms of service of snow-forecast.com when using their data.

## Disclaimer

This tool is not affiliated with snow-forecast.com. Forecast data accuracy depends on the source website. Always check official weather services for critical weather information.