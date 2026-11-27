-- ============================================================================
-- SnowForecast — ski stats, vacations, leaderboard & public share links
-- Version: v1.2.1 — 2026-11-27
--   v1.2.1 (independent-review fixes, 2026-11-27): H3 find_or_create
--   hardened (auth.uid()-only wrapper; internal helper never granted),
--   M1 trip linking requires membership, M5 concurrent-insert conflict
--   handling, M4 empty-vacation cleanup trigger, C4 anon USAGE on
--   schema ski, M3 resort CHECKs widened with 'hermon', M6 comment
--   corrected (vacation_stats shows 0 to non-owners, not "their
--   contribution").
-- Project: Aviel's EXISTING Supabase project ("options",
-- https://zryunaixiaxlxedlvlyv.supabase.co). Do NOT create a new project.
-- Repo: avielj/snowforcast (static Vercel site)
--
-- RUN THIS FILE ONLY AFTER ski-schema.sql (v1.1) HAS BEEN RUN.
--   Supabase Dashboard -> SQL Editor -> paste this whole file -> Run.
--   Re-running is safe (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS /
--   CREATE OR REPLACE / DROP POLICY IF EXISTS / DROP TRIGGER IF EXISTS).
--   One transaction: either the whole migration lands or nothing does.
--
-- What this file does (all ADDITIVE — no existing table, column, policy,
-- or trigger is changed, except the recordings SELECT policy which is
-- deliberately NOT changed: recordings stay owner-only, see §4):
--   §1  ski.vacations — one row per auto-detected vacation.
--   §2  ski.recordings += vacation_id, ski_day, ski_time_s, lift_time_s,
--       run_count (all nullable) + trigger that sets ski_day and links
--       each recording to its vacation.
--   §3  Views ski.daily_stats + ski.vacation_stats (security_invoker):
--       per-day and per-vacation cumulative stats for the OWNER.
--   §4  Leaderboard: share_stats flag on ski.trip_members (opt-in,
--       OFF by default) + SECURITY DEFINER functions
--       ski.leaderboard_daily / ski.leaderboard_trip /
--       ski.leaderboard_vacation.
--   §5  Public share links: ski.share_links + SECURITY DEFINER
--       ski.resolve_share_link / ski.revoke_share_link.
--
-- DESIGN DECISIONS (why, not just what)
--   D1  ONE migration file, not three. Stats, leaderboard and share
--       links all build on the same two primitives (vacations + the
--       per-recording stat columns). One file = one Run in the SQL
--       Editor, one version to track, no ordering puzzle between files.
--   D2  Cumulative stats are VIEWS, not stored/generated columns.
--       Recordings arrive late (offline sync), get re-synced, or get
--       corrected — a stored total would drift unless maintained by
--       triggers on every write. A view is always correct, costs no
--       write amplification, and a vacation holds at most dozens of
--       recordings, so aggregation is cheap. (Also: a GENERATED column
--       cannot compute ski_day — `AT TIME ZONE` is STABLE, not
--       IMMUTABLE, and generated columns require IMMUTABLE. ski_day is
--       therefore a plain column maintained by the §2 trigger.)
--   D3  NO ski.vacation_members table. A vacation's audience is exactly
--       the membership of the trip it is linked to (vacations.trip_id
--       -> ski.trip_members). A second member list would duplicate trip
--       membership and drift from it (someone leaves the trip but stays
--       in the vacation, or vice versa). A vacation with trip_id NULL
--       is private: owner only, no leaderboard, no sharing audience.
--   D4  share_stats lives on ski.trip_members (per trip membership),
--       NOT on the user and NOT on the vacation. Sharing stats is a
--       per-crew decision: Aviel may share with the La Plagne crew and
--       not with the family trip. A user-level flag would be
--       all-or-nothing; a vacation-level flag would duplicate the
--       trip boundary. Default FALSE (off) — nobody appears on any
--       leaderboard until they explicitly opt in, per trip.
--   D5  Leaderboards are SECURITY DEFINER FUNCTIONS, not
--       security_invoker views — deliberately. Recordings stay
--       owner-only (the v1 policy is untouched), so a security_invoker
--       view over recordings could only ever show the caller their own
--       rows: a "leaderboard" view would list one person. The functions
--       instead enforce the equivalent checks inside (caller signed
--       in + caller is a trip member + only owners with share_stats
--       for that trip are included) and return AGGREGATES ONLY — never
--       GPS points, never another user's raw track. The own-stats
--       views in §3 ARE security_invoker, as they should be.
--   D6  share_links is a SEPARATE TABLE, not token columns on each
--       item table. One item can have several links (different
--       expiries, e.g. one for the group chat and one that never
--       expires); a link can be revoked without touching the item;
--       and five item types x (token + expiry + revoked) columns would
--       be 15 columns scattered across tables. One table, one pattern.
--   D7  No demo / fake data. No seed INSERTs. Vacations are created
--       only by the §2 trigger from REAL recordings, or by real users.
--
-- GROUPING RULE (the precise rule — see also SETUP.md Step 5)
--   A ski day is the CALENDAR DATE of a recording's started_at in the
--   RESORT TIMEZONE. All three resorts (Alpe d'Huez, La Plagne,
--   Val Thorens) are in France, so the resort timezone is
--   Europe/Paris (CET/CEST, DST handled by AT TIME ZONE). A recording
--   that starts at 23:30 local and ends after midnight counts on its
--   START day. Several recordings on the same calendar day are one day.
--   Days group per (owner, resort): a maximal run of CONSECUTIVE
--   calendar dates is ONE vacation. A gap of >= 1 calendar day with no
--   recording opens a NEW vacation. If a later recording bridges the
--   gap between two vacations (e.g. vacations Jan 8-9 and Jan 11-12,
--   then a Jan 10 recording arrives), the two vacations MERGE into one.
--
-- PRIVACY SUMMARY
--   * Vacations: owner sees all their own; trip members see a vacation
--     ONLY when it is linked to their trip (trip_id NOT NULL). Nobody
--     else sees it. Rename/delete: owner only.
--   * Recordings: owner only, UNCHANGED from v1. No new policy widens
--     this. Friends see stats only through the §4 functions (opt-in
--     members, aggregates only) or a §5 link the owner created.
--   * Leaderboard: only members with share_stats = true for that trip
--     appear. Opt out (or never opt in) = invisible on the board.
--   * Public links: token-gated, single-item, read-only. The resolver
--     returns NULL for unknown / revoked / expired tokens without
--     saying which, and never returns points (except item_type
--     'route', the one type whose whole purpose is showing the track),
--     user ids, names (except leaderboard display names of members
--     who opted into share_stats), trip member lists, or any other
--     user's data.
--
-- Requirements: PostgreSQL 15+ (same as ski-schema.sql — the views use
-- security_invoker = true). pgcrypto is used for unguessable tokens
-- (gen_random_bytes); it is allow-listed in Supabase — if the
-- CREATE EXTENSION below fails, enable pgcrypto in
-- Dashboard -> Database -> Extensions and re-run.
-- ============================================================================

BEGIN;

-- pgcrypto for gen_random_bytes(32) — 256-bit unguessable share tokens.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- --------------------------------------------------------------------------
-- §1. ski.vacations — one row per auto-detected vacation
--
--    Created ONLY by the §2 trigger from real recordings (or by the
--    backfill in §2 for recordings that predate this migration). The
--    client never invents a vacation id — it reads the list, and it may
--    rename (UPDATE name) or delete (DELETE) its own vacations.
--    trip_id links a vacation to a trip for sharing: NULL = private.
--    timezone is stored per vacation so the grouping rule stays explicit
--    even if a non-French resort is added later (today always
--    'Europe/Paris' — see the grouping rule above).
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ski.vacations (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  trip_id     uuid        REFERENCES ski.trips (id) ON DELETE SET NULL,
  resort      text        NOT NULL
              CHECK (resort IN ('alpe-d-huez', 'la-plagne', 'val-thorens', 'hermon')),
  name        text        NOT NULL DEFAULT '',
  start_date  date        NOT NULL,
  end_date    date        NOT NULL,
  timezone    text        NOT NULL DEFAULT 'Europe/Paris',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date),
  -- One vacation per owner + resort + start date: the auto-grouping
  -- function relies on this to find "the" vacation a day belongs to.
  UNIQUE (owner_id, resort, start_date)
);

CREATE INDEX IF NOT EXISTS vacations_owner_idx
  ON ski.vacations (owner_id, start_date DESC);
CREATE INDEX IF NOT EXISTS vacations_trip_idx
  ON ski.vacations (trip_id);

DROP TRIGGER IF EXISTS vacations_set_updated_at ON ski.vacations;
CREATE TRIGGER vacations_set_updated_at
  BEFORE UPDATE ON ski.vacations
  FOR EACH ROW EXECUTE FUNCTION ski.set_updated_at();

-- --------------------------------------------------------------------------
-- §2. ski.recordings — additive columns + auto-grouping trigger
--
--    vacation_id : the vacation this recording belongs to. Set by the
--      trigger below (or by an explicit client value, which the trigger
--      respects). ON DELETE SET NULL: deleting a vacation unlinks its
--      recordings instead of deleting them.
--    ski_day     : calendar date of started_at in Europe/Paris. Plain
--      column (NOT generated — AT TIME ZONE is STABLE, not IMMUTABLE).
--      Maintained by the trigger; backfilled for old rows by §2's
--      backfill call. NULL only on rows created before this migration
--      that the backfill somehow missed — the views ignore NULL days.
--    ski_time_s  : seconds actually skiing (descending). Computed
--      client-side by computeStats() on Stop, like the other stat
--      columns. NULL = unknown (old recordings, or a client that does
--      not split yet) — never 0 by default, so "unknown" stays
--      distinguishable from "no skiing".
--    lift_time_s : seconds on lifts / stationary uphill transport.
--      ski_time_s + lift_time_s <= duration_s when all three are known.
--    run_count   : number of runs (descents) in this recording.
-- --------------------------------------------------------------------------
ALTER TABLE ski.recordings
  ADD COLUMN IF NOT EXISTS vacation_id uuid
    REFERENCES ski.vacations (id) ON DELETE SET NULL;
ALTER TABLE ski.recordings
  ADD COLUMN IF NOT EXISTS ski_day date;
ALTER TABLE ski.recordings
  ADD COLUMN IF NOT EXISTS ski_time_s double precision
    CHECK (ski_time_s IS NULL OR ski_time_s >= 0);
ALTER TABLE ski.recordings
  ADD COLUMN IF NOT EXISTS lift_time_s double precision
    CHECK (lift_time_s IS NULL OR lift_time_s >= 0);
ALTER TABLE ski.recordings
  ADD COLUMN IF NOT EXISTS run_count integer
    CHECK (run_count IS NULL OR run_count >= 0);
-- ski + lift time cannot exceed the total duration (when all are known).
ALTER TABLE ski.recordings
  DROP CONSTRAINT IF EXISTS recordings_ski_lift_le_duration;
ALTER TABLE ski.recordings
  ADD CONSTRAINT recordings_ski_lift_le_duration CHECK (
    ski_time_s IS NULL OR lift_time_s IS NULL OR duration_s IS NULL
    OR ski_time_s + lift_time_s <= duration_s
  );

COMMENT ON COLUMN ski.recordings.vacation_id IS
  'Vacation this recording belongs to (auto-grouped by consecutive ski days, resort Europe/Paris). NULL = not grouped yet.';
COMMENT ON COLUMN ski.recordings.ski_day IS
  'Calendar date of started_at in the resort timezone (Europe/Paris). Set by trigger ski.recordings_assign_vacation.';
COMMENT ON COLUMN ski.recordings.ski_time_s IS
  'Seconds actually skiing (descending). NULL = unknown / not split by this client version.';
COMMENT ON COLUMN ski.recordings.lift_time_s IS
  'Seconds on lifts / stationary uphill transport. NULL = unknown / not split by this client version.';
COMMENT ON COLUMN ski.recordings.run_count IS
  'Number of runs (descents) in this recording. NULL = unknown / not counted by this client version.';

CREATE INDEX IF NOT EXISTS recordings_vacation_idx
  ON ski.recordings (vacation_id);
CREATE INDEX IF NOT EXISTS recordings_user_day_idx
  ON ski.recordings (user_id, ski_day);

-- Find the vacation a (user, resort, day) belongs to — creating it, or
-- extending / merging vacations, as needed. SECURITY DEFINER so the
-- trigger (§2) and the backfill can write vacations regardless of the
-- caller's RLS; it only ever touches the GIVEN user's own vacations
-- (p_user_id comes from the recording's owner, never from a stranger).
--   * day inside [start_date, end_date]            -> link, no change
--   * day = end_date + 1                           -> extend end_date
--   * day = start_date - 1                         -> extend start_date
--   * day bridges two vacations                    -> merge into the
--     earlier one (reassign the later one's recordings, delete it)
--   * otherwise                                    -> create new vacation
--     named e.g. 'La Plagne · Jan 2027' (renameable by the owner).
-- If the recording has a trip and the vacation has none, the vacation
-- is linked to that trip (first trip wins; a later different trip
-- never overwrites it) — M1: ONLY when the owner is a member of that
-- trip. A non-member who records against a trip uuid must never have
-- their vacation exposed to its members.
--
-- H3 (independent review, 2026-11-27): the original 4-arg helper took
-- an ARBITRARY p_user_id and was GRANTED to authenticated — any
-- signed-in user could create vacations in ANYONE's account (proven
-- by the reviewer). The helper is therefore INTERNAL
-- (ski.find_or_create_vacation_for_day_for) and is NEVER granted to
-- anyone; the only callable entry point is the 3-arg wrapper
-- ski.find_or_create_vacation_for_day(p_resort, p_day, p_trip_id)
-- below, which uses auth.uid() of the CALLER and nothing else. The
-- trigger calls the wrapper; backfill_vacations() calls the internal
-- helper directly (SECURITY DEFINER, iterating real owners).
DROP FUNCTION IF EXISTS ski.find_or_create_vacation_for_day(uuid, text, date, uuid);
CREATE OR REPLACE FUNCTION ski.find_or_create_vacation_for_day_for(
  p_user_id uuid, p_resort text, p_day date, p_trip_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ski, pg_catalog
AS $$
DECLARE
  v_vac ski.vacations%ROWTYPE;
  v_other ski.vacations%ROWTYPE;
  v_name text;
  v_member boolean;
BEGIN
  -- M1: is the owner a member of the trip at all? (Checked once; used
  -- for both the link-existing and the create branches.)
  v_member := p_trip_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM ski.trip_members m
    WHERE m.trip_id = p_trip_id AND m.user_id = p_user_id);

  -- 1. Day already inside a vacation, or directly adjacent to one.
  SELECT * INTO v_vac FROM ski.vacations v
  WHERE v.owner_id = p_user_id
    AND v.resort = p_resort
    AND p_day BETWEEN v.start_date - 1 AND v.end_date + 1
  ORDER BY v.start_date
  LIMIT 1;

  IF v_vac.id IS NOT NULL THEN
    -- Extend the range if the day sticks out by one on either side.
    IF p_day < v_vac.start_date OR p_day > v_vac.end_date THEN
      UPDATE ski.vacations
      SET start_date = LEAST(start_date, p_day),
          end_date   = GREATEST(end_date, p_day)
      WHERE id = v_vac.id
      RETURNING * INTO v_vac;
    END IF;

    -- 2. Bridging merge: does the (possibly just extended) vacation
    -- now touch a second vacation of the same user+resort?
    SELECT * INTO v_other FROM ski.vacations v
    WHERE v.owner_id = p_user_id
      AND v.resort = p_resort
      AND v.id <> v_vac.id
      AND v.start_date <= v_vac.end_date + 1
      AND v.end_date >= v_vac.start_date - 1
    ORDER BY v.start_date
    LIMIT 1;

    IF v_other.id IS NOT NULL THEN
      UPDATE ski.vacations
      SET start_date = LEAST(start_date, v_other.start_date),
          end_date   = GREATEST(end_date, v_other.end_date)
      WHERE id = v_vac.id
      RETURNING * INTO v_vac;
      -- Reassign the absorbed vacation's recordings FIRST (the FK is
      -- ON DELETE SET NULL, so deleting first would unlink them).
      UPDATE ski.recordings
      SET vacation_id = v_vac.id
      WHERE vacation_id = v_other.id;
      DELETE FROM ski.vacations WHERE id = v_other.id;
    END IF;

    -- Link the trip if the vacation has none yet (first trip wins;
    -- M1: only when the owner is a member of that trip).
    IF v_member AND v_vac.trip_id IS NULL THEN
      UPDATE ski.vacations SET trip_id = p_trip_id WHERE id = v_vac.id;
    END IF;

    RETURN v_vac.id;
  END IF;

  -- 3. No adjacent vacation: create one for this single day.
  v_name := CASE p_resort
    WHEN 'alpe-d-huez' THEN 'Alpe d''Huez'
    WHEN 'la-plagne'   THEN 'La Plagne'
    WHEN 'val-thorens' THEN 'Val Thorens'
    WHEN 'hermon'      THEN 'Mount Hermon'
    ELSE p_resort END || ' · ' || to_char(p_day, 'Mon YYYY');

  -- M5: two concurrent inserts for the same new (owner, resort, day)
  -- must not fail one recording with a UNIQUE violation — the loser
  -- re-selects the row the winner created (and the recording still
  -- lands; worst case it stays unlinked until backfill).
  INSERT INTO ski.vacations
    (owner_id, trip_id, resort, name, start_date, end_date, timezone)
  VALUES
    (p_user_id, CASE WHEN v_member THEN p_trip_id ELSE NULL END,
     p_resort, v_name, p_day, p_day, 'Europe/Paris')
  ON CONFLICT (owner_id, resort, start_date) DO NOTHING
  RETURNING id INTO v_vac.id;

  IF v_vac.id IS NULL THEN
    SELECT id INTO v_vac.id FROM ski.vacations
    WHERE owner_id = p_user_id AND resort = p_resort AND start_date = p_day;
  END IF;

  RETURN v_vac.id;
END;
$$;

-- Callable entry point (H3): the caller can ONLY ever act as
-- themselves — auth.uid() is the user, never a parameter. Returns
-- NULL when there is no signed-in caller (e.g. a raw SQL-Editor call
-- with no JWT); the trigger only ever fires on a signed-in user's
-- recording insert, where auth.uid() is the recording owner (the
-- INSERT policy enforces user_id = auth.uid()).
CREATE OR REPLACE FUNCTION ski.find_or_create_vacation_for_day(
  p_resort text, p_day date, p_trip_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ski, pg_catalog
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN ski.find_or_create_vacation_for_day_for(
    auth.uid(), p_resort, p_day, p_trip_id);
END;
$$;

-- Trigger: on every new recording (and when started_at / resort change),
-- set ski_day and link the vacation. An explicitly supplied vacation_id
-- is respected — EXCEPT when started_at/resort change, in which case
-- the day may no longer belong to that vacation and auto-grouping
-- re-runs (the client can re-assign afterwards with a separate UPDATE
-- that touches only vacation_id).
CREATE OR REPLACE FUNCTION ski.recordings_assign_vacation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ski, pg_catalog
AS $$
DECLARE
  v_day date;
BEGIN
  v_day := (NEW.started_at AT TIME ZONE 'Europe/Paris')::date;
  NEW.ski_day := v_day;

  IF TG_OP = 'UPDATE'
     AND (NEW.started_at IS DISTINCT FROM OLD.started_at
          OR NEW.resort IS DISTINCT FROM OLD.resort) THEN
    NEW.vacation_id := NULL;
  END IF;

  IF NEW.vacation_id IS NULL THEN
    -- H3: the 3-arg wrapper uses auth.uid() (= the recording owner:
    -- the INSERT policy enforces user_id = auth.uid()) — never a
    -- caller-supplied user id.
    NEW.vacation_id := ski.find_or_create_vacation_for_day(
      NEW.resort, v_day, NEW.trip_id);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS recordings_assign_vacation ON ski.recordings;
CREATE TRIGGER recordings_assign_vacation
  BEFORE INSERT OR UPDATE OF started_at, resort ON ski.recordings
  FOR EACH ROW EXECUTE FUNCTION ski.recordings_assign_vacation();

-- Backfill: group every pre-existing recording (vacation_id IS NULL)
-- into vacations, oldest first so consecutive days extend the same
-- vacation instead of creating one per day. Owner-scoped by
-- construction — it only links a recording to ITS OWN owner's vacation.
-- H3 (independent review, 2026-11-27): when called by a signed-in
-- user it processes ONLY that caller's recordings; the all-users pass
-- runs only with no auth context (the migration itself, run as
-- postgres in the SQL Editor). A user can therefore never regroup
-- (or resurrect a deleted vacation of) anyone else.
-- Called once at the end of this migration; also callable later via
--   supabase.rpc('backfill_vacations', {}, { schema: 'ski' })
-- (e.g. after a bulk import). Returns the number of recordings linked.
CREATE OR REPLACE FUNCTION ski.backfill_vacations()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ski, pg_catalog
AS $$
DECLARE
  r record;
  n integer := 0;
BEGIN
  FOR r IN
    SELECT id, user_id, resort, started_at, trip_id
    FROM ski.recordings
    WHERE vacation_id IS NULL
      AND (auth.uid() IS NULL OR user_id = auth.uid())
    ORDER BY user_id, resort, started_at
  LOOP
    UPDATE ski.recordings
    SET vacation_id = ski.find_or_create_vacation_for_day_for(
          r.user_id, r.resort,
          (r.started_at AT TIME ZONE 'Europe/Paris')::date,
          r.trip_id),
        ski_day = (r.started_at AT TIME ZONE 'Europe/Paris')::date
    WHERE id = r.id;
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$;

-- One-time backfill for recordings created before this migration.
SELECT ski.backfill_vacations();

-- M4 (independent review, 2026-11-27): deleting a recording left its
-- vacation row behind with 0 recordings (orphan empty vacation). This
-- trigger removes a vacation when its last recording goes away.
-- (Deleting a VACATION is different: the FK sets its recordings'
-- vacation_id NULL — no trigger involvement.)
CREATE OR REPLACE FUNCTION ski.delete_empty_vacation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ski, pg_catalog
AS $$
BEGIN
  IF OLD.vacation_id IS NOT NULL THEN
    DELETE FROM ski.vacations v
    WHERE v.id = OLD.vacation_id
      AND NOT EXISTS (SELECT 1 FROM ski.recordings r
                      WHERE r.vacation_id = OLD.vacation_id);
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS recordings_delete_empty_vacation ON ski.recordings;
CREATE TRIGGER recordings_delete_empty_vacation
  AFTER DELETE ON ski.recordings
  FOR EACH ROW EXECUTE FUNCTION ski.delete_empty_vacation();

-- --------------------------------------------------------------------------
-- §3. Own-stats views (security_invoker — RLS-governed, owner sees own)
--
--    Why views, not stored columns (decision D2): recordings arrive late
--    (offline sync), get re-synced or corrected — a stored total would
--    drift. These views are always correct and cheap at this scale.
--
--    HONEST LIMIT, read before building UI on these: the views aggregate
--    only the rows RLS lets the CALLER see. For the owner that is
--    everything. For a trip member looking at a SHARED vacation,
--    ski.vacation_stats shows 0 — NOT "their own contribution" (the
--    earlier comment overstated this; verified 2026-11-27): a member's
--    recordings belong to THEIR OWN vacation rows, so the join from the
--    owner's vacation finds no recordings at all. Cross-user totals
--    live ONLY in the §4 leaderboard functions, which enforce
--    share_stats. Never present a vacation_stats row to a non-owner
--    as "the vacation total".
-- --------------------------------------------------------------------------
CREATE OR REPLACE VIEW ski.daily_stats
WITH (security_invoker = true) AS
  SELECT
    r.user_id,
    r.resort,
    r.ski_day,
    COUNT(*)                                AS recording_count,
    COALESCE(SUM(r.distance_m), 0)          AS total_distance_m,
    COALESCE(SUM(r.vertical_gain_m), 0)     AS total_vertical_gain_m,
    COALESCE(SUM(r.vertical_loss_m), 0)     AS total_vertical_loss_m,
    MAX(r.top_speed_ms)                     AS max_top_speed_ms,
    MAX(r.longest_run_m)                    AS longest_run_m,
    COALESCE(SUM(r.run_count), 0)           AS total_runs,
    COALESCE(SUM(r.ski_time_s), 0)          AS total_ski_time_s,
    COALESCE(SUM(r.lift_time_s), 0)         AS total_lift_time_s,
    COALESCE(SUM(r.duration_s), 0)          AS total_duration_s,
    MIN(r.started_at)                       AS first_started_at,
    MAX(r.ended_at)                         AS last_ended_at
  FROM ski.recordings r
  WHERE r.ski_day IS NOT NULL
  GROUP BY r.user_id, r.resort, r.ski_day;

CREATE OR REPLACE VIEW ski.vacation_stats
WITH (security_invoker = true) AS
  SELECT
    v.id                    AS vacation_id,
    v.owner_id              AS user_id,
    v.trip_id,
    v.resort,
    v.name,
    v.start_date,
    v.end_date,
    COUNT(DISTINCT r.ski_day)               AS day_count,
    COUNT(r.id)                             AS recording_count,
    COALESCE(SUM(r.distance_m), 0)          AS total_distance_m,
    COALESCE(SUM(r.vertical_gain_m), 0)     AS total_vertical_gain_m,
    COALESCE(SUM(r.vertical_loss_m), 0)     AS total_vertical_loss_m,
    MAX(r.top_speed_ms)                     AS max_top_speed_ms,
    MAX(r.longest_run_m)                    AS longest_run_m,
    COALESCE(SUM(r.run_count), 0)           AS total_runs,
    COALESCE(SUM(r.ski_time_s), 0)          AS total_ski_time_s,
    COALESCE(SUM(r.lift_time_s), 0)         AS total_lift_time_s,
    COALESCE(SUM(r.duration_s), 0)          AS total_duration_s
  FROM ski.vacations v
  LEFT JOIN ski.recordings r ON r.vacation_id = v.id
  GROUP BY v.id, v.owner_id, v.trip_id, v.resort, v.name,
           v.start_date, v.end_date;

-- --------------------------------------------------------------------------
-- §4. Leaderboard — opt-in stats sharing inside a trip
--
--    share_stats on ski.trip_members (decision D4): per-trip opt-in,
--    DEFAULT FALSE. Nobody appears on any leaderboard until they flip
--    it on for that trip. The toggle lives in the trip sheet:
--        supabase.rpc('set_share_stats',
--          { p_trip_id, p_share: true }, { schema: 'ski' })
--
--    Why a function, not a plain UPDATE: the v1 policy
--    trip_members_update_self requires role = 'member' in WITH CHECK,
--    so a trip ADMIN (the creator — usually Aviel) cannot update their
--    own member row at all. Loosening that policy would let a member
--    promote themselves to admin. The function below updates ONLY the
--    caller's own share_stats column — one column, one row, no role
--    change — so the v1 policy stays exactly as it is.
-- --------------------------------------------------------------------------
ALTER TABLE ski.trip_members
  ADD COLUMN IF NOT EXISTS share_stats boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN ski.trip_members.share_stats IS
  'Opt-in (default false): share this member''s aggregate ski stats with the other members of THIS trip, for leaderboards. Off = invisible on every board. No raw tracks are ever shared — aggregates only, via the leaderboard functions.';

CREATE OR REPLACE FUNCTION ski.set_share_stats(p_trip_id uuid, p_share boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ski, pg_catalog
AS $$
DECLARE
  n integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;
  UPDATE ski.trip_members
  SET share_stats = p_share
  WHERE trip_id = p_trip_id AND user_id = auth.uid();
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n > 0;
END;
$$;

-- Daily leaderboard: one row per SHARING member of the trip, for one
-- ski day (Europe/Paris calendar date). Ranks per category are computed
-- server-side (RANK(): ties share a rank). Returns an EMPTY SET — not
-- an error — when the caller is not signed in, is not a trip member,
-- or when nobody shares. A recording counts for the day when its
-- trip_id is the trip OR its vacation is linked to the trip (covers
-- recordings whose trip_id was never set but whose vacation is).
-- Returned columns are AGGREGATES + display_name only: no GPS points,
-- no user ids beyond the member list the caller can already see via
-- trip_members, no raw tracks. is_me marks the caller's own row.
CREATE OR REPLACE FUNCTION ski.leaderboard_daily(
  p_trip_id uuid, p_day date
)
RETURNS TABLE (
  user_id            uuid,
  display_name       text,
  is_me              boolean,
  total_distance_m   double precision,
  total_vertical_gain_m double precision,
  max_top_speed_ms   double precision,
  longest_run_m      double precision,
  total_runs         bigint,
  total_ski_time_s   double precision,
  total_lift_time_s  double precision,
  rank_distance      bigint,
  rank_vertical      bigint,
  rank_top_speed     bigint,
  rank_longest_run   bigint,
  rank_runs          bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ski, pg_catalog
AS $$
  WITH sharing AS (
    SELECT tm.user_id, tm.display_name
    FROM ski.trip_members tm
    WHERE tm.trip_id = p_trip_id
      AND tm.share_stats
  ),
  day AS (
    SELECT
      r.user_id,
      COALESCE(SUM(r.distance_m), 0)      AS total_distance_m,
      COALESCE(SUM(r.vertical_gain_m), 0) AS total_vertical_gain_m,
      MAX(r.top_speed_ms)                 AS max_top_speed_ms,
      MAX(r.longest_run_m)                AS longest_run_m,
      COALESCE(SUM(r.run_count), 0)       AS total_runs,
      COALESCE(SUM(r.ski_time_s), 0)      AS total_ski_time_s,
      COALESCE(SUM(r.lift_time_s), 0)     AS total_lift_time_s
    FROM ski.recordings r
    JOIN sharing s ON s.user_id = r.user_id
    WHERE r.ski_day = p_day
      AND (r.trip_id = p_trip_id
           OR r.vacation_id IN (
             SELECT v.id FROM ski.vacations v WHERE v.trip_id = p_trip_id))
    GROUP BY r.user_id
  )
  SELECT
    s.user_id,
    s.display_name,
    (s.user_id = auth.uid()) AS is_me,
    d.total_distance_m,
    d.total_vertical_gain_m,
    d.max_top_speed_ms,
    d.longest_run_m,
    d.total_runs,
    d.total_ski_time_s,
    d.total_lift_time_s,
    RANK() OVER (ORDER BY d.total_distance_m DESC)    AS rank_distance,
    RANK() OVER (ORDER BY d.total_vertical_gain_m DESC) AS rank_vertical,
    RANK() OVER (ORDER BY d.max_top_speed_ms DESC NULLS LAST) AS rank_top_speed,
    RANK() OVER (ORDER BY d.longest_run_m DESC NULLS LAST)    AS rank_longest_run,
    RANK() OVER (ORDER BY d.total_runs DESC)           AS rank_runs
  FROM sharing s
  JOIN day d ON d.user_id = s.user_id
  WHERE auth.uid() IS NOT NULL
    AND ski.is_trip_member(p_trip_id)
  ORDER BY d.total_distance_m DESC;
$$;

-- Internal rows builder for the TRIP cumulative board: aggregates
-- each SHARING member's recordings linked to the trip (by trip_id, or
-- via a vacation linked to the trip), over the whole trip.
-- It performs NO caller checks by design — it is NOT granted to any
-- role (REVOKE below), so it can only run nested inside the SECURITY
-- DEFINER callers that DO authorise the request: ski.leaderboard_trip
-- / ski.leaderboard_vacation (signed-in trip member) and
-- ski.resolve_share_link (a valid, unrevoked, unexpired public link
-- whose creator chose to publish exactly this board).
--
-- WHY TRIP-SCOPED, not vacation-scoped: a vacation row belongs to ONE
-- owner (the trigger groups each user's own recordings into their own
-- vacations), so a board over a single vacation_id could only ever
-- list that one owner. The shared cumulative board is therefore
-- necessarily per TRIP: every sharing member's whole-trip totals.
-- leaderboard_vacation() below is a convenience wrapper that resolves
-- the trip from the vacation id the client already has.
CREATE OR REPLACE FUNCTION ski.leaderboard_trip_rows(
  p_trip_id uuid
)
RETURNS TABLE (
  user_id            uuid,
  display_name       text,
  day_count          bigint,
  total_distance_m   double precision,
  total_vertical_gain_m double precision,
  max_top_speed_ms   double precision,
  longest_run_m      double precision,
  total_runs         bigint,
  total_ski_time_s   double precision,
  total_lift_time_s  double precision,
  rank_distance      bigint,
  rank_vertical      bigint,
  rank_top_speed     bigint,
  rank_longest_run   bigint,
  rank_runs          bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ski, pg_catalog
AS $$
  WITH sharing AS (
    SELECT tm.user_id, tm.display_name
    FROM ski.trip_members tm
    WHERE tm.trip_id = p_trip_id
      AND tm.share_stats
  ),
  total AS (
    SELECT
      r.user_id,
      COUNT(DISTINCT r.ski_day)            AS day_count,
      COALESCE(SUM(r.distance_m), 0)      AS total_distance_m,
      COALESCE(SUM(r.vertical_gain_m), 0) AS total_vertical_gain_m,
      MAX(r.top_speed_ms)                 AS max_top_speed_ms,
      MAX(r.longest_run_m)                AS longest_run_m,
      COALESCE(SUM(r.run_count), 0)       AS total_runs,
      COALESCE(SUM(r.ski_time_s), 0)      AS total_ski_time_s,
      COALESCE(SUM(r.lift_time_s), 0)     AS total_lift_time_s
    FROM ski.recordings r
    JOIN sharing s ON s.user_id = r.user_id
    WHERE r.trip_id = p_trip_id
       OR r.vacation_id IN (
         SELECT v.id FROM ski.vacations v WHERE v.trip_id = p_trip_id)
    GROUP BY r.user_id
  )
  SELECT
    s.user_id,
    s.display_name,
    t.day_count,
    t.total_distance_m,
    t.total_vertical_gain_m,
    t.max_top_speed_ms,
    t.longest_run_m,
    t.total_runs,
    t.total_ski_time_s,
    t.total_lift_time_s,
    RANK() OVER (ORDER BY t.total_distance_m DESC)    AS rank_distance,
    RANK() OVER (ORDER BY t.total_vertical_gain_m DESC) AS rank_vertical,
    RANK() OVER (ORDER BY t.max_top_speed_ms DESC NULLS LAST) AS rank_top_speed,
    RANK() OVER (ORDER BY t.longest_run_m DESC NULLS LAST)    AS rank_longest_run,
    RANK() OVER (ORDER BY t.total_runs DESC)           AS rank_runs
  FROM sharing s
  JOIN total t ON t.user_id = s.user_id
  ORDER BY t.total_distance_m DESC;
$$;

-- Nobody may call the rows builder directly — only the authorised
-- wrappers below (and resolve_share_link) may use it (nested SECURITY
-- DEFINER calls run as the function owner, so the wrappers still work
-- after this revoke). Both revokes are needed: v1's
-- ALTER DEFAULT PRIVILEGES already granted EXECUTE on future ski
-- functions to `authenticated`, so revoking PUBLIC alone would still
-- leave members able to call it.
REVOKE EXECUTE ON FUNCTION ski.leaderboard_trip_rows(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION ski.leaderboard_trip_rows(uuid) FROM authenticated;

-- Trip (cumulative) leaderboard: one row per SHARING member of the
-- trip, aggregated over ALL of that member's recordings linked to the
-- trip (whole trip, all days). Returns an EMPTY SET — not an error —
-- when the caller is not signed in or is not a trip member.
-- Daily vs cumulative: leaderboard_daily(p_trip_id, p_day) ranks ONE
-- day only; this one sums the whole trip.
CREATE OR REPLACE FUNCTION ski.leaderboard_trip(
  p_trip_id uuid
)
RETURNS TABLE (
  user_id            uuid,
  display_name       text,
  is_me              boolean,
  day_count          bigint,
  total_distance_m   double precision,
  total_vertical_gain_m double precision,
  max_top_speed_ms   double precision,
  longest_run_m      double precision,
  total_runs         bigint,
  total_ski_time_s   double precision,
  total_lift_time_s  double precision,
  rank_distance      bigint,
  rank_vertical      bigint,
  rank_top_speed     bigint,
  rank_longest_run   bigint,
  rank_runs          bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ski, pg_catalog
AS $$
  SELECT
    lb.user_id,
    lb.display_name,
    (lb.user_id = auth.uid()) AS is_me,
    lb.day_count,
    lb.total_distance_m,
    lb.total_vertical_gain_m,
    lb.max_top_speed_ms,
    lb.longest_run_m,
    lb.total_runs,
    lb.total_ski_time_s,
    lb.total_lift_time_s,
    lb.rank_distance,
    lb.rank_vertical,
    lb.rank_top_speed,
    lb.rank_longest_run,
    lb.rank_runs
  FROM ski.leaderboard_trip_rows(p_trip_id) lb
  WHERE auth.uid() IS NOT NULL
    AND ski.is_trip_member(p_trip_id)
  ORDER BY lb.total_distance_m DESC;
$$;

-- Vacation (cumulative) leaderboard: same trip board, reached from a
-- vacation id (the handle the client has on the vacation screen).
-- Resolves the vacation's linked trip and returns that trip's board.
-- A vacation with trip_id NULL (private) has no audience and returns
-- an empty set.
CREATE OR REPLACE FUNCTION ski.leaderboard_vacation(
  p_vacation_id uuid
)
RETURNS TABLE (
  user_id            uuid,
  display_name       text,
  is_me              boolean,
  day_count          bigint,
  total_distance_m   double precision,
  total_vertical_gain_m double precision,
  max_top_speed_ms   double precision,
  longest_run_m      double precision,
  total_runs         bigint,
  total_ski_time_s   double precision,
  total_lift_time_s  double precision,
  rank_distance      bigint,
  rank_vertical      bigint,
  rank_top_speed     bigint,
  rank_longest_run   bigint,
  rank_runs          bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ski, pg_catalog
AS $$
  SELECT * FROM ski.leaderboard_trip(
    (SELECT v.trip_id FROM ski.vacations v WHERE v.id = p_vacation_id)
  );
$$;

-- --------------------------------------------------------------------------
-- §5. Public share links — read-only, token-gated, single-item
--
--    Table (decision D6): one row per link. A link points at ONE item
--    (item_type + item_id) and carries its own expiry / revoked flag,
--    so the same recording can have a link that expires tomorrow and
--    another that never expires, and either can be revoked alone.
--    token: 256-bit random hex (gen_random_bytes(32)), UNIQUE, server
--    default — the client never invents a token. Guessing a token is
--    infeasible (2^256); there is no rate-limit in SQL, so expiry +
--    revocation are the controls, and the resolver below returns NULL
--    for unknown / revoked / expired tokens without saying which.
--
--    RLS: owner-only on the TABLE (only the creator can create / list /
--    revoke their links; anon gets nothing on the table itself).
--    PUBLIC READ goes ONLY through ski.resolve_share_link (SECURITY
--    DEFINER, executable by anon): it validates the token, then returns
--    a JSON envelope for THAT item only. What it NEVER returns:
--      * GPS points — EXCEPT item_type 'route', whose whole purpose is
--        showing the track (one recording's points, nothing else).
--      * user ids, owner ids, auth data, trip member lists, names of
--        anyone except leaderboard members who opted into share_stats.
--      * any other user's stats, any other item, the account, or the
--        existence of other links. A wrong token and an expired token
--        look identical (NULL) — no oracle.
--    item_id meaning per type:
--      recording   -> recordings.id : aggregate stats of ONE recording
--      route       -> recordings.id : the track (points) + stats of ONE
--                     recording. THE ONLY type returning points.
--      vacation    -> vacations.id  : cumulative stats of ONE vacation
--      daily_stats -> recordings.id : that recording owner's totals for
--                     that recording's ski_day (one user, one day)
--      leaderboard -> vacations.id  : cumulative board of that vacation
--                     (sharing members only — same filter as §4; creating
--                     this link publishes those members' display names
--                     + stats to anyone holding the link)
--      trip        -> trips.id      : name / resort / dates ONLY
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ski.share_links (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  item_type   text        NOT NULL
              CHECK (item_type IN ('recording', 'route', 'vacation',
                                  'daily_stats', 'leaderboard', 'trip')),
  item_id     uuid        NOT NULL,
  token       text        NOT NULL UNIQUE
              DEFAULT encode(gen_random_bytes(32), 'hex'),
  created_by  uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz,
  revoked     boolean     NOT NULL DEFAULT false,
  revoked_at  timestamptz,
  CHECK (expires_at IS NULL OR expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS share_links_item_idx
  ON ski.share_links (item_type, item_id);
CREATE INDEX IF NOT EXISTS share_links_created_by_idx
  ON ski.share_links (created_by, created_at DESC);

-- Resolve a public link. SECURITY DEFINER (it must read rows the anon
-- caller cannot see) but SAFE by construction: the token is the only
-- input, the link row is the only gate, and every branch selects ONE
-- item by id and projects ONLY the whitelisted columns below.
CREATE OR REPLACE FUNCTION ski.resolve_share_link(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ski, pg_catalog
AS $$
DECLARE
  v_link ski.share_links%ROWTYPE;
  v_out jsonb;
BEGIN
  IF p_token IS NULL OR p_token = '' THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_link FROM ski.share_links WHERE token = p_token;

  -- Unknown, revoked, or expired: identical NULL, no reason given.
  IF NOT FOUND OR v_link.revoked
     OR (v_link.expires_at IS NOT NULL AND v_link.expires_at <= now()) THEN
    RETURN NULL;
  END IF;

  CASE v_link.item_type
    WHEN 'recording' THEN
      SELECT jsonb_build_object(
        'item_type', 'recording',
        'resort', r.resort,
        'ski_day', r.ski_day,
        'started_at', r.started_at,
        'ended_at', r.ended_at,
        'distance_m', r.distance_m,
        'duration_s', r.duration_s,
        'top_speed_ms', r.top_speed_ms,
        'longest_run_m', r.longest_run_m,
        'vertical_gain_m', r.vertical_gain_m,
        'vertical_loss_m', r.vertical_loss_m,
        'ski_time_s', r.ski_time_s,
        'lift_time_s', r.lift_time_s,
        'run_count', r.run_count)
      INTO v_out
      FROM ski.recordings r WHERE r.id = v_link.item_id;

    WHEN 'route' THEN
      -- THE ONLY branch returning GPS points: the single recording's
      -- own track, because a shared route IS the track. No owner id,
      -- no trip/vacation/local ids, no other user's data.
      SELECT jsonb_build_object(
        'item_type', 'route',
        'resort', r.resort,
        'ski_day', r.ski_day,
        'started_at', r.started_at,
        'ended_at', r.ended_at,
        'distance_m', r.distance_m,
        'duration_s', r.duration_s,
        'top_speed_ms', r.top_speed_ms,
        'longest_run_m', r.longest_run_m,
        'vertical_gain_m', r.vertical_gain_m,
        'vertical_loss_m', r.vertical_loss_m,
        'ski_time_s', r.ski_time_s,
        'lift_time_s', r.lift_time_s,
        'run_count', r.run_count,
        'points', r.points)
      INTO v_out
      FROM ski.recordings r WHERE r.id = v_link.item_id;

    WHEN 'vacation' THEN
      SELECT jsonb_build_object(
        'item_type', 'vacation',
        'name', v.name,
        'resort', v.resort,
        'start_date', v.start_date,
        'end_date', v.end_date,
        'day_count', s.day_count,
        'total_distance_m', s.total_distance_m,
        'total_vertical_gain_m', s.total_vertical_gain_m,
        'total_vertical_loss_m', s.total_vertical_loss_m,
        'max_top_speed_ms', s.max_top_speed_ms,
        'longest_run_m', s.longest_run_m,
        'total_runs', s.total_runs,
        'total_ski_time_s', s.total_ski_time_s,
        'total_lift_time_s', s.total_lift_time_s,
        'total_duration_s', s.total_duration_s)
      INTO v_out
      FROM ski.vacations v
      LEFT JOIN (
        SELECT vacation_id,
          COUNT(DISTINCT ski_day) AS day_count,
          COALESCE(SUM(distance_m), 0) AS total_distance_m,
          COALESCE(SUM(vertical_gain_m), 0) AS total_vertical_gain_m,
          COALESCE(SUM(vertical_loss_m), 0) AS total_vertical_loss_m,
          MAX(top_speed_ms) AS max_top_speed_ms,
          MAX(longest_run_m) AS longest_run_m,
          COALESCE(SUM(run_count), 0) AS total_runs,
          COALESCE(SUM(ski_time_s), 0) AS total_ski_time_s,
          COALESCE(SUM(lift_time_s), 0) AS total_lift_time_s,
          COALESCE(SUM(duration_s), 0) AS total_duration_s
        FROM ski.recordings
        GROUP BY vacation_id
      ) s ON s.vacation_id = v.id
      WHERE v.id = v_link.item_id;

    WHEN 'daily_stats' THEN
      -- item_id is ONE recording; the day is that recording's owner +
      -- ski_day, aggregated over all of that owner's recordings that day.
      SELECT jsonb_build_object(
        'item_type', 'daily_stats',
        'resort', base.resort,
        'ski_day', base.ski_day,
        'total_distance_m', COALESCE(SUM(r.distance_m), 0),
        'total_vertical_gain_m', COALESCE(SUM(r.vertical_gain_m), 0),
        'total_vertical_loss_m', COALESCE(SUM(r.vertical_loss_m), 0),
        'max_top_speed_ms', MAX(r.top_speed_ms),
        'longest_run_m', MAX(r.longest_run_m),
        'total_runs', COALESCE(SUM(r.run_count), 0),
        'total_ski_time_s', COALESCE(SUM(r.ski_time_s), 0),
        'total_lift_time_s', COALESCE(SUM(r.lift_time_s), 0),
        'total_duration_s', COALESCE(SUM(r.duration_s), 0))
      INTO v_out
      FROM ski.recordings base
      JOIN ski.recordings r
        ON r.user_id = base.user_id
       AND r.ski_day = base.ski_day
       AND r.resort = base.resort
      WHERE base.id = v_link.item_id
      GROUP BY base.resort, base.ski_day;

    WHEN 'leaderboard' THEN
      -- item_id is a vacation. Same sharing filter as §4, via the
      -- trip rows builder — NOT via leaderboard_trip/vacation, which
      -- require a signed-in trip member and would return an empty
      -- board to an anonymous link opener. The LINK is the
      -- authorisation here: its creator chose to publish this board.
      -- A private vacation (trip_id NULL) yields an empty board.
      SELECT jsonb_build_object(
        'item_type', 'leaderboard',
        'vacation_name', v.name,
        'resort', v.resort,
        'start_date', v.start_date,
        'end_date', v.end_date,
        'entries', COALESCE((
          SELECT jsonb_agg(e ORDER BY (e->>'rank_distance')::int)
          FROM (
            SELECT jsonb_build_object(
              'display_name', lb.display_name,
              'day_count', lb.day_count,
              'total_distance_m', lb.total_distance_m,
              'total_vertical_gain_m', lb.total_vertical_gain_m,
              'max_top_speed_ms', lb.max_top_speed_ms,
              'longest_run_m', lb.longest_run_m,
              'total_runs', lb.total_runs,
              'rank_distance', lb.rank_distance,
              'rank_vertical', lb.rank_vertical,
              'rank_top_speed', lb.rank_top_speed,
              'rank_longest_run', lb.rank_longest_run,
              'rank_runs', lb.rank_runs) AS e
            FROM ski.leaderboard_trip_rows(v.trip_id) lb
          ) sub
        ), '[]'::jsonb))
      INTO v_out
      FROM ski.vacations v WHERE v.id = v_link.item_id;

    WHEN 'trip' THEN
      SELECT jsonb_build_object(
        'item_type', 'trip',
        'name', t.name,
        'resort', t.resort,
        'start_date', t.start_date,
        'end_date', t.end_date)
      INTO v_out
      FROM ski.trips t WHERE t.id = v_link.item_id;
  END CASE;

  -- The item itself is gone (deleted after the link was made).
  RETURN v_out;
END;
$$;

-- Revoke one of YOUR links by token. Only the creator can revoke it
-- (created_by = auth.uid()); returns false when the token is unknown,
-- already revoked, or not yours — deliberately the same answer.
CREATE OR REPLACE FUNCTION ski.revoke_share_link(p_token text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ski, pg_catalog
AS $$
DECLARE
  n integer;
BEGIN
  IF auth.uid() IS NULL OR p_token IS NULL OR p_token = '' THEN
    RETURN false;
  END IF;
  UPDATE ski.share_links
  SET revoked = true, revoked_at = now()
  WHERE token = p_token
    AND created_by = auth.uid()
    AND NOT revoked;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n > 0;
END;
$$;

-- --------------------------------------------------------------------------
-- §6. Row Level Security + grants
--
--    * ski.vacations: owner sees all their own; trip members see a
--      vacation ONLY when it is linked to their trip. Rename (UPDATE)
--      and DELETE are owner-only — members cannot rename or delete
--      someone else's vacation.
--    * ski.share_links: creator-only, all operations. The public never
--      touches this table directly — only resolve_share_link (anon) and
--      revoke_share_link (authenticated creator) are exposed.
--    * ski.recordings: UNCHANGED (owner-only). No policy here widens
--      it — see decision D5.
--    * ski.trip_members: UNCHANGED (share_stats is toggled via the
--      set_share_stats function, not by loosening the update policy).
-- --------------------------------------------------------------------------
ALTER TABLE ski.vacations   ENABLE ROW LEVEL SECURITY;
ALTER TABLE ski.share_links ENABLE ROW LEVEL SECURITY;

-- ---- ski.vacations ----
DROP POLICY IF EXISTS vacations_select_owner_or_trip_member ON ski.vacations;
CREATE POLICY vacations_select_owner_or_trip_member ON ski.vacations
  FOR SELECT USING (
    owner_id = auth.uid()
    OR (trip_id IS NOT NULL AND ski.is_trip_member(trip_id))
  );

DROP POLICY IF EXISTS vacations_insert_owner ON ski.vacations;
CREATE POLICY vacations_insert_owner ON ski.vacations
  FOR INSERT WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS vacations_update_owner ON ski.vacations;
CREATE POLICY vacations_update_owner ON ski.vacations
  FOR UPDATE USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS vacations_delete_owner ON ski.vacations;
CREATE POLICY vacations_delete_owner ON ski.vacations
  FOR DELETE USING (owner_id = auth.uid());

-- ---- ski.share_links ----
DROP POLICY IF EXISTS share_links_select_owner ON ski.share_links;
CREATE POLICY share_links_select_owner ON ski.share_links
  FOR SELECT USING (created_by = auth.uid());

DROP POLICY IF EXISTS share_links_insert_owner ON ski.share_links;
CREATE POLICY share_links_insert_owner ON ski.share_links
  FOR INSERT WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS share_links_update_owner ON ski.share_links;
CREATE POLICY share_links_update_owner ON ski.share_links
  FOR UPDATE USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS share_links_delete_owner ON ski.share_links;
CREATE POLICY share_links_delete_owner ON ski.share_links
  FOR DELETE USING (created_by = auth.uid());

-- ---- Grants ----
-- Authenticated users: full DML on the two new tables, read on the views,
-- execute on the functions. anon gets NOTHING on any table — its only
-- entry point is resolve_share_link, which takes a token and returns
-- one whitelisted item. (The v1 ALTER DEFAULT PRIVILEGES already covers
-- future tables created by the same role; these explicit grants make
-- this file self-sufficient if it is ever run on its own.)
-- C4 (independent review, 2026-11-27): anon ALSO needs USAGE on the
-- schema itself — without it, calling resolve_share_link as anon fails
-- with "permission denied for schema ski" before the function body
-- even runs, so no public link can ever resolve for a guest.
GRANT USAGE ON SCHEMA ski TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON ski.vacations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ski.share_links TO authenticated;
GRANT SELECT ON ski.daily_stats TO authenticated;
GRANT SELECT ON ski.vacation_stats TO authenticated;
-- H3: the internal 4-arg helper is NEVER granted to anyone (revoked
-- explicitly so no earlier grant survives a re-run); only the
-- auth.uid()-scoped 3-arg wrapper is callable by signed-in users.
REVOKE EXECUTE ON FUNCTION ski.find_or_create_vacation_for_day_for(uuid, text, date, uuid) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION ski.find_or_create_vacation_for_day(text, date, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION ski.backfill_vacations() TO authenticated;
GRANT EXECUTE ON FUNCTION ski.set_share_stats(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION ski.leaderboard_daily(uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION ski.leaderboard_trip(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION ski.leaderboard_vacation(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION ski.resolve_share_link(text) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION ski.revoke_share_link(text) TO authenticated;

-- ---- §7. Resort CHECK widening (M3, independent review 2026-11-27) ----
-- A recording with a resort outside the three French ones failed the
-- WHOLE INSERT (the §2 trigger's vacation INSERT violated the CHECK).
-- The app already tracks Mount Hermon snow, so 'hermon' is the known
-- fourth resort. The CREATE TABLE statements above already carry the
-- widened list for fresh installs; these ALTERs apply it to databases
-- where v1.1.1 / v1.2 already ran (CREATE TABLE IF NOT EXISTS is a
-- no-op there). Idempotent: DROP IF EXISTS + ADD.
ALTER TABLE ski.trips DROP CONSTRAINT IF EXISTS trips_resort_check;
ALTER TABLE ski.trips ADD CONSTRAINT trips_resort_check
  CHECK (resort IN ('alpe-d-huez', 'la-plagne', 'val-thorens', 'hermon'));
ALTER TABLE ski.recordings DROP CONSTRAINT IF EXISTS recordings_resort_check;
ALTER TABLE ski.recordings ADD CONSTRAINT recordings_resort_check
  CHECK (resort IN ('alpe-d-huez', 'la-plagne', 'val-thorens', 'hermon'));
ALTER TABLE ski.vacations DROP CONSTRAINT IF EXISTS vacations_resort_check;
ALTER TABLE ski.vacations ADD CONSTRAINT vacations_resort_check
  CHECK (resort IN ('alpe-d-huez', 'la-plagne', 'val-thorens', 'hermon'));

COMMIT;

-- ============================================================================
-- Verify (run in the SQL Editor after the block above succeeds):
--
--   -- New objects exist:
--   SELECT table_name FROM information_schema.tables
--     WHERE table_schema = 'ski' ORDER BY 1;
--   -- expect: friend_shares, recordings, share_links, trip_members,
--   --         trips, vacations  (6 tables)
--   SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'ski';
--   -- expect: rowsecurity = true on all six tables
--   SELECT table_name FROM information_schema.views
--     WHERE table_schema = 'ski' ORDER BY 1;
--   -- expect: active_friend_shares, daily_stats, vacation_stats
--   SELECT column_name FROM information_schema.columns
--     WHERE table_schema = 'ski' AND table_name = 'recordings'
--       AND column_name IN ('vacation_id','ski_day','ski_time_s',
--                           'lift_time_s','run_count')
--     ORDER BY 1;
--   -- expect: 5 rows
--   SELECT column_name FROM information_schema.columns
--     WHERE table_schema = 'ski' AND table_name = 'trip_members'
--       AND column_name = 'share_stats';
--   -- expect: 1 row
--   SELECT * FROM ski.daily_stats;     -- expect: 0 rows if no recordings
--   SELECT * FROM ski.vacation_stats;  -- expect: 0 rows if no vacations
--   SELECT ski.resolve_share_link('does-not-exist');  -- expect: NULL
--
--   -- Daily vs cumulative, worked by hand (see SETUP.md Step 5):
--   -- two sharing members ski the same trip day; the daily board ranks
--   -- that day only, the vacation board sums the whole vacation.
-- ============================================================================
