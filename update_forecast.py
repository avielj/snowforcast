#!/usr/bin/env python3
"""
Automated Snow Forecast Updater
Can be run as a cron job to keep forecast data current
"""

import sys
import os
import json
import logging
from datetime import datetime
from snow_forecast_parser import SnowForecastParser

# Setup logging
def setup_logging():
    log_file = os.path.join(os.path.dirname(__file__), 'forecast_updater.log')
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(levelname)s - %(message)s',
        handlers=[
            logging.FileHandler(log_file),
            logging.StreamHandler(sys.stdout)
        ]
    )
    return logging.getLogger(__name__)

def update_forecast():
    """Update the forecast data"""
    logger = setup_logging()
    
    try:
        logger.info("Starting forecast update...")
        
        # Initialize parser
        parser = SnowForecastParser()
        
        # Fetch new data
        forecast_data = parser.get_forecast()
        
        if not forecast_data:
            logger.error("Failed to fetch forecast data")
            return False
        
        # Save to JSON file
        json_file = os.path.join(os.path.dirname(__file__), 'val_thorens_forecast.json')
        with open(json_file, 'w') as f:
            json.dump(forecast_data, f, indent=2, default=str)
        
        # Log success
        snow_conditions = forecast_data.get('snow_conditions', {})
        fresh_snow = snow_conditions.get('Fresh snowfall depth', 'N/A')
        last_snowfall = snow_conditions.get('Last snowfall', 'N/A')
        
        logger.info(f"Forecast updated successfully!")
        logger.info(f"Fresh snow: {fresh_snow}")
        logger.info(f"Last snowfall: {last_snowfall}")
        logger.info(f"Forecast periods: {len(forecast_data.get('forecast_days', []))}")
        
        return True
        
    except Exception as e:
        logger.error(f"Error updating forecast: {str(e)}")
        return False

def check_data_age():
    """Check if the current data is older than specified hours"""
    json_file = os.path.join(os.path.dirname(__file__), 'val_thorens_forecast.json')
    
    if not os.path.exists(json_file):
        return True  # No data exists, need update
    
    # Check file modification time
    file_age_hours = (datetime.now().timestamp() - os.path.getmtime(json_file)) / 3600
    
    # Update if data is older than 3 hours
    return file_age_hours > 3

def main():
    """Main function for automated updates"""
    logger = setup_logging()
    
    # Check if update is needed
    if len(sys.argv) > 1 and sys.argv[1] == '--force':
        logger.info("Forced update requested")
        need_update = True
    else:
        need_update = check_data_age()
        if need_update:
            logger.info("Data is stale, updating...")
        else:
            logger.info("Data is current, no update needed")
    
    if need_update:
        success = update_forecast()
        if success:
            logger.info("Update completed successfully")
            sys.exit(0)
        else:
            logger.error("Update failed")
            sys.exit(1)
    else:
        sys.exit(0)

if __name__ == "__main__":
    main()