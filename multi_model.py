#!/usr/bin/env python3
"""
Multi-source snowfall consensus.

Combines independent weather models into a robust daily snowfall consensus:
  - Open-Meteo multi-model endpoint - one request, per-model daily values:
    Meteo-France seamless (AROME/ARPEGE blend), DWD ICON seamless,
    ECMWF IFS 0.25, NOAA GFS seamless, plus GEM seamless (Canada),
    JMA seamless (Japan) and UKMO seamless (UK Met Office)
  - Open-Meteo ensemble API - GFS (31 members) and ECMWF IFS (51 members)
    for uncertainty spread
  - MET Norway (api.met.no) - independent post-processed forecast, no key.
    Uses next_1_hours blocks (hourly, non-overlapping) where present and
    next_6_hours only for the 6-hourly tail of the forecast; summing
    next_6_hours over hourly entries double-counted precipitation ~6x
    (Alpe-d-Huez bot 2026-11-22: 50.8cm -> 7.2cm after the fix).

Each day of an existing Open-Meteo extended forecast is enriched with:
  snowfall          -> (skill-weighted) median across models
  snowfall_range    -> [low, high] spread across INLIER models + ensemble
                       p10/p90 (outliers excluded, see detect_outliers)
  snowfall_models   -> per-model values for transparency / skill scoring
                       (outliers are KEPT here, never silently dropped)
  snowfall_outliers -> models flagged as extreme outliers that day
  snowfall_sources  -> number of models that returned data (incl. outliers)

Outlier rule (detect_outliers): a model is an extreme outlier when it is
more than 3x the (plain) median AND more than 10cm away from it, on either
side. It stays in snowfall_models and in the median (the median is robust)
but is excluded from snowfall_range so one wild model cannot dominate the
range shown to users. Every flag is printed to the run log.

Model weights come from data/skill.json (see forecast_skill.py); until that
file has data every model gets equal weight and the result is a plain median.
"""

import json
import os
from datetime import datetime

import requests

# One Open-Meteo request returns all of these; the last three are independent
# national centres (Canada / Japan / UK) added 2026-11-22 after live tests.
# NOT included, deliberately (see report): meteofrance_arpege_europe (already
# inside meteofrance_seamless from day 3, elevation-biased at low resorts),
# meteofrance_arome_france / icon_d2 / icon_eu (near-duplicates of the
# seamless blends, 2-5 day horizons), ecmwf_aifs025 (returns all-null
# snowfall via Open-Meteo as of 2026-11-22).
FORECAST_MODELS = ['meteofrance_seamless', 'icon_seamless', 'ecmwf_ifs025', 'gfs_seamless',
                   'gem_seamless', 'jma_seamless', 'ukmo_seamless']
ENSEMBLE_MODEL = 'gfs_seamless'
ECMWF_ENSEMBLE_MODEL = 'ecmwf_ifs025'
# A model is an extreme outlier when it is >3x the plain median AND >10cm away
# from it (either side). 10cm (not 5cm) so a lone high value on a marginal day
# — e.g. Meteo-France 5.81cm on 2026-11-25 at Alpe-d-Huez bot, where it has
# the best local track record — stays in the range, while a truly wild value
# (MET Norway 50.8cm vs a 0cm median) is caught. The MET Norway fetch fix
# below does the heavy lifting for that source (50.8 -> 7.2cm); this rule is
# the backstop. Genuine storm spread (e.g. 14-51cm across models at
# Alpe-d-Huez top, median ~25cm) is NOT flagged.
OUTLIER_RATIO = 3.0
OUTLIER_MIN_GAP_CM = 10.0
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


def fetch_ensemble_daily(lat, lon, elevation_m, days=14, model=ENSEMBLE_MODEL):
    """Fetch ensemble members and aggregate hourly snowfall to daily percentiles.

    `model` is 'gfs_seamless' (31 members) or 'ecmwf_ifs025' (51 members).
    Returns {date_str: {'p10': cm, 'median': cm, 'p90': cm, 'members': n}}
    """
    params = {
        'latitude': lat,
        'longitude': lon,
        'elevation': elevation_m,
        'hourly': 'snowfall',
        'models': model,
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
    """Fetch MET Norway forecast and estimate daily snowfall from precip blocks.

    Snow is estimated from precipitation_amount when the symbol indicates
    snow (full amount, 1mm water ~ 1cm snow) or sleet (half). Returns
    {date_str: {'snowfall': cm, 'temp_max': C, 'temp_min': C, 'precip': mm}}

    Block choice matters: the timeseries is hourly for ~60h then 6-hourly.
    Every hourly entry carries a next_6_hours block, so summing next_6_hours
    over all entries counts each 6h window ~6 times (Alpe-d-Huez bot
    2026-11-22: 50.8cm from overlapping heavysleet blocks, when the hourly
    symbols were heavyrain until 17:00 and only 14.4mm of sleet fell after).
    We therefore prefer next_1_hours (1h, never overlaps) and use
    next_6_hours only where the next entry is >= 6h away. next_1_hours has
    no temperatures, so temps come from instant air_temperature for hourly
    entries and from next_6_hours air_temperature_max/min for 6h entries.
    """
    params = {'lat': round(lat, 4), 'lon': round(lon, 4), 'altitude': int(altitude_m)}
    resp = requests.get('https://api.met.no/weatherapi/locationforecast/2.0/complete',
                        params=params, headers=MET_NO_HEADERS, timeout=30)
    resp.raise_for_status()
    timeseries = resp.json().get('properties', {}).get('timeseries', [])

    def _block_snow(block):
        details = block.get('details', {})
        symbol = block.get('summary', {}).get('symbol_code', '')
        precip = details.get('precipitation_amount', 0.0) or 0.0
        if 'snow' in symbol:
            return precip, precip
        if 'sleet' in symbol:
            return precip * 0.5, precip
        return 0.0, precip

    days = {}
    for i, entry in enumerate(timeseries):
        data = entry.get('data', {})
        # Pick the longest non-overlapping precip block for this entry.
        block = None
        block_hours = 0
        if 'next_1_hours' in data:
            block, block_hours = data['next_1_hours'], 1
        elif 'next_6_hours' in data:
            next_time = timeseries[i + 1]['time'] if i + 1 < len(timeseries) else None
            if next_time is None:
                block, block_hours = data['next_6_hours'], 6
            else:
                gap_h = (datetime.fromisoformat(next_time.replace('Z', '+00:00'))
                         - datetime.fromisoformat(entry['time'].replace('Z', '+00:00'))).total_seconds() / 3600
                if gap_h >= 6:
                    block, block_hours = data['next_6_hours'], 6
        if not block:
            continue  # last entry (instant only) or an overlapping 6h block
        date = entry['time'][:10]
        snow_cm, precip = _block_snow(block)
        day = days.setdefault(date, {'snowfall': 0.0, 'precip': 0.0, 'temps': []})
        day['snowfall'] += snow_cm
        day['precip'] += precip
        details = block.get('details', {})
        if 'air_temperature_max' in details and 'air_temperature_min' in details:
            day['temps'].extend([details['air_temperature_max'], details['air_temperature_min']])
        else:
            instant_temp = data.get('instant', {}).get('details', {}).get('air_temperature')
            if instant_temp is not None:
                day['temps'].append(instant_temp)

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


def detect_outliers(model_values):
    """Flag extreme outliers against the plain median of the day's values.

    A model is an outlier when its value is >OUTLIER_RATIO x the median AND
    more than OUTLIER_MIN_GAP_CM away from it, on either side. The median
    itself can never be flagged, so at least the inliers are never empty.
    Returns (median, [outlier model names]). Detection uses the plain
    (unweighted) median so a low skill weight cannot shift the reference.
    """
    values = sorted(v for v in model_values.values() if v is not None)
    if len(values) < 3:
        return (values[len(values) // 2] if values else None), []
    median = _percentile(values, 50)
    outliers = []
    for model, value in model_values.items():
        if value is None:
            continue
        if median == 0:
            if value > OUTLIER_MIN_GAP_CM:
                outliers.append(model)
        elif value > OUTLIER_RATIO * median and value - median > OUTLIER_MIN_GAP_CM:
            outliers.append(model)
        elif value < median / OUTLIER_RATIO and median - value > OUTLIER_MIN_GAP_CM:
            outliers.append(model)
    return median, sorted(outliers)


def apply_consensus(extended_forecast, multi_model, ensemble, met_norway, weights,
                    ensemble_ecmwf=None):
    """Enrich each extended-forecast day with a consensus snowfall + range.

    Mutates and returns extended_forecast (the list of day dicts).
    The consensus median uses ALL models (it is robust to one wild value);
    the range uses inliers only, widened by both ensembles' p10/p90.
    Outliers stay in snowfall_models and count toward snowfall_sources.
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
        ens_ecmwf = (ensemble_ecmwf or {}).get(date)
        if ens_ecmwf:
            model_values['ecmwf_ensemble_median'] = ens_ecmwf['median']

        pairs = [(v, weights.get(m, 1.0)) for m, v in model_values.items() if v is not None]
        if len(pairs) < 2:
            continue  # nothing to build a consensus from

        consensus = weighted_median(pairs)
        plain_median, outliers = detect_outliers(model_values)
        inlier_values = [v for m, v in model_values.items()
                         if v is not None and m not in outliers]
        low, high = min(inlier_values), max(inlier_values)
        for e in (ens, ens_ecmwf):  # widen range with ensemble spread
            if e:
                low = min(low, e['p10'])
                high = max(high, e['p90'])
        if outliers:
            print(f"  ⚠ Outlier {date}: "
                  + ", ".join(f"{m}={model_values[m]}cm" for m in outliers)
                  + f" vs median {plain_median}cm — excluded from range only")

        day['snowfall'] = round(consensus, 1)
        day['snowfall_range'] = [round(low, 1), round(high, 1)]
        day['snowfall_sources'] = len(pairs)
        day['snowfall_models'] = {m: v for m, v in model_values.items() if v is not None}
        day['snowfall_outliers'] = outliers

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
    ensemble_ecmwf = {}
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
            print(f"  ✓ Ensemble (GFS): {len(ensemble)} days x {members} members")
    except Exception as e:
        print(f"  ⚠ Ensemble fetch failed: {e}")
    try:
        ensemble_ecmwf = fetch_ensemble_daily(lat, lon, elevation_m, model=ECMWF_ENSEMBLE_MODEL)
        if ensemble_ecmwf:
            members = next(iter(ensemble_ecmwf.values()))['members']
            print(f"  ✓ Ensemble (ECMWF): {len(ensemble_ecmwf)} days x {members} members")
    except Exception as e:
        print(f"  ⚠ ECMWF ensemble fetch failed: {e}")
    try:
        met = fetch_met_norway_daily(lat, lon, elevation_m)
        print(f"  ✓ MET Norway: {len(met)} days")
    except Exception as e:
        print(f"  ⚠ MET Norway fetch failed: {e}")

    if not multi and not ensemble and not ensemble_ecmwf and not met:
        return elevation_data

    weights = load_skill_weights(resort) if resort else {}
    apply_consensus(extended, multi, ensemble, met, weights,
                    ensemble_ecmwf=ensemble_ecmwf)

    elevation_data['consensus'] = {
        'method': 'skill-weighted median' if weights else 'median',
        'models': (['openmeteo_best_match'] + [m for m in FORECAST_MODELS if multi]
                   + (['met_norway'] if met else [])
                   + (['ensemble_median'] if ensemble else [])
                   + (['ecmwf_ensemble_median'] if ensemble_ecmwf else [])),
        'skill_weights': weights or None,
        'generated': datetime.now().isoformat(),
    }
    return elevation_data
