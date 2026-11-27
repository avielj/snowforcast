/* sf-stats.js — SnowForecast ski stats + vacation grouping (Slopes-style).
   Pure computation over Record tracks (REAL GPS only — never demo or
   fake data). No network and no Supabase calls here: this file computes
   from tracks; sf-sync.js uploads the results and reads the server's
   authoritative aggregates (daily_stats / vacation_stats views).
   Works standalone — no map globals, no SF dependency.
   DISPLAY CONTRACT: stats are shown on a SEPARATE recap screen (part of
   the unified site), never on the map. The recap screen reads vacations
   via SFSync.getVacationsForRecap() (server views when online, this
   file's local grouping when offline); the unified-site coordinator owns
   that screen — this file is only the computation + grouping layer.

   GROUPING RULE (matches ski-stats-vacations.sql v1.2 exactly):
     - A ski day is the CALENDAR DATE of a recording's started_at in
       Europe/Paris (the resort timezone), not the device timezone.
       A recording starting 23:30 Paris time counts on its START day.
     - Days group per (owner, resort): a maximal run of CONSECUTIVE
       calendar dates at ONE resort is one vacation; a gap of >= 1 day
       opens a new one. A later recording bridging a gap MERGES
       vacations — server-side (the §2 trigger); the local grouping
       here is a preview and re-groups the same way when it re-runs.
     - The SERVER is authoritative for vacations: the trigger creates
       them from real recordings (named e.g. 'La Plagne · Jan 2027').
       Local vacation ids here are preview keys
       ('vac-<resort>-<first-day>'), NOT server ids — the server id
       comes from the vacations list (SFSync), and renames go by it.
   DEFINITIONS (same everywhere — app, sync, leaderboard):
     - A "run" (runCount) is one DESCENT: a continuous-movement
       segment whose net altitude change is <= -20 m. A new segment
       starts after a stop (>=60 s with speed < 0.5 m/s) or a gap
       > 180 s — the same rule map-shared.js uses for longestRun.
       Lift rides are segments too, but they are NOT runs (they climb).
       runCount is NULL when the track has no altitude data (a descent
       cannot be identified without it) — never 0 by default.
     - longestRun is the longest DESCENT segment when altitude data
       exists; without altitude it falls back to the longest
       continuous-movement segment (the honest proxy — direction
       unknown).
     - skiTimeS vs liftTimeS: per point pair with altitude, a drop of
       >= 2 m counts as skiing (descending), a rise of >= 2 m as lift
       (ascending). Estimates from GPS altitude; null when the track
       has no altitude data at all. ski + lift <= duration always
       (the server enforces it as a CHECK).
   PRIVACY: everything here is the user's own data. Cross-user
   visibility (leaderboard) is a separate, opt-in layer (share_stats)
   in sf-sync.js — nothing in this file shares anything. */
(function(){
'use strict';

var NAMES_KEY = 'sf-vacation-names';
var RESORT_NAMES = { 'alpe-d-huez':"Alpe d'Huez", 'la-plagne':'La Plagne', 'val-thorens':'Val Thorens' };
var MONTHS_EN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

/* ================= helpers ================= */
var parisFmt = null;
try{
  parisFmt = new Intl.DateTimeFormat('en-CA', { timeZone:'Europe/Paris', year:'numeric', month:'2-digit', day:'2-digit' });
}catch(e){ parisFmt = null; }
function dayKey(ts){
  // Calendar date of ts in Europe/Paris (the grouping rule). Falls back
  // to the device-local date only when Intl/timeZone is unavailable.
  try{
    if(parisFmt) return parisFmt.format(new Date(ts)); // 'YYYY-MM-DD' (en-CA)
  }catch(e){}
  try{
    var d = new Date(ts);
    return d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2);
  }catch(err){ return ''; }
}
function dayNum(dayStr){ // days since epoch (UTC) for gap arithmetic
  var p = String(dayStr||'').split('-');
  if(p.length!==3) return NaN;
  return Math.floor(Date.UTC(+p[0], +p[1]-1, +p[2]) / 86400000);
}
function haversineM(a, b){
  var R=6371000, toR=function(x){ return x*Math.PI/180; };
  var dLa=toR(b[0]-a[0]), dLo=toR(b[1]-a[1]);
  var h=Math.sin(dLa/2)*Math.sin(dLa/2)+Math.cos(toR(a[0]))*Math.cos(toR(b[0]))*Math.sin(dLo/2)*Math.sin(dLo/2);
  return 2*R*Math.asin(Math.sqrt(h));
}
function readLS(k, def){ try{ var v=localStorage.getItem(k); return v==null?def:JSON.parse(v); }catch(e){ return def; } }
function storeLS(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }

/* ================= per-track stats =================
   Mirrors map-shared.js Rec.computeStats (distance, gain/loss, top
   speed) and adds runCount + ski/lift split + descent-aware longest
   run. A "run" is a descent (see header); lift segments do not count. */
function computeTrackStats(points, startTs, endTs){
  var st = { distance:0, duration:Math.max(0, ((endTs||0)-(startTs||0))/1000),
    gain:0, loss:0, topSpeed:0, longestRun:0, runCount:null,
    skiTimeS:null, liftTimeS:null, n:(points||[]).length };
  var pts = points||[];
  if(pts.length<2){ return st; }
  var hasAlt = pts.some(function(p){ return p.alt!=null; });
  var skiT=0, liftT=0;
  var segDist=0, segAltStart=null, segAltEnd=null, runs=0, longestDesc=0, longestSeg=0;
  function closeSegment(){
    if(segDist>longestSeg) longestSeg = segDist;
    if(segAltStart!=null && segAltEnd!=null && (segAltEnd-segAltStart)<=-20){
      runs++;
      if(segDist>longestDesc) longestDesc = segDist;
    }
    segDist=0; segAltStart=null; segAltEnd=null;
  }
  for(var i=1;i<pts.length;i++){
    var a=pts[i-1], b=pts[i];
    var d = haversineM([a.lat,a.lon],[b.lat,b.lon]);
    var dt = Math.max(0, ((b.t||0)-(a.t||0))/1000);
    st.distance += d;
    var spd = (b.spd!=null?b.spd:(dt>0?d/dt:0));
    if(spd>st.topSpeed) st.topSpeed = spd;
    if(hasAlt && a.alt!=null && b.alt!=null){
      var dh = b.alt-a.alt;
      if(dh>0) st.gain+=dh; else st.loss-=dh;
      if(dh<=-2) skiT+=dt; else if(dh>=2) liftT+=dt;
    }
    var stopped = (spd<0.5 && dt>=60) || dt>180;
    if(stopped){
      closeSegment();
    } else {
      if(segAltStart==null && a.alt!=null) segAltStart=a.alt;
      if(b.alt!=null) segAltEnd=b.alt;
      segDist += d;
    }
  }
  closeSegment();
  if(hasAlt){ st.runCount=runs; st.longestRun=longestDesc; st.skiTimeS=skiT; st.liftTimeS=liftT; }
  else { st.gain=null; st.loss=null; st.longestRun=longestSeg; }
  return st;
}

/* ================= per-day stats (per resort + day) ================= */
function computeDayStats(tracks){
  var byKey = {};
  (tracks||[]).forEach(function(tr){
    if(!tr || !tr.startTs) return;
    var resort = tr.resort||'';
    var day = dayKey(tr.startTs);
    var key = resort+'|'+day;
    var st = (tr.stats && typeof tr.stats.distance==='number')
      ? tr.stats
      : computeTrackStats(tr.points||[], tr.startTs, tr.endTs);
    // fill run/ski-lift numbers when the stored stats predate them —
    // only when raw points exist to recompute from (server-mirrored
    // tracks carry stats columns but no points; never zero them out).
    if((st.runCount==null || st.skiTimeS===undefined) && (tr.points||[]).length>=2){
      var full = computeTrackStats(tr.points||[], tr.startTs, tr.endTs);
      st = { distance:st.distance, duration:st.duration, gain:st.gain, loss:st.loss,
        topSpeed:st.topSpeed, longestRun:(full.longestRun!=null?full.longestRun:st.longestRun),
        runCount:full.runCount, skiTimeS:full.skiTimeS, liftTimeS:full.liftTimeS };
    }
    var d = byKey[key];
    if(!d){ d = byKey[key] = { resort:resort, day:day, distance:0, gain:0, loss:0, topSpeed:0,
      longestRun:0, runCount:0, skiTimeS:0, liftTimeS:0, durationS:0,
      trackCount:0, hasAlt:false, hasRunCount:false }; }
    d.distance += (st.distance||0);
    if(st.gain!=null){ d.gain += st.gain; d.hasAlt=true; }
    if(st.loss!=null){ d.loss += st.loss; d.hasAlt=true; }
    if((st.topSpeed||0)>d.topSpeed) d.topSpeed = st.topSpeed||0;
    if((st.longestRun||0)>d.longestRun) d.longestRun = st.longestRun||0;
    if(st.runCount!=null){ d.runCount += st.runCount; d.hasRunCount=true; }
    if(st.skiTimeS!=null) d.skiTimeS += st.skiTimeS;
    if(st.liftTimeS!=null) d.liftTimeS += st.liftTimeS;
    d.durationS += (st.duration||0);
    d.trackCount++;
  });
  var days = Object.keys(byKey).sort().map(function(k){
    var d = byKey[k];
    if(!d.hasAlt){ d.gain=null; d.loss=null; d.skiTimeS=null; d.liftTimeS=null; }
    if(!d.hasRunCount) d.runCount=null;
    delete d.hasAlt; delete d.hasRunCount;
    return d;
  });
  return days;
}

/* ================= vacation grouping (per resort) ================= */
function groupVacations(dayStats){
  var days = (dayStats||[]).slice().sort(function(a,b){
    if(a.resort!==b.resort) return a.resort<b.resort?-1:1;
    return a.day<b.day?-1:(a.day>b.day?1:0);
  });
  var vacs = [];
  var cur = null;
  days.forEach(function(d){
    if(!cur || cur.resort!==d.resort){ cur = { resort:d.resort, startDay:d.day, endDay:d.day, days:[d.day] }; vacs.push(cur); return; }
    var gap = dayNum(d.day) - dayNum(cur.endDay);
    if(gap===1){ cur.endDay=d.day; cur.days.push(d.day); }
    else { cur = { resort:d.resort, startDay:d.day, endDay:d.day, days:[d.day] }; vacs.push(cur); }
  });
  return vacs.map(function(v){
    return { id:'vac-'+v.resort+'-'+v.startDay, resort:v.resort, startDay:v.startDay, endDay:v.endDay, days:v.days.slice() };
  });
}
function defaultVacationName(vac){
  // Same shape as the server trigger: '<Resort> · Mon YYYY'.
  var resort = RESORT_NAMES[vac.resort] || vac.resort || '';
  try{
    var p = vac.startDay.split('-');
    var mon = MONTHS_EN[+p[1]-1] || '';
    return (resort?resort+' · ':'') + mon + ' ' + p[0];
  }catch(e){ return resort; }
}
function getVacationNames(){ return readLS(NAMES_KEY, {})||{}; }
function vacationName(vac){
  var names = getVacationNames();
  return (names[vac.id] && names[vac.id].trim()) ? names[vac.id].trim() : defaultVacationName(vac);
}
function renameVacation(vacId, name){
  var names = getVacationNames();
  name = String(name||'').trim().slice(0,80);
  if(!name) delete names[vacId]; else names[vacId]=name;
  storeLS(NAMES_KEY, names);
  var parts = String(vacId||'').replace(/^vac-/, '').split('-');
  var resort = parts.length>3 ? parts.slice(0, -3).join('-') : '';
  var startDay = parts.slice(-3).join('-');
  return vacationName({id:vacId, resort:resort, startDay:startDay, endDay:startDay});
}
function aggregateVacation(vac, dayStatsByDay){
  var tot = { distance:0, gain:0, loss:0, topSpeed:0, longestRun:0, runCount:0,
    skiTimeS:0, liftTimeS:0, durationS:0, days:vac.days.length, trackCount:0, hasAlt:false, hasRunCount:false };
  vac.days.forEach(function(day){
    var d = dayStatsByDay[day]; if(!d) return;
    tot.distance += (d.distance||0);
    if(d.gain!=null){ tot.gain += d.gain; tot.hasAlt=true; }
    if(d.loss!=null){ tot.loss += d.loss; tot.hasAlt=true; }
    if((d.topSpeed||0)>tot.topSpeed) tot.topSpeed = d.topSpeed||0;
    if((d.longestRun||0)>tot.longestRun) tot.longestRun = d.longestRun||0;
    if(d.runCount!=null){ tot.runCount += d.runCount; tot.hasRunCount=true; }
    if(d.skiTimeS!=null) tot.skiTimeS += d.skiTimeS;
    if(d.liftTimeS!=null) tot.liftTimeS += d.liftTimeS;
    tot.durationS += (d.durationS||0);
    tot.trackCount += (d.trackCount||0);
  });
  if(!tot.hasAlt){ tot.gain=null; tot.loss=null; tot.skiTimeS=null; tot.liftTimeS=null; }
  if(!tot.hasRunCount) tot.runCount=null;
  delete tot.hasAlt; delete tot.hasRunCount;
  return tot;
}
function getVacations(tracks){
  var dayStats = computeDayStats(tracks);
  var byResortDay = {};
  dayStats.forEach(function(d){ byResortDay[d.resort+'|'+d.day]=d; });
  return groupVacations(dayStats).map(function(v){
    var byDay = {};
    v.days.forEach(function(day){ byDay[day]=byResortDay[v.resort+'|'+day]; });
    return { id:v.id, resort:v.resort, name:vacationName(v), startDay:v.startDay, endDay:v.endDay,
      days:v.days, totals:aggregateVacation(v, byDay), dayStats: v.days.map(function(d){ return byDay[d]; }) };
  });
}
function vacationIdForDate(ts, resort){
  // Provisional LOCAL key for a single day (preview/rename storage).
  // The server vacation id is different — read it from the vacations
  // list (SFSync). Never send this key to the server.
  return 'vac-'+(resort||'')+'-'+dayKey(ts);
}

window.SFStats = {
  dayKey:dayKey, computeTrackStats:computeTrackStats,
  computeDayStats:computeDayStats, groupVacations:groupVacations,
  aggregateVacation:aggregateVacation, getVacations:getVacations,
  vacationName:vacationName, renameVacation:renameVacation,
  vacationIdForDate:vacationIdForDate, defaultVacationName:defaultVacationName
};
})();
