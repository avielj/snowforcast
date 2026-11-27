/* sf-share.js — ONE share module for every screen (recap, friends, map).
   SFShare.share(item) where item = {kind, title, text, url, card, data}.
   kinds: 'day-stats' | 'vacation-stats' | 'leaderboard' | 'recording' |
          'route' | 'trip' | 'spot' | 'day-card'.
   Behaviour:
   - navigator.share exists (mobile) -> Web Share API with title/text/url
     (+ the PNG file when a day card was rendered).
   - Otherwise -> an in-page share menu (WhatsApp wa.me/?text=, copy link
     with clipboard + fallback, download card PNG). On map pages the menu
     is skipped: copy-link + SF.toast instead, so nothing new floats over
     the map.
   - Every share button shows, BEFORE sending, exactly what will be
     shared (preview text in the menu / in the Web Share sheet via
     title+text), and AFTER sending how to revoke it (if possible).
   IRON RULE: sharing is an explicit user action every time. Nothing is
   shared automatically, sharing is off by default.
   Public links, two stages (stated honestly in the UI):
   - Stage A (works NOW, no server): the link encodes the item itself in
     the URL (like the existing ?f= links): /guides/share?d=<b64url>.
     Expiry: 7 days for stats/route, 60 minutes for a spot — checked by
     share.html. A stage-A link CANNOT be revoked once sent; the UI says
     so before sharing.
   - Stage B (landed v1.2, supabase/ski-stats-vacations.sql §5):
     ski.share_links + SFSync.createShareLink / revokeShareLink /
     resolveShareLink — a server-minted 256-bit token,
     /guides/share?t=<token>; revocable + expirable server-side.
     The client NEVER invents a token. Used automatically when the user
     is signed in AND the item resolves to a server uuid (recording /
     vacation / trip); otherwise stage A with the honest note. (The
     old Stage B target, ski.public_shares from the superseded
     proposal, was never created — C3, independent review 2026-11-27.)
   No GPS points or full tracks are ever put in a shared link except the
   single spot point of a 'spot' share (the same payload as ?f=). */
(function(){
'use strict';

var LINKS_KEY = 'sf-my-share-links';
var STAGE_A_DAYS = 7, STAGE_A_SPOT_MIN = 60;

var STR = {
he:{
  'sh.title':'שיתוף', 'sh.preview':'מה ישותף:', 'sh.whatsapp':'וואטסאפ',
  'sh.copy':'העתקת קישור', 'sh.copied':'הקישור הועתק',
  'sh.downloadCard':'הורדת כרטיס תמונה', 'sh.close':'סגירה',
  'sh.noRevoke':'קישור זה לא ניתן לביטול אחרי שנשלח.',
  'sh.revokeHow':'ניתן לבטל את הקישור בכל רגע ממסך החברים ← הקישורים ששיתפתי.',
  'sh.revoke':'ביטול קישור', 'sh.revoked':'הקישור בוטל.',
  'sh.expired':'הקישור פג תוקפו.', 'sh.shareFailed':'השיתוף נכשל — נסו שוב.',
  'sh.myLinks':'הקישורים ששיתפתי', 'sh.noLinks':'לא שיתפתם עדיין קישורים.',
  'sh.stageA':'קישור ישיר (לא ניתן לביטול)', 'sh.stageB':'קישור ניתן לביטול',
  'sh.shared':'שותף.', 'sh.linkExpires':'תוקף הקישור: {when}'
},
en:{
  'sh.title':'Share', 'sh.preview':'What will be shared:', 'sh.whatsapp':'WhatsApp',
  'sh.copy':'Copy link', 'sh.copied':'Link copied',
  'sh.downloadCard':'Download image card', 'sh.close':'Close',
  'sh.noRevoke':'This link cannot be revoked once sent.',
  'sh.revokeHow':'You can revoke this link any time from Friends → Links I shared.',
  'sh.revoke':'Revoke link', 'sh.revoked':'Link revoked.',
  'sh.expired':'This link has expired.', 'sh.shareFailed':'Sharing failed — please try again.',
  'sh.myLinks':'Links I shared', 'sh.noLinks':'You have not shared any links yet.',
  'sh.stageA':'Direct link (cannot be revoked)', 'sh.stageB':'Revocable link',
  'sh.shared':'Shared.', 'sh.linkExpires':'Link expires: {when}'
}};

function lang(){ try{ var l=document.documentElement.getAttribute('lang')||'he'; return l.indexOf('en')===0?'en':'he'; }catch(e){ return 'he'; } }
function t(k, vars){ var L=STR[lang()]||STR.he; var s=(L[k]!=null?L[k]:(STR.en[k]!=null?STR.en[k]:k));
  if(vars) for(var a in vars) s=String(s).split('{'+a+'}').join(vars[a]); return s; }
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
function readLS(k, def){ try{ var v=localStorage.getItem(k); return v==null?def:JSON.parse(v); }catch(e){ return def; } }
function storeLS(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }
function toast(msg){ try{ if(window.SF&&SF.toast) SF.toast(msg); }catch(e){} }
function b64urlEncode(str){
  var bytes=new TextEncoder().encode(str), bin='';
  bytes.forEach(function(b){ bin+=String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function b64urlDecode(str){
  try{ var s=String(str).replace(/-/g,'+').replace(/_/g,'/');
    while(s.length%4) s+='=';
    var bin=atob(s), bytes=new Uint8Array(bin.length);
    for(var i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i);
    return new TextDecoder().decode(bytes); }catch(e){ return null; }
}
function origin(){ try{ return location.origin; }catch(e){ return ''; } }

/* ---- my-links registry (local record of every link I created) ---- */
function myLinks(){ return readLS(LINKS_KEY, []); }
function recordLink(e){ var l=myLinks(); l.unshift(e); storeLS(LINKS_KEY, l.slice(0,50)); }
function stageBProbe(){
  // C3: Stage B is available when the user is signed in and the sync
  // layer is present — the createShareLink call itself is the real
  // probe (it reports 'unavailable' when ski.share_links is missing,
  // and buildLink falls back to stage A). No direct table probe: the
  // client must never read ski.share_links with the anon key.
  if(window._sfShareStageB!==undefined) return Promise.resolve(window._sfShareStageB);
  try{
    var ok = !!(window.SFSync && window.SFAuth && SFAuth.isSignedIn && SFAuth.isSignedIn());
    return Promise.resolve(ok);
  }catch(e){ return Promise.resolve(false); }
}

/* Build the public URL for an item. Returns {url, stage, token, expiresTs}.
   Stage B (revocable server link) needs the item's SERVER uuid:
   item.serverItemType in ('recording','route','vacation','daily_stats',
   'leaderboard','trip') + item.serverItemId (uuid). The token is minted
   server-side by SFSync.createShareLink — this module never invents one.
   Without a server id (guest, never synced, spot) the link is stage A. */
function buildLink(item){
  var isSpot = item.kind==='spot';
  var expTs = Date.now() + (isSpot ? STAGE_A_SPOT_MIN*60*1000 : STAGE_A_DAYS*24*60*60*1000);
  var payload = {kind:item.kind, title:item.title||'', text:item.text||'', data:item.data||null, exp:expTs};
  var stageAUrl = origin() + '/guides/share?d=' + b64urlEncode(JSON.stringify(payload));
  /* Spot shares stay stage A (same 60-minute model as ?f= — no server
     row needed). Anything without a server uuid cannot mint a token. */
  if(isSpot || !item.serverItemType || !item.serverItemId)
    return Promise.resolve({url:stageAUrl, stage:'A', token:null, expiresTs:expTs});
  return stageBProbe().then(function(ok){
    if(!ok) return {url:stageAUrl, stage:'A', token:null, expiresTs:expTs};
    return SFSync.createShareLink(item.serverItemType, item.serverItemId,
      new Date(expTs).toISOString()).then(function(r){
      if(!r || !r.ok || !r.token) return {url:stageAUrl, stage:'A', token:null, expiresTs:expTs};
      return {url:r.url, stage:'B', token:r.token, expiresTs:expTs};
    }).catch(function(){ return {url:stageAUrl, stage:'A', token:null, expiresTs:expTs}; });
  });
}
function revokeLink(id){
  var l=myLinks(), e=null;
  l.forEach(function(x){ if(x.id===id) e=x; });
  if(!e || e.stage!=='B' || !e.token) return Promise.resolve(false);
  // C3: revoke goes through ski.revoke_share_link (creator only) via
  // SFSync — never a direct UPDATE on the table.
  if(!window.SFSync || !SFSync.revokeShareLink) return Promise.resolve(false);
  return SFSync.revokeShareLink(e.token).then(function(r){
    if(!r || !r.ok) return false;
    e.revoked=true; storeLS(LINKS_KEY, l); return true;
  }).catch(function(){ return false; });
}

/* ---- day summary card (client-side canvas PNG, works offline) ---- */
function dayCardPNG(day, resortName){
  return new Promise(function(res){
    var W=1080, H=1080;
    var cv=document.createElement('canvas'); cv.width=W; cv.height=H;
    var c=cv.getContext('2d');
    var dark=true;
    try{ dark=!window.matchMedia||!window.matchMedia('(prefers-color-scheme: light)').matches; }catch(e){}
    var bg=c.createLinearGradient(0,0,0,H);
    if(dark){ bg.addColorStop(0,'#06111f'); bg.addColorStop(1,'#0e2a44'); }
    else { bg.addColorStop(0,'#eef4f8'); bg.addColorStop(1,'#d7e6f0'); }
    c.fillStyle=bg; c.fillRect(0,0,W,H);
    var fg=dark?'#f6fbff':'#0b1c2c', mut=dark?'#9fb3c8':'#4b6172', acc=dark?'#7dd3fc':'#0284c7';
    c.fillStyle=acc; c.font='900 44px system-ui, sans-serif';
    c.fillText('❄ SnowForecast', 70, 100);
    c.fillStyle=fg; c.font='900 72px system-ui, sans-serif';
    var name=(resortName||day.resort||'').slice(0,24);
    c.fillText(name, 70, 190);
    c.fillStyle=mut; c.font='600 40px system-ui, sans-serif';
    c.fillText(day.date||'', 70, 250);
    var s=day.stats||{};
    function kmh(v){ return v?((v*3.6).toFixed(0)+' km/h'):'—'; }
    function dist(m){ return m==null?'—':(m>=1000?(m/1000).toFixed(1)+' km':Math.round(m)+' m'); }
    function dur(sec){ if(sec==null) return '—'; sec=Math.round(sec); var h=Math.floor(sec/3600), m=Math.round((sec%3600)/60); return h>0?h+':'+('0'+m).slice(-2):m+' min'; }
    var rows=[
      [lang()==='en'?'Distance':'מרחק', dist(s.distance)],
      [lang()==='en'?'Vertical':'גובה מצטבר', s.gain==null?'—':Math.round(s.gain)+' m'],
      [lang()==='en'?'Top speed':'מהירות מרבית', kmh(s.topSpeed)],
      [lang()==='en'?'Longest run':'הריצה הארוכה ביותר', dist(s.longestRun)],
      [lang()==='en'?'Runs':'ריצות', (s.runs==null?'—':String(s.runs))],
      [lang()==='en'?'Ski / lift time':'זמן גלישה / ליפטים', (s.skiTime==null?'—':dur(s.skiTime)+' / '+dur(s.liftTime))]
    ];
    var y=340;
    rows.forEach(function(r){
      c.fillStyle=mut; c.font='700 38px system-ui, sans-serif'; c.fillText(r[0], 70, y);
      c.fillStyle=fg; c.font='900 46px system-ui, sans-serif';
      c.fillText(r[1], 70, y+62);
      y+=150;
    });
    c.fillStyle=mut; c.font='600 32px system-ui, sans-serif';
    c.fillText('snowforcast', 70, H-60);
    if(cv.toBlob) cv.toBlob(function(b){ res(b); }, 'image/png');
    else res(null);
  });
}

/* ---- the one share entry point ---- */
function share(item){
  item=item||{};
  var needLink=!item.url;
  function go(url, stage, token, expiresTs, alreadyRecorded){
    var text=(item.text||'')+(url?('\n'+url):'');
    var preview=(item.title?item.title+'\n':'')+text;
    var after = stage==='B' ? t('sh.revokeHow') : t('sh.noRevoke');
    /* Record the link the FIRST time it is shown to the user (menu or
       successful Web Share). Previously only the Web Share success path
       recorded it, so a route shared from the map on desktop (no
       navigator.share -> copy-link menu) never appeared in
       Friends -> Links I shared. alreadyRecorded flips so the menu
       path and the share-success path can never double-record. */
    function recordOnce(){
      if(url && !alreadyRecorded){
        alreadyRecorded = true;
        recordLink({id:'sh-'+Date.now().toString(36), kind:item.kind, title:item.title||'', url:url,
          stage:stage, token:token||null, createdTs:Date.now(), expiresTs:expiresTs, revoked:false});
      }
    }
    var filePromise = Promise.resolve(null);
    if(item.cardDay){
      filePromise=dayCardPNG(item.cardDay, item.cardResort).then(function(blob){
        if(!blob) return null;
        try{ return new File([blob], 'snowforecast-day.png', {type:'image/png'}); }catch(e){ return null; }
      });
    }
    filePromise.then(function(file){
      if(navigator.share){
        var data={title:item.title||'SnowForecast', text:text};
        if(url) data.url=url;
        if(file && navigator.canShare && navigator.canShare({files:[file]})) data.files=[file];
        else if(file) data.files=[file];
        navigator.share(data).then(function(){
          recordOnce();
          toast(t('sh.shared')+' '+after);
        }).catch(function(e){ if(e&&e.name==='AbortError') return; recordOnce(); openMenu(preview, url, file, after); });
        return;
      }
      recordOnce();
      openMenu(preview, url, file, after);
    });
  }
  if(needLink){
    buildLink(item).then(function(r){
      if(item.kind!=='spot') recordLink({id:'sh-'+Date.now().toString(36), kind:item.kind, title:item.title||'',
        url:r.url, stage:r.stage, token:r.token||null, createdTs:Date.now(), expiresTs:r.expiresTs, revoked:false});
      go(r.url, r.stage, r.token, r.expiresTs, true);
    });
  } else {
    go(item.url, 'A', null, null, false);
  }
}
function copyText(text, okMsg){
  function done(){ toast(okMsg||t('sh.copied')); }
  if(navigator.clipboard && navigator.clipboard.writeText){ navigator.clipboard.writeText(text).then(done, function(){ fallbackCopy(text); done(); }); }
  else { fallbackCopy(text); done(); }
}
function fallbackCopy(text){
  try{ var ta=document.createElement('textarea'); ta.value=text; ta.style.position='fixed'; ta.style.left='-9999px';
    document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); }catch(e){}
}
function openMenu(preview, url, file, after){
  /* On map pages: no menu over the map — copy the link + toast. */
  if(window.SF && SF.sheetOpen){
    if(url) copyText(url);
    toast(after||'');
    return;
  }
  var menu=document.getElementById('sfShareMenu');
  if(!menu){
    menu=document.createElement('div'); menu.id='sfShareMenu';
    document.body.appendChild(menu);
  }
  var h='<h2 style="margin:0 0 4px;font-size:1.05rem">'+esc(t('sh.title'))+'</h2>'
    +'<p class="sfme-muted" style="margin:0">'+esc(t('sh.preview'))+'</p>'
    +'<div class="sfme-share-preview">'+esc(preview)+'</div>'
    +'<p class="sfme-note">'+esc(after||'')+'</p><div class="sfme-row">'
    +'<a class="sfme-btn primary block" target="_blank" rel="noopener" href="https://wa.me/?text='+encodeURIComponent(preview)+'">'+esc(t('sh.whatsapp'))+'</a>'
    +'<button class="sfme-btn block" data-sh="copy">'+esc(t('sh.copy'))+'</button>';
  if(file) h+='<button class="sfme-btn block" data-sh="card">'+esc(t('sh.downloadCard'))+'</button>';
  h+='<button class="sfme-btn block" data-sh="close">'+esc(t('sh.close'))+'</button></div>';
  menu.innerHTML=h;
  menu.classList.add('open');
  menu.querySelector('[data-sh="copy"]').addEventListener('click', function(){ if(url) copyText(url); });
  var cardBtn=menu.querySelector('[data-sh="card"]');
  if(cardBtn) cardBtn.addEventListener('click', function(){
    var a=document.createElement('a'); a.href=URL.createObjectURL(file); a.download='snowforecast-day.png';
    document.body.appendChild(a); a.click(); setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 500);
  });
  menu.querySelector('[data-sh="close"]').addEventListener('click', function(){ menu.classList.remove('open'); });
}

/* Item builders (recap.html uses these; every screen shares them).
   C3: each builder resolves the item's SERVER uuid when it can, so
   buildLink can mint a revocable stage-B token. Without a server id
   the share falls back to stage A (data-in-URL) honestly. */
function fmtDist(m){ return m>=1000?(m/1000).toFixed(1)+' km':Math.round(m)+' m'; }
function shareDay(day){
  var s=day.stats||{};
  var text=(lang()==='en'?'Ski day ':'יום גלישה ')+day.date+' — '+(day.resort||'')
    +'\n⛷️ '+fmtDist(s.distance||0)
    +' · ⬆ '+(s.gain==null?'—':Math.round(s.gain)+' m')
    +' · 💨 '+((s.topSpeed||0)*3.6).toFixed(0)+' km/h';
  /* Flat stats fields: share.html show() reads d.distance/d.gain/... at
     the top level (same shape shareVacation sends). The nested stats:{}
     form left the viewer's stat grid empty. */
  var item={kind:'day-stats', title:'SnowForecast — '+day.date, text:text, cardDay:day, cardResort:day.resort, data:{day:day.date, resort:day.resort, distance:Math.round(s.distance||0), gain:(s.gain==null?null:Math.round(s.gain)), topSpeed:Math.round((s.topSpeed||0)*3.6), longestRun:Math.round(s.longestRun||0), runs:(s.runs==null?null:s.runs)}};
  // daily_stats resolves to the DAY's aggregates (all of the owner's
  // recordings that day, same resort) via ANY one recording of that
  // day — the day's top track is the natural key.
  var recLocalId = (day.topTrack && day.topTrack.id) || (day.tracks && day.tracks[0] && day.tracks[0].id) || null;
  if(!recLocalId || !window.SFSync || !SFSync.getServerRecordingId){ share(item); return; }
  SFSync.getServerRecordingId(recLocalId).then(function(sid){
    if(sid){ item.serverItemType='daily_stats'; item.serverItemId=sid; }
    share(item);
  }).catch(function(){ share(item); });
}
function shareVacation(vac){
  var v=vac.totals||{};
  var text=(lang()==='en'?'Ski vacation ':'חופשת סקי ')+vac.name
    +'\n⛷️ '+fmtDist(v.distance||0)+' · ⬆ '+Math.round(v.gain||0)+' m · '+v.days+' '+(lang()==='en'?'days':'ימי גלישה');
  var item={kind:'vacation-stats', title:'SnowForecast — '+vac.name, text:text,
    data:{vacation:vac.id, name:vac.name, days:v.days, distance:Math.round(v.distance||0), gain:Math.round(v.gain||0)}};
  // The vacation's server uuid (from the server list, by resort +
  // start date) — the local preview key ('vac-<resort>-<start>') is
  // NOT a server id and must never be sent as item_id.
  if(!window.SFSync || !SFSync.getVacationId || !vac.resort || !vac.startDate){ share(item); return; }
  try{
    var sid = SFSync.getVacationId(vac.resort, vac.startDate);
    if(sid){ item.serverItemType='vacation'; item.serverItemId=sid; }
  }catch(e){}
  share(item);
}
function shareLeaderboard(scopeName, lines, serverVacationId){
  var text=(lang()==='en'?'Leaderboard — ':'לוח תוצאות — ')+scopeName+'\n'+(lines||[]).join('\n');
  var item={kind:'leaderboard', title:'SnowForecast — '+scopeName, text:text, data:{scope:scopeName, lines:lines||[]}};
  // A leaderboard link is minted against a vacation's server uuid
  // (the board is the vacation's trip board). Without it the share
  // stays stage A.
  if(serverVacationId){ item.serverItemType='leaderboard'; item.serverItemId=serverVacationId; }
  share(item);
}
function shareRoute(routeText, url){
  share({kind:'route', title:'SnowForecast', text:routeText, url:url});
}
function shareTrip(tripName, inviteUrl){
  // The invite URL ('#trip=<local-id>') is the JOIN mechanism, not a
  // read-only share link — it is shared as-is (stage A). A 'trip'
  // share_links card (name/dates only, revocable) is a different
  // action: call SFShare.share({kind:'trip', serverItemType:'trip',
  // serverItemId:<server trip uuid>}) for that.
  share({kind:'trip', title:'SnowForecast — '+tripName, text:(lang()==='en'?'Join my ski trip: ':'הצטרפו לטיול הסקי שלי: ')+tripName, url:inviteUrl});
}

window.SFShare = { share:share, shareDay:shareDay, shareVacation:shareVacation,
  shareLeaderboard:shareLeaderboard, shareRoute:shareRoute, shareTrip:shareTrip,
  dayCardPNG:dayCardPNG, myLinks:myLinks, revokeLink:revokeLink, t:t, esc:esc,
  b64urlDecode:b64urlDecode, b64urlEncode:b64urlEncode };
})();
