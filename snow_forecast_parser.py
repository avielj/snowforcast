#!/usr/bin/env python3
"""
Snow Forecast Parser for Val Thorens
Fetches and parses snow forecast data from snow-forecast.com
"""

import requests
import re
from bs4 import BeautifulSoup
from datetime import datetime, timedelta
import json

class SnowForecastParser:
    def __init__(self):
        self.base_url = "https://www.snow-forecast.com/resorts/Val-Thorens/6day/bot"
        self.headers = {
            'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
            'accept-language': 'en-US,en;q=0.9,he;q=0.8',
            'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
        }
        # Your cookies from the curl command
        self.cookies = {
            'vis': '1fL6qk%2F77zX%2BGUTVRa%2FyGxJcCBKy3PLPk3Iooqb1BzTS8aT%2FzUTxKdKKU0Q0Z8g18mo9domCTAVfyDEL12JQIZH3ptxygPkb%2Byu2OtTF1wmtxEwh55SdrAiAK6xygIA2SZrlfVvSglUEOUr4UnjNH%2FrR0zG4--tJaQ6sbtsfjuAU05--zr2MBkjB7zdTHu%2FZNlirTg%3D%3D',
            'h68': '1.2.v15qqZlbZ_4eCA.1761051722',
            'usprivacy': '1---',
            '_gcl_au': '1.1.1875126818.1761051724',
            '_ga': 'GA1.1.1454317582.1761051724',
            '_cc_id': 'a8c0a5e1d9237ab089ec33f1a9d3a7f',
            'panoramaId_expiry': '1761656526395',
            'panoramaId': '77fdfdad45fe73ac528c816c4daf185ca02c6b656fab85ab8a5c4c065d172e33',
            'panoramaIdType': 'panoDevice',
            'hist': 'eyJfcmFpbHMiOnsibWVzc2FnZSI6IkJBaEpJaGRzT2pFM09Ub3hOell4TkRjME9USTFPallHT2daRlZBPT0iLCJleHAiOm51bGwsInB1ciI6ImNvb2tpZS5oaXN0In19--33fa5add1dc25ed6914cfe20874e6538216448e1',
            'fcstViewCount': '3',
            'cto_bundle': '70RZaV9WeXh4OXNUOGpjclYxcVViNE5lNzlWcSUyRjhSNlpqdGw3Q3JXTWYwTjhJRVJYV0FBZXJjanAxOEhJb1d2WGolMkJXbG1JSE1qWTRNN1JRMlY4R2glMkJ0OXYwYzdPYkgxOXhCSW93Mm8xelo4Ukk0VE1aTjdwUHF0d1AzT1ZCTkxTZWJjUjlWMEI0QUtaR1c4dnI4VXBwNGMzaCUyRlJpbzZUTnVhZVBWalpzaEY2UWg1aTc4WDJOZ0VUbyUyQkhUZUlnWUxRWElwNElqekUlMkZ5JTJGRjZjbnpUYjlXSjgxZ2l2Z2NMWTNwOE1OZUNvSllwTDcyS1Z5dHVwR0dkZGhWdkZWVzJHUG5xbmNkbEk2bXlibE40ekVCYWcwQkhYZGp3JTNEJTNE',
            '__gads': 'ID=18a0517e20297ce9:T=1761051727:RT=1761474929:S=ALNI_MaobsGYfAV4vWWPcEHdsWXNpivARw',
            '__gpi': 'UID=000012b3459d1f0b:T=1761051727:RT=1761474929:S=ALNI_MYdRv_xFQDcrlEm40I79WDkFDPKlQ',
            '__eoi': 'ID=cc6e42bacc1a3c88:T=1761051727:RT=1761474929:S=AA-AfjYK4-RQuWogOKIwwNJ77pd_',
            '_ga_THKVCDP92J': 'GS2.1.s1761474926$o2$g0$t1761474931$j55$l0$h0',
            'c-a-maison-sport': 't1761474931',
            '_current_session': 'qlnNtNJCpPUyc9AYo09bn6Sqr5AxIuWprBedV%2FubgdSB%2BzLt3pyzklwIXhuc79UJBG6YLcTaCXzwswg5vkZ7%2FcY%2B2qCs9AHPOHCfyAH2iog%2BIZMptLR9UZU%2BUiYCogctudOO4yXnKlmcBp%2BBg9OWascoEpXCZUReJLK6HgFISYkxJZCKObIATRAP3TCf3sVZHgyke8H%2BEkhKYY%2BCxWCmRYdsOHMmBdkk5hb%2FVEqbepFKx4EKVWWT063wrGradlVgCvjW9%2BqsiOKvICcwtROJq%2FjPFp%2BeybHurj2yiUV5ZANYOCNL5OOQKojcu7co2gNW87jRBKVIU21BMSo5lfJgKQUWqX3VjU863x%2FtkHvgI8snVvBGUQD9T23SjB51UaKEKooTUCN%2Fii3YMbAzha6FD%2FRhWVhv1tDlRFSs4pR6izrvf8am86grorD%2FMJNiZ%2BXnGe3TsQAT%2FiWSRS6M%2BY%2BrUT1sUppZxMC5BDGDWEYb5Pgl1xHUqalNSlkB8hiOtm7%2FcnHxyD1j%2FRaP0dxZVu2bHXYPitNnaCEoNj2PdGqkmUesNjHvJtqGwGS5Q2mc9JjHiC4Z93OPPtytTw%2BuFdcmd3hVf9TVpaNipkzGBCwZqt1yP6a1x6MVBcUs9AsI7J6VgjczxLZfRiAh9%2F5fOvtpB%2B%2FoxFzynAwGeZnv9lsih6zw7Wm3NOZFaoc8pVgx7Bh%2Fy%2BshVcN2JfMGrU0Ggr6aaRie6dcAkjoIxR%2BSDo1kQkx60kky4MRmjdUj461NWVL8RV6qhiICeOCZoXKV5YR%2BYC2xKrvBTOHU5ilZLZgNdjYD1vtdV1uKnME5aq5BQ%2B3hKw0phT2I84iFIDTd--z%2BiWqAVv0hrwzQiy--wtGiuL60CMaboTLpmOY6sw%3D%3D'
        }
    
    def fetch_forecast_data(self):
        """Fetch the raw HTML data from the forecast page"""
        try:
            response = requests.get(self.base_url, headers=self.headers, cookies=self.cookies)
            response.raise_for_status()
            return response.text
        except requests.RequestException as e:
            print(f"Error fetching data: {e}")
            return None
    
    def parse_forecast_data(self, html_content):
        """Parse the HTML content and extract forecast information"""
        soup = BeautifulSoup(html_content, 'html.parser')
        
        forecast_data = {
            'resort': 'Val Thorens',
            'elevation': '2300m (bottom)',
            'last_updated': datetime.now().isoformat(),
            'forecast_days': []
        }
        
        # Find the forecast table
        forecast_table = soup.find('table', class_='forecast-table__table')
        if not forecast_table:
            print("Could not find forecast table")
            return None
        
        # Extract time headers (days and hours)
        time_headers = forecast_table.find('tr', {'data-row': 'time'})
        if time_headers:
            time_cells = time_headers.find_all('td', class_='forecast-table__cell')
            times = []
            for cell in time_cells:
                time_text = cell.get_text(strip=True)
                if time_text and time_text != '—':
                    times.append(time_text)
        
        # Extract weather data for each row type
        weather_data = {}
        
        # Temperature
        temp_row = forecast_table.find('tr', {'data-row': 'temperature'})
        if temp_row:
            temps = self._extract_temperature_data(temp_row)
            weather_data['temperature'] = temps
        
        # Snow depth
        snow_row = forecast_table.find('tr', {'data-row': 'snow'})
        if snow_row:
            snow_depths = self._extract_snow_data(snow_row)
            weather_data['snow_depth'] = snow_depths
        
        # Wind
        wind_row = forecast_table.find('tr', {'data-row': 'wind'})
        if wind_row:
            wind_data = self._extract_wind_data(wind_row)
            weather_data['wind'] = wind_data
        
        # Weather symbols
        weather_row = forecast_table.find('tr', {'data-row': 'weather'})
        if weather_row:
            weather_symbols = self._extract_weather_symbols(weather_row)
            weather_data['weather'] = weather_symbols
        
        # Freezing level
        freezing_row = forecast_table.find('tr', {'data-row': 'freezing-level'})
        if freezing_row:
            freezing_levels = self._extract_data_values(freezing_row, 'level-value')
            weather_data['freezing_level'] = freezing_levels
        
        # Humidity
        humidity_row = forecast_table.find('tr', {'data-row': 'humidity'})
        if humidity_row:
            humidity_data = self._extract_span_data(humidity_row)
            weather_data['humidity'] = humidity_data
        
        # Organize data by time periods
        if times:
            for i, time in enumerate(times):
                day_data = {
                    'time': time,
                    'temperature': weather_data.get('temperature', [None])[i] if i < len(weather_data.get('temperature', [])) else None,
                    'snow_depth': weather_data.get('snow_depth', [None])[i] if i < len(weather_data.get('snow_depth', [])) else None,
                    'wind': weather_data.get('wind', [None])[i] if i < len(weather_data.get('wind', [])) else None,
                    'weather': weather_data.get('weather', [None])[i] if i < len(weather_data.get('weather', [])) else None,
                    'freezing_level': weather_data.get('freezing_level', [None])[i] if i < len(weather_data.get('freezing_level', [])) else None,
                    'humidity': weather_data.get('humidity', [None])[i] if i < len(weather_data.get('humidity', [])) else None,
                }
                forecast_data['forecast_days'].append(day_data)
        
        # Extract summary text
        summary_blocks = soup.find_all('p', string=re.compile(r'weather summary:'))
        summaries = []
        for block in summary_blocks:
            parent = block.find_parent()
            if parent:
                summary_text = parent.get_text(strip=True)
                summaries.append(summary_text)
        
        forecast_data['summaries'] = summaries
        
        # Extract snow conditions
        snow_conditions = self._extract_snow_conditions(soup)
        forecast_data['snow_conditions'] = snow_conditions
        
        return forecast_data
    
    def _extract_data_values(self, row, class_name):
        """Extract data values from cells with specific class"""
        values = []
        cells = row.find_all('td', class_='forecast-table__cell')
        for cell in cells:
            div = cell.find('div', class_=class_name)
            if div and div.get('data-value'):
                values.append(float(div['data-value']))
            else:
                text = cell.get_text(strip=True)
                if text and text != '—':
                    try:
                        values.append(float(text))
                    except ValueError:
                        values.append(text)
                else:
                    values.append(None)
        return values
    
    def _extract_temperature_data(self, row):
        """Extract temperature data specifically"""
        values = []
        cells = row.find_all('td', class_='forecast-table__cell')
        for cell in cells:
            # Look for temp-value class with data-value attribute
            temp_div = cell.find('div', class_=lambda x: x and 'temp-value' in x)
            if temp_div and temp_div.get('data-value'):
                values.append(float(temp_div['data-value']))
            else:
                # Fallback to text content
                text = cell.get_text(strip=True)
                if text and text != '—':
                    try:
                        # Remove any non-numeric characters except minus sign
                        clean_text = re.sub(r'[^\d\-.]', '', text)
                        if clean_text:
                            values.append(float(clean_text))
                        else:
                            values.append(None)
                    except ValueError:
                        values.append(None)
                else:
                    values.append(None)
        return values
    
    def _extract_span_data(self, row):
        """Extract data from span elements"""
        values = []
        cells = row.find_all('td', class_='forecast-table__cell')
        for cell in cells:
            span = cell.find('span')
            if span:
                text = span.get_text(strip=True)
                try:
                    values.append(int(text))
                except ValueError:
                    values.append(text)
            else:
                values.append(None)
        return values
    
    def _extract_snow_data(self, row):
        """Extract snow depth data"""
        values = []
        cells = row.find_all('td', class_='forecast-table__cell')
        for cell in cells:
            snow_div = cell.find('div', class_='snow-value')
            if snow_div and snow_div.get('data-value'):
                values.append(int(snow_div['data-value']))
            else:
                text = cell.get_text(strip=True)
                if text and text != '—':
                    values.append(text)
                else:
                    values.append(None)
        return values
    
    def _extract_wind_data(self, row):
        """Extract wind data including speed and direction"""
        wind_data = []
        cells = row.find_all('td', class_='forecast-table__cell')
        for cell in cells:
            wind_info = {}
            
            # Wind speed
            wind_value = cell.find('div', class_='wind-icon__value')
            if wind_value:
                wind_info['speed'] = wind_value.get_text(strip=True)
            
            # Wind direction
            wind_icon = cell.find('div', class_='wind-icon')
            if wind_icon and wind_icon.get('data-direction'):
                wind_info['direction'] = wind_icon['data-direction']
            
            wind_data.append(wind_info if wind_info else None)
        
        return wind_data
    
    def _extract_weather_symbols(self, row):
        """Extract weather condition symbols and descriptions"""
        weather_data = []
        cells = row.find_all('td', class_='forecast-table__cell')
        for cell in cells:
            img = cell.find('img')
            if img:
                weather_data.append({
                    'condition': img.get('alt', ''),
                    'icon': img.get('src', '')
                })
            else:
                weather_data.append(None)
        
        return weather_data
    
    def _extract_snow_conditions(self, soup):
        """Extract current snow conditions"""
        conditions = {}
        
        snow_table = soup.find('table', class_='snow-depths-table__table')
        if snow_table:
            rows = snow_table.find_all('tr')
            for row in rows:
                th = row.find('th')
                td = row.find('td')
                if th and td:
                    key = th.get_text(strip=True).replace(':', '')
                    value = td.get_text(strip=True)
                    conditions[key] = value
        
        return conditions
    
    def get_forecast(self):
        """Main method to get and parse forecast data"""
        print("Fetching Val Thorens snow forecast...")
        html_content = self.fetch_forecast_data()
        
        if not html_content:
            return None
        
        print("Parsing forecast data...")
        forecast_data = self.parse_forecast_data(html_content)
        
        return forecast_data
    
    def print_forecast(self, forecast_data):
        """Print formatted forecast information"""
        if not forecast_data:
            print("No forecast data available")
            return
        
        print(f"\n{'='*60}")
        print(f"SNOW FORECAST FOR {forecast_data['resort'].upper()}")
        print(f"Elevation: {forecast_data['elevation']}")
        print(f"Last Updated: {forecast_data['last_updated']}")
        print(f"{'='*60}")
        
        # Print snow conditions
        if forecast_data.get('snow_conditions'):
            print(f"\nCURRENT SNOW CONDITIONS:")
            print(f"{'-'*30}")
            for key, value in forecast_data['snow_conditions'].items():
                print(f"{key}: {value}")
        
        # Print summaries
        if forecast_data.get('summaries'):
            print(f"\nWEATHER SUMMARIES:")
            print(f"{'-'*30}")
            for summary in forecast_data['summaries']:
                print(f"• {summary}")
        
        # Print detailed forecast
        if forecast_data.get('forecast_days'):
            print(f"\nDETAILED FORECAST:")
            print(f"{'-'*30}")
            print(f"{'Time':<8} {'Temp(°C)':<10} {'Snow(cm)':<10} {'Wind':<15} {'Weather':<20} {'Freezing(m)':<12} {'Humidity(%)':<12}")
            print(f"{'-'*100}")
            
            for day in forecast_data['forecast_days'][:12]:  # Show first 12 time periods
                time = day.get('time', 'N/A')
                temp = f"{day.get('temperature', 'N/A')}"
                snow = f"{day.get('snow_depth', 'N/A')}"
                
                wind = day.get('wind', {})
                if isinstance(wind, dict) and wind:
                    wind_str = f"{wind.get('speed', 'N/A')} {wind.get('direction', '')}"
                else:
                    wind_str = 'N/A'
                
                weather = day.get('weather', {})
                if isinstance(weather, dict) and weather:
                    weather_str = weather.get('condition', 'N/A')[:18]
                else:
                    weather_str = 'N/A'
                
                freezing = f"{day.get('freezing_level', 'N/A')}"
                humidity = f"{day.get('humidity', 'N/A')}"
                
                print(f"{time:<8} {temp:<10} {snow:<10} {wind_str:<15} {weather_str:<20} {freezing:<12} {humidity:<12}")
        
        print(f"\n{'='*60}")
    
    def save_forecast_json(self, forecast_data, filename="val_thorens_forecast.json"):
        """Save forecast data to JSON file"""
        if forecast_data:
            with open(filename, 'w') as f:
                json.dump(forecast_data, f, indent=2, default=str)
            print(f"Forecast data saved to {filename}")

def main():
    """Main function to run the snow forecast parser"""
    parser = SnowForecastParser()
    forecast_data = parser.get_forecast()
    
    if forecast_data:
        parser.print_forecast(forecast_data)
        parser.save_forecast_json(forecast_data)
    else:
        print("Failed to retrieve forecast data")

if __name__ == "__main__":
    main()