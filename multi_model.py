#!/usr/bin/env python3
"""
Multi-source snowfall consensus.

Combines independent weather models into a robust daily snowfall consensus:
  - Open-Meteo multi-model endpoint (Meteo-France AROME/ARPEGE, DWD ICON,
    ECMWF IFS, NOAA GFS) - one request, per-model daily values
  - Open-Meteo ensemble API - ~30 perturbed members for uncertainty spread
  - MET Norway (api.met.no) - independent post-processed forecast, no key

Each day of an existing Open-Meteo extended forecast is enriched with:
  snowfall          -> (skill-weighted) median across models
  snowfall_range    -> [low, high] spread across models + ensemble p10/p90
  snowfall_models   -> per-model values for transparency / skill scoring
  snowfall_sources  -> number of independent values behind the consensus

Model weights come from data/skill.json (see forecast_skill.py); until that
file has data every model gets equal weight and the result is a plain median.
"""

import json
import os
from datetime import datetime

import requests

FORECAST_MODELS = ['meteofrance_seamless', 'icon_seamless', 'ecmwf_ifs025', 'gfs_seamless']
ENSEMBLE_MODEL = 'gfs_seamless'
MET_NO_HEADERS = {'User-Agent': 'snowforcast/1.0 github.com/avielj/snowforcast'}
SKILL_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'skill.json')


def fetch_multi_model_daily(lat, lon, elevation_m, days=16):
    """Fetch daily forecasts from several models in one Open-Meteo request.

    Returns {date_str: {model: {'snowfall': cm, 'temp_max': C, 'temp_min': C, 'precip': mm}}}
    """
    params = {
        'latitude': lat,
        'longitude': lon,
        'elevation': elevation_m,
        'daily': 'snowfall_sum,temperature_2m_max,temperature_2m_min,precipitation_sum',
        'models': ','.join(FORECAST_MODELS),
        'forecast_days': days,
        'timezone': 'Europe/Paris',
    }
    resp = requests.get('https://api.open-meteo.com/v1/forecast', params=params, timeout=30)
    resp.raise_for_status()
    daily = resp.json().get('daily', {})
    dates = daily.get('time', [])

    result = {}
    for i, date in enumerate(dates):
        result[date] = {}
        for model in FORECAST_MODELS:
            snow = daily.get(f'snowfall_sum_{model}', [])
            tmax = daily.get(f'temperature_2m_max_{model}', [])
            tmin = daily.get(f'temperature_2m_min_{model}', [])
            prec = daily.get(f'precipitation_sum_{model}', [])
            values = {
                'snowfall': snow[i] if i < len(snow) else None,
                'temp_max': tmax[i] if i < len(tmax) else None,
                'temp_min': tmin[i] if i < len(tmin) else None,
                'precip': prec[i] if i < len(prec) else None,
            }
            if values['snowfall'] is not None:
                result[date][model] = values
    return result


def fetch_ensemble_daily(lat, lon, elevation_m, days=14):
    """Fetch ensemble members and aggregate hourly snowfall to daily percentiles.

    Returns {date_str: {'p10': cm, 'median': cm, 'p90': cm, 'members': n}}
    """
    params = {
        'latitude': lat,
        'longitude': lon,
        'elevation': elevation_m,
        'hourly': 'snowfall',
        'models': ENSEMBLE_MODEL,
        'forecast_days': days,
        'timezone': 'Europe/Paris',
    }
    resp = requests.get('https://ensemble-api.open-meteo.com/v1/ensemble', params=params, timeout=30)
    resp.raise_for_status()
    hourly = resp.json().get('hourly', {})
    times = hourly.get('time', [])
    member_keys = [k for k in hourly if k.startswith('snowfall')]
    if not times or not member_keys:
        return {}

    # Sum each member's hourly snowfall into daily totals
    daily_by_member = {}  # member -> {date: total}
    for key in member_keys:
        series = hourly[key]
        totals = {}
        for i, t in enumerate(times):
            date = t[:10]
            v = series[i] if i < len(series) else None
            if v is not None:
                totals[date] = totals.get(date, 0.0) + v
        daily_by_member[key] = totals

    dates = sorted({d for totals in daily_by_member.values() for d in totals})
    result = {}
    for date in dates:
        values = sorted(t[date] for t in daily_by_member.values() if date in t)
        if not values:
            continue
        result[date] = {
            'p10': round(_percentile(values, 10), 1),
            'median': round(_percentile(values, 50), 1),
            'p90': round(_percentile(values, 90), 1),
            'members': len(values),
        }
    return result


def fetch_met_norway_daily(lat, lon, altitude_m):
    """Fetch MET Norway forecast and estimate daily snowfall from 6h blocks.

    Snow is estimated from precipitation_amount when the symbol indicates
    snow (full amount, 1mm water ~ 1cm snow) or sleet (half). Returns
    {date_str: {'snowfall': cm, 'temp_max': C, 'temp_min': C, 'precip': mm}}
    """
    params = {'lat': round(lat, 4), 'lon': round(lon, 4), 'altitude': int(altitude_m)}
    resp = requests.get('https://api.met.no/weatherapi/locationforecast/2.0/complete',
                        params=params, headers=MET_NO_HEADERS, timeout=30)
    resp.raise_for_status()
    timeseries = resp.json().get('properties', {}).get('timeseries', [])

    days = {}
    for entry in timeseries:
        block = entry.get('data', {}).get('next_6_hours')
        if not block:
            continue
        date = entry['time'][:10]
        details = block.get('details', {})
        symbol = block.get('summary', {}).get('symbol_code', '')
        precip = details.get('precipitation_amount', 0.0) or 0.0

        snow_cm = 0.0
        if 'snow' in symbol:
            snow_cm = precip  # 1mm water equivalent ~ 1cm snow
        elif 'sleet' in symbol:
            snow_cm = precip * 0.5

        day = days.setdefault(date, {'snowfall': 0.0, 'precip': 0.0, 'temps': []})
        day['snowfall'] += snow_cm
        day['precip'] += precip
        for k in ('air_temperature_max', 'air_temperature_min'):
            if k in details:
                day['temps'].append(details[k])

    result = {}
    for date, day in days.items():
        temps = day.pop('temps')
        result[date] = {
            'snowfall': round(day['snowfall'], 1),
            'precip': round(day['precip'], 1),
            'temp_max': max(temps) if temps else None,
            'temp_min': min(temps) if temps else None,
        }
    return result


def _percentile(sorted_values, p):
    """Linear-interpolated percentile of an already sorted list."""
    if not sorted_values:
        return None
    if len(sorted_values) == 1:
        return sorted_values[0]
    rank = (p / 100.0) * (len(sorted_values) - 1)
    low = int(rank)
    high = min(low + 1, len(sorted_values) - 1)
    frac = rank - low
    return sorted_values[low] * (1 - frac) + sorted_values[high] * frac


def weighted_median(value_weight_pairs):
    """Median of values where each value counts with the given weight."""
    pairs = sorted((v, w) for v, w in value_weight_pairs if v is not None and w > 0)
    if not pairs:
        return None
    total = sum(w for _, w in pairs)
    cumulative = 0.0
    for value, weight in pairs:
        cumulative += weight
        if cumulative >= total / 2:
            return value
    return pairs[-1][0]


def load_skill_weights(resort):
    """Per-model weights from data/skill.json: weight = 1 / (MAE + 0.5).

    Missing file, resort, or model -> neutral weight 1.0.
    """
    try:
        with open(SKILL_FILE) as f:
            skill = json.load(f)
    except (OSError, ValueError):
        return {}

    models = skill.get('resorts', {}).get(resort, {}).get('models', {})
    weights = {}
    for model, stats in models.items():
        mae = stats.get('mae')
        if mae is not None and stats.get('n', 0) >= 5:
            weights[model] = round(1.0 / (mae + 0.5), 3)
    # Weighting only makes sense once several models have a track record;
    # a single scored model would just get double-counted.
    return weights if len(weights) >= 2 else {}


def apply_consensus(extended_forecast, multi_model, ensemble, met_norway, weights):
    """Enrich each extended-forecast day with a consensus snowfall + range.

    Mutates and returns extended_forecast (the list of day dicts).
    """
    for day in extended_forecast:
        date = day.get('date')
        if not date:
            continue

        model_values = {'openmeteo_best_match': day.get('snowfall')}
        for model, values in multi_model.get(date, {}).items():
            model_values[model] = values['snowfall']
        if date in met_norway:
            model_values['met_norway'] = met_norway[date]['snowfall']
        ens = ensemble.get(date)
        if ens:
            model_values['ensemble_median'] = ens['median']

        pairs = [(v, weights.get(m, 1.0)) for m, v in model_values.items() if v is not None]
        if len(pairs) < 2:
            continue  # nothing to build a consensus from

        consensus = weighted_median(pairs)
        values = [v for v, _ in pairs]
        low, high = min(values), max(values)
        if ens:  # widen range with ensemble spread
            low = min(low, ens['p10'])
            high = max(high, ens['p90'])

        day['snowfall'] = round(consensus, 1)
        day['snowfall_range'] = [round(low, 1), round(high, 1)]
        day['snowfall_sources'] = len(pairs)
        day['snowfall_models'] = {m: v for m, v in model_values.items() if v is not None}

        # Temperature consensus (plain median, no range shown in UI)
        tmax = [values['temp_max'] for values in multi_model.get(date, {}).values()
                if values['temp_max'] is not None]
        tmin = [values['temp_min'] for values in multi_model.get(date, {}).values()
                if values['temp_min'] is not None]
        if date in met_norway and met_norway[date]['temp_max'] is not None:
            tmax.append(met_norway[date]['temp_max'])
            tmin.append(met_norway[date]['temp_min'])
        if day.get('temp_max') is not None:
            tmax.append(day['temp_max'])
        if day.get('temp_min') is not None:
            tmin.append(day['temp_min'])
        if len(tmax) >= 2:
            day['temp_max'] = round(_percentile(sorted(tmax), 50), 1)
        if len(tmin) >= 2:
            day['temp_min'] = round(_percentile(sorted(tmin), 50), 1)

    return extended_forecast


def enrich_extended_forecast(elevation_data, lat, lon, elevation_m, resort=None):
    """Fetch all extra sources and fold them into elevation_data['extended'].

    Failures in any single source degrade gracefully to the remaining ones.
    """
    extended = elevation_data.get('extended', {}).get('extended_forecast')
    if not extended:
        return elevation_data

    multi = {}
    ensemble = {}
    met = {}
    try:
        multi = fetch_multi_model_daily(lat, lon, elevation_m)
        print(f"  ✓ Multi-model: {len(multi)} days x {len(FORECAST_MODELS)} models")
    except Exception as e:
        print(f"  ⚠ Multi-model fetch failed: {e}")
    try:
        ensemble = fetch_ensemble_daily(lat, lon, elevation_m)
        if ensemble:
            members = next(iter(ensemble.values()))['members']
            print(f"  ✓ Ensemble: {len(ensemble)} days x {members} members")
    except Exception as e:
        print(f"  ⚠ Ensemble fetch failed: {e}")
    try:
        met = fetch_met_norway_daily(lat, lon, elevation_m)
        print(f"  ✓ MET Norway: {len(met)} days")
    except Exception as e:
        print(f"  ⚠ MET Norway fetch failed: {e}")

    if not multi and not ensemble and not met:
        return elevation_data

    weights = load_skill_weights(resort) if resort else {}
    apply_consensus(extended, multi, ensemble, met, weights)

    elevation_data['consensus'] = {
        'method': 'skill-weighted median' if weights else 'median',
        'models': (['openmeteo_best_match'] + [m for m in FORECAST_MODELS if multi]
                   + (['met_norway'] if met else [])
                   + (['ensemble_median'] if ensemble else [])),
        'skill_weights': weights or None,
        'generated': datetime.now().isoformat(),
    }
    return elevation_data
