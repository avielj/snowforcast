/* sf-recap.js — ski recap, vacations + private leaderboard (off-map screen).
   Reads the SAME local tracks the map recorder writes (IndexedDB
   'sf-tracks' / store 'tracks', track {id, resort, startTs, endTs,
   points[{t,lat,lon,alt,acc,spd}], stats}). When the map's SF.Rec is
   present (map pages) its idbAll()/computeStats() are reused; on the
   recap page SF is absent, so this module opens the same IndexedDB
   itself and carries its own copy of the stats math — map-shared.js is
   never modified.
   - computeStats() mirrors map-shared.js computeStats EXACTLY for
     distance / duration / gain / loss / topSpeed / longestRun (same
     stop rule: >=60s under 0.5 m/s, or a gap >180s), and ADDS what the
     map does not compute: ski time vs lift time, run count, and the
     top-speed point (for tap-to-jump). The definitions are canonical
     in guides/sf-stats.js (SFStats) and this module delegates to it
     when present; the fallback below uses the same definitions.
     Ski/lift split: per point pair with altitude, a drop of >=2 m
     counts as skiing, a rise of >=2 m as lift. Without altitude data
     the split is impossible and ski/lift time is null — shown as "—",
     never guessed from speed alone. A "run" is one
     continuous-movement segment (same stop rule as longestRun); a
     segment may be a descent or a lift ride, and the count never
     pretends to know which is which.
   - Days: tracks grouped by local calendar date + resort. Vacations:
     via SFVacations.buildVacations (consecutive days = one vacation).
   - Leaderboard (private, per trip/vacation): daily winners per
     category (distance, vertical, top speed, longest run, run count)
     + cumulative ranking for the whole vacation. Sources: my local
     tracks + the landed leaderboard RPCs via SFSync
     (ski.leaderboard_daily / leaderboard_trip / leaderboard_vacation
     — supabase/ski-stats-vacations.sql v1.2, NOT the day_stats TABLE
     from the superseded proposal: that table was never created, and
     the client never uploads aggregates. My stats reach the server
     as my synced recordings (sf-sync.js uploads them with their
     stats columns); the server's daily_stats view aggregates them).
     Privacy is hard: the board shows ONLY people who opted in to
     share stats (share_stats on trip_members, off by default,
     revocable any time, toggled via ski.set_share_stats — never a
     direct UPDATE). Anyone who did not opt in does not appear at
     all — no "0", no empty slot. If I am the only sharer, the board
     says so honestly and shows no demo/fake participants.
   - My opt-in: a single toggle on this screen maps onto the per-trip
     share_stats flags (SFSync.onLocalShareStats, one RPC per trip).
     Turning it off revokes my stats from every board. If the
     functions/tables are missing, everything falls back to local-only
     ("my stats only") with an honest note.
   All strings HE/EN. No map, nothing floats over a map. */
(function(){
'use strict';

var TRACKS_DB = 'sf-tracks', TRACKS_STORE = 'tracks';
var OPTIN_KEY = 'sf-stats-optin';
// C2 (independent review, 2026-11-27): there is NO ski.day_stats
// table — the landed v1.2 has the daily_stats VIEW over recordings
// and the leaderboard RPCs. This module never upserts aggregates;
// see uploadMyDayStats / fetchBoardRows below. The old DAYSTATS_TABLE
// constant is gone on purpose.

var STR = {
he:{
  'rec.title':'סיכומי גלישה', 'rec.days':'ימים', 'rec.vacations':'חופשות',
  'rec.distance':'מרחק', 'rec.vertical':'גובה מצטבר', 'rec.topSpeed':'מהירות מרבית',
  'rec.longestRun':'הריצה הארוכה ביותר', 'rec.runs':'ריצות', 'rec.skiTime':'זמן גלישה',
  'rec.liftTime':'זמן ליפטים', 'rec.duration':'משך כולל', 'rec.noAlt':'אין נתוני גובה — לא ניתן להפריד זמן גלישה מליפטים',
  'rec.noTracks':'אין הקלטות עדיין. הקליטו יום גלישה מהמפה (כפתור ההקלטה) והסיכום יופיע כאן.',
  'rec.localOnly':'מוצגות רק ההקלטות מהמכשיר הזה. התחברו כדי לראות גם הקלטות מסונכרנות מהשרת.',
  'rec.noRemote':'פונקציות הלוח (leaderboard) עדיין לא קיימות בשרת — הלוח מציג רק את הסטטיסטיקה שלי.',
  'rec.notSignedIn':'לא מחוברים — הלוח מציג רק את הסטטיסטיקה שלי מהמכשיר הזה.',
  'rec.onlySharer':'אתם המשתפים היחידים כרגע — אין עדיין משתתפים אחרים בלוח. בלי נתוני דמו.',
  'rec.noParticipants':'אין משתתפים משתפים בלוח הזה עדיין.',
  'rec.dailyWinners':'מנצחי היום', 'rec.cumulative':'דירוג מצטבר לחופשה',
  'rec.bestToday':'הכי {what} היום', 'rec.shareStatsOptIn':'שיתוף הסטטיסטיקה שלי בלוח',
  'rec.shareStatsNote':'כבוי כברירת מחדל. כשתדליקו, רק אגרגטים יומיים (מרחק, גובה, מהירות, ריצות) ישותפו עם חברי הטיול — לעולם לא מסלול מלא או מיקום חי. ניתן לביטול בכל רגע.',
  'rec.shareOn':'שיתוף דולק — הסטטיסטיקה שלי גלויה לחברי הטיול בלוח.',
  'rec.shareOff':'שיתוף כבוי — אני לא מופיע/ה בלוח של אחרים.',
  'rec.topSpeedAt':'המהירות המרבית נמדדה ב־{time}, {speed} קמ״ש',
  'rec.topSpeedPoint':'נקודה: {lat}, {lon} · גובה {alt} מ׳',
  'rec.gpx':'הורדת GPX', 'rec.showDetail':'פרטים', 'rec.dayDetail':'פירוט היום',
  'rec.friendStatsOnly':'הסטטיסטיקה של {name} בלבד — בלי מיקום ובלי מסלול מלא, לפי מה שהוא/היא שיתפ/ה.',
  'rec.rename':'שינוי שם', 'rec.save':'שמירה', 'rec.cancel':'ביטול',
  'rec.vacDays':'ימי גלישה', 'rec.me':'אני', 'rec.uploaded':'הסטטיסטיקה היומית סונכרנה.',
  'rec.uploadFailed':'לא הצלחנו לשתף את הסטטיסטיקה כרגע — נשארת מקומית בלבד.',
  'rec.m':'מ׳', 'rec.km':'ק״מ', 'rec.kmh':'קמ״ש', 'rec.min':'דקות'
},
en:{
  'rec.title':'Ski recaps', 'rec.days':'Days', 'rec.vacations':'Vacations',
  'rec.distance':'Distance', 'rec.vertical':'Vertical', 'rec.topSpeed':'Top speed',
  'rec.longestRun':'Longest run', 'rec.runs':'Runs', 'rec.skiTime':'Ski time',
  'rec.liftTime':'Lift time', 'rec.duration':'Total time', 'rec.noAlt':'No altitude data — ski vs lift time cannot be split',
  'rec.noTracks':'No tracks yet. Record a ski day from the map (Record button) and the recap will appear here.',
  'rec.localOnly':'Only tracks from this device are shown. Sign in to also see synced tracks from the server.',
  'rec.noRemote':'The leaderboard functions do not exist on the server yet — the board shows only my stats.',
  'rec.notSignedIn':'Not signed in — the board shows only my stats from this device.',
  'rec.onlySharer':'You are the only sharer so far — no other participants on the board yet. No demo data.',
  'rec.noParticipants':'No sharing participants on this board yet.',
  'rec.dailyWinners':'Daily winners', 'rec.cumulative':'Vacation standings',
  'rec.bestToday':'Most {what} today', 'rec.shareStatsOptIn':'Share my stats on the board',
  'rec.shareStatsNote':'Off by default. When on, only daily aggregates (distance, vertical, speed, runs) are shared with trip members — never a full track or live position. Revocable any time.',
  'rec.shareOn':'Sharing on — my stats are visible to trip members on the board.',
  'rec.shareOff':'Sharing off — I do not appear on other people\u2019s boards.',
  'rec.topSpeedAt':'Top speed measured at {time}, {speed} km/h',
  'rec.topSpeedPoint':'Point: {lat}, {lon} · alt {alt} m',
  'rec.gpx':'Download GPX', 'rec.showDetail':'Details', 'rec.dayDetail':'Day detail',
  'rec.friendStatsOnly':'Only {name}\u2019s stats — no position and no full track, just what they shared.',
  'rec.rename':'Rename', 'rec.save':'Save', 'rec.cancel':'Cancel',
  'rec.vacDays':'Ski days', 'rec.me':'Me', 'rec.uploaded':'Daily stats synced.',
  'rec.uploadFailed':'Could not share stats right now — staying local only.',
  'rec.m':'m', 'rec.km':'km', 'rec.kmh':'km/h', 'rec.min':'min'
}};

function lang(){ try{ var l=document.documentElement.getAttribute('lang')||'he'; return l.indexOf('en')===0?'en':'he'; }catch(e){ return 'he'; } }
function t(k, vars){ var L=STR[lang()]||STR.he; var s=(L[k]!=null?L[k]:(STR.en[k]!=null?STR.en[k]:k));
  if(vars) for(var a in vars) s=String(s).split('{'+a+'}').join(vars[a]); return s; }
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
function readLS(k, def){ try{ var v=localStorage.getItem(k); return v==null?def:JSON.parse(v); }catch(e){ return def; } }
function storeLS(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }
function haversine(a, b){
  var R=6371000, dLat=(b[0]-a[0])*Math.PI/180, dLon=(b[1]-a[1])*Math.PI/180;
  var la1=a[0]*Math.PI/180, la2=b[0]*Math.PI/180;
  var h=Math.sin(dLat/2)*Math.sin(dLat/2)+Math.cos(la1)*Math.cos(la2)*Math.sin(dLon/2)*Math.sin(dLon/2);
  return 2*R*Math.asin(Math.sqrt(h));
}
function fmtDist(m){ if(m==null) return '—'; return m>=1000 ? (m/1000).toFixed(1)+' '+t('rec.km') : Math.round(m)+' '+t('rec.m'); }
function fmtDur(sec){ if(sec==null) return '—'; sec=Math.round(sec); var h=Math.floor(sec/3600), m=Math.round((sec%3600)/60);
  return h>0 ? h+':'+('0'+m).slice(-2) : m+' '+t('rec.min'); }
function fmtClock(ts){ try{ var d=new Date(ts); return ('0'+d.getHours()).slice(-2)+':'+('0'+d.getMinutes()).slice(-2); }catch(e){ return ''; } }
function dayKey(ts){ var d=new Date(ts); return d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2); }

/* ================= stats math =================
   CANONICAL DEFINITIONS live in guides/sf-stats.js (SFStats — sibling
   computation layer, same definitions everywhere: app, sync,
   leaderboard). This module DELEGATES to SFStats.computeTrackStats
   when present and only falls back to its own copy below when
   SFStats is absent (never loaded, old cached page). The fallback
   mirrors map-shared.js computeStats for distance/duration/gain/loss/
   topSpeed/longestRun, with the same ski/lift rule SFStats uses
   (per-pair altitude ±2 m; null without altitude).
   - runCount: one DESCENT — a continuous-movement segment whose net
     altitude change is <= -20 m (same stop rule as longestRun).
     Lift segments do NOT count. Without altitude data runCount is
     NULL, never 0. longestRun is the longest DESCENT segment when
     altitude exists, else the longest continuous-movement segment.
   - topSpeedPoint (this module only): the GPS point of the fastest
     segment, for tap-to-jump in the recap. */
function topSpeedPoint(points){
  var best=null, bestSpd=0;
  for(var i=1;i<points.length;i++){
    var a=points[i-1], b=points[i];
    var d=haversine([a.lat,a.lon],[b.lat,b.lon]);
    var dt=Math.max(1,(b.t-a.t)/1000);
    var spd=(b.spd!=null?b.spd:(d/dt));
    if(spd>bestSpd){ bestSpd=spd; best={t:b.t, lat:b.lat, lon:b.lon, alt:b.alt, speed:spd}; }
  }
  return best;
}
function computeDayStats(points, startTs, endTs){
  var pts=points||[];
  if(window.SFStats && SFStats.computeTrackStats){
    var s=SFStats.computeTrackStats(pts, startTs, endTs);
    return {distance:s.distance||0, duration:s.duration||0,
      gain:(s.gain==null?null:s.gain), loss:(s.loss==null?null:s.loss),
      topSpeed:s.topSpeed||0, longestRun:s.longestRun||0, n:s.n||pts.length,
      skiTime:(s.skiTimeS==null?null:s.skiTimeS), liftTime:(s.liftTimeS==null?null:s.liftTimeS),
      runs:(s.runCount==null?null:s.runCount),
      topSpeedPoint:pts.length>1?topSpeedPoint(pts):null};
  }
  return computeDayStatsFallback(pts, startTs, endTs);
}
function computeDayStatsFallback(points, startTs, endTs){
  /* Fallback only (SFStats absent): same definitions as
     SFStats.computeTrackStats — per-pair altitude ±2 m for the
     ski/lift split; runCount = DESCENT segments (net altitude
     change <= -20 m), NULL without altitude; longestRun = longest
     descent with altitude, else longest continuous segment. */
  var st = {distance:0, duration:Math.max(0,(endTs-startTs)/1000), gain:0, loss:0,
    topSpeed:0, longestRun:0, n:(points||[]).length, skiTime:null, liftTime:null, runs:null, topSpeedPoint:null};
  var pts = points||[];
  if(pts.length<2){ return st; }
  var hasAlt = pts.some(function(p){ return p.alt!=null; });
  var skiT=0, liftT=0, segDist=0, segAltStart=null, segAltEnd=null, runs=0, longestDesc=0, longestSeg=0;
  function closeSegment(){
    if(segDist>longestSeg) longestSeg=segDist;
    if(segAltStart!=null && segAltEnd!=null && (segAltEnd-segAltStart)<=-20){
      runs++;
      if(segDist>longestDesc) longestDesc=segDist;
    }
    segDist=0; segAltStart=null; segAltEnd=null;
  }
  for(var i=1;i<pts.length;i++){
    var a=pts[i-1], b=pts[i];
    var d=haversine([a.lat,a.lon],[b.lat,b.lon]);
    var dt=Math.max(0,(b.t-a.t)/1000);
    st.distance+=d;
    var spd=(b.spd!=null?b.spd:(dt>0?d/dt:0));
    if(spd>st.topSpeed){ st.topSpeed=spd; st.topSpeedPoint={t:b.t, lat:b.lat, lon:b.lon, alt:b.alt, speed:spd}; }
    if(hasAlt && a.alt!=null && b.alt!=null){
      var dh=b.alt-a.alt;
      if(dh>0) st.gain+=dh; else st.loss-=dh;
      if(dh<=-2) skiT+=dt; else if(dh>=2) liftT+=dt;
    }
    var stopped=(spd<0.5 && dt>=60) || dt>180;
    if(stopped){ closeSegment(); }
    else {
      if(segAltStart==null && a.alt!=null) segAltStart=a.alt;
      if(b.alt!=null) segAltEnd=b.alt;
      segDist+=d;
    }
  }
  closeSegment();
  if(hasAlt){ st.runs=runs; st.longestRun=longestDesc; st.skiTime=skiT; st.liftTime=liftT; }
  else { st.gain=null; st.loss=null; st.longestRun=longestSeg; }
  return st;
}

/* ================= local tracks ================= */
function idbAllLocal(){
  return new Promise(function(res){
    if(window.SF && SF.Rec && SF.Rec.idbAll){ SF.Rec.idbAll().then(res); return; }
    if(!('indexedDB' in window)){ res([]); return; }
    var rq;
    try{ rq=indexedDB.open(TRACKS_DB, 1); }catch(e){ res([]); return; }
    rq.onerror=function(){ res([]); };
    rq.onsuccess=function(){
      try{
        var tx=rq.result.transaction(TRACKS_STORE,'readonly');
        var g=tx.objectStore(TRACKS_STORE).getAll();
        g.onsuccess=function(){ res(g.result||[]); }; g.onerror=function(){ res([]); };
      }catch(e){ res([]); }
    };
  });
}
function trackStats(tr){
  if(tr.stats && typeof tr.stats.distance==='number'){
    var s=tr.stats;
    /* Stored stats predate the ski/lift split: recompute from points
       when points exist so the split is available; else keep stored. */
    if(tr.points && tr.points.length>1){
      var full=computeDayStats(tr.points, tr.startTs, tr.endTs||tr.startTs);
      full.duration = s.duration!=null ? s.duration : full.duration;
      return full;
    }
    return {distance:s.distance||0, duration:s.duration||0, gain:(s.gain==null?null:s.gain),
      loss:(s.loss==null?null:s.loss), topSpeed:s.topSpeed||0, longestRun:s.longestRun||0,
      n:s.n||0, skiTime:null, liftTime:null, runs:null, topSpeedPoint:null};
  }
  if(tr.points && tr.points.length>1) return computeDayStats(tr.points, tr.startTs, tr.endTs||tr.startTs);
  return computeDayStats([], tr.startTs, tr.endTs||tr.startTs);
}
function loadTracks(){
  return idbAllLocal().then(function(all){
    all.sort(function(a,b){ return b.startTs-a.startTs; });
    return all.map(function(tr){
      return {id:tr.id, resort:tr.resort||'', startTs:tr.startTs, endTs:tr.endTs||tr.startTs,
        points:tr.points||[], stats:trackStats(tr)};
    });
  });
}
function groupDays(tracks){
  var days = {};
  tracks.forEach(function(tr){
    // M2: a ski day is the calendar date in Europe/Paris (the server
    // grouping rule), not the device-local date — SFStats.dayKey when
    // present, device-local fallback only.
    var dk = (window.SFStats && SFStats.dayKey) ? SFStats.dayKey(tr.startTs) : dayKey(tr.startTs);
    var k = dk+'|'+(tr.resort||'');
    var d = days[k] || {date:dk, resort:tr.resort||'', tracks:[],
      stats:{distance:0, duration:0, gain:0, loss:0, topSpeed:0, longestRun:0, runs:0,
        skiTime:0, liftTime:0, n:0, hasAlt:false}};
    d.tracks.push(tr);
    var s = tr.stats;
    d.stats.distance+=s.distance||0; d.stats.duration+=s.duration||0;
    if(s.gain!=null){ d.stats.gain+=s.gain; d.stats.hasAlt=true; }
    if(s.loss!=null) d.stats.loss+=s.loss;
    if((s.topSpeed||0)>d.stats.topSpeed) d.stats.topSpeed=s.topSpeed||0;
    if((s.longestRun||0)>d.stats.longestRun) d.stats.longestRun=s.longestRun||0;
    if(s.runs!=null) d.stats.runs+=s.runs;
    if(s.skiTime!=null) d.stats.skiTime+=s.skiTime;
    if(s.liftTime!=null) d.stats.liftTime+=s.liftTime;
    d.stats.n+=s.n||0;
    days[k]=d;
  });
  var out = Object.keys(days).map(function(k){ return days[k]; });
  out.forEach(function(d){
    if(!d.stats.hasAlt){ d.stats.gain=null; d.stats.loss=null; d.stats.skiTime=null; d.stats.liftTime=null; d.stats.runs=null; }
    d.topTrack = d.tracks.slice().sort(function(a,b){ return (b.stats.topSpeed||0)-(a.stats.topSpeed||0); })[0]||null;
  });
  out.sort(function(a,b){ return a.date<b.date?-1:1; });
  return out.reverse();
}

/* ================= trips (for trip_local_id) ================= */
var KNOWN_TRIPS = [
  {id:'alpe-2027', resort:'alpe-d-huez', name:'Alpe d\u2019Huez — Jan 8–15', start:'2027-01-08', end:'2027-01-15'},
  {id:'laplagne-2027', resort:'la-plagne', name:'La Plagne — Jan 31–Feb 7', start:'2027-01-31', end:'2027-02-07'}
];
function tripsForDay(date, resort){
  var s = readLS('sf-trips', {});
  var all = KNOWN_TRIPS.slice();
  var custom = s.custom||{};
  Object.keys(custom).forEach(function(id){ var c=custom[id];
    if(c && c.startDate) all.push({id:id, resort:c.resort||'', name:(c.he||c.en||id), start:c.startDate, end:c.endDate||c.startDate}); });
  return all.filter(function(tr){ return (!resort||!tr.resort||tr.resort===resort) && tr.start<=date && date<=tr.end; });
}
function tripLocalIdForDay(date, resort){
  var m = tripsForDay(date, resort);
  return m.length ? m[0].id : null;
}

/* ================= opt-in + remote board (landed v1.2) =================
   C2 (independent review, 2026-11-27): the landed SQL has NO
   day_stats table and NO direct share_stats UPDATE — the opt-in is
   trip_members.share_stats, toggled ONLY via ski.set_share_stats
   (SFSync.onLocalShareStats), and the board reads the leaderboard
   RPCs (SFSync.getLeaderboard). My day stats reach the server as my
   synced RECORDINGS (sf-sync.js uploads them with their stats
   columns); the server's daily_stats view aggregates them. There is
   nothing to "upload" here beyond flushing the sync queue. */
function allTripLocalIds(){
  var ids = KNOWN_TRIPS.map(function(tr){ return tr.id; });
  var s = readLS('sf-trips', {});
  var custom = s.custom||{};
  Object.keys(custom).forEach(function(id){ if(ids.indexOf(id)<0) ids.push(id); });
  return ids;
}
function getOptIn(){ var o=readLS(OPTIN_KEY, {}); return {enabled:!!o.enabled, trips:o.trips||{}}; }
function setOptIn(enabled){
  var o=getOptIn(); o.enabled=!!enabled; storeLS(OPTIN_KEY, o);
  // This screen's single toggle maps onto the per-trip share_stats
  // flags (one set_share_stats RPC per trip, via SFSync).
  if(window.SFSync && SFSync.onLocalShareStats){
    allTripLocalIds().forEach(function(id){
      try{ SFSync.onLocalShareStats(id, !!enabled); }catch(e){}
    });
  }
  if(enabled) uploadMyDayStats();
  return o;
}
function supaClient(){
  try{ if(window.SFAuth && SFAuth.getClient) return SFAuth.getClient(); }catch(e){}
  return null;
}
function myUserId(){
  try{ var u=window.SFAuth && SFAuth.getUser && SFAuth.getUser(); return u?u.id:null; }catch(e){ return null; }
}
function myName(){
  try{ var u=window.SFAuth && SFAuth.getUser && SFAuth.getUser(); if(u&&(u.name||u.email)) return u.name||u.email; }catch(e){}
  var me=readLS('sf-me', null)||{}; return me.name||'';
}

/* "Upload" my day stats: flush the sync queue so my recordings (with
   their stats columns) land on the server. The server's daily_stats
   view aggregates them; the board reads them via the leaderboard
   RPCs. Returns a status string: 'ok' | 'no-client' | 'no-table' |
   'off' | 'error' (same contract as before — recap.html renders it). */
function uploadMyDayStats(){
  var opt=getOptIn();
  if(!opt.enabled) return Promise.resolve('off');
  if(!window.SFSync || !SFSync.syncNow || !myUserId()) return Promise.resolve('no-client');
  try{
    var st = SFSync.getStatus ? SFSync.getStatus() : null;
    if(st && st.tablesMissing) return Promise.resolve('no-table');
    if(st && !st.online) return Promise.resolve('error');
  }catch(e){}
  return SFSync.syncNow().then(function(res){
    if(res && res.error){
      var msg=String((res.error&&res.error.message)||'');
      if(/PGRST205|Could not find the table|relation .* does not exist/i.test(msg)) return 'no-table';
      return 'error';
    }
    return 'ok';
  }).catch(function(){ return 'error'; });
}
function deleteMySharedStats(){
  // Revoking my shared stats = turning share_stats OFF on every trip
  // (set_share_stats RPC via SFSync). There is no day_stats table to
  // delete from.
  if(!window.SFSync || !SFSync.onLocalShareStats || !myUserId()) return Promise.resolve(false);
  var chain = Promise.resolve();
  allTripLocalIds().forEach(function(id){
    chain = chain.then(function(){ return SFSync.onLocalShareStats(id, false); });
  });
  return chain.then(function(){ return true; }).catch(function(){ return false; });
}
/* Read the board for one trip (or all my trips when tripLocalId null).
   One leaderboard_daily RPC per local ski day in the scope; rows are
   normalised to the old day_stats shape so buildBoard and recap.html
   need no changes. Only sharers are ever returned (the RPC enforces
   share_stats) — non-sharers are invisible by query, not by UI
   filtering. My own rows are skipped here (they come from local
   tracks in buildBoard). */
function fetchBoardRows(tripLocalId){
  if(!window.SFSync || !SFSync.getLeaderboard) return Promise.resolve({status:'no-client', rows:[]});
  if(!myUserId()) return Promise.resolve({status:'no-client', rows:[]});
  return loadTracks().then(function(tracks){
    var days = groupDays(tracks);
    var chain = Promise.resolve(), rows = [], status = 'ok';
    days.forEach(function(d){
      var dayTrip = tripLocalIdForDay(d.date, d.resort);
      if(tripLocalId && dayTrip!==tripLocalId) return;
      if(!dayTrip) return; // day outside any trip: no board for it
      chain = chain.then(function(){
        return SFSync.getLeaderboard(dayTrip, d.date).then(function(lb){
          if(!lb.available){
            if(lb.reason==='functions-missing') status = 'no-table';
            else if(lb.reason==='signed-out') status = 'no-client';
            else if(lb.reason==='not-synced') { /* trip never synced: no remote rows, not an error */ }
            else status = 'error';
            return;
          }
          (lb.daily||[]).forEach(function(r){
            if(r.is_me) return;
            rows.push({ user_id:r.user_id, display_name:r.display_name||'',
              trip_local_id:dayTrip, resort:d.resort||null, day:d.date,
              distance_m:r.total_distance_m||0, duration_s:r.total_duration_s||0,
              vertical_gain_m:r.total_vertical_gain_m||0,
              top_speed_ms:r.max_top_speed_ms||0, longest_run_m:r.longest_run_m||0,
              run_count:(r.total_runs==null?null:r.total_runs),
              ski_time_s:(r.total_ski_time_s==null?null:r.total_ski_time_s),
              lift_time_s:(r.total_lift_time_s==null?null:r.total_lift_time_s),
              shared:true });
          });
        }).catch(function(){ status='error'; });
      });
    });
    return chain.then(function(){ return {status:status, rows:rows}; });
  }).catch(function(){ return {status:'error', rows:[]}; });
}

/* ================= leaderboard math =================
   Categories: distance, vertical (gain), topSpeed, longestRun, runs.
   Daily: winner per category per day. Cumulative: per vacation —
   distance/vertical/duration/runs summed, topSpeed/longestRun maxed. */
var CATS = [
  {key:'distance', label:function(){ return t('rec.distance'); }, val:function(s){ return s.distance_m!=null?s.distance_m:s.distance||0; }, fmt:function(v){ return fmtDist(v); }},
  {key:'vertical', label:function(){ return t('rec.vertical'); }, val:function(s){ return s.vertical_gain_m!=null?s.vertical_gain_m:(s.gain==null?0:s.gain); }, fmt:function(v){ return Math.round(v)+' '+t('rec.m'); }},
  {key:'topSpeed', label:function(){ return t('rec.topSpeed'); }, val:function(s){ return s.top_speed_ms!=null?s.top_speed_ms:(s.topSpeed||0); }, fmt:function(v){ return (v*3.6).toFixed(0)+' '+t('rec.kmh'); }},
  {key:'longestRun', label:function(){ return t('rec.longestRun'); }, val:function(s){ return s.longest_run_m!=null?s.longest_run_m:(s.longestRun||0); }, fmt:function(v){ return fmtDist(v); }},
  {key:'runs', label:function(){ return t('rec.runs'); }, val:function(s){ return s.run_count!=null?s.run_count:(s.runs==null?0:s.runs); }, fmt:function(v){ return String(v); }}
];
function boardEntry(name, isMe, stats, extra){
  return {name:name, isMe:!!isMe, stats:stats, extra:extra||{}};
}
/* Build the board for one scope: myDays (local day objects) + remoteRows
   (leaderboard RPC rows, sharers only). Scope key: tripLocalId or vacation id. */
function buildBoard(myDays, remoteRows, meName){
  var byDay = {};
  function add(day, entry){
    (byDay[day]=byDay[day]||[]).push(entry);
  }
  myDays.forEach(function(d){
    add(d.date, boardEntry(meName||t('rec.me'), true, d.stats, {dayObj:d, mine:true}));
  });
  remoteRows.forEach(function(r){
    var uid = r.user_id;
    var isMe = uid && uid===myUserId();
    if(isMe) return; /* my own rows are already in from local tracks */
    add(r.day, boardEntry(r.display_name||'', false, r, {remote:true}));
  });
  var days = Object.keys(byDay).sort().reverse();
  var daily = days.map(function(day){
    var winners = {};
    CATS.forEach(function(c){
      var best=null, bestV=-1;
      byDay[day].forEach(function(e){
        var v=c.val(e.stats);
        if(v>bestV){ bestV=v; best=e; }
      });
      if(best && bestV>0) winners[c.key]={entry:best, value:bestV};
    });
    return {day:day, entries:byDay[day], winners:winners};
  });
  /* Cumulative across the scope. */
  var cum = {};
  function cumKey(e){ return (e.isMe?'me':('u:'+(e.stats.user_id||e.name))); }
  days.forEach(function(day){
    byDay[day].forEach(function(e){
      var k=cumKey(e);
      var c=cum[k] || (cum[k]={name:e.name, isMe:e.isMe,
        distance:0, vertical:0, duration:0, runs:0, topSpeed:0, longestRun:0, days:0});
      c.days++;
      c.distance+=CATS[0].val(e.stats); c.vertical+=CATS[1].val(e.stats);
      c.duration+= (e.stats.duration_s!=null?e.stats.duration_s:(e.stats.duration||0));
      c.runs+=CATS[4].val(e.stats);
      c.topSpeed=Math.max(c.topSpeed, CATS[2].val(e.stats));
      c.longestRun=Math.max(c.longestRun, CATS[3].val(e.stats));
    });
  });
  var cumList = Object.keys(cum).map(function(k){ return cum[k]; });
  return {daily:daily, cumulative:cumList, participants:Object.keys(cum).length};
}

/* ================= rendering (recap.html containers) ================= */
function statGrid(s){
  function cell(label, value){ return '<div class="sfme-stat"><small>'+esc(label)+'</small><b>'+esc(value)+'</b></div>'; }
  var h='<div class="sfme-grid">';
  h+=cell(t('rec.distance'), fmtDist(s.distance||0));
  h+=cell(t('rec.vertical'), s.gain==null?'—':Math.round(s.gain)+' '+t('rec.m'));
  h+=cell(t('rec.topSpeed'), (s.topSpeed||s.top_speed_ms)?(((s.topSpeed||s.top_speed_ms)*3.6).toFixed(0)+' '+t('rec.kmh')):'—');
  h+=cell(t('rec.longestRun'), fmtDist(s.longestRun||s.longest_run_m||0));
  h+=cell(t('rec.runs'), (s.runs==null&&(s.run_count==null))?'—':String(s.runs!=null?s.runs:s.run_count));
  h+=cell(t('rec.skiTime'), s.skiTime==null?'—':fmtDur(s.skiTime));
  h+=cell(t('rec.liftTime'), s.liftTime==null?'—':fmtDur(s.liftTime));
  h+=cell(t('rec.duration'), fmtDur(s.duration||s.duration_s||0));
  h+='</div>';
  if(s.skiTime==null && s.gain==null) h+='<p class="sfme-note">'+esc(t('rec.noAlt'))+'</p>';
  return h;
}
function dayCard(d, opts){
  opts=opts||{};
  var h='<div class="sfme-card" data-day="'+esc(d.date)+'">';
  h+='<h2>'+esc(d.date)+' · '+esc(d.resort||'')+'</h2>';
  h+=statGrid(d.stats);
  h+='<div class="sfme-row">'
    +'<button class="sfme-btn" data-act="detail" data-day="'+esc(d.date)+'">'+esc(t('rec.showDetail'))+'</button>'
    +'<button class="sfme-btn" data-act="share-day" data-day="'+esc(d.date)+'">↗️ Share</button>'
    +'<button class="sfme-btn" data-act="card-day" data-day="'+esc(d.date)+'">🖼️ PNG</button>'
    +'</div><div class="sfme-detail" data-detail="'+esc(d.date)+'" hidden></div></div>';
  return h;
}
function detailHtml(d){
  var s=d.stats, h='';
  var top = null;
  d.tracks.forEach(function(tr){ var p=tr.stats&&tr.stats.topSpeedPoint;
    if(p && (!top || p.speed>top.speed)) top=p; });
  if(top){
    h+='<p class="sfme-muted">'+esc(t('rec.topSpeedAt',{time:fmtClock(top.t), speed:(top.speed*3.6).toFixed(0)}))+'</p>';
    h+='<p class="sfme-muted">'+esc(t('rec.topSpeedPoint',{lat:top.lat.toFixed(5), lon:top.lon.toFixed(5), alt:(top.alt!=null?Math.round(top.alt):'—')}))+'</p>';
  }
  h+='<p class="sfme-muted">'+esc(d.tracks.length)+' track(s) · '+esc(fmtDur(s.duration||0))+'</p>';
  h+='<div class="sfme-row"><button class="sfme-btn" data-act="gpx-day" data-day="'+esc(d.date)+'">'+esc(t('rec.gpx'))+'</button></div>';
  return h;
}
function gpxForDay(d){
  var s='<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="SnowForecast">\n';
  d.tracks.forEach(function(tr){
    s+='<trk><name>'+esc(tr.id)+'</name><trkseg>\n';
    (tr.points||[]).forEach(function(p){
      s+='<trkpt lat="'+p.lat+'" lon="'+p.lon+'">'+(p.alt!=null?'<ele>'+Math.round(p.alt)+'</ele>':'')+'<time>'+new Date(p.t).toISOString()+'</time></trkpt>\n';
    });
    s+='</trkseg></trk>\n';
  });
  return s+'</gpx>';
}
function download(name, text, mime){
  var b=new Blob([text], {type:mime||'application/gpx+xml'});
  var a=document.createElement('a'); a.href=URL.createObjectURL(b); a.download=name;
  document.body.appendChild(a); a.click(); setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

window.SFRecap = {
  t:t, esc:esc, fmtDist:fmtDist, fmtDur:fmtDur, fmtClock:fmtClock,
  computeDayStats:computeDayStats, loadTracks:loadTracks, groupDays:groupDays,
  getOptIn:getOptIn, setOptIn:setOptIn, uploadMyDayStats:uploadMyDayStats,
  deleteMySharedStats:deleteMySharedStats, fetchBoardRows:fetchBoardRows,
  buildBoard:buildBoard, CATS:CATS, statGrid:statGrid, dayCard:dayCard,
  detailHtml:detailHtml, gpxForDay:gpxForDay, download:download,
  tripLocalIdForDay:tripLocalIdForDay, myName:myName, myUserId:myUserId
};
})();
