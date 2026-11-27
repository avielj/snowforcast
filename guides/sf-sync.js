/* sf-sync.js — SnowForecast offline-first sync (Supabase, schema `ski`).
   Local IndexedDB / localStorage stays the source of truth, exactly as
   today. When online AND signed in (see sf-auth.js), this layer:
     - queues local changes (trip joins, my shared position, finished
       recordings) in an IndexedDB outbox and pushes them on reconnect;
     - pulls newer server state on load: trip members' shared positions
       (replacing one-off `?f=` links for logged-in users — `?f=` links
       keep working unchanged for guests) and trip member lists.
   Guest mode, empty Supabase config, unreachable Supabase, or tables
   not created yet (SQL not run in the dashboard): every public method
   is a safe no-op or a queued retry — the app keeps working locally and
   nothing throws. A missing-tables error (PGRST205) is reported via
   getStatus().tablesMissing so the UI can say so plainly.

   =====================================================================
   SERVER CONTRACT — schema `ski`, see supabase/ski-schema.sql (v1.1.1,
   which is the source of truth; v1.1 does NOT run as-is) +
     ski.trips          (id uuid PK, created_by uuid, resort text,
                         name text, start_date date, end_date date,
                         created_at, updated_at, local_id text UNIQUE)
     ski.trip_members   (id uuid PK, trip_id uuid FK, user_id uuid,
                         display_name text, role 'admin'|'member',
                         joined_at, UNIQUE(trip_id, user_id))
     ski.friend_shares  (id uuid PK, trip_id uuid FK, user_id uuid,
                         display_name text, lat double, lon double,
                         accuracy_m double, source 'gps'|'map-centre',
                         is_meeting_point boolean, label text,
                         shared_at timestamptz,
                         expires_at timestamptz (plain column, set by
                         a BEFORE INSERT trigger to shared_at + 60 min
                         — v1.1.1; a GENERATED column cannot use
                         now()/non-immutable expressions))
     ski.recordings     (id uuid PK, user_id uuid, trip_id uuid NULL,
                         resort text, started_at timestamptz,
                         ended_at timestamptz, distance_m double,
                         duration_s double, top_speed_ms double,
                         longest_run_m double, vertical_gain_m double,
                         vertical_loss_m double, points jsonb,
                         point_count GENERATED, created_at,
                         local_id text UNIQUE)
     VIEW ski.active_friend_shares (only expires_at > now())
     FUNCTION ski.join_trip_by_local_id(p_local_id, p_display_name)
       -> uuid (SECURITY DEFINER: adds caller as 'member', returns uuid)
     FUNCTION ski.delete_expired_shares() -> integer (hygiene only)
   Local trip ids are strings ('alpe-2027', custom 'name-xxxx'); the
   server row carries the same string in local_id, so any device can
   find it. The uuid itself is generated client-side on first sync and
   cached in the local meta store. RLS restricts every row to trip
   members (see ski-schema.sql); recordings are private to their owner.
   Shares are APPEND-ONLY history server-side: one row per tap, never
   overwritten; the app shows the newest non-expired share per member.

   =====================================================================
   STATS / VACATIONS / LEADERBOARD / SHARE LINKS — CONFIRMED v1.2
   (supabase/ski-stats-vacations.sql, v1.2, verified to run clean on
   PostgreSQL 16: v1.1.1 + re-run + v1.2 + re-run, 0 errors. Base is
   ski-schema.sql v1.1.1 — do NOT build against v1.1 (it does not run
   as-is) and do NOT build against supabase/ski-schema-v1.2-proposal.sql
   (unified-site builder's PROPOSAL — conflicting design: day_stats
   TABLE vs daily_stats VIEW, public_shares + get_public_share vs
   share_links + resolve_share_link, "no vacations table" vs the real
   vacations table. The proposal is NOT applied; v1.2 is the contract.)
     ski.vacations      (id uuid PK, owner_id uuid, trip_id uuid NULL,
                         resort text, name text, start_date date,
                         end_date date, timezone text DEFAULT
                         'Europe/Paris', created_at, updated_at,
                         UNIQUE(owner_id, resort, start_date))
                         — NO local_id. Created ONLY by the §2 trigger
                         from real recordings (or backfill). The client
                         NEVER invents a vacation id: it reads the list
                         (refreshVacationList), renames/deletes its OWN
                         rows by server id. RLS: owner sees own; trip
                         members see it when trip_id is set.
     ski.recordings +=  (vacation_id uuid FK vacations ON DELETE
                         SET NULL, ski_day date, ski_time_s double,
                         lift_time_s double, run_count integer)
                         — the §2 trigger sets ski_day (started_at in
                         Europe/Paris) and links vacation_id from
                         consecutive ski days per (owner, resort); an
                         explicit vacation_id is respected, a changed
                         started_at/resort re-runs grouping. The client
                         sends run_count/ski_time_s/lift_time_s (see
                         SFStats.computeTrackStats) and the recording's
                         trip_id (active trip, so the vacation links to
                         the trip); it does NOT send vacation_id or
                         ski_day. If the v1.2 columns do not exist yet,
                         the upload retries WITHOUT them (PGRST204
                         fallback), so old and new schemas both work.
                         CHECK: ski_time_s + lift_time_s <= duration_s.
     VIEW ski.daily_stats (security_invoker, owner-only): per
                         (user, resort, ski_day) totals — recording_
                         count, total_distance_m, total_vertical_
                         gain/loss_m, max_top_speed_ms, longest_run_m,
                         total_runs, total_ski/lift_time_s,
                         total_duration_s, first/last_started_at.
     VIEW ski.vacation_stats (security_invoker): per vacation —
                         vacation_id, user_id, trip_id, resort, name,
                         start/end_date, day_count, recording_count +
                         the same totals. HONEST LIMIT (M6, verified
                         2026-11-27): for a non-owner it shows 0 —
                         NOT "their own contribution": a member's
                         recordings belong to THEIR OWN vacation rows,
                         so the join finds no recordings at all. Never
                         present a vacation_stats row to a non-owner
                         as "the vacation total".
   v1.2.1 (independent-review fixes, 2026-11-27): H3 the trigger's
   vacation helper is auth.uid()-scoped (wrapper) with the internal
   helper ungranted; M1 the recordings INSERT policy requires trip
   membership when trip_id is set (this client retries a 42501 with
   trip_id NULL so the track still syncs as private); M4 empty
   vacations are deleted server-side when their last recording goes
   away (and filtered out of the recap list here); M5 concurrent
   inserts re-select instead of failing; C4 anon has USAGE on schema
   ski so public links resolve for guests; M3 resort CHECKs widened
   with 'hermon' (this client allows the same four resorts).
     ski.trip_members += (share_stats boolean NOT NULL DEFAULT false)
                         — per-trip opt-in (default OFF). Toggled ONLY
                         via ski.set_share_stats(p_trip_id, p_share)
                         -> boolean (SECURITY DEFINER) — the v1 UPDATE
                         policy still rejects admin-row updates, so a
                         direct UPDATE must never be used.
     FUNCTION ski.leaderboard_daily(p_trip_id, p_day) -> rows
                         (user_id, display_name, is_me, totals + ranks
                         per category). FUNCTION ski.leaderboard_trip
                         (p_trip_id) -> same + day_count (cumulative
                         per TRIP — a vacation belongs to one owner, so
                         no vacation-scoped cumulative board exists).
                         FUNCTION ski.leaderboard_vacation
                         (p_vacation_id) -> the trip board, resolved
                         from the vacation (empty when trip_id NULL).
                         All return an EMPTY SET (not an error) for
                         non-members / nobody sharing. Aggregates only,
                         never GPS points. leaderboard_trip_rows is
                         REVOKED for authenticated — never call it.
     ski.share_links    (id uuid PK, item_type CHECK IN
                         ('recording','route','vacation',
                         'daily_stats','leaderboard','trip'), item_id
                         uuid NOT NULL, token text UNIQUE DEFAULT
                         encode(gen_random_bytes(32),'hex') — 256-bit
                         hex, SERVER-GENERATED, the client never
                         invents a token: insert WITHOUT token and read
                         it back; created_by uuid, created_at,
                         expires_at (NULL or > created_at), revoked
                         boolean, revoked_at)
     FUNCTION ski.resolve_share_link(p_token) RETURNS jsonb
                         — the ONLY public read (anon may execute it).
                         Returns the item's whitelisted JSON envelope
                         (item_type + fields; NO points except 'route';
                         NO user ids/names except leaderboard display
                         names of sharers) or NULL for unknown /
                         revoked / expired — no reason given.
     FUNCTION ski.revoke_share_link(p_token) RETURNS boolean
                         — creator only. FUNCTION
                         ski.backfill_vacations() RETURNS integer —
                         groups pre-existing recordings (run once by
                         the migration; callable later for repair).
   GROUPING RULE (server + SFStats agree): ski day = started_at in
   Europe/Paris; consecutive dates per (owner, resort) = one vacation;
   a gap >= 1 day opens a new one; a late recording bridging a gap
   MERGES vacations (trigger). The local grouping in SFStats is a
   preview; the server list is authoritative.
   ===================================================================== */
(function(){
'use strict';

var SCHEMA = 'ski';
var SHARE_TTL_MS = 60*60*1000;      // shares expire after 60 minutes
var MAX_TRACK_POINTS = 2000;        // decimate very long tracks before upload
// M3: resorts the server accepts (ski CHECKs, v1.2.1). A track from any
// other resort cannot sync — it stays local-only, never queued.
var ALLOWED_RESORTS = ['alpe-d-huez', 'la-plagne', 'val-thorens', 'hermon'];
var DBNAME = 'sf-sync', DBVER = 1;

/* ================= tiny IndexedDB wrapper (memory fallback) ================= */
var memOutbox = [], memMeta = {};
var dbPromise = null;
function idb(){
  if(dbPromise) return dbPromise;
  dbPromise = new Promise(function(res){
    if(!('indexedDB' in window)){ res(null); return; }
    var rq;
    try{ rq = indexedDB.open(DBNAME, DBVER); }catch(e){ res(null); return; }
    // A blocked open (another tab holding the DB at an old version)
    // must never hang the sync layer: fall back to the memory store.
    rq.onblocked = function(){ res(null); };
    rq.onupgradeneeded = function(){
      try{
        if(!rq.result.objectStoreNames.contains('outbox')) rq.result.createObjectStore('outbox', {keyPath:'id'});
        if(!rq.result.objectStoreNames.contains('meta')) rq.result.createObjectStore('meta', {keyPath:'key'});
      }catch(e){}
    };
    rq.onsuccess = function(){ res(rq.result); };
    rq.onerror = function(){ res(null); };
  });
  return dbPromise;
}
function outboxPut(op){
  return idb().then(function(db){
    if(!db){ var i=memOutbox.findIndex(function(o){ return o.id===op.id; }); if(i>=0) memOutbox[i]=op; else memOutbox.push(op); return true; }
    return new Promise(function(res){
      try{ var tx=db.transaction('outbox','readwrite'); tx.objectStore('outbox').put(op);
        tx.oncomplete=function(){ res(true); }; tx.onerror=function(){ res(false); }; }catch(e){ res(false); }
    });
  });
}
function outboxAll(){
  return idb().then(function(db){
    if(!db) return memOutbox.slice();
    return new Promise(function(res){
      try{ var rq=db.transaction('outbox','readonly').objectStore('outbox').getAll();
        rq.onsuccess=function(){ res(rq.result||[]); }; rq.onerror=function(){ res([]); }; }catch(e){ res([]); }
    });
  });
}
function outboxDel(id){
  return idb().then(function(db){
    if(!db){ memOutbox=memOutbox.filter(function(o){ return o.id!==id; }); return true; }
    return new Promise(function(res){
      try{ var tx=db.transaction('outbox','readwrite'); tx.objectStore('outbox').delete(id);
        tx.oncomplete=function(){ res(true); }; tx.onerror=function(){ res(false); }; }catch(e){ res(false); }
    });
  });
}
function outboxClear(){
  return idb().then(function(db){
    if(!db){ memOutbox=[]; return true; }
    return new Promise(function(res){
      try{ var tx=db.transaction('outbox','readwrite'); tx.objectStore('outbox').clear();
        tx.oncomplete=function(){ res(true); }; tx.onerror=function(){ res(false); }; }catch(e){ res(false); }
    });
  });
}
function metaGet(key){
  return idb().then(function(db){
    if(!db) return (key in memMeta) ? memMeta[key] : null;
    return new Promise(function(res){
      try{ var rq=db.transaction('meta','readonly').objectStore('meta').get(key);
        rq.onsuccess=function(){ res(rq.result?rq.result.value:null); }; rq.onerror=function(){ res(null); }; }catch(e){ res(null); }
    });
  });
}
function metaPut(key, value){
  return idb().then(function(db){
    if(!db){ memMeta[key]=value; return true; }
    return new Promise(function(res){
      try{ var tx=db.transaction('meta','readwrite'); tx.objectStore('meta').put({key:key, value:value});
        tx.oncomplete=function(){ res(true); }; tx.onerror=function(){ res(false); }; }catch(e){ res(false); }
    });
  });
}

/* ================= helpers ================= */
function uuid(){
  try{ if(window.crypto && crypto.randomUUID) return crypto.randomUUID(); }catch(e){}
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c){
    var r=Math.random()*16|0; return (c==='x'?r:(r&0x3|0x8)).toString(16);
  });
}
function iso(ts){ try{ return new Date(ts).toISOString(); }catch(e){ return null; } }
function nowIso(){ return new Date().toISOString(); }
function readLS(k, def){ try{ var v=localStorage.getItem(k); return v==null?def:JSON.parse(v); }catch(e){ return def; } }
function storeLS(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }
function displayName(){
  try{ var me = readLS('sf-me', null)||{}; if(me.name) return me.name; }catch(e){}
  var u = getUser();
  return (u && (u.name||u.email)) || '';
}
function tripInfo(tripId){
  // Built-in + custom trips. (Mirror of the TRIPS table in map-shared.js —
  // TRIPS itself is a closure there, so the two built-ins are repeated
  // here; custom trips come from the sf-trips state.)
  var rec = null;
  try{
    var s = readLS('sf-trips', {});
    if(s.custom && s.custom[tripId]) rec = s.custom[tripId];
  }catch(e){}
  if(!rec){
    var builtIn = {
      'alpe-2027':   {id:'alpe-2027', resort:'alpe-d-huez', he:'אלפ דואז · 8–15 בינואר', en:"Alpe d'Huez · 8–15 Jan", startDate:'2027-01-08', endDate:'2027-01-15'},
      'laplagne-2027':{id:'laplagne-2027', resort:'la-plagne', he:'לה פלאן · 31 בינואר – 7 בפברואר', en:'La Plagne · 31 Jan – 7 Feb', startDate:'2027-01-31', endDate:'2027-02-07'}
    };
    rec = builtIn[tripId] || null;
  }
  return rec;
}
function tripNameOf(tr){
  if(!tr) return '';
  var l='he'; try{ l=(document.documentElement.getAttribute('lang')||'he'); }catch(e){}
  return (l.indexOf('en')===0 ? (tr.en||tr.he) : (tr.he||tr.en)) || '';
}
function joinedTripIds(){
  try{
    var s = readLS('sf-trips', {});
    var ids = Object.keys(s.joined||{});
    if(s.active && ids.indexOf(s.active)===-1) ids.push(s.active);
    return ids;
  }catch(e){ return []; }
}
function currentSlug(){
  try{ if(window.SF && SF.getCfg) return SF.getCfg().slug||''; }catch(e){}
  return '';
}

/* ================= state ================= */
var pendingCount = 0;
var lastSyncAt = 0;
var lastError = null;      // {message, code} or null
var lastDropped = null;    // M7: note about the last op dropped after 5 coded failures
var tablesMissing = false; // lastError was PGRST205 / "table does not exist"
var flushing = false;
var tripMapCache = {};     // local trip id -> server uuid (loaded at boot)
var vacationListCache = []; // server vacations I can see (owner + trip-linked), refreshed on pull/flush
var vacationsAvailable = true; // false once a vacations read proves the table missing
var leaderboardAvailable = true; // false once a leaderboard RPC proves the functions missing
var shareLinksAvailable = true; // false once a share_links call proves the table/function missing

function getClient(){
  try{ return (window.SFAuth && SFAuth.getClient) ? SFAuth.getClient() : null; }catch(e){ return null; }
}
function getUser(){
  try{ return (window.SFAuth && SFAuth.getUser) ? SFAuth.getUser() : null; }catch(e){ return null; }
}
function ready(){ return !!getClient() && !!getUser(); }
function online(){ try{ return navigator.onLine!==false; }catch(e){ return true; } }
function errInfo(e){
  if(!e) return {message:'unknown', code:null};
  if(typeof e==='string') return {message:e, code:null};
  return {message:(e.message||String(e)), code:(e.code||null)};
}
function isTablesMissingError(e){
  var info = errInfo(e);
  if(info.code==='PGRST205') return true;
  return /could not find the table|relation .* does not exist|PGRST205/i.test(info.message||'');
}
function setError(e){
  lastError = errInfo(e);
  tablesMissing = isTablesMissingError(e);
}
function callRpc(client, fn, args){
  // supabase-js v2: rpc(fn, args, {schema}) — same form SETUP.md uses.
  try{ return client.rpc(fn, args||{}, {schema: SCHEMA}); }
  catch(e){ return Promise.reject(e); }
}

/* ================= trip id mapping (local string id -> server uuid) ================= */
function getTripUuid(localId){ return tripMapCache[localId] || null; }
function setTripUuid(localId, sid){
  if(!localId || !sid) return;
  tripMapCache[localId]=sid;
  metaPut('tripMap', tripMapCache).catch(function(){});
}
// Server is authoritative for trips I can already see (creator/member):
// one SELECT refreshes the whole map. Fails cleanly (PGRST205) when the
// SQL has not been run yet — the caller treats that as "tables missing".
function refreshTripMap(){
  var client = getClient();
  if(!client) return Promise.resolve(false);
  return client.from('trips').select('id,local_id').then(function(res){
    if(res.error) return Promise.reject(res.error);
    (res.data||[]).forEach(function(r){ if(r.local_id && r.id) tripMapCache[r.local_id]=r.id; });
    metaPut('tripMap', tripMapCache).catch(function(){});
    return true;
  });
}
// The server is authoritative for vacations: the §2 trigger creates
// them from real recordings (no local_id, no client upsert). One SELECT
// refreshes the list I can see (my own + ones linked to my trips).
// Best-effort: a missing vacations table must NOT block trip/share/
// record sync — it only disables the vacation list / recap.
function refreshVacationList(){
  var client = getClient();
  if(!client) return Promise.resolve(false);
  return client.from('vacations').select('id,owner_id,trip_id,resort,name,start_date,end_date,timezone')
    .order('start_date', {ascending:false})
    .then(function(res){
      if(res.error) return Promise.reject(res.error);
      vacationsAvailable = true; // a successful read proves the table exists
      vacationListCache = res.data||[];
      metaPut('vacationList', vacationListCache).catch(function(){});
      return true;
    }).catch(function(e){ if(isTablesMissingError(e)||(e&&e.code==='PGRST204')) vacationsAvailable=false; return false; });
}
// Find the server vacation for a (resort, start date) — the UNIQUE
// (owner_id, resort, start_date) is the client-side lookup key.
function getVacationId(resort, startDate){
  var row = null;
  vacationListCache.forEach(function(v){ if(v.resort===resort && v.start_date===startDate) row=v; });
  return row ? row.id : null;
}
function getVacationById(serverId){
  var row = null;
  vacationListCache.forEach(function(v){ if(v.id===serverId) row=v; });
  return row;
}

/* ================= outbox =================
   Every successful enqueue schedules a flush shortly after: when online
   + signed in the change is pushed promptly; when offline it just sits
   in the outbox until the 'online' event (or the next enqueue) retries.
   The timer is debounced so a burst of enqueues causes one flush. */
var flushTimer = null;
function scheduleFlush(){
  if(flushTimer) return;
  flushTimer = setTimeout(function(){ flushTimer=null; flush(); }, 500);
}
function enqueue(type, payload){
  if(!ready()) return Promise.resolve(false); // guest / signed-out: local-only, nothing queued
  var op = { id:type+'|'+(payload.localId||payload.trip||uuid())+'|'+Date.now()+'-'+Math.random().toString(36).slice(2,6),
    type:type, payload:payload, ts:Date.now(), tries:0 };
  return outboxPut(op).then(function(ok){
    if(ok){ pendingCount++; if(window.SFAuth && SFAuth.render) SFAuth.render(); scheduleFlush(); }
    return ok;
  });
}

/* ---- local change hooks (called from map-shared.js, all guarded there)
   Each returns the enqueue promise, so callers can await the op landing
   in the outbox before flushing (an un-awaited enqueue + immediate
   flush is a race: the IndexedDB put may not have landed yet). ---- */
function onLocalTrip(localTripId){
  var tr = tripInfo(localTripId);
  if(!tr) return Promise.resolve(false);
  var u = getUser(); if(!u) return Promise.resolve(false);
  // Trip row first (ignoreDuplicates: two devices creating the same trip
  // offline produce ONE server row, keyed by local_id), then the join
  // RPC (adds me as 'member'; no-op when the creator trigger already
  // made me admin). Both are idempotent; both stay queued until the
  // tables exist.
  return enqueue('trip.upsert', { localId:localTripId, resort:tr.resort||currentSlug(),
    name:tripNameOf(tr), startDate:tr.startDate||null, endDate:tr.endDate||null, ownerId:u.id })
    .then(function(){ return enqueue('member.join', { localId:localTripId, userId:u.id,
      displayName:displayName() }); });
}
function onLocalShare(share){
  // share: {trip, lat, lon, acc, ts, name, kind:'friend'|'meet',
  //         label, source:'gps'|'map-centre'} — from Friends.doShareFix /
  // Friends.shareMeetingPoint. Server rows are append-only: one row per
  // tap, never overwritten; expires_at is set server-side by a BEFORE
  // INSERT trigger (shared_at + 60 min, v1.1.1).
  var u = getUser(); if(!u || !share || !share.trip) return Promise.resolve(false);
  return enqueue('share.insert', { trip:share.trip, userId:u.id,
    displayName:share.name||displayName(), kind:share.kind||'friend', label:share.label||null,
    resort:currentSlug(), lat:share.lat, lon:share.lon, acc:share.acc==null?null:share.acc,
    source:(share.source||'gps'), sharedAt:iso(share.ts||Date.now()) });
}
function onLocalShareStop(tripId){
  var u = getUser(); if(!u || !tripId) return Promise.resolve(false);
  // Deletes ALL my rows for that trip (friend shares + meeting points) —
  // the schema's "Stop sharing" rule. Links already sent keep working
  // until they expire only if their rows survive; deleting them ends the
  // share for everyone, which is what the sheet promises.
  return enqueue('share.delete', { trip:tripId, userId:u.id });
}
function onLocalRecording(track){
  // track: {id, resort, startTs, endTs, points, stats} — final save only (Rec.stop)
  var u = getUser(); if(!u || !track || !track.id) return Promise.resolve(false);
  // M3: the server CHECK rejects resorts outside the four — never
  // queue such a track (it would fail forever and block the queue).
  // The track stays in the local IndexedDB; only its sync is skipped.
  if(ALLOWED_RESORTS.indexOf(track.resort||currentSlug())<0) return Promise.resolve({ok:false, reason:'unsupported-resort'});
  var pts = track.points||[];
  if(pts.length>MAX_TRACK_POINTS){
    var stride = Math.ceil(pts.length/MAX_TRACK_POINTS), dec = [];
    for(var i=0;i<pts.length;i+=stride) dec.push(pts[i]);
    if(dec[dec.length-1]!==pts[pts.length-1]) dec.push(pts[pts.length-1]);
    pts = dec;
  }
  var st = track.stats||{};
  // Full Slopes-style stats from the raw track (run count + ski/lift
  // split + descent-aware longest run). SFStats is loaded on map pages;
  // without it we upload the base columns only and the server stats
  // stay null. Longest run comes from SFStats when available (descent-
  // aware); distance/gain/loss/top speed stay the in-app computeStats
  // values (computed from the FULL point list before decimation).
  var full = null;
  try{ if(window.SFStats) full = SFStats.computeTrackStats(pts, track.startTs, track.endTs); }catch(e){}
  // trip_id: the ACTIVE trip for this resort, when it is already synced
  // (server uuid known). The §2 trigger uses it to link the vacation
  // it auto-creates to that trip (first trip wins; a later recording
  // with the trip links a still-private vacation). Unknown / no active
  // trip -> NULL: the vacation stays private until a recording with a
  // trip arrives. vacation_id and ski_day are NOT sent — the trigger
  // sets both (ski_day = started_at in Europe/Paris).
  var tripUuid = null;
  try{
    var resort = track.resort||currentSlug();
    if(window.SF && SF.Trips && SF.Trips.activeId && resort===currentSlug()){
      var activeLocalId = SF.Trips.activeId();
      if(activeLocalId) tripUuid = getTripUuid(activeLocalId);
    }
  }catch(e){ tripUuid = null; }
  // Returns a promise that resolves once the recording op is queued
  // (callers can await it before flushing).
  return enqueue('recording.upsert', { localId:track.id, userId:u.id, tripId:tripUuid,
    resort:track.resort||currentSlug(), startedAt:iso(track.startTs), endedAt:iso(track.endTs),
    distanceM:st.distance||0, durationS:st.duration||0,
    verticalGainM:(st.gain==null?null:st.gain), verticalLossM:(st.loss==null?null:st.loss),
    topSpeedMs:st.topSpeed||0, longestRunM:(full&&full.longestRun!=null?full.longestRun:(st.longestRun||0)),
    runCount:(full?full.runCount:null), skiTimeS:(full?full.skiTimeS:null),
    liftTimeS:(full?full.liftTimeS:null), points:pts });
}
// Rename a vacation (recap screen): server id, not a local key — the
// server owns vacation ids. Local rename (SFStats.renameVacation, by
// local preview key) is the offline display fallback; the server
// rename is queued and lands on flush. Owner-only (RLS); dropped when
// the vacations table does not exist yet.
function renameVacation(serverVacationId, name){
  var u = getUser(); if(!u || !serverVacationId) return Promise.resolve(false);
  return enqueue('vacation.rename', { serverId:serverVacationId, userId:u.id,
    name:String(name||'').trim().slice(0,80) });
}
// Delete one of MY vacations (recap screen). Owner-only (RLS). The
// recordings stay — their vacation_id is set NULL by the FK.
function deleteVacation(serverVacationId){
  var u = getUser(); if(!u || !serverVacationId) return Promise.resolve(false);
  return enqueue('vacation.delete', { serverId:serverVacationId, userId:u.id });
}
// Leaderboard opt-in toggle (Trips.setShareStats): local state is the
// source of truth; this enqueues the set_share_stats RPC call.
// Best-effort: dropped when the v1.2 function does not exist yet.
function onLocalShareStats(localTripId, on){
  var u = getUser(); if(!u || !localTripId) return Promise.resolve(false);
  return enqueue('member.share-stats', { localId:localTripId, userId:u.id, on:!!on });
}

/* ================= public share links (v1.2 §5) =================
   Token: 256-bit random HEX, generated SERVER-SIDE (token DEFAULT
   encode(gen_random_bytes(32),'hex')). The client NEVER invents a
   token: createShareLink inserts WITHOUT a token and reads it back
   from the returned row. item_id is the SERVER uuid of the item
   (recording/vacation/trip server id — NOT a local id; use
   getServerRecordingId / getVacationId to resolve one). item_type in
   ('recording','route','vacation','daily_stats','leaderboard','trip').
   Resolving goes ONLY through ski.resolve_share_link (anon may execute
   it) — never a direct table read with the anon key. The resolver
   returns the item's whitelisted JSON envelope (item_type + fields;
   NO GPS points except 'route'; NO user ids) or NULL for unknown /
   revoked / expired — deliberately no reason given. Revoke goes
   through ski.revoke_share_link (creator only). The public page
   (/guides/share?t=…) is the unified-site coordinator's; this layer
   only mints, revokes and resolves tokens. */
function getShareLinkUrl(token){
  var origin = '';
  try{ origin = location.origin; }catch(e){}
  return origin + '/guides/share?t=' + encodeURIComponent(token);
}
function getServerTripId(localTripId){
  // Public resolver for share/recap screens: the server uuid of a
  // local trip id (null when never synced). Needed for 'trip' share
  // links, whose item_id is the trip's server uuid.
  return getTripUuid(localTripId);
}
function createShareLink(itemType, serverItemId, expiresAtISO){
  var client = getClient();
  if(!client || !getUser()) return Promise.resolve({ok:false, reason:'signed-out'});
  if(!serverItemId) return Promise.resolve({ok:false, reason:'no-item'});
  // C1: only the landed item_type values — 'stats' was the proposal's
  // name and violates the server CHECK (23514); a local id is not a
  // uuid (22P02). Reject early instead of queueing a doomed insert.
  if(['recording','route','vacation','daily_stats','leaderboard','trip'].indexOf(itemType)<0)
    return Promise.resolve({ok:false, reason:'bad-item-type'});
  // No token in the insert: the server default mints it. .select()
  // reads the minted token (and link id) back in the same round trip.
  // expires_at must be NULL or in the future (server CHECK).
  return client.from('share_links').insert({ item_type:itemType, item_id:serverItemId,
    created_by:getUser().id, expires_at:expiresAtISO||null })
    .select('id,token')
    .then(function(res){
      if(res.error){
        if(isTablesMissingError(res.error)){ shareLinksAvailable=false; return {ok:false, reason:'unavailable'}; }
        return {ok:false, reason:'error', error:res.error};
      }
      var row = (res.data && res.data[0]) || null;
      if(!row || !row.token) return {ok:false, reason:'error'};
      return {ok:true, token:row.token, url:getShareLinkUrl(row.token), linkId:row.id};
    }).catch(function(e){ return {ok:false, reason:'error', error:e}; });
}
function revokeShareLink(token){
  var client = getClient();
  if(!client || !getUser() || !token) return Promise.resolve({ok:false, reason:'signed-out'});
  return callRpc(client, 'revoke_share_link', {p_token:token})
    .then(function(res){
      if(res.error){
        if(isTablesMissingError(res.error)){ shareLinksAvailable=false; return {ok:false, reason:'unavailable'}; }
        return {ok:false, reason:'error', error:res.error};
      }
      // false = unknown / already revoked / not mine (same answer by design).
      return {ok:res.data===true};
    }).catch(function(e){ return {ok:false, reason:'error', error:e}; });
}
function resolveShareLink(token){
  // Public: works for guests too (anon key + RPC, no sign-in needed).
  var client = getClient();
  if(!client || !token) return Promise.resolve({ok:false, reason:'not-found'});
  return callRpc(client, 'resolve_share_link', {p_token:token})
    .then(function(res){
      if(res.error){
        if(isTablesMissingError(res.error)){ shareLinksAvailable=false; return {ok:false, reason:'unavailable'}; }
        return {ok:false, reason:'error', error:res.error};
      }
      if(!res.data) return {ok:false, reason:'not-found'}; // unknown / revoked / expired
      return {ok:true, item:res.data};
    }).catch(function(){ return {ok:false, reason:'error'}; });
}

/* ================= leaderboard (data layer, v1.2 §4) =================
   The board itself is a separate screen (unified-site coordinator).
   These call the SECURITY DEFINER functions — never views (a view over
   owner-only recordings could only ever show the caller). Functions
   return AGGREGATES + display names + server-side ranks, only for
   members with share_stats=true for that trip; an empty set (not an
   error) means not-a-member / nobody shares / private vacation.
   Daily vs cumulative: leaderboard_daily(trip, day) ranks ONE ski day
   (Europe/Paris date); leaderboard_trip(trip) sums the whole trip;
   leaderboard_vacation(vacation) is the trip board reached from a
   vacation id (empty when the vacation's trip_id is NULL). */
function getLeaderboard(localTripId, dayISO){
  var client = getClient();
  if(!client || !getUser() || !localTripId) return Promise.resolve({available:false, reason:'signed-out'});
  var sid = getTripUuid(localTripId);
  if(!sid) return Promise.resolve({available:false, reason:'not-synced'});
  var dailyP = dayISO
    ? callRpc(client, 'leaderboard_daily', {p_trip_id:sid, p_day:dayISO})
    : Promise.resolve({data:[], error:null});
  var tripP = callRpc(client, 'leaderboard_trip', {p_trip_id:sid});
  return Promise.all([dailyP, tripP]).then(function(parts){
    var dres = parts[0], tres = parts[1];
    if(dres.error || tres.error){
      var err = dres.error || tres.error;
      if(isTablesMissingError(err)){ leaderboardAvailable=false; return {available:false, reason:'functions-missing'}; }
      return {available:false, reason:'error', error:err};
    }
    return {available:true, daily:dres.data||[], trip:tres.data||[]};
  }).catch(function(e){ return {available:false, reason:'error', error:e}; });
}
function getLeaderboardForVacation(serverVacationId){
  var client = getClient();
  if(!client || !getUser() || !serverVacationId) return Promise.resolve({available:false, reason:'signed-out'});
  return callRpc(client, 'leaderboard_vacation', {p_vacation_id:serverVacationId})
    .then(function(res){
      if(res.error){
        if(isTablesMissingError(res.error)){ leaderboardAvailable=false; return {available:false, reason:'functions-missing'}; }
        return {available:false, reason:'error', error:res.error};
      }
      return {available:true, rows:res.data||[]};
    }).catch(function(e){ return {available:false, reason:'error', error:e}; });
}
// Manual repair / setup: group pre-existing unlinked recordings into
// vacations (the migration already ran this once). Returns {ok, linked}.
function backfillVacations(){
  var client = getClient();
  if(!client || !getUser()) return Promise.resolve({ok:false, reason:'signed-out'});
  return callRpc(client, 'backfill_vacations', {})
    .then(function(res){
      if(res.error){
        if(isTablesMissingError(res.error)) return {ok:false, reason:'unavailable'};
        return {ok:false, reason:'error', error:res.error};
      }
      return {ok:true, linked:(typeof res.data==='number'?res.data:0)};
    }).catch(function(e){ return {ok:false, reason:'error', error:e}; });
}

/* ================= own stats + recap (v1.2 §3) =================
   The recap screen reads the SERVER views (always correct, include
   late recordings from any device). HONEST LIMIT: vacation_stats for
   a non-owner shows only THEIR OWN contribution — the recap screen
   must only show these rows to the owner. getVacationsForRecap
   returns ONE normalised shape from either source:
     {id, resort, name, startDay, endDay, dayCount, totals:{distance,
      gain, loss, topSpeed, longestRun, runCount, skiTimeS, liftTimeS,
      durationS}, source:'server'|'local'}
   Server rows carry the server vacation uuid as id; local rows carry
   the SFStats preview key ('vac-<resort>-<start>') and source 'local'.
   Offline (or views missing) -> local SFStats grouping from on-device
   tracks. */
function getMyDailyStats(){
  var client = getClient();
  if(!client || !getUser()) return Promise.resolve({available:false, reason:'signed-out', rows:[]});
  return client.from('daily_stats').select('*').order('ski_day', {ascending:false})
    .then(function(res){
      if(res.error){
        if(isTablesMissingError(res.error)) return {available:false, reason:'views-missing', rows:[]};
        return {available:false, reason:'error', error:res.error, rows:[]};
      }
      return {available:true, rows:res.data||[]};
    }).catch(function(e){ return {available:false, reason:'error', error:e, rows:[]}; });
}
function getMyVacationStats(){
  var client = getClient();
  if(!client || !getUser()) return Promise.resolve({available:false, reason:'signed-out', rows:[]});
  return client.from('vacation_stats').select('*').order('start_date', {ascending:false})
    .then(function(res){
      if(res.error){
        if(isTablesMissingError(res.error)) return {available:false, reason:'views-missing', rows:[]};
        return {available:false, reason:'error', error:res.error, rows:[]};
      }
      return {available:true, rows:res.data||[]};
    }).catch(function(e){ return {available:false, reason:'error', error:e, rows:[]}; });
}
function getServerRecordingId(localTrackId){
  // The server uuid of one of MY recordings, by its local_id (needed
  // for 'recording' / 'route' / 'daily_stats' share links, whose
  // item_id is the recording's server id).
  var client = getClient();
  if(!client || !getUser() || !localTrackId) return Promise.resolve(null);
  return client.from('recordings').select('id').eq('local_id', localTrackId).limit(1)
    .then(function(res){
      if(res.error || !res.data || !res.data[0]) return null;
      return res.data[0].id;
    }).catch(function(){ return null; });
}
function getVacationsForRecap(){
  return getMyVacationStats().then(function(vs){
    if(vs.available){
      // M4: an empty vacation (0 recordings — e.g. created before its
      // recordings were deleted, or a transient trigger state) is not
      // a vacation the user can open; the server trigger deletes such
      // rows, but filter here too so a stale row never renders.
      return vs.rows.filter(function(r){ return (r.recording_count||0) > 0; }).map(function(r){
        return { id:r.vacation_id, resort:r.resort, name:r.name,
          startDay:r.start_date, endDay:r.end_date, dayCount:r.day_count,
          totals:{ distance:r.total_distance_m||0, gain:r.total_vertical_gain_m,
            loss:r.total_vertical_loss_m, topSpeed:r.max_top_speed_ms||0,
            longestRun:r.longest_run_m||0, runCount:r.total_runs||0,
            skiTimeS:r.total_ski_time_s, liftTimeS:r.total_lift_time_s,
            durationS:r.total_duration_s||0 },
          recordingCount:r.recording_count||0, tripId:r.trip_id||null, source:'server' };
      });
    }
    if(!window.SFStats) return [];
    var localP = (window.SF && SF.Rec && SF.Rec.idbAll) ? SF.Rec.idbAll().catch(function(){ return []; }) : Promise.resolve([]);
    return localP.then(function(tracks){
      return SFStats.getVacations(tracks||[]).map(function(v){
        return { id:v.id, resort:v.resort, name:v.name, startDay:v.startDay, endDay:v.endDay,
          dayCount:v.days.length, totals:v.totals, recordingCount:v.totals.trackCount||0,
          tripId:null, source:'local' };
      });
    }).catch(function(){ return []; });
  }).catch(function(){ return []; });
}

/* ================= flush (push outbox, then pull) ================= */
function tableOp(client, op){
  var p = op.payload;
  if(op.type==='trip.upsert'){
    var sid = getTripUuid(p.localId) || uuid();
    setTripUuid(p.localId, sid);
    return client.from('trips').upsert({ id:sid, created_by:p.ownerId, resort:p.resort,
      name:p.name, start_date:p.startDate, end_date:p.endDate, local_id:p.localId },
      {onConflict:'local_id', ignoreDuplicates:true});
  }
  if(op.type==='member.join'){
    return callRpc(client, 'join_trip_by_local_id', {p_local_id:p.localId, p_display_name:p.displayName})
      .then(function(res){
        if(res.error) return res;
        // RPC returns NULL when no trip with that local_id exists yet —
        // i.e. the trip.upsert op ahead of this one has not landed (a
        // flush can start between the two enqueues). Treat as retryable:
        // keep the op queued; the next flush retries it.
        if(!res.data) return {error:{message:'trip not found for local_id '+p.localId+' (not synced yet)', code:'SF_NO_TRIP'}};
        setTripUuid(p.localId, res.data); // RPC returns the trip uuid
        return res;
      });
  }
  if(op.type==='share.insert'){
    var tsid = getTripUuid(p.trip);
    if(!tsid) return Promise.resolve({error:{message:'no server trip uuid for '+p.trip, code:'SF_NO_TRIP'}});
    return client.from('friend_shares').insert({ trip_id:tsid, user_id:p.userId,
      display_name:p.displayName, lat:p.lat, lon:p.lon,
      accuracy_m:p.acc, source:(p.source==='map-centre'?'map-centre':'gps'),
      is_meeting_point:(p.kind==='meet'), label:p.label||null, shared_at:p.sharedAt });
  }
  if(op.type==='share.delete'){
    var dsid = getTripUuid(p.trip);
    if(!dsid) return Promise.resolve({data:null, error:null}); // nothing synced yet: nothing to delete
    return client.from('friend_shares').delete().eq('trip_id', dsid).eq('user_id', p.userId);
  }
  if(op.type==='recording.upsert'){
    // M3: a resort the server CHECK rejects must never be sent (an
    // old queued op from before the allowlist, or a resort that was
    // valid when queued). Drop it — the track stays local.
    if(ALLOWED_RESORTS.indexOf(p.resort)<0) return Promise.resolve({dropped:true});
    // v1.2 stats columns (run_count, ski_time_s, lift_time_s) ride
    // along when present. vacation_id and ski_day are NOT sent — the
    // §2 trigger sets both (ski_day = started_at in Europe/Paris;
    // vacation from consecutive days per owner+resort, linked to
    // trip_id when given). If the v1.2 columns do not exist yet,
    // PostgREST answers PGRST204 (column not found) and we retry with
    // the base v1.1 columns — sync works on either schema.
    var fullRow = { local_id:p.localId, user_id:p.userId,
      trip_id:(p.tripId||null), resort:p.resort, started_at:p.startedAt, ended_at:p.endedAt,
      distance_m:p.distanceM, duration_s:p.durationS,
      vertical_gain_m:p.verticalGainM, vertical_loss_m:p.verticalLossM,
      top_speed_ms:p.topSpeedMs, longest_run_m:p.longestRunM,
      run_count:p.runCount, ski_time_s:p.skiTimeS, lift_time_s:p.liftTimeS,
      points:p.points };
    return client.from('recordings').upsert(fullRow, {onConflict:'local_id'})
      .then(function(res){
        if(res.error && res.error.code==='PGRST204'){
          var baseRow = { local_id:p.localId, user_id:p.userId,
            trip_id:(p.tripId||null), resort:p.resort, started_at:p.startedAt, ended_at:p.endedAt,
            distance_m:p.distanceM, duration_s:p.durationS,
            vertical_gain_m:p.verticalGainM, vertical_loss_m:p.verticalLossM,
            top_speed_ms:p.topSpeedMs, longest_run_m:p.longestRunM,
            points:p.points };
          return client.from('recordings').upsert(baseRow, {onConflict:'local_id'});
        }
        // M1: the v1.2.1 INSERT policy rejects a recording whose
        // trip_id names a trip the caller is not a member of (42501).
        // That must not lose the track: retry once with trip_id NULL
        // — the recording syncs as private (its vacation stays
        // unlinked) instead of blocking the queue forever.
        if(res.error && res.error.code==='42501' && fullRow.trip_id){
          var privateRow = { local_id:p.localId, user_id:p.userId,
            trip_id:null, resort:p.resort, started_at:p.startedAt, ended_at:p.endedAt,
            distance_m:p.distanceM, duration_s:p.durationS,
            vertical_gain_m:p.verticalGainM, vertical_loss_m:p.verticalLossM,
            top_speed_ms:p.topSpeedMs, longest_run_m:p.longestRunM,
            run_count:p.runCount, ski_time_s:p.skiTimeS, lift_time_s:p.liftTimeS,
            points:p.points };
          return client.from('recordings').upsert(privateRow, {onConflict:'local_id'});
        }
        return res;
      });
  }
  if(op.type==='vacation.rename'){
    // Owner-only (RLS). Keyed by SERVER id — vacations have no local_id.
    return client.from('vacations').update({name:p.name}).eq('id', p.serverId).eq('owner_id', p.userId)
      .then(function(res){
        if(res.error && (isTablesMissingError(res.error) || res.error.code==='PGRST204')){
          vacationsAvailable=false;
          return {dropped:true};
        }
        if(!res.error) refreshVacationList().catch(function(){});
        return res;
      });
  }
  if(op.type==='vacation.delete'){
    return client.from('vacations').delete().eq('id', p.serverId).eq('owner_id', p.userId)
      .then(function(res){
        if(res.error && (isTablesMissingError(res.error) || res.error.code==='PGRST204')){
          vacationsAvailable=false;
          return {dropped:true};
        }
        if(!res.error) refreshVacationList().catch(function(){});
        return res;
      });
  }
  if(op.type==='member.share-stats'){
    var ssid = getTripUuid(p.localId);
    if(!ssid) return Promise.resolve({error:{message:'no server trip uuid for '+p.localId, code:'SF_NO_TRIP'}});
    // v1.2 §4: toggle ONLY via ski.set_share_stats (SECURITY DEFINER).
    // A direct UPDATE must never be used — the v1 policy rejects it
    // on admin rows. Returns false when the caller has no member row
    // for this trip yet (join not landed) — retryable. A missing
    // function (PGRST205) drops the op; the local toggle still holds.
    return callRpc(client, 'set_share_stats', {p_trip_id:ssid, p_share:!!p.on})
      .then(function(res){
        if(res.error){
          if(isTablesMissingError(res.error)){ leaderboardAvailable=false; return {dropped:true}; }
          return res;
        }
        if(res.data!==true) return {error:{message:'set_share_stats returned false (no member row yet?)', code:'SF_NO_MEMBER'}};
        return res;
      });
  }
  return Promise.resolve({error:null});
}
function flush(){
  if(flushing || !ready() || !online()) return Promise.resolve({flushed:0, pending:pendingCount});
  var client = getClient();
  flushing = true;
  lastError = null; tablesMissing = false;
  // Resolve local trip ids to server uuids first. When the SQL has not
  // been run yet this SELECT fails with PGRST205 — ops stay queued and
  // the app keeps working locally (see getStatus().tablesMissing).
  return refreshTripMap().catch(function(e){ setError(e); return false; }).then(function(mapOk){
    if(mapOk===false){ flushing=false; if(window.SFAuth && SFAuth.render) SFAuth.render(); return {flushed:0, pending:pendingCount, error:lastError}; }
    // Best-effort: a missing vacations table must not block anything.
    return refreshVacationList().catch(function(){ return false; }).then(function(){
    return outboxAll().then(function(ops){
      // Timestamp order, ties broken by dependency rank: a trip row
      // must land before its member join; a rename/delete after the
      // recording that created the vacation. (Op ids sort
      // alphabetically, not by enqueue order, so the rank — not the
      // id — decides ties.)
      var RANK = {'trip.upsert':0, 'member.join':1,
        'member.share-stats':2, 'share.insert':3, 'share.delete':4,
        'recording.upsert':5, 'vacation.rename':6, 'vacation.delete':7};
      ops.sort(function(a,b){ return (a.ts||0)-(b.ts||0)
        || ((RANK[a.type]==null?9:RANK[a.type])-(RANK[b.type]==null?9:RANK[b.type])); });
      var chain = Promise.resolve(), done = 0;
      ops.forEach(function(op){
        chain = chain.then(function(){
          if(lastError) return; // stop on first failure; rest stays queued
          // H2 (defence in depth): an op queued by another user must
          // never flush under the current user — RLS would reject it
          // and it would block the queue. Drop it (sign-out already
          // clears the outbox; this covers a stale op that survived,
          // e.g. a session restored after a crash).
          var owner = op.payload && (op.payload.userId || op.payload.ownerId);
          var me = getUser();
          if(owner && me && owner!==me.id){
            return outboxDel(op.id).then(function(){ pendingCount=Math.max(0,pendingCount-1); });
          }
          return tableOp(client, op).then(function(res){
            if(res && res.error){
              // M7: a permanently failing op must not block the queue
              // forever. Coded failures (PostgREST / policy /
              // validation errors — NOT the retryable SF_NO_TRIP /
              // SF_NO_MEMBER "not landed yet" answers, and NOT
              // network errors, which have no code) count tries; at
              // 5 tries the op is dropped so the rest can flow. The
              // drop is recorded in getStatus().lastDropped.
              if(res.error.code && res.error.code!=='SF_NO_TRIP' && res.error.code!=='SF_NO_MEMBER'){
                op.tries = (op.tries||0)+1;
                if(op.tries>=5){
                  lastDropped = op.type+' failed '+op.tries+'x ('+(res.error.message||res.error.code)+') — dropped';
                  return outboxDel(op.id).then(function(){ pendingCount=Math.max(0,pendingCount-1); });
                }
                return outboxPut(op).then(function(){ setError(res.error); });
              }
              setError(res.error); return;
            }
            // {dropped:true} = best-effort op for a table/column that
            // does not exist yet: delete it, count it, keep flushing.
            done++;
            return outboxDel(op.id).then(function(){ pendingCount=Math.max(0,pendingCount-1); });
          }).catch(function(e){ setError(e); });
        });
      });
      return chain.then(function(){
        flushing = false;
        if(!lastError){
          lastSyncAt = Date.now();
          // Hygiene only (expiry is enforced by RLS + the view): delete
          // my expired rows server-side, best-effort, failures ignored.
          try{ callRpc(client, 'delete_expired_shares', {}).catch(function(){}); }catch(e){}
          return pull().then(function(){ if(window.SFAuth && SFAuth.render) SFAuth.render(); return {flushed:done, pending:pendingCount}; });
        }
        if(window.SFAuth && SFAuth.render) SFAuth.render();
        return {flushed:done, pending:pendingCount, error:lastError};
      });
    });
    });
  }).catch(function(e){ flushing=false; setError(e); return {flushed:0, pending:pendingCount, error:lastError}; });
}

/* ================= pull (server -> local) ================= */
function pull(){
  if(!ready() || !online()) return Promise.resolve(false);
  var client = getClient();
  var u = getUser();
  return refreshTripMap().catch(function(){ return false; }).then(function(){
    var trips = joinedTripIds();
    if(!trips.length) return true;
    var chain = Promise.resolve();
    trips.forEach(function(localId){
      var sid = getTripUuid(localId);
      if(!sid) return; // never synced (or not created yet): nothing to pull
      chain = chain.then(function(){
        // The view already returns only non-expired shares, newest first.
        return client.from('active_friend_shares').select('*').eq('trip_id', sid)
          .order('shared_at', {ascending:false})
          .then(function(res){
            if(!res.error && res.data) pullSharesIntoLocal(localId, res.data, u);
            return client.from('trip_members').select('display_name').eq('trip_id', sid)
              .then(function(mres){
                if(!mres.error && mres.data) pullMembersIntoLocal(localId, mres.data);
              }).catch(function(){});
          }).catch(function(){});
      });
    });
    return chain.then(function(){
      try{ if(window.SF && SF.Friends){ SF.Friends.pruneExpired(); SF.Friends.render(); } }catch(e){}
      // Refresh the server vacation list too (the recap screen reads
      // it; the trigger may have created/merged vacations since the
      // last flush). Best-effort, failures ignored.
      return refreshVacationList().catch(function(){ return false; }).then(function(){ return true; });
    });
  });
}
function pullSharesIntoLocal(localTripId, rows, me){
  if(!window.SF || !SF.Friends || !SF.Friends.upsertFriend) return;
  rows.forEach(function(r){
    if(!r || (me && r.user_id===me.id)) return; // my own position is already local
    var ts = r.shared_at ? Date.parse(r.shared_at) : 0;
    if(!ts || (Date.now()-ts) > SHARE_TTL_MS) return; // expired: drop, never resurrect
    // Friend shares: one marker per member (newest wins via upsertFriend's
    // ts check). Meeting points: one marker per row.
    var fid = r.is_meeting_point ? ('sync-meet-'+r.id) : ('sync-'+r.user_id);
    try{
      SF.Friends.upsertFriend({ v:1, kind:(r.is_meeting_point?'meet':'friend'), fid:fid,
        from:r.display_name||'', trip:localTripId, lat:r.lat, lon:r.lon,
        acc:(r.accuracy_m==null?null:r.accuracy_m), ts:ts, label:r.label||null,
        resort:r.resort||currentSlug() }, 'sync');
    }catch(e){}
  });
}
function pullMembersIntoLocal(localTripId, rows){
  try{
    var s = readLS('sf-trips', {});
    s.members = s.members||{}; s.members[localTripId]=s.members[localTripId]||[];
    var have = {};
    s.members[localTripId].forEach(function(m){ have[(m.name||'').trim().toLowerCase()]=true; });
    rows.forEach(function(r){
      var name = (r.display_name||'').trim();
      if(!name || have[name.toLowerCase()]) return; // add-only: never remove local members
      have[name.toLowerCase()]=true;
      s.members[localTripId].push({id:'mb-sync-'+Math.random().toString(36).slice(2,8), name:name, sharing:false});
    });
    storeLS('sf-trips', s);
    if(window.SF && SF.Trips) SF.Trips.renderSettings();
  }catch(e){}
}

/* ================= status / boot ================= */
function getStatus(){
  return { enabled:ready(), signedIn:!!getUser(), online:online(),
    pending:pendingCount, lastSyncAt:lastSyncAt, lastError:lastError,
    lastDropped:lastDropped,
    tablesMissing:tablesMissing, vacationsAvailable:vacationsAvailable,
    leaderboardAvailable:leaderboardAvailable, shareLinksAvailable:shareLinksAvailable };
}
function syncNow(){ return flush(); }

// H2: sign-out must clear everything that belongs to the signed-out
// user — otherwise the next user flushes their ops (RLS failures,
// queue stuck forever; the review proved it twice in the mock suite).
// The auth callback also fires with null on session-restore, so only
// clear on a REAL transition: we saw a user this page-load and now
// see null. A fresh load with no session never clears (the previous
// sign-out already did).
var seenUserId = null;
function clearOnSignOut(){
  pendingCount = 0;
  tripMapCache = {}; vacationListCache = [];
  lastSyncAt = 0; lastError = null; lastDropped = null; tablesMissing = false;
  outboxClear();
  metaPut('tripMap', {}); metaPut('vacationList', []);
  purgeSyncedLocal();
}
// Synced-in friends/members belong to the signed-out user: remove
// them from local state (SETUP.md 4.5: "other people's points are
// gone"). Local ?f= drops and locally added members stay.
function purgeSyncedLocal(){
  try{
    var fr = readLS('sf-friends', []);
    if(Array.isArray(fr)){
      var kept = fr.filter(function(f){ return !(f && typeof f.fid==='string' && f.fid.indexOf('sync-')===0); });
      if(kept.length!==fr.length) storeLS('sf-friends', kept);
    }
  }catch(e){}
  try{
    var s = readLS('sf-trips', {});
    var changed = false;
    if(s && s.members){
      Object.keys(s.members).forEach(function(tid){
        var before = (s.members[tid]||[]).length;
        s.members[tid] = (s.members[tid]||[]).filter(function(m){ return !(m && typeof m.id==='string' && m.id.indexOf('mb-sync-')===0); });
        if(s.members[tid].length!==before) changed = true;
      });
      if(changed) storeLS('sf-trips', s);
    }
  }catch(e){}
  try{ if(window.SF && SF.Friends && SF.Friends.render) SF.Friends.render(); }catch(e){}
  try{ if(window.SF && SF.Trips && SF.Trips.renderSettings) SF.Trips.renderSettings(); }catch(e){}
}

function boot(){
  outboxAll().then(function(ops){ pendingCount = ops.length; });
  metaGet('tripMap').then(function(m){ if(m) tripMapCache = m; });
  metaGet('vacationList').then(function(v){ if(v) vacationListCache = v; });
  if(window.SFAuth && SFAuth.onAuthChange){
    SFAuth.onAuthChange(function(user){
      if(user){ seenUserId = user.id; lastError=null; tablesMissing=false; flush(); return; }
      if(seenUserId){ seenUserId = null; clearOnSignOut(); if(window.SFAuth && SFAuth.render) SFAuth.render(); }
    });
  }
  window.addEventListener('online', function(){ flush(); });
  window.addEventListener('offline', function(){ if(window.SFAuth && SFAuth.render) SFAuth.render(); });
  // pull shortly after load when already signed in (session restore)
  setTimeout(function(){ if(ready() && online()) pull(); }, 3000);
}
if(document.readyState==='loading'){ document.addEventListener('DOMContentLoaded', boot); }
else { boot(); }

window.SFSync = {
  getStatus:getStatus, syncNow:syncNow, flush:flush, pull:pull,
  onLocalTrip:onLocalTrip, onLocalShare:onLocalShare,
  onLocalShareStop:onLocalShareStop, onLocalRecording:onLocalRecording,
  onLocalShareStats:onLocalShareStats,
  renameVacation:renameVacation, deleteVacation:deleteVacation,
  backfillVacations:backfillVacations,
  createShareLink:createShareLink, revokeShareLink:revokeShareLink,
  resolveShareLink:resolveShareLink, getShareLinkUrl:getShareLinkUrl,
  getLeaderboard:getLeaderboard, getLeaderboardForVacation:getLeaderboardForVacation,
  getMyDailyStats:getMyDailyStats, getMyVacationStats:getMyVacationStats,
  getServerRecordingId:getServerRecordingId,
  getServerTripId:getServerTripId,
  getVacationId:getVacationId, getVacationById:getVacationById,
  getVacationsForRecap:getVacationsForRecap,
  SHARE_TTL_MS:SHARE_TTL_MS,
  _debug:{ outboxCount:function(){ return outboxAll().then(function(o){ return o.length; }); },
    clear:function(){ pendingCount=0; return outboxClear(); },
    tripMap:function(){ return tripMapCache; },
    vacationList:function(){ return vacationListCache; } }
};
})();
