-- ============================================================================
-- SnowForecast — ski sync schema (Supabase / PostgreSQL 15+)
-- Version: v1.1.2 — 2026-11-27 (v1.1 + review fixes H4/M1/M3, see below)
--   v1.1.1 changelog:
--     * is_trip_member()/is_trip_admin() moved from §1 to just before §6:
--       LANGUAGE sql functions are validated at creation and referenced
--       ski.trip_members before §3 created it (ERROR on first run).
--     * friend_shares.expires_at is now a plain timestamptz set by a
--       BEFORE INSERT trigger (shared_at + 60 min): `timestamptz +
--       interval` is STABLE, not IMMUTABLE, so a GENERATED column was
--       rejected. The SELECT policy's `expires_at > now()` check is
--       unchanged.
--   v1.1.2 (independent-review fixes, 2026-11-27): H4 creator
--   display_name falls back full_name -> name -> email local-part
--   (Google metadata has no 'display_name'); join_trip_by_local_id
--   heals a blank stored display_name on re-join; M1 recordings
--   INSERT requires trip membership when trip_id is set; M3 resort
--   CHECKs widened with 'hermon'.
-- Project: Aviel's EXISTING Supabase project ("options",
-- https://zryunaixiaxlxedlvlyv.supabase.co). Do NOT create a new project.
-- Repo: avielj/snowforcast (static Vercel site, HEAD a491a00a)
--
-- What this file does
--   * Creates ONE new schema, `ski`. It does not touch any existing table,
--     schema, or auth configuration. Safe to run on a project that already
--     has other data.
--   * Enables Row Level Security (RLS) on every table. The anon key used by
--     the web app can only ever see rows the signed-in user is entitled to.
--     The service_role key bypasses RLS by design — this file never contains
--     any key. Never paste a service_role key into the web app.
--   * No demo / fake data. No seed INSERTs: trips are created by real
--     users only, from the app. (The single INSERT in this file lives
--     inside a trigger that adds a trip's creator as its admin member.)
--
-- How to run it: Supabase Dashboard -> SQL Editor -> paste this whole file
-- -> Run. Re-running is safe (IF NOT EXISTS / CREATE OR REPLACE /
-- DROP POLICY IF EXISTS). §9 (v1.1) uses ADD COLUMN IF NOT EXISTS, so a
-- re-run DOES pick up the v1.1 additions on a database that only has v1.
--
-- Requirements: PostgreSQL 15+ (all current Supabase projects). The view
-- `ski.active_friend_shares` uses `security_invoker = true`, which needs
-- PG 15+. If your project were older, delete the `WITH (security_invoker
-- = true)` clause — but then the view would run as its owner and bypass
-- RLS, so do NOT do that without upgrading instead.
--
-- Offline-first note: the phone's IndexedDB stays the source of truth
-- on-device. Supabase is the rendezvous that lets a second device / a
-- trip member see the same trip, share, or (later) leaderboard. If the
-- network or Supabase is down, the app keeps working locally.
-- ============================================================================

BEGIN;

-- --------------------------------------------------------------------------
-- 0. Schema + privileges
-- --------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS ski;

-- Nobody except the owner gets anything by default; we grant explicitly
-- below, only to `authenticated` (signed-in users). `anon` gets nothing:
-- an unsigned visitor cannot read or write any ski table.
REVOKE ALL ON SCHEMA ski FROM PUBLIC;
GRANT USAGE ON SCHEMA ski TO authenticated;

-- --------------------------------------------------------------------------
-- 1. Helper functions (SECURITY DEFINER so RLS policies can call them
--    without recursing into the same table's policy)
--
--    RLS policies on `ski.trip_members` cannot use a plain subquery against
--    `ski.trip_members` itself — the subquery would re-enter the policy and
--    recurse. These helpers run as the function owner, bypass RLS, and
--    answer one yes/no question each. They only ever check the *caller's*
--    own membership (auth.uid() is the JWT user, not the function owner),
--    so they cannot be used to learn anything about another user.
--
--    NOTE (v1.1.1): the functions themselves live just before §6, not
--    here. LANGUAGE sql functions are validated at creation time and
--    reference `ski.trip_members`, which is not created until §3 — so
--    defining them here fails on first run with
--    ERROR: relation "ski.trip_members" does not exist.
-- --------------------------------------------------------------------------

-- --------------------------------------------------------------------------
-- 2. ski.trips — one row per ski trip
--    Real trips today: Alpe d'Huez 2027-01-08..15, La Plagne 2027-01-31..
--    2027-02-07, Val Thorens ad hoc. They are created by users in the app,
--    NOT seeded here.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ski.trips (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by  uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  resort      text        NOT NULL
              CHECK (resort IN ('alpe-d-huez', 'la-plagne', 'val-thorens', 'hermon')),
  name        text        NOT NULL,               -- e.g. 'Alpe d'Huez — Jan 8–15'
  start_date  date,                               -- nullable: ad-hoc VT trip
  end_date    date,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS trips_resort_start_idx
  ON ski.trips (resort, start_date);

-- Keep updated_at honest without app code having to remember it.
CREATE OR REPLACE FUNCTION ski.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ski, pg_catalog
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trips_set_updated_at ON ski.trips;
CREATE TRIGGER trips_set_updated_at
  BEFORE UPDATE ON ski.trips
  FOR EACH ROW EXECUTE FUNCTION ski.set_updated_at();

-- The creator is automatically an admin member of their own trip, so a
-- freshly created trip is immediately visible to its creator and they can
-- invite others. Display name is best-effort from the auth profile:
-- H4 (independent review, 2026-11-27) — Google OAuth metadata carries
-- 'full_name'/'name', NOT 'display_name', so the old lookup returned
-- NULL and the creator showed blank on the leaderboard. Fallback chain:
-- display_name -> full_name -> name -> email local-part -> ''.
CREATE OR REPLACE FUNCTION ski.add_creator_as_member()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ski, pg_catalog
AS $$
BEGIN
  INSERT INTO ski.trip_members (trip_id, user_id, display_name, role)
  VALUES (
    NEW.id,
    NEW.created_by,
    COALESCE(
      (SELECT COALESCE(
          NULLIF(raw_user_meta_data ->> 'display_name', ''),
          NULLIF(raw_user_meta_data ->> 'full_name', ''),
          NULLIF(raw_user_meta_data ->> 'name', ''),
          split_part(email, '@', 1), '')
         FROM auth.users WHERE id = NEW.created_by),
      ''
    ),
    'admin'
  )
  ON CONFLICT (trip_id, user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trips_add_creator_as_member ON ski.trips;
CREATE TRIGGER trips_add_creator_as_member
  AFTER INSERT ON ski.trips
  FOR EACH ROW EXECUTE FUNCTION ski.add_creator_as_member();

-- --------------------------------------------------------------------------
-- 3. ski.trip_members — who is in a trip (the visibility boundary)
--
--    Rule, unchanged from the current link-based app: a person is visible
--    to you only if you are both members of the same trip. There is no
--    global friends list and no cross-trip visibility.
--    Joining: anyone with the invite link can join — there is no admin
--    approval (same as today's `?trip=` links). The trip id in the link
--    IS the access control; the INSERT policy below only lets a user add
--    *themselves*, as a plain 'member', never anyone else and never as
--    admin. If Aviel later wants invite approval / revocation, that is a
--    new decision — do not improvise it here.
--    display_name is stored per member (denormalised) because RLS forbids
--    reading other users' auth profiles: the name shown in the trip sheet
--    must come from a row the reader is allowed to see.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ski.trip_members (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id      uuid        NOT NULL REFERENCES ski.trips (id) ON DELETE CASCADE,
  user_id      uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  display_name text        NOT NULL DEFAULT '',
  role         text        NOT NULL DEFAULT 'member'
               CHECK (role IN ('admin', 'member')),
  joined_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (trip_id, user_id)
);

CREATE INDEX IF NOT EXISTS trip_members_user_idx
  ON ski.trip_members (user_id);

-- --------------------------------------------------------------------------
-- 4. ski.friend_shares — one snapshot per "Share my spot" tap
--
--    A share is a SNAPSHOT, not live tracking: one GPS fix (or the map
--    centre, if GPS failed), taken on one explicit tap. Sharing is OFF by
--    default — nothing is written here until the user taps "Share my spot"
--    in a trip. "Stop sharing" deletes the user's rows for that trip.
--    Rows are append-only history: a new tap inserts a new row, it never
--    overwrites the old one, so the 60-minute freshness rule can be judged
--    from the row itself. The app shows the newest non-expired share per
--    member as that member's marker, plus every non-expired meeting point.
--    display_name is snapshotted into the row for the same reason as in
--    trip_members: recipients cannot read the sharer's auth profile.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ski.friend_shares (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id          uuid        NOT NULL REFERENCES ski.trips (id) ON DELETE CASCADE,
  user_id          uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  display_name     text        NOT NULL DEFAULT '',
  lat              double precision NOT NULL CHECK (lat >= -90  AND lat <= 90),
  lon              double precision NOT NULL CHECK (lon >= -180 AND lon <= 180),
  accuracy_m       double precision CHECK (accuracy_m IS NULL OR accuracy_m >= 0),
  source           text        NOT NULL DEFAULT 'gps'
                   CHECK (source IN ('gps', 'map-centre')),
  is_meeting_point boolean     NOT NULL DEFAULT false,
  label            text,                  -- meeting-point label, e.g. 'Meet here'
  shared_at        timestamptz NOT NULL DEFAULT now(),
  -- Expiry, same rule as today's `?f=` links: fresh <15 min, stale 15–60,
  -- gone after 60. Computed, never set by the client.
  -- NOTE (v1.1.1): plain column, NOT a GENERATED column — `timestamptz +
  -- interval` is STABLE, not IMMUTABLE, so Postgres rejects it as a
  -- generation expression. The BEFORE INSERT trigger below sets it to
  -- shared_at + 60 minutes instead.
  expires_at       timestamptz
);

CREATE INDEX IF NOT EXISTS friend_shares_trip_time_idx
  ON ski.friend_shares (trip_id, shared_at DESC);
CREATE INDEX IF NOT EXISTS friend_shares_user_time_idx
  ON ski.friend_shares (user_id, shared_at DESC);
CREATE INDEX IF NOT EXISTS friend_shares_expires_idx
  ON ski.friend_shares (expires_at);

-- Set expires_at = shared_at + 60 minutes on insert (see column note
-- above: this cannot be a GENERATED column). Unconditional — the client
-- never supplies expires_at.
CREATE OR REPLACE FUNCTION ski.set_friend_share_expiry()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ski, pg_catalog
AS $$
BEGIN
  NEW.expires_at := NEW.shared_at + interval '60 minutes';
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS friend_shares_set_expires_at ON ski.friend_shares;
CREATE TRIGGER friend_shares_set_expires_at
  BEFORE INSERT ON ski.friend_shares
  FOR EACH ROW EXECUTE FUNCTION ski.set_friend_share_expiry();

-- Convenience view: only shares that have not expired yet. The SELECT
-- policy on the base table enforces the same 60-minute cutoff, so this
-- view is defence-in-depth + a simpler query for the app
-- ("SELECT * FROM ski.active_friend_shares WHERE trip_id = ?").
-- security_invoker = true (PG 15+) makes the view run with the *caller's*
-- RLS, so it cannot leak rows the caller may not see.
CREATE OR REPLACE VIEW ski.active_friend_shares
WITH (security_invoker = true) AS
  SELECT *
  FROM ski.friend_shares s
  WHERE s.expires_at > now();

-- --------------------------------------------------------------------------
-- 5. ski.recordings — one row per Record track (a day's skiing)
--
--    Design decision: GPS points live in ONE jsonb column, NOT in a
--    separate ski.recording_points table. Why:
--      * A track is written once (points stream in while recording, the
--        row is finalised on Stop) and read whole (day recap, GPX export,
--        drawing the track on the map). No query ever needs one point, a
--        point range, or a join across tracks.
--      * A day can be thousands of points. A child table would turn one
--        track into thousands of rows and every recap into an aggregation;
--        the JSONB array is one row, a few hundred KB at most, and matches
--        the shape the app already stores in IndexedDB
--        ({t, lat, lon, alt, acc} per point — t = epoch ms).
--      * The queryable numbers (distance, duration, top speed, longest
--        run, vertical) are stored as plain columns, computed client-side
--        by the existing computeStats() on Stop. Leaderboards / recaps
--        never have to parse the JSONB.
--    If per-point queries are ever needed (e.g. server-side leaderboards
--    by segment), add ski.recording_points then — do not pay for it now.
--    Recordings are PRIVATE: visible only to their owner, even inside a
--    trip. Sharing a recap / leaderboard is a separate, later decision.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ski.recordings (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  trip_id        uuid        REFERENCES ski.trips (id) ON DELETE SET NULL,
  resort         text        NOT NULL
                 CHECK (resort IN ('alpe-d-huez', 'la-plagne', 'val-thorens', 'hermon')),
  started_at     timestamptz NOT NULL,
  ended_at       timestamptz,
  distance_m     double precision CHECK (distance_m IS NULL OR distance_m >= 0),
  duration_s     double precision CHECK (duration_s IS NULL OR duration_s >= 0),
  top_speed_ms   double precision CHECK (top_speed_ms IS NULL OR top_speed_ms >= 0),
  longest_run_m  double precision CHECK (longest_run_m IS NULL OR longest_run_m >= 0),
  vertical_gain_m  double precision CHECK (vertical_gain_m IS NULL OR vertical_gain_m >= 0),
  vertical_loss_m  double precision CHECK (vertical_loss_m IS NULL OR vertical_loss_m >= 0),
  -- GPS points, exactly as recorded on-device:
  --   [{ "t": 1790000000000, "lat": 45.0924, "lon": 6.06994,
  --      "alt": 1860, "acc": 8 }, ...]   (alt/acc nullable per point)
  points         jsonb       NOT NULL DEFAULT '[]'::jsonb
                 CHECK (jsonb_typeof(points) = 'array'),
  point_count    integer     GENERATED ALWAYS AS (jsonb_array_length(points)) STORED,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (ended_at IS NULL OR ended_at >= started_at)
);

CREATE INDEX IF NOT EXISTS recordings_user_time_idx
  ON ski.recordings (user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS recordings_trip_time_idx
  ON ski.recordings (trip_id, started_at DESC);

-- --------------------------------------------------------------------------
-- 5b. Membership helpers (defined HERE, not in §1: LANGUAGE sql functions
--     are validated at creation and reference ski.trip_members, created
--     in §3 — defining them in §1 fails on first run)
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ski.is_trip_member(p_trip_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ski, pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1 FROM ski.trip_members m
    WHERE m.trip_id = p_trip_id
      AND m.user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION ski.is_trip_admin(p_trip_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ski, pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1 FROM ski.trip_members m
    WHERE m.trip_id = p_trip_id
      AND m.user_id = auth.uid()
      AND m.role = 'admin'
  );
$$;

-- --------------------------------------------------------------------------
-- 6. Row Level Security — on, on every table, no exceptions
-- --------------------------------------------------------------------------
ALTER TABLE ski.trips         ENABLE ROW LEVEL SECURITY;
ALTER TABLE ski.trip_members  ENABLE ROW LEVEL SECURITY;
ALTER TABLE ski.friend_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE ski.recordings    ENABLE ROW LEVEL SECURITY;

-- ---- ski.trips ----
DROP POLICY IF EXISTS trips_select_member ON ski.trips;
CREATE POLICY trips_select_member ON ski.trips
  FOR SELECT USING (
    created_by = auth.uid() OR ski.is_trip_member(id)
  );

DROP POLICY IF EXISTS trips_insert_own ON ski.trips;
CREATE POLICY trips_insert_own ON ski.trips
  FOR INSERT WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS trips_update_creator ON ski.trips;
CREATE POLICY trips_update_creator ON ski.trips
  FOR UPDATE USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS trips_delete_creator ON ski.trips;
CREATE POLICY trips_delete_creator ON ski.trips
  FOR DELETE USING (created_by = auth.uid());

-- ---- ski.trip_members ----
-- Read: only members of that trip see its member list.
DROP POLICY IF EXISTS trip_members_select_member ON ski.trip_members;
CREATE POLICY trip_members_select_member ON ski.trip_members
  FOR SELECT USING (ski.is_trip_member(trip_id));

-- Join: anyone with the invite link may add THEMSELVES as a plain member.
-- They cannot add anyone else and cannot grant themselves admin.
DROP POLICY IF EXISTS trip_members_insert_self ON ski.trip_members;
CREATE POLICY trip_members_insert_self ON ski.trip_members
  FOR INSERT WITH CHECK (user_id = auth.uid() AND role = 'member');

-- Edit: only your own row, and you cannot promote yourself.
DROP POLICY IF EXISTS trip_members_update_self ON ski.trip_members;
CREATE POLICY trip_members_update_self ON ski.trip_members
  FOR UPDATE USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid() AND role = 'member');

-- Leave: your own row; an admin may also remove others.
DROP POLICY IF EXISTS trip_members_delete_self_or_admin ON ski.trip_members;
CREATE POLICY trip_members_delete_self_or_admin ON ski.trip_members
  FOR DELETE USING (
    user_id = auth.uid() OR ski.is_trip_admin(trip_id)
  );

-- ---- ski.friend_shares ----
-- Read: only members of the same trip, and only shares younger than
-- 60 minutes. Expired rows are invisible even to their owner through
-- this policy — the app already knows the share expired from its own
-- local copy, and nothing may be treated as current after an hour.
DROP POLICY IF EXISTS friend_shares_select_member_fresh ON ski.friend_shares;
CREATE POLICY friend_shares_select_member_fresh ON ski.friend_shares
  FOR SELECT USING (
    ski.is_trip_member(trip_id) AND expires_at > now()
  );

-- Share: only into a trip you belong to, and only as yourself.
DROP POLICY IF EXISTS friend_shares_insert_self_member ON ski.friend_shares;
CREATE POLICY friend_shares_insert_self_member ON ski.friend_shares
  FOR INSERT WITH CHECK (
    user_id = auth.uid() AND ski.is_trip_member(trip_id)
  );

DROP POLICY IF EXISTS friend_shares_update_self ON ski.friend_shares;
CREATE POLICY friend_shares_update_self ON ski.friend_shares
  FOR UPDATE USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid() AND ski.is_trip_member(trip_id));

-- Stop sharing: delete your own rows.
DROP POLICY IF EXISTS friend_shares_delete_self ON ski.friend_shares;
CREATE POLICY friend_shares_delete_self ON ski.friend_shares
  FOR DELETE USING (user_id = auth.uid());

-- ---- ski.recordings ----
-- Private: only the owner. Trip members never see each other's tracks.
DROP POLICY IF EXISTS recordings_select_owner ON ski.recordings;
CREATE POLICY recordings_select_owner ON ski.recordings
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS recordings_insert_owner ON ski.recordings;
CREATE POLICY recordings_insert_owner ON ski.recordings
  FOR INSERT WITH CHECK (user_id = auth.uid()
    -- M1 (independent review, 2026-11-27): a non-member who knows a
    -- trip uuid must not attach a recording to it (the §2 trigger
    -- would link their vacation to that trip and expose it to the
    -- members). A recording with no trip (NULL) is always allowed.
    AND (trip_id IS NULL OR ski.is_trip_member(trip_id)));

DROP POLICY IF EXISTS recordings_update_owner ON ski.recordings;
CREATE POLICY recordings_update_owner ON ski.recordings
  FOR UPDATE USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS recordings_delete_owner ON ski.recordings;
CREATE POLICY recordings_delete_owner ON ski.recordings
  FOR DELETE USING (user_id = auth.uid());

-- --------------------------------------------------------------------------
-- 7. Grants — signed-in users only; `anon` gets nothing on ski.*
--    (service_role bypasses RLS by design; it is never used by the web app.)
-- --------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ski TO authenticated;
GRANT SELECT ON ski.active_friend_shares TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA ski TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA ski
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA ski
  GRANT EXECUTE ON FUNCTIONS TO authenticated;

-- --------------------------------------------------------------------------
-- 8. Expiry cleanup — hygiene only, NOT the enforcement mechanism
--
--    Enforcement is the RLS policy + the view above: an expired share is
--    never returned, even if it still sits in the table. This function
--    just deletes the dead rows so the table does not grow forever.
--    The app may call it (authenticated users may execute it — it only
--    ever deletes rows whose expires_at has passed):
--        supabase.rpc('delete_expired_shares', {}, { schema: 'ski' })
--    ...or run it on a schedule. pg_cron is NOT enabled by default; if
--    you want the schedule, enable the pg_cron extension in
--    Dashboard -> Database -> Extensions, then uncomment and run:
--
--    SELECT cron.schedule(
--      'ski-cleanup-expired-shares',
--      '*/15 * * * *',
--      $$SELECT ski.delete_expired_shares();$$
--    );
--
--    If you never schedule it, nothing breaks — expired shares stay
--    invisible and the table just holds a little dead weight.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ski.delete_expired_shares()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ski, pg_catalog
AS $$
DECLARE
  n integer;
BEGIN
  DELETE FROM ski.friend_shares WHERE expires_at <= now();
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

-- --------------------------------------------------------------------------
-- 9. v1.1 — client sync keys (2026-11-27, app workstream ws10)
--    The app is offline-first: each device keeps its own local ids
--    (localStorage 'sf-trips' trip ids like 'alpe-2027', IndexedDB track
--    ids like 'trk-...'). To upsert idempotently and to let a second
--    device find the server row for a local trip, the server needs the
--    same stable key. These are ADDITIVE ONLY (ADD COLUMN IF NOT EXISTS /
--    CREATE UNIQUE INDEX IF NOT EXISTS / CREATE OR REPLACE FUNCTION) —
--    no existing column, policy, or trigger is changed.
-- --------------------------------------------------------------------------

-- Stable client key for a trip (e.g. 'alpe-2027', 'laplagne-2027', or a
-- custom 'name-xxxx' id). The app upserts trips ON CONFLICT (local_id)
-- with ignoreDuplicates, so two devices creating the same trip offline
-- produce ONE server row. Nullable for backwards compatibility with any
-- row created before v1.1; the app always sets it. (A PostgreSQL UNIQUE
-- INDEX permits multiple NULLs.)
ALTER TABLE ski.trips ADD COLUMN IF NOT EXISTS local_id text;
CREATE UNIQUE INDEX IF NOT EXISTS trips_local_id_idx ON ski.trips (local_id);

-- Stable client key for a recording (the IndexedDB track id, 'trk-...').
-- The app upserts a finished track ON CONFLICT (local_id), so re-syncing
-- the same track never duplicates it.
ALTER TABLE ski.recordings ADD COLUMN IF NOT EXISTS local_id text;
CREATE UNIQUE INDEX IF NOT EXISTS recordings_local_id_idx ON ski.recordings (local_id);

-- Join a trip by its client local_id (used for invite links, which carry
-- only the local id, e.g. '#trip=alpe-2027'). RLS forbids reading a trip
-- you are not a member of, so the client cannot resolve local_id -> uuid
-- itself; this SECURITY DEFINER function does the lookup and inserts the
-- CALLER as a plain 'member' (never admin, never anyone else). Returns
-- the trip uuid, or NULL when no trip with that local_id exists.
-- The creator never needs this: the trigger in §2 already adds the
-- creator as admin. H4 (independent review, 2026-11-27): ON CONFLICT
-- now UPDATES a blank display_name with the name the caller supplies
-- (the trigger's metadata lookup can still yield ''), so a creator who
-- re-joins heals their own blank row. A non-empty stored name is never
-- overwritten with an empty one.
CREATE OR REPLACE FUNCTION ski.join_trip_by_local_id(p_local_id text, p_display_name text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ski, pg_catalog
AS $$
DECLARE
  v_trip_id uuid;
BEGIN
  SELECT id INTO v_trip_id FROM ski.trips WHERE local_id = p_local_id;
  IF v_trip_id IS NULL THEN
    RETURN NULL;
  END IF;
  INSERT INTO ski.trip_members (trip_id, user_id, display_name, role)
  VALUES (v_trip_id, auth.uid(), COALESCE(p_display_name, ''), 'member')
  ON CONFLICT (trip_id, user_id) DO UPDATE
    SET display_name = COALESCE(NULLIF(EXCLUDED.display_name, ''),
                                ski.trip_members.display_name);
  RETURN v_trip_id;
END;
$$;

GRANT EXECUTE ON FUNCTION ski.join_trip_by_local_id(text, text) TO authenticated;

COMMIT;

-- ============================================================================
-- Verify (run these in the SQL Editor after the block above succeeds):
--   SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'ski';
--   SELECT table_name FROM information_schema.tables
--     WHERE table_schema = 'ski' ORDER BY 1;
--   -- expect: friend_shares, recordings, trip_members, trips
--   SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'ski';
--   -- expect: rowsecurity = true on all four tables
--   SELECT policyname FROM pg_policies WHERE schemaname = 'ski' ORDER BY 1;
--   -- expect: 16 policies (4 trips, 4 trip_members, 4 friend_shares,
--   --          4 recordings — count them, don't trust memory)
--   SELECT * FROM ski.active_friend_shares;  -- expect: 0 rows, no error
--   -- v1.1 additions:
--   SELECT column_name FROM information_schema.columns
--     WHERE table_schema = 'ski' AND column_name = 'local_id'
--     ORDER BY 1;
--   -- expect: local_id on trips AND recordings (2 rows)
--   SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--     WHERE n.nspname = 'ski' AND proname = 'join_trip_by_local_id';
--   -- expect: 1 row
-- ============================================================================
