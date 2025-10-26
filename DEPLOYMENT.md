# ❄️ Snow Forecast App - Deployment Guide

## 🚀 Automated Updates Every 3 Hours

Your app is now configured to automatically update forecast data every 3 hours using **GitHub Actions** (completely FREE!).

### How It Works

1. **GitHub Actions Workflow** (`.github/workflows/update-forecast.yml`):
   - Runs every 3 hours automatically
   - Fetches fresh forecast data from snow-forecast.com
   - Saves static JSON files to the `data/` directory
   - Commits and pushes the updated data back to GitHub

2. **Static Data Files** (`data/` directory):
   - `val-thorens-bot.json`, `val-thorens-mid.json`, `val-thorens-top.json`
   - `cervinia-bot.json`, `cervinia-mid.json`, `cervinia-top.json`
   - `all-forecasts.json` - Combined file with all data
   - `metadata.json` - Last update timestamp

3. **Smart Page Loading** (`forecast.html`):
   - Automatically detects if loading from GitHub Pages (static mode)
   - On Vercel: Uses live API calls
   - On GitHub Pages: Uses pre-generated JSON files

### 📊 Deployment Options

#### Option 1: GitHub Pages (Static - Recommended for FREE hosting)

**Setup:**
1. Go to your GitHub repository settings
2. Navigate to "Pages" section
3. Under "Source", select "main" branch
4. Click "Save"
5. Your site will be available at: `https://avielj.github.io/snowforcast/`

**Advantages:**
- ✅ Completely FREE
- ✅ Automatic updates every 3 hours
- ✅ Fast static page loading
- ✅ No backend server needed

**How it works:**
- GitHub Actions runs every 3 hours, scrapes data, saves to `data/` folder
- GitHub Pages serves the static HTML + JSON files
- No API calls needed - everything is pre-generated

#### Option 2: Vercel (Dynamic - Current Setup)

**Current Status:**
- Already deployed to Vercel
- Uses serverless functions to fetch data on-demand
- More expensive if you have many visitors (can hit free tier limits)

**Advantages:**
- ✅ Real-time data (fetched on each request)
- ✅ No GitHub Actions needed

**Disadvantages:**
- ⚠️ May hit free tier limits with heavy traffic
- ⚠️ Slower page loads (waits for API calls)

### 🔄 Manual Trigger

You can manually trigger a forecast update:
1. Go to your GitHub repository
2. Click "Actions" tab
3. Select "Update Forecast Data" workflow
4. Click "Run workflow"

### 📁 Project Structure

```
.github/workflows/
  └── update-forecast.yml     # GitHub Actions workflow (runs every 3 hours)

data/
  ├── val-thorens-bot.json    # Val Thorens bottom elevation
  ├── val-thorens-mid.json    # Val Thorens mid elevation
  ├── val-thorens-top.json    # Val Thorens top elevation
  ├── cervinia-bot.json       # Cervinia bottom elevation
  ├── cervinia-mid.json       # Cervinia mid elevation
  ├── cervinia-top.json       # Cervinia top elevation
  ├── all-forecasts.json      # Combined data
  └── metadata.json           # Update timestamp

generate_static_data.py       # Script to generate static JSON files
forecast.html                 # Main forecast page (works in both modes)
index.html                    # Redirects to forecast.html
app.py                        # Flask backend (for Vercel)
```

### ⚙️ Configuration

**To change update frequency:**
Edit `.github/workflows/update-forecast.yml`:
```yaml
schedule:
  - cron: '0 */3 * * *'  # Every 3 hours
  # - cron: '0 */6 * * *'  # Every 6 hours
  # - cron: '0 0 * * *'    # Once daily at midnight
```

**Cron schedule examples:**
- `'0 */1 * * *'` - Every hour
- `'0 */3 * * *'` - Every 3 hours (current)
- `'0 */6 * * *'` - Every 6 hours
- `'0 0,12 * * *'` - Twice daily (midnight and noon)
- `'0 8 * * *'` - Daily at 8 AM UTC

### 🎿 Features

- **Multi-Resort Support**: Val Thorens & Cervinia
- **3 Elevation Levels**: Bottom, Mid, Top
- **7-Day Forecast**: AM/PM/Night periods
- **Weekly Summary**: Total snowfall, snow days, best day
- **Auto-Updates**: Every 3 hours via GitHub Actions
- **Responsive Design**: Works on desktop, tablet, mobile

### 🔧 Troubleshooting

**GitHub Actions not running?**
- Check the "Actions" tab in your GitHub repo
- Make sure Actions are enabled in repository settings

**Old data showing?**
- Check the last commit timestamp in the `data/` folder
- Manually trigger the workflow to force an update

**Want to switch to GitHub Pages?**
- Enable GitHub Pages in repository settings
- GitHub Actions will keep the data fresh automatically
- Much cheaper than Vercel for high traffic!

---

## 🌐 Live URLs

- **Vercel (Dynamic)**: https://snowforcast.vercel.app
- **GitHub Pages (Static)**: https://avielj.github.io/snowforcast/ (after enabling)

