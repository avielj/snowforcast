/* sf-hub.js — per-resort hub weather layer for the map pages.
   One shared file for all three maps (val-thorens / la-plagne / alpe-d-huez).
   - Adds a weather chip to the map page's #statusRow: 7-day snow total from
     /api/forecast (mid elevation by default). Hidden if the fetch fails —
     never an invented number.
   - Tapping the chip opens a new sheet pane `pane-weather`, created here
     (the pane DOM did not exist before). It uses the existing openSheet()
     from map-shared.js: openSheet() toggles panes by id 'pane-'+pane, so an
     arbitrary pane id works as long as the pane element exists inside
     #sheet (verified in map-shared.js: panes are matched by id, no
     allow-list). The pane's ✕ button is bound here, because map-shared.js
     binds .x buttons once at init — before this pane exists.
   - The pane shows a 7-day table from the REAL /api/forecast response
     (elevation selector bot/mid/top; per-day snow/rain/wind/temp computed
     from the payload exactly like app.py does: snow = average_snow if
     present else sum of period snow; rain = sum of period rain; wind =
     max period wind; temp = min–max of period temperatures), plus links
     to the full forecast (/forecast.html) and the resort guide.
   - Resort slug is derived from the page (SF.getCfg().slug, else the
     filename map-<slug>.html). API resort keys are Capitalised
     (Val-Thorens / La-Plagne / Alpe-d-Huez).
   - Also wires the route-card share button (#rcShareBtn, inserted by
     apply-unified-integration.py) and the Settings "Friends & recap" link
     (injected here at runtime — no map HTML edit needed for the link):
     both lazy-load guides/sf-share.js on first use.
   - The weather pane never floats over the map: it lives inside the
     existing bottom sheet, like every other pane.
   Depends on: map-shared.js (window.SF: openSheet/closeSheet/toast),
   nothing else. Safe no-op when #statusRow / #sheet are absent. */
(function(){
'use strict';

var API_SLUGS = {'val-thorens':'Val-Thorens', 'la-plagne':'La-Plagne', 'alpe-d-huez':'Alpe-d-Huez'};
var GUIDE_URLS = {'val-thorens':'/guides/val-thorens', 'la-plagne':'/guides/la-plagne', 'alpe-d-huez':'/guides/alpe-d-huez'};
var RESORT_NAMES = {'val-thorens':'Val Thorens', 'la-plagne':'La Plagne', 'alpe-d-huez':"Alpe d'Huez"};
/* Elevation heights, copied from app.py RESORT_INFO (single source of truth server-side). */
var ELEV_HEIGHTS = {
  'val-thorens': {bot:'2300m', mid:'2800m', top:'3230m'},
  'la-plagne':   {bot:'1250m', mid:'2250m', top:'3250m'},
  'alpe-d-huez': {bot:'1250m', mid:'2350m', top:'3330m'}
};
var ELEVS = ['bot', 'mid', 'top'];

var STR = {
he:{
  'hub.snow7':'שלג 7 ימים', 'hub.weather':'🌨️ תחזית',
  'hub.unavailable':'התחזית לא זמינה כרגע — נסו שוב מאוחר יותר.',
  'hub.loading':'טוען תחזית…', 'hub.day':'יום', 'hub.snow':'שלג',
  'hub.rain':'גשם', 'hub.wind':'רוח', 'hub.temp':'טמפ׳',
  'hub.elev':'גובה', 'hub.bot':'תחתון', 'hub.mid':'אמצע', 'hub.top':'פסגה',
  'hub.full':'תחזית מלאה ←', 'hub.guide':'למדריך האתר ←',
  'hub.updated':'עודכן', 'hub.best':'היום הכי מושלג',
  'hub.shareRoute':'שיתוף מסלול', 'hub.routeShared':'הקישור למסלול הועתק',
  'hub.meLink':'👥 חברים / סיכומים', 'hub.cmPer7d':'ס״מ / 7 ימים'
},
en:{
  'hub.snow7':'snow / 7 days', 'hub.weather':'🌨️ Forecast',
  'hub.unavailable':'Forecast unavailable right now — please try again later.',
  'hub.loading':'Loading forecast…', 'hub.day':'Day', 'hub.snow':'Snow',
  'hub.rain':'Rain', 'hub.wind':'Wind', 'hub.temp':'Temp',
  'hub.elev':'Elevation', 'hub.bot':'Bottom', 'hub.mid':'Mid', 'hub.top':'Summit',
  'hub.full':'Full forecast →', 'hub.guide':'Resort guide →',
  'hub.updated':'Updated', 'hub.best':'Snowiest day',
  'hub.shareRoute':'Share route', 'hub.routeShared':'Route link copied',
  'hub.meLink':'👥 Friends / recaps', 'hub.cmPer7d':'cm / 7 days'
}};

function lang(){ try{ var l=document.documentElement.getAttribute('lang')||'he'; return l.indexOf('en')===0?'en':'he'; }catch(e){ return 'he'; } }
function t(k){ var L=STR[lang()]||STR.he; return L[k]!=null?L[k]:(STR.en[k]!=null?STR.en[k]:k); }
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }

function slug(){
  try{ if(window.SF && SF.getCfg && SF.getCfg().slug) return SF.getCfg().slug; }catch(e){}
  var m = location.pathname.match(/map-(val-thorens|la-plagne|alpe-d-huez)(\.html)?/); // live URLs are suffix-less
  return m ? m[1] : 'val-thorens';
}
function num(v){ if(v==null) return 0; var m=String(v).replace(',','.').match(/-?\d+(?:\.\d+)?/); return m?parseFloat(m[0]):0; }
function fmtNum(n){ return (Math.round(n*10)/10).toString(); }

/* Day aggregation — mirrors app.py _day_snow/_total_rain/_peak_wind/_temp_range. */
function dayStats(day){
  var periods=[];
  ['am','pm','night'].forEach(function(p){ if(day && day[p]) periods.push(day[p]); });
  var snow = (day && day.average_snow!=null) ? num(day.average_snow)
    : periods.reduce(function(a,p){ return a+num(p.snow); }, 0);
  var rain = periods.reduce(function(a,p){ return a+num(p.rain); }, 0);
  var wind = periods.reduce(function(a,p){ return Math.max(a, num(p.wind)); }, 0);
  var temps = periods.map(function(p){ return num(p.temperature); }).filter(function(x){ return isFinite(x); });
  return {name:(day&&day.name)||'', snow:snow, rain:rain, wind:wind,
    tmin:temps.length?Math.min.apply(null,temps):null,
    tmax:temps.length?Math.max.apply(null,temps):null};
}

var state = {elevation:'mid', data:null, loading:false, failed:false};

function fetchForecast(elev){
  var apiSlug = API_SLUGS[slug()] || 'Val-Thorens';
  return fetch('/api/forecast?resort='+encodeURIComponent(apiSlug)+'&elevation='+encodeURIComponent(elev))
    .then(function(r){ if(!r.ok) throw new Error('http '+r.status); return r.json(); })
    .then(function(j){
      if(!j || !j.summary || !j.forecast || !Array.isArray(j.forecast.days)) throw new Error('bad payload');
      return j;
    });
}

function chipEl(){ return document.getElementById('sfHubWeatherChip'); }

function renderChip(){
  var chip = chipEl(); if(!chip) return;
  if(state.failed || !state.data){ chip.style.display='none'; return; }
  var s = state.data.summary;
  chip.style.display='';
  chip.innerHTML = '🌨️ ' + Math.round(num(s.snow)) + ' cm <small>' + esc(t('hub.snow7')) + '</small>';
  chip.setAttribute('aria-label', t('hub.weather') + ': ' + Math.round(num(s.snow)) + ' ' + t('hub.cmPer7d'));
}

function ensurePane(){
  var pane = document.getElementById('pane-weather');
  if(pane) return pane;
  var sheet = document.getElementById('sheet'); if(!sheet) return null;
  pane = document.createElement('div');
  pane.className = 'pane'; pane.id = 'pane-weather';
  pane.innerHTML = '<h2><span></span><button class="x" aria-label="Close">✕</button></h2><div class="sf-hub-body"></div>';
  sheet.appendChild(pane);
  var x = pane.querySelector('.x');
  if(x) x.addEventListener('click', function(){ if(window.SF && SF.closeSheet) SF.closeSheet(); else if(window.closeSheet) window.closeSheet(); });
  return pane;
}

function renderPane(){
  var pane = ensurePane(); if(!pane) return;
  pane.querySelector('h2 span').textContent = t('hub.weather') + ' — ' + (RESORT_NAMES[slug()]||'');
  var body = pane.querySelector('.sf-hub-body');
  if(state.loading){ body.innerHTML = '<p class="note">'+esc(t('hub.loading'))+'</p>'; return; }
  if(state.failed || !state.data){
    body.innerHTML = '<p class="note">'+esc(t('hub.unavailable'))+'</p>'
      + '<div class="row"><a class="btn" href="/forecast.html">'+esc(t('hub.full'))+'</a></div>';
    return;
  }
  var j = state.data, days = j.forecast.days.map(dayStats);
  var h = '<div class="seg" role="group" aria-label="'+esc(t('hub.elev'))+'">';
  ELEVS.forEach(function(e){
    var hh = (ELEV_HEIGHTS[slug()]||{})[e]||e;
    h += '<button data-elev="'+e+'" class="'+(state.elevation===e?'active':'')+'">'+esc(t('hub.'+e))+' '+esc(hh)+'</button>';
  });
  h += '</div>';
  h += '<table class="sf-hub-table"><thead><tr><th>'+esc(t('hub.day'))+'</th><th>'+esc(t('hub.snow'))+'</th><th>'+esc(t('hub.rain'))+'</th><th>'+esc(t('hub.wind'))+'</th><th>'+esc(t('hub.temp'))+'</th></tr></thead><tbody>';
  days.forEach(function(d){
    h += '<tr><td>'+esc(d.name)+'</td><td><b>'+esc(fmtNum(d.snow))+' cm</b></td><td>'+esc(fmtNum(d.rain))+' mm</td><td>'+esc(Math.round(d.wind))+' km/h</td><td>'
      + (d.tmin==null ? '—' : esc(Math.round(d.tmin)+'° / '+Math.round(d.tmax)+'°')) + '</td></tr>';
  });
  h += '</tbody></table>';
  var best = j.summary.best_day ? '<p class="note">🏆 '+esc(t('hub.best'))+': '+esc(j.summary.best_day)+'</p>' : '';
  var upd = j.summary.updated ? '<p class="note">'+esc(t('hub.updated'))+': '+esc(j.summary.updated)+'</p>' : '';
  h += best + upd;
  h += '<div class="row"><a class="btn" href="/forecast.html">'+esc(t('hub.full'))+'</a>'
    + '<a class="btn" href="'+esc(GUIDE_URLS[slug()]||'/guides/')+'">'+esc(t('hub.guide'))+'</a></div>';
  body.innerHTML = h;
  body.querySelectorAll('[data-elev]').forEach(function(b){
    b.addEventListener('click', function(){
      state.elevation = b.getAttribute('data-elev');
      loadWeather(true);
    });
  });
}

function loadWeather(rerender){
  if(state.loading) return;
  state.loading = true; state.failed = false;
  if(rerender) renderPane();
  fetchForecast(state.elevation).then(function(j){
    state.data = j; state.loading = false; state.failed = false;
    renderChip(); renderPane();
  }).catch(function(){
    state.data = null; state.loading = false; state.failed = true;
    renderChip(); renderPane();
  });
}

function openWeather(){
  ensurePane();
  renderPane();
  if(window.SF && SF.openSheet) SF.openSheet('weather','half');
  else if(window.openSheet) window.openSheet('weather','half');
  if(!state.data && !state.loading) loadWeather(true);
}

/* ---- runtime additions that need no map-HTML edit ---- */
function injectMeLink(){
  var settings = document.getElementById('pane-settings'); if(!settings) return;
  if(settings.querySelector('[data-sf-me-link]')) return;
  var anchor = document.getElementById('friendsEntrySettings');
  var row = document.createElement('div');
  row.className = 'row';
  row.innerHTML = '<a class="btn block" data-sf-me-link href="/guides/recap?view=friends">'+esc(t('hub.meLink'))+'</a>';
  if(anchor && anchor.parentNode) anchor.parentNode.parentNode.insertBefore(row, anchor.parentNode.nextSibling);
  else settings.appendChild(row);
}

/* Route share button (#rcShareBtn, inserted by apply-unified-integration.py).
   Lazy-loads guides/sf-share.js on first tap; falls back to copying a plain
   map link if the module cannot load. The shared item is the current route
   (destination + summary from the route card) — never an invented route. */
var shareJsLoading = false;
function ensureShareJs(cb){
  if(window.SFShare){ cb(true); return; }
  if(shareJsLoading){ var iv=setInterval(function(){ if(window.SFShare){ clearInterval(iv); cb(true); } }, 200);
    setTimeout(function(){ clearInterval(iv); cb(!!window.SFShare); }, 5000); return; }
  shareJsLoading = true;
  var s=document.createElement('script'); s.src='sf-share.js'; s.async=true;
  s.onload=function(){ cb(!!window.SFShare); };
  s.onerror=function(){ cb(false); };
  document.head.appendChild(s);
}
function shareRoute(){
  var dest = '', sum = '';
  try{ var d=document.getElementById('destName'); if(d) dest=d.textContent.trim();
    var r=document.getElementById('routeTotal'); if(r) sum=r.textContent.trim(); }catch(e){}
  if(!dest){ if(window.SF && SF.toast) SF.toast(t('hub.unavailable'), true); return; }
  var url = location.origin + location.pathname + '#dest=' + encodeURIComponent(dest);
  var item = {kind:'route', title:(RESORT_NAMES[slug()]||'')+' — '+dest,
    text:(RESORT_NAMES[slug()]||'')+': '+dest+(sum?' ('+sum+')':''), url:url};
  ensureShareJs(function(ok){
    if(ok && window.SFShare) { window.SFShare.share(item); return; }
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(url).then(function(){ if(window.SF&&SF.toast) SF.toast(t('hub.routeShared')); });
    }
  });
}

/* ---- friend blocks (from guides/sf-friends.js, enforced here so the map
   never needs an edit): localStorage 'sf-friend-blocks' keyed
   'fid:<fid>' / 'name:<lowercase name>'. Blocked friends' points are
   dropped on arrival (upsertFriend wrapped) and removed if already
   stored. Blocking is local-only BY DESIGN — the landed schema has no
   ski.friends / ski.friend_blocks tables (those were proposed in the
   superseded ski-schema-v1.2-proposal.sql §2–3 and never created). */
function readBlocks(){ try{ var v=localStorage.getItem('sf-friend-blocks'); return v?JSON.parse(v):{}; }catch(e){ return {}; } }
function isBlockedPoint(p){
  var b=readBlocks();
  return !!((p&&p.fid&&b['fid:'+p.fid]) || (p&&p.from&&b['name:'+String(p.from).trim().toLowerCase()]));
}
function enforceBlocks(){
  try{
    if(!window.SF||!SF.Friends) return;
    var F=SF.Friends;
    if(F.upsertFriend && !F.upsertFriend._sfBlocked){
      var orig=F.upsertFriend;
      var wrapped=function(p, src){ if(isBlockedPoint(p)) return {ok:false, reason:'blocked'}; return orig(p, src); };
      wrapped._sfBlocked=true;
      F.upsertFriend=wrapped;
    }
    (F.list()||[]).forEach(function(p){ if(isBlockedPoint(p)&&p.fid) F.remove(p.fid); });
  }catch(e){}
}

function boot(){
  var row = document.getElementById('statusRow');
  if(row && !chipEl()){
    var chip = document.createElement('button');
    chip.className = 'chip'; chip.id = 'sfHubWeatherChip'; chip.type = 'button';
    chip.style.display = 'none';
    chip.addEventListener('click', openWeather);
    row.appendChild(chip);
  }
  injectMeLink();
  enforceBlocks();
  var shareBtn = document.getElementById('rcShareBtn');
  if(shareBtn && !shareBtn.getAttribute('data-sfhub-bound')){
    shareBtn.setAttribute('data-sfhub-bound','1');
    shareBtn.textContent = '↗️ ' + t('hub.shareRoute');
    shareBtn.addEventListener('click', shareRoute);
  }
  loadWeather(false);
  /* Re-render on language flip (map pages set documentElement.lang). */
  if(window.MutationObserver){
    var mo = new MutationObserver(function(muts){
      for(var i=0;i<muts.length;i++){ if(muts[i].attributeName==='lang'){ renderChip(); renderPane(); injectMeLink();
        var sb=document.getElementById('rcShareBtn'); if(sb) sb.textContent='↗️ '+t('hub.shareRoute'); break; } }
    });
    try{ mo.observe(document.documentElement, {attributes:true}); }catch(e){}
  }
  document.addEventListener('sf-hub-refresh', function(){ loadWeather(true); });
}
if(document.readyState==='loading'){ document.addEventListener('DOMContentLoaded', boot); }
else { boot(); }

window.SFHub = { openWeather:openWeather, refresh:function(){ loadWeather(true); }, slug:slug };
})();
