#!/usr/bin/env python3
"""Focused tests for the generate_static_data.py fallback + keep-last-good paths.

Run from a COPY of the repo (never in the real worktree, so committed data is
never touched):
    rm -rf /tmp/gen-test && cp -r /tmp/snowforcast-worktrees/generator /tmp/gen-test
    cd /tmp/gen-test && python3 test_generator_fallback.py

The tests stub fetch_forecast / fetch_openmeteo_extended — no network needed.
A live end-to-end run is a separate, manual step (TEST_LIVE=1 runs the real
generate_static_data.py in a /tmp copy only).
"""
import hashlib
import json
import os
import shutil
import sys
import tempfile
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import generate_static_data as gsd

RESORTS = ['Val-Thorens', 'Cervinia', 'Via-Lattea', 'Monterosa-Ski', 'Gudauri',
           'St-Anton', 'Alpe-d-Huez', 'La-Plagne', 'Mount-Hermon']
ELEVATIONS = ['bot', 'mid', 'top']


def make_extended(snowfalls, base=datetime(2026, 11, 22)):
    """Canned 16-day OpenMeteo extended forecast (same shape as the real API)."""
    ext = []
    for i, sf in enumerate(snowfalls):
        d = base + timedelta(days=i)
        ext.append({
            "date": d.strftime("%Y-%m-%d"),
            "day_name": d.strftime("%A"),
            "temp_max": 2.0, "temp_min": -4.0,
            "precipitation": sf, "rain": 0.0,
            "snowfall": sf, "weather_code": 73 if sf else 1,
            "freezing_level_min": 1800, "freezing_level_max": 2600,
        })
    return {"extended_forecast": ext, "last_updated": "2026-11-22T00:00:00",
            "source": "OpenMeteo", "elevation": 2800, "elevation_used": 2800}


# 16 days of snowfall; first 7 days are the ones the fallback must reproduce.
SNOWFALLS = [0, 5.0, 12.5, 0, 3.0, 0, 0, 8.0, 1.5, 0, 0, 4.0, 0, 0, 2.0, 0]


def make_prev_entry(days=6, marker="PREV-DAY"):
    """A previous-run elevation entry with `days` good days."""
    return {
        "days": [{
            "name": "Monday", "date": str(16 + i),
            "am": {"condition": marker, "temperature": "-2.0", "feels_like": "-5.0",
                   "snow": "1.0", "rain": "0", "wind": "10.0 km/h W"},
            "pm": {"condition": marker, "temperature": "1.0", "feels_like": "-1.0",
                   "snow": "0.5", "rain": "0", "wind": "10.0 km/h W"},
            "night": {"condition": marker, "temperature": "-3.0", "feels_like": "-7.0",
                      "snow": "2.0", "rain": "0", "wind": "5.0 km/h W"},
        } for i in range(days)],
        "last_updated": "2026-11-21T10:00:00",
        "resort": "X", "elevation": "bot",
        "extended": make_extended(SNOWFALLS),
    }


def snapshot_tree(root):
    out = {}
    for dirpath, _, filenames in os.walk(root):
        for fn in filenames:
            p = os.path.join(dirpath, fn)
            out[os.path.relpath(p, root)] = hashlib.sha256(open(p, 'rb').read()).hexdigest()
    return out


def run_main_expecting_exit(code):
    try:
        gsd.main()
    except SystemExit as e:
        assert e.code == code, f"expected exit {code}, got {e.code}"
        return
    assert code == 0, f"expected exit {code}, main() returned normally"


def check_days_shape(all_data, expect_per_elev):
    total = 0
    for resort in RESORTS:
        for elev in ELEVATIONS:
            entry = all_data[resort][elev]
            days = entry.get('days', [])
            assert len(days) == expect_per_elev, f"{resort}/{elev}: {len(days)} days, want {expect_per_elev}"
            for day in days:
                for period in ('am', 'pm', 'night'):
                    assert isinstance(day.get(period), dict), f"{resort}/{elev} {day.get('date')}: missing {period}"
            total += len(days)
    return total


def check_snow_totals(all_data, snowfalls):
    """Fallback day snow (am+pm+night) must match the extended snowfall (±0.2 rounding)."""
    worst = 0.0
    for resort in RESORTS:
        for elev in ELEVATIONS:
            for i, day in enumerate(all_data[resort][elev]['days'][:7]):
                got = sum(float(day[p]['snow']) for p in ('am', 'pm', 'night'))
                want = snowfalls[i]
                worst = max(worst, abs(got - want))
                assert abs(got - want) <= 0.2, f"{resort}/{elev} day {i}: snow {got} != extended {want}"
    return worst


def test_fallback_from_empty(_tmp):
    """Unit: fill_missing_days_from_openmeteo builds 7 days from {} / None."""
    for start in ({}, None, {'days': []}):
        out = gsd.fill_missing_days_from_openmeteo(start, make_extended(SNOWFALLS), target_days=7)
        assert len(out['days']) == 7, f"start={start!r}: got {len(out.get('days', []))} days"
        for day in out['days']:
            assert set(day) >= {'name', 'date', 'am', 'pm', 'night'}
    print("PASS test_fallback_from_empty: {} / None / {'days': []} all -> 7 days, am/pm/night present")


def test_full_scrape_failure_fallback(tmp):
    """Scrape fails for ALL resorts; extended succeeds -> 7 fallback days each."""
    gsd.fetch_forecast = lambda resort, elevation: None
    gsd.fetch_openmeteo_extended = lambda lat, lon, name, elevation_m=2800: make_extended(SNOWFALLS)
    gsd.MULTI_MODEL_AVAILABLE = False
    run_main_expecting_exit(0)
    all_data = json.load(open('data/all-forecasts.json'))
    total = check_days_shape(all_data, 7)
    worst = check_snow_totals(all_data, SNOWFALLS)
    assert total == 27 * 7 == 189, total
    meta = json.load(open('data/metadata.json'))
    assert meta['total_days'] == 189 and meta['fresh_days'] == 189
    assert len(meta['fallback_elevations']) == 27, meta['fallback_elevations']
    assert meta['carried_elevations'] == []
    # per-file JSONs written too
    assert len(json.load(open('data/val-thorens-top.json'))['days']) == 7
    print(f"PASS test_full_scrape_failure_fallback: 189 days (27x7), "
          f"max snow-total deviation vs extended = {worst:.1f} cm, 27/27 fallback")


def test_keep_last_good_total_failure(tmp):
    """Scrape AND extended both fail -> files untouched, exit 1."""
    prev = {r: {e: make_prev_entry() for e in ELEVATIONS} for r in RESORTS}
    os.makedirs('data', exist_ok=True)
    with open('data/all-forecasts.json', 'w') as f:
        json.dump(prev, f)
    with open('data/metadata.json', 'w') as f:
        json.dump({'last_updated': '2026-11-21T10:00:00'}, f)
    with open('data/val-thorens-top.json', 'w') as f:
        json.dump(prev['Val-Thorens']['top'], f)
    before = snapshot_tree('data')
    gsd.fetch_forecast = lambda resort, elevation: None
    gsd.fetch_openmeteo_extended = lambda lat, lon, name, elevation_m=2800: None
    gsd.MULTI_MODEL_AVAILABLE = False
    run_main_expecting_exit(1)
    after = snapshot_tree('data')
    assert before == after, f"files changed on total failure: {set(before) ^ set(after)}"
    print("PASS test_keep_last_good_total_failure: exit 1, all data files byte-identical")


def test_scrape_ok_extended_fails(tmp):
    """Regression: scrape succeeds (5 days) but the OpenMeteo extended fetch
    fails -> the scraped days must still be published, not dropped."""
    def fake_scrape(resort, elevation):
        return {"days": make_prev_entry(days=5)["days"],
                "last_updated": "2026-11-22T06:00:00",
                "resort": resort, "elevation": elevation}

    gsd.fetch_forecast = fake_scrape
    gsd.fetch_openmeteo_extended = lambda lat, lon, name, elevation_m=2800: None
    gsd.MULTI_MODEL_AVAILABLE = False
    run_main_expecting_exit(0)
    all_data = json.load(open('data/all-forecasts.json'))
    total = check_days_shape(all_data, 5)
    assert total == 27 * 5 == 135, total
    meta = json.load(open('data/metadata.json'))
    assert meta['total_days'] == 135 and meta['fresh_days'] == 135
    assert meta['fallback_elevations'] == [] and meta['carried_elevations'] == []
    assert 'extended' not in all_data['Val-Thorens']['bot']
    print("PASS test_scrape_ok_extended_fails: scrape-only run kept 135 days (27x5), exit 0")


def test_partial_failure_carries_prev_days(tmp):
    """Scrape fails everywhere; extended fails for Gudauri only -> Gudauri
    keeps its previous days, the other 8 resorts get 7 fallback days."""
    prev = {r: {e: make_prev_entry() for e in ELEVATIONS} for r in RESORTS}
    os.makedirs('data', exist_ok=True)
    with open('data/all-forecasts.json', 'w') as f:
        json.dump(prev, f)

    def fake_extended(lat, lon, name, elevation_m=2800):
        return None if name == 'Gudauri' else make_extended(SNOWFALLS)

    gsd.fetch_forecast = lambda resort, elevation: None
    gsd.fetch_openmeteo_extended = fake_extended
    gsd.MULTI_MODEL_AVAILABLE = False
    run_main_expecting_exit(0)
    all_data = json.load(open('data/all-forecasts.json'))
    for elev in ELEVATIONS:
        g = all_data['Gudauri'][elev]
        assert len(g['days']) == 6, f"Gudauri/{elev}: {len(g['days'])} days, want carried 6"
        assert g['days'][0]['am']['condition'] == 'PREV-DAY', "Gudauri days not carried"
    for resort in [r for r in RESORTS if r != 'Gudauri']:
        for elev in ELEVATIONS:
            assert len(all_data[resort][elev]['days']) == 7
    meta = json.load(open('data/metadata.json'))
    assert meta['total_days'] == 24 * 7 + 3 * 6 == 186, meta['total_days']
    assert meta['fresh_days'] == 24 * 7 == 168, meta['fresh_days']
    assert sorted(meta['carried_elevations']) == ['Gudauri/bot', 'Gudauri/mid', 'Gudauri/top']
    assert len(meta['fallback_elevations']) == 24
    print("PASS test_partial_failure_carries_prev_days: Gudauri kept 6 prev days x3, "
          "other 24 elevations got 7 fallback days; total 186, fresh 168")


def main():
    tests = [test_fallback_from_empty, test_full_scrape_failure_fallback,
             test_keep_last_good_total_failure, test_scrape_ok_extended_fails,
             test_partial_failure_carries_prev_days]
    orig_fetch, orig_ext = gsd.fetch_forecast, gsd.fetch_openmeteo_extended
    orig_mm = gsd.MULTI_MODEL_AVAILABLE
    cwd = os.getcwd()
    for test in tests:
        tmp = tempfile.mkdtemp(prefix='gen-test-')
        os.chdir(tmp)
        try:
            test(tmp)
        finally:
            os.chdir(cwd)
            gsd.fetch_forecast, gsd.fetch_openmeteo_extended = orig_fetch, orig_ext
            gsd.MULTI_MODEL_AVAILABLE = orig_mm
            shutil.rmtree(tmp, ignore_errors=True)
    print(f"\nALL {len(tests)} TESTS PASSED")


if __name__ == '__main__':
    main()
