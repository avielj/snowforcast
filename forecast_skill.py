#!/usr/bin/env python3
"""
Score each forecast model's historical snowfall accuracy from git history.

The data/ files are committed every ~3 hours, so the repo history contains
"what each model predicted for day D, L days ahead" as well as the day-of
forecast for D (the best available proxy for what actually happened).

For every resort (mid elevation), this script samples one commit per day
going back --days, extracts per-model snowfall predictions at 1-3 day lead
times, compares them to the day-of consensus value, and writes per-model
mean absolute error to data/skill.json. generate_static_data.py then uses
those MAEs to weight the consensus median (weight = 1 / (MAE + 0.5)).

Per-model history only exists from the first multi-model commit onward;
before that, only the Open-Meteo default ('openmeteo_best_match') is
scored. Skill therefore sharpens automatically as history accrues.

Usage: python3 forecast_skill.py [--days 45]
Requires full git history (actions/checkout with fetch-depth: 0).
"""

import argparse
import json
import subprocess
from datetime import datetime, timedelta

MAX_LEAD_DAYS = 3
MIN_SAMPLES = 5


def git(*args):
    result = subprocess.run(['git'] + list(args), capture_output=True, text=True, timeout=120)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or f'git {args[0]} failed')
    return result.stdout


def daily_commits(path, days_back):
    """Latest commit per calendar day that touched `path`, newest first."""
    since = (datetime.now() - timedelta(days=days_back)).strftime('%Y-%m-%d')
    log = git('log', f'--since={since}', '--format=%H %cI', '--', path)
    by_day = {}
    for line in log.splitlines():
        commit_hash, date_iso = line.split(' ', 1)
        day = date_iso[:10]
        if day not in by_day:  # log is newest-first, keep the latest of each day
            by_day[day] = (commit_hash, day)
    return list(by_day.values())


def load_extended(commit_hash, path):
    try:
        raw = git('show', f'{commit_hash}:{path}')
        return json.loads(raw).get('extended', {}).get('extended_forecast', [])
    except (RuntimeError, ValueError):
        return []


def score_resort(resort, days_back):
    """Collect predictions vs day-of values for one resort's mid-elevation file."""
    path = f'data/{resort.lower()}-mid.json'
    predictions = {}   # model -> list of (date, lead, value)
    observations = {}  # date -> day-of snowfall value

    for commit_hash, commit_day in daily_commits(path, days_back):
        commit_date = datetime.strptime(commit_day, '%Y-%m-%d')
        for day in load_extended(commit_hash, path):
            date_str = day.get('date')
            snowfall = day.get('snowfall')
            if not date_str or snowfall is None:
                continue
            try:
                lead = (datetime.strptime(date_str, '%Y-%m-%d') - commit_date).days
            except ValueError:
                continue

            if lead == 0:
                # Day-of forecast = observation proxy (keep the latest commit's value)
                observations.setdefault(date_str, snowfall)
            elif 1 <= lead <= MAX_LEAD_DAYS:
                models = day.get('snowfall_models') or {'openmeteo_best_match': snowfall}
                for model, value in models.items():
                    if value is not None:
                        predictions.setdefault(model, []).append((date_str, value))

    stats = {}
    for model, preds in predictions.items():
        errors = [abs(value - observations[date]) for date, value in preds if date in observations]
        if len(errors) >= MIN_SAMPLES:
            stats[model] = {'mae': round(sum(errors) / len(errors), 2), 'n': len(errors)}
    return stats


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[1])
    parser.add_argument('--days', type=int, default=45, help='history window (default 45)')
    args = parser.parse_args()

    with open('data/metadata.json') as f:
        resorts = json.load(f).get('resorts', [])

    skill = {
        'generated': datetime.now().isoformat(),
        'days_analyzed': args.days,
        'max_lead_days': MAX_LEAD_DAYS,
        'note': 'MAE (cm) of extended snowfall vs day-of forecast, mid elevation',
        'resorts': {},
    }
    for resort in resorts:
        try:
            stats = score_resort(resort, args.days)
        except Exception as e:
            print(f'⚠ {resort}: {e}')
            continue
        if stats:
            skill['resorts'][resort] = {'models': stats}
            summary = ', '.join(f'{m}={s["mae"]}' for m, s in sorted(stats.items()))
            print(f'✓ {resort}: {summary}')
        else:
            print(f'- {resort}: not enough history yet')

    with open('data/skill.json', 'w') as f:
        json.dump(skill, f, indent=2)
    print(f'\n✓ Saved data/skill.json ({len(skill["resorts"])} resorts scored)')


if __name__ == '__main__':
    main()
