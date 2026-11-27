/* sf-vacations.js — vacation grouping for SnowForecast recaps.
   THIN ADAPTER over guides/sf-stats.js (SFStats): grouping, totals and
   the canonical definitions live there ("same everywhere — app, sync,
   leaderboard"). This file only ADDS what the recap screen needs:
   - the SERVER vacation uuid (SFSync.getVacationId, by resort + start
     date) so rename / share / board calls can use the server id;
   - trip-name override: a vacation that falls inside a known trip
     (built-in Alpe d'Huez 8–15 Jan 2027 / La Plagne 31 Jan–7 Feb 2027 —
     Aviel's real trips — plus custom trips from localStorage
     'sf-trips'.custom) takes the TRIP name, because the trip name is
     the shared name (trips already sync via sf-sync.js);
   - mapping SFStats totals ({skiTimeS, liftTimeS, runCount, durationS})
     to the recap screen's field names ({skiTime, liftTime, runs,
     duration}), and attaching the screen's per-day objects (with
     tracks, for detail/GPX) to each vacation.
   Rule: consecutive ski days form ONE vacation; a break of one day or
   more opens a new vacation. Vacation id: 'vac-<resort>-<first-day>'
   (SFStats local preview key — NOT a server id; the server uuid is
   attached as `serverId` when the vacation is synced). Names: (1)
   custom name in localStorage 'sf-vacation-names' (same key SFStats
   uses); (2) trip name; (3) SFStats' generated date-range name,
   prefixed with the resort. Never a fake trip name.
   Naming sync (C2/C3): setName queues a SERVER rename
   (SFSync.renameVacation, by server uuid) when the vacation is
   synced, and keeps the localStorage name as the offline display
   fallback; the server list is authoritative when present. The
   landed schema DOES have a ski.vacations table (v1.2) — the earlier
   "no vacations table" note referred to the superseded proposal.
   Fallback: when SFStats is absent, grouping/totals are computed here
   with the same rule (per-resort, Europe/Paris days via SFStats.dayKey
   when available). */
(function(){
'use strict';

var NAMES_KEY = 'sf-vacation-names';
var TRIPS_KEY = 'sf-trips';

var RESORT_NAMES = {'val-thorens':'Val Thorens', 'la-plagne':'La Plagne', 'alpe-d-huez':"Alpe d'Huez"};

/* Built-in trips (Aviel's real trips, dates verified in the trip record):
   Alpe d'Huez family week 8–15 Jan 2027; La Plagne crew week 31 Jan–7 Feb 2027. */
var KNOWN_TRIPS = [
  {id:'alpe-2027', resort:'alpe-d-huez', name:'Alpe d\u2019Huez — Jan 8–15', start:'2027-01-08', end:'2027-01-15'},
  {id:'laplagne-2027', resort:'la-plagne', name:'La Plagne — Jan 31–Feb 7', start:'2027-01-31', end:'2027-02-07'}
];

function readLS(k, def){ try{ var v=localStorage.getItem(k); return v==null?def:JSON.parse(v); }catch(e){ return def; } }
function storeLS(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }
function dayKey(ts){ var d=new Date(ts); return d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2); }
function parseDay(k){ var p=k.split('-'); return new Date(+p[0], +p[1]-1, +p[2]); }
function addDays(d, n){ var c=new Date(d); c.setDate(c.getDate()+n); return c; }
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }

/* Group sorted day-keys into runs of consecutive calendar days (fallback path). */
function groupDays(dayKeys){
  var sorted = dayKeys.slice().sort();
  var groups = [];
  sorted.forEach(function(k){
    var d = parseDay(k);
    var last = groups[groups.length-1];
    if(last && addDays(parseDay(last[last.length-1]), 1).getTime()===d.getTime()) last.push(k);
    else groups.push([k]);
  });
  return groups;
}

function customTrips(){
  var s = readLS(TRIPS_KEY, {});
  var out = [];
  var custom = s.custom || {};
  Object.keys(custom).forEach(function(id){
    var c = custom[id];
    if(c && c.startDate) out.push({id:id, resort:c.resort||'', name:(c.he||c.en||c.name||id), start:c.startDate, end:c.endDate||c.startDate});
  });
  return out;
}
function tripForVacation(firstDay, lastDay, resort){
  var trips = KNOWN_TRIPS.concat(customTrips());
  for(var i=0;i<trips.length;i++){
    var tr = trips[i];
    if(resort && tr.resort && tr.resort!==resort) continue;
    if(tr.start<=firstDay && lastDay<=tr.end) return tr;
  }
  return null;
}
function fmtRange(a, b, lang){
  var opts = {day:'numeric', month:'short'};
  var loc = lang==='en' ? 'en-GB' : 'he-IL';
  try{
    var A = parseDay(a).toLocaleDateString(loc, opts), B = parseDay(b).toLocaleDateString(loc, opts);
    var y = parseDay(b).getFullYear();
    return A + '–' + B + ' ' + y;
  }catch(e){ return a + ' – ' + b; }
}
function mapTotals(t){
  t = t||{};
  return {distance:t.distance||0, gain:(t.gain==null?null:t.gain), loss:(t.loss==null?null:t.loss),
    skiTime:(t.skiTimeS==null?(t.skiTime==null?null:t.skiTime):t.skiTimeS),
    liftTime:(t.liftTimeS==null?(t.liftTime==null?null:t.liftTime):t.liftTimeS),
    duration:(t.durationS!=null?t.durationS:(t.duration||0)),
    topSpeed:t.topSpeed||0, longestRun:t.longestRun||0,
    runs:(t.runCount!=null?t.runCount:(t.runs||0)), days:t.days||0, points:t.points||0};
}

/* Build vacations. Signature: buildVacations(tracks, myDays, lang) where
   myDays are the recap screen's per-day objects {date, resort, tracks,
   stats} (from SFRecap.groupDays). Returns, newest first:
   [{id, serverId, startDate, endDate, resort, resortName, days:[myDayObjs],
     dayKeys:[date strings], name, customName, trip, totals}] */
function buildVacations(tracks, myDays, lang){
  myDays = myDays||[];
  var names = readLS(NAMES_KEY, {});
  var out = [];
  if(window.SFStats && SFStats.getVacations){
    SFStats.getVacations(tracks||[]).forEach(function(v){
      // M2: match days by date AND resort — SFStats groups per resort,
      // so a same-date day at another resort is a different vacation.
      var gdays = myDays.filter(function(d){ return v.days.indexOf(d.date)>=0
        && (!v.resort || !d.resort || d.resort===v.resort); });
      var resort = v.resort || '';
      if(!resort) gdays.forEach(function(d){ if(!resort && d.resort) resort=d.resort; });
      var trip = tripForVacation(v.startDay, v.endDay, resort);
      var customName = names[v.id] || '';
      var resortName = RESORT_NAMES[resort] || resort || '';
      var baseName = customName || v.name || '';
      var name = customName || (trip ? trip.name
        : (resortName ? resortName+' · '+baseName : baseName));
      // Server uuid when this vacation is synced (null offline / not
      // synced yet) — rename/share/board use serverId, never the
      // local preview key.
      var serverId = null;
      try{ if(window.SFSync && SFSync.getVacationId) serverId = SFSync.getVacationId(resort, v.startDay); }catch(e){}
      var totals = mapTotals(v.totals||{});
      totals.days = v.days.length;
      out.push({id:v.id, serverId:serverId, startDate:v.startDay, endDate:v.endDay, resort:resort,
        resortName:resortName, days:gdays, dayKeys:v.days.slice(),
        name:name, customName:customName, trip:trip?trip.id:null, totals:totals});
    });
    out.sort(function(a,b){ return a.startDate<b.startDate?-1:1; });
    return out.reverse();
  }
  /* Fallback (SFStats absent): same grouping rule, computed here. */
  var byResort = {};
  myDays.forEach(function(d){ (byResort[d.resort||''] = byResort[d.resort||''] || []).push(d); });
  Object.keys(byResort).forEach(function(resort){
    var ds = byResort[resort].slice().sort(function(a,b){ return a.date<b.date?-1:1; });
    groupDays(ds.map(function(d){ return d.date; })).forEach(function(g){
      var gdays = ds.filter(function(d){ return g.indexOf(d.date)>=0; });
      var id = 'vac-' + (resort?resort+'-':'') + g[0];
      var trip = tripForVacation(g[0], g[g.length-1], resort);
      var totals = {distance:0, gain:0, loss:0, skiTime:0, liftTime:0, duration:0,
        topSpeed:0, longestRun:0, runs:0, days:gdays.length, points:0};
      gdays.forEach(function(d){
        var s = d.stats||{};
        totals.distance += s.distance||0;
        if(s.gain!=null) totals.gain += s.gain;
        if(s.loss!=null) totals.loss += s.loss;
        if(s.skiTime!=null) totals.skiTime += s.skiTime;
        if(s.liftTime!=null) totals.liftTime += s.liftTime;
        totals.duration += s.duration||0; totals.runs += s.runs||0; totals.points += s.n||0;
        if((s.topSpeed||0)>totals.topSpeed) totals.topSpeed=s.topSpeed||0;
        if((s.longestRun||0)>totals.longestRun) totals.longestRun=s.longestRun||0;
      });
      if(!gdays.some(function(d){ return d.stats && d.stats.gain!=null; })){ totals.gain=null; totals.loss=null; totals.skiTime=null; totals.liftTime=null; }
      var customName = names[id] || '';
      var resortName = RESORT_NAMES[resort] || resort || '';
      var name = customName || (trip ? trip.name : (resortName ? resortName+' · '+fmtRange(g[0], g[g.length-1], lang) : fmtRange(g[0], g[g.length-1], lang)));
      var serverId = null;
      try{ if(window.SFSync && SFSync.getVacationId) serverId = SFSync.getVacationId(resort, g[0]); }catch(e){}
      out.push({id:id, serverId:serverId, startDate:g[0], endDate:g[g.length-1], resort:resort, resortName:resortName,
        days:gdays, dayKeys:g.slice(), name:name, customName:customName, trip:trip?trip.id:null, totals:totals});
    });
  });
  out.sort(function(a,b){ return a.startDate<b.startDate?-1:1; });
  return out.reverse();
}

function setName(vacId, name){
  name = String(name||'').trim().slice(0,60);
  // Server rename when the vacation is synced: resolve the server
  // uuid from the local preview key ('vac-<resort>-<start>') and queue
  // the rename (SFSync.renameVacation). The local name is kept too:
  // immediate display + offline fallback.
  try{
    if(window.SFSync && SFSync.getVacationId && SFSync.renameVacation){
      var m = String(vacId||'').match(/^vac-(.+)-(\d{4}-\d{2}-\d{2})$/);
      if(m){
        var sid = SFSync.getVacationId(m[1], m[2]);
        if(sid) SFSync.renameVacation(sid, name);
      }
    }
  }catch(e){}
  if(window.SFStats && SFStats.renameVacation){ SFStats.renameVacation(vacId, name); return; }
  var names = readLS(NAMES_KEY, {});
  if(name) names[vacId]=name; else delete names[vacId];
  storeLS(NAMES_KEY, names);
}
function getName(vacId){ return readLS(NAMES_KEY, {})[vacId] || ''; }

window.SFVacations = { buildVacations:buildVacations, groupDays:groupDays,
  setName:setName, getName:getName, dayKey:dayKey, esc:esc };
})();
