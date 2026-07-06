# ❄️ Snow Forecast Dashboard

Snow and weather dashboard for multiple ski resorts including Val Thorens, La Plagne, Cervinia, Mount Hermon, and more. The app scrapes snow-forecast.com, blends several independent weather models into a consensus forecast, and serves an interactive front-end via `forecast.html`.

## Highlights
- 7-day outlook for bottom, mid, and top elevations (AM/PM/Night breakdown)
- Multi-resort support (Val Thorens, Cervinia, Via Lattea, Monterosa Ski, Gudauri, St. Anton, Alpe d'Huez, La Plagne, Mount Hermon) with combined JSON feeds in `data/`
- Multi-model snowfall consensus: Open-Meteo multi-model (Meteo-France AROME, DWD ICON, ECMWF IFS, NOAA GFS), a ~30-member ensemble for uncertainty ranges, and MET Norway — merged as a median with a model-disagreement range
- Model skill tracking: `forecast_skill.py` scores each model's past accuracy from git history (weekly GitHub Action) and the consensus weights models accordingly
- Optional OpenWeatherMap fusion for temperature, snow, and precipitation cross-checks
- REST API for live pulls plus static JSON for CDN/static hosting workflows
- Works on Vercel (dynamic Flask) or GitHub Pages (static assets refreshed every 3 hours)

## Quick Start
1. Ensure Python 3.10+ is available.
2. Create and activate a virtualenv:
	```bash
	python3 -m venv .venv
	source .venv/bin/activate
	```
3. Install dependencies:
	```bash
	pip install -r requirements.txt
	```
4. (Optional) Export `OPENWEATHER_API_KEY` to enable OpenWeather augmentation.
5. Run the Flask app:
	```bash
	python app.py
	```
6. Open `http://localhost:8080` to view the dashboard. Static HTML can also be opened directly via `forecast.html`.

## Data Refresh Options
- `update_forecast.py`: Pulls the latest Val Thorens data and updates `val_thorens_forecast.json`. Designed for cron usage; see `cron_examples.txt`.
- `generate_static_data.py`: Builds JSON for every resort/elevation combo and writes snapshots into `data/`. GitHub Actions can invoke this script every 3 hours (see `DEPLOYMENT.md`).
- `enhanced_snow_forecast_parser.py`: Experimental parser that fetches all elevations concurrently and produces a comprehensive payload.

## API Surface (Flask)
- `GET /` and `GET /forecast.html` — serve the interactive front-end.
- `GET /val_thorens_forecast.json` — cached Val Thorens forecast.
- `GET /comprehensive_val_thorens_forecast.json` — multi-elevation snapshot.
- `GET /api/refresh` — re-scrape base data from snow-forecast.com.
- `GET /api/refresh-comprehensive` — re-scrape all elevations.
- `GET /api/forecast?resort=Val-Thorens|Cervinia&elevation=bot|mid|top` — on-demand scrape with optional OpenWeather blending.
- `GET /api/status` — service health and cache timestamp.

## Deployment Notes
- **Vercel**: Runs `app.py` as a serverless Flask app using environment variables for keys. Provides real-time scrapes per request.
- **GitHub Pages / Static Hosting**: Serve `forecast.html` and the generated `data/*.json`. Pair with the GitHub Actions workflow described in `DEPLOYMENT.md` to keep static files current.

## Repository Tour
- `forecast.html` — responsive front-end with automatic source detection (static vs. live).
- `snow_forecast_parser.py` — core scraper for the canonical Val Thorens feed.
- `multi_model.py` — multi-model / ensemble / MET Norway consensus engine.
- `forecast_skill.py` — scores model accuracy from git history into `data/skill.json`.
- `openweather_integration.py` — OpenWeather helper and dataset merger.
- `data/` — auto-generated JSON bundles (`all-forecasts.json`, per-resort/elevation files, `metadata.json`).
- `cron_examples.txt` — sample crontab entries for local automation.
- `DEPLOYMENT.md` — detailed static hosting and automation walkthrough.

## Support & Troubleshooting
- Verify cookies and headers in the scraper if snow-forecast.com changes its markup or rate-limits requests.
- When running scheduled jobs, log output from `update_forecast.py` (`forecast_updater.log`) to monitor errors.
- If GitHub Actions stop updating `data/`, trigger the “Update Forecast Data” workflow manually or review workflow permissions.

Happy riding!🚠
