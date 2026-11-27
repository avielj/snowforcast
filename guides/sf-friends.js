/* sf-friends.js — friends management (off-map screen, guides/recap.html).
   Local-first: the persistent friends list lives in localStorage
   'sf-friends-list'; trip members come from 'sf-trips' (members per trip,
   written by map-shared.js / sf-sync.js) and live points from
   'sf-friends' (the same key the map's Friends module uses — this file
   reads/writes the same shapes, it never changes map-shared.js).
   Rules (hard):
   - A friend is visible on the map ONLY inside a shared trip AND only
     while sharing is on. Sharing is OFF by default.
   - Block / hide per friend: stored in localStorage 'sf-friend-blocks'
     keyed by fid ('fid:<fid>') or by name ('name:<lowercase name>').
     Enforcement on map pages happens in sf-hub.js (already loaded
     there): it wraps SF.Friends.upsertFriend to drop blocked points
     and removes blocked points already stored. This file exposes the
     same helpers so the recap page can enforce them too.
   - "Stop sharing my location with X": there is NO per-recipient
     targeting in the current share model — a share is visible to ALL
     members of the trip (friend_shares is trip-wide). The honest
     controls are: (a) hide X from MY map (block — works), (b) stop
     sharing in the whole trip (SF.Friends.stopSharing on a map page,
     or the trip switch in the map's Friends sheet). The UI says this
     plainly instead of pretending per-friend share targeting exists.
   - Add friend: by email (stored as 'invited' until they join via the
     trip invite link) or by pasting a ?f= share link (decoded here —
     base64url JSON v1, same validation as the map module: lat/lon/ts/
     trip/from). Friends added by email are NOT looked up on any
     server: Supabase RLS forbids reading other users' auth profiles,
     so an email alone cannot resolve to a user id. The server-side
     resolution (ski.friends with peer_user_id filled on join) is
     proposed in ski-schema-v1.2-proposal.sql §2.
   - Sync: when SFSync/SFAuth are present and the ski.friends table
     exists, the list is ALSO written there (owner-only rows). Until
     the sync coordinator approves/runs the proposal, everything is
     local-only and the UI says so.
   All strings HE/EN. No map, nothing floats over a map. */
(function(){
'use strict';

var LIST_KEY = 'sf-friends-list';
var BLOCKS_KEY = 'sf-friend-blocks';
var TRIPS_KEY = 'sf-trips';
var POINTS_KEY = 'sf-friends';
var ME_KEY = 'sf-me';

var STR = {
he:{
  'fr.title':'חברים', 'fr.myList':'החברים שלי', 'fr.inTrips':'אנשים בטיולים שלי',
  'fr.addByEmail':'הוספה לפי אימייל', 'fr.addByLink':'הוספה מקישור שיתוף (?f=)',
  'fr.emailPh':'name@example.com', 'fr.linkPh':'הדבק קישור ?f= …',
  'fr.add':'הוספה', 'fr.remove':'הסרה', 'fr.block':'חסימה / הסתרה מהמפה',
  'fr.unblock':'ביטול חסימה', 'fr.blocked':'חסום/ה — לא מוצג/ת על המפה שלי',
  'fr.invited':'הוזמן/ה — עדיין לא הצטרף/ה לטיול',
  'fr.fromTrip':'מהטיול', 'fr.fromLink':'מקישור', 'fr.manual':'הוספה ידנית',
  'fr.noFriends':'אין חברים עדיין. הוסיפו חבר לפי אימייל, או הדביקו קישור שיתוף שקיבלתם.',
  'fr.noTripPeople':'אין אנשים בטיולים עדיין — הצטרפו לטיול מהמפה, או שלחו קישור הזמנה.',
  'fr.mySharing':'השיתוף שלי', 'fr.sharingOn':'משתף/ת מיקום בטיול',
  'fr.sharingOff':'לא משתף/ת מיקום', 'fr.stopSharingTrip':'עצירת שיתוף בטיול',
  'fr.stopSharingNote':'שיתוף המיקום הוא ברמת הטיול — כל חברי הטיול רואים אותו, לא חבר אחד ספציפי. כדי להפסיק לשתף עם מישהו ספציפי: חסמו אותו (הוא לא יראה על המפה שלכם) או עצרו את השיתוף לכל הטיול.',
  'fr.stopSharingMapHint':'עצירת השיתוף מתבצעת מהמפה (גיליון חברים) — פתחו את מפת הטיול.',
  'fr.linkBad':'הקישור לא תקין או שפג תוקפו (60 דקות).',
  'fr.emailBad':'כתובת אימייל לא תקינה.',
  'fr.added':'החבר נוסף.',
  'fr.myLinks':'הקישורים ששיתפתי', 'fr.noLinks':'לא שיתפתם עדיין קישורים.',
  'fr.syncLocal':'נשמר מקומית בלבד — סנכרון חברים עדיין לא הופעל (ממתין לאישור טבלת friends).',
  'fr.hideNote':'חסום/ה לא יופיע/תופיע על המפה שלכם, ונקודות חדשות ממנו/ה ייחסמו אוטומטית.',
  'fr.name':'שם'
},
en:{
  'fr.title':'Friends', 'fr.myList':'My friends', 'fr.inTrips':'People in my trips',
  'fr.addByEmail':'Add by email', 'fr.addByLink':'Add from a share link (?f=)',
  'fr.emailPh':'name@example.com', 'fr.linkPh':'Paste a ?f= link…',
  'fr.add':'Add', 'fr.remove':'Remove', 'fr.block':'Block / hide from my map',
  'fr.unblock':'Unblock', 'fr.blocked':'Blocked — not shown on my map',
  'fr.invited':'Invited — has not joined a trip yet',
  'fr.fromTrip':'From trip', 'fr.fromLink':'From link', 'fr.manual':'Added manually',
  'fr.noFriends':'No friends yet. Add a friend by email, or paste a share link you received.',
  'fr.noTripPeople':'Nobody in your trips yet — join a trip from the map, or send an invite link.',
  'fr.mySharing':'My sharing', 'fr.sharingOn':'Sharing position in trip',
  'fr.sharingOff':'Not sharing position', 'fr.stopSharingTrip':'Stop sharing in trip',
  'fr.stopSharingNote':'Position sharing is per trip — every trip member sees it, not one specific friend. To stop sharing with one specific person: block them (they will not appear on your map) or stop sharing for the whole trip.',
  'fr.stopSharingMapHint':'Stopping sharing is done from the map (Friends sheet) — open the trip map.',
  'fr.stopSharingTripDone':'Sharing stopped for this trip.',
  'fr.linkBad':'The link is invalid or expired (60 minutes).',
  'fr.emailBad':'That email address does not look valid.',
  'fr.added':'Friend added.',
  'fr.myLinks':'Links I shared', 'fr.noLinks':'You have not shared any links yet.',
  'fr.syncLocal':'Saved locally only — friends sync is not enabled yet (waiting for the friends table to be approved).',
  'fr.hideNote':'A blocked friend will not appear on your map, and new points from them are blocked automatically.',
  'fr.name':'Name'
}};

function lang(){ try{ var l=document.documentElement.getAttribute('lang')||'he'; return l.indexOf('en')===0?'en':'he'; }catch(e){ return 'he'; } }
function t(k, vars){ var L=STR[lang()]||STR.he; var s=(L[k]!=null?L[k]:(STR.en[k]!=null?STR.en[k]:k));
  if(vars) for(var a in vars) s=String(s).split('{'+a+'}').join(vars[a]); return s; }
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
function readLS(k, def){ try{ var v=localStorage.getItem(k); return v==null?def:JSON.parse(v); }catch(e){ return def; } }
function storeLS(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }
function uid(){ try{ if(window.crypto&&crypto.randomUUID) return crypto.randomUUID(); }catch(e){}
  return 'fr-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8); }

/* ---- data ---- */
function list(){ return readLS(LIST_KEY, []); }
function save(l){ storeLS(LIST_KEY, l); }
function blocks(){ return readLS(BLOCKS_KEY, {}); }
function saveBlocks(b){ storeLS(BLOCKS_KEY, b); }
function blockKeyForPoint(p){
  if(p && p.fid) return 'fid:'+p.fid;
  if(p && p.from) return 'name:'+String(p.from).trim().toLowerCase();
  return null;
}
function isBlockedPoint(p){
  var b=blocks();
  var k1=p&&p.fid?('fid:'+p.fid):null, k2=p&&p.from?('name:'+String(p.from).trim().toLowerCase()):null;
  return !!(k1&&b[k1]) || !!(k2&&b[k2]);
}
function isBlockedFriend(f){
  var b=blocks();
  if(f.fid && b['fid:'+f.fid]) return true;
  if(f.name && b['name:'+String(f.name).trim().toLowerCase()]) return true;
  return false;
}
function setBlocked(f, blocked){
  var b=blocks();
  var keys=[];
  if(f.fid) keys.push('fid:'+f.fid);
  if(f.name) keys.push('name:'+String(f.name).trim().toLowerCase());
  keys.forEach(function(k){ if(blocked) b[k]={ts:Date.now()}; else delete b[k]; });
  saveBlocks(b);
  if(blocked){
    /* Remove their stored points so the map stops showing them. */
    var pts=readLS(POINTS_KEY, []);
    var kept=pts.filter(function(p){ return !isBlockedPoint(p); });
    if(kept.length!==pts.length) storeLS(POINTS_KEY, kept);
    try{ if(window.SF&&SF.Friends){ (pts||[]).forEach(function(p){ if(p.fid&&isBlockedPoint(p)) SF.Friends.remove(p.fid); }); SF.Friends.render(); } }catch(e){}
  }
}
function tripPeople(){
  var s=readLS(TRIPS_KEY, {});
  var out=[];
  var members=s.members||{};
  Object.keys(members).forEach(function(tripId){
    (members[tripId]||[]).forEach(function(m){
      if(!m||!m.name) return;
      out.push({name:m.name, trip:tripId, sharing:!!m.sharing, id:m.id||('mb:'+tripId+':'+m.name.toLowerCase())});
    });
  });
  var pts=readLS(POINTS_KEY, []);
  pts.forEach(function(p){
    if(!p||p.kind!=='friend'||!p.from) return;
    if(!out.some(function(x){ return x.name===p.from && x.trip===p.trip; }))
      out.push({name:p.from, trip:p.trip, sharing:false, fid:p.fid||null, id:'pt:'+(p.fid||p.from)});
  });
  return out;
}
function mySharing(){
  var s=readLS(TRIPS_KEY, {});
  return s.mySharing||{};
}
function trips(){
  var s=readLS(TRIPS_KEY, {});
  var out=[];
  var joined=s.joined||{};
  Object.keys(joined).forEach(function(id){ if(joined[id]) out.push(id); });
  var custom=s.custom||{};
  Object.keys(custom).forEach(function(id){ out.push(id); });
  if(s.active && out.indexOf(s.active)<0) out.unshift(s.active);
  return out;
}

/* ---- add ---- */
function addFriend(entry){
  var l=list();
  var e={id:uid(), name:String(entry.name||'').trim().slice(0,60), email:String(entry.email||'').trim().toLowerCase().slice(0,120),
    source:entry.source||'manual', tripIds:entry.tripIds||[], fid:entry.fid||null,
    status:entry.status||'added', addedTs:Date.now()};
  if(!e.name && e.email) e.name=e.email.split('@')[0];
  if(!e.name) return null;
  l.push(e); save(l);
  syncFriendToServer(e);
  return e;
}
function removeFriend(id){
  var l=list();
  var f=l.find(function(x){ return x.id===id; });
  save(l.filter(function(x){ return x.id!==id; }));
  if(f){
    setBlocked(f, false);
    var pts=readLS(POINTS_KEY, []);
    var kept=pts.filter(function(p){ return !(f.fid&&p.fid===f.fid) && !(f.name&&p.from===f.name); });
    if(kept.length!==pts.length) storeLS(POINTS_KEY, kept);
    try{ if(window.SF&&SF.Friends&&f.fid) SF.Friends.remove(f.fid); }catch(e){}
  }
}
/* Decode a ?f= payload (base64url JSON v1) — same validation as the map
   module: lat/lon ranges, ts within the last 24h, trip id shape. */
function b64urlDecode(str){
  try{
    var s=String(str).replace(/-/g,'+').replace(/_/g,'/');
    while(s.length%4) s+='=';
    var bin=atob(s);
    var bytes=new Uint8Array(bin.length);
    for(var i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }catch(e){ return null; }
}
function parseShareLink(text){
  var m=String(text||'').match(/[?&#]f=([A-Za-z0-9\-_]+)/) || String(text||'').match(/^([A-Za-z0-9\-_]+)$/);
  if(!m) return {ok:false, reason:'no-f'};
  var raw=b64urlDecode(m[1]);
  if(!raw) return {ok:false, reason:'decode'};
  var p=null;
  try{ p=JSON.parse(raw); }catch(e){ return {ok:false, reason:'json'}; }
  if(!p||p.v!==1||p.kind!=='friend') return {ok:false, reason:'version'};
  if(typeof p.lat!=='number'||p.lat<-90||p.lat>90||typeof p.lon!=='number'||p.lon<-180||p.lon>180) return {ok:false, reason:'lat'};
  if(typeof p.ts!=='number'||(Date.now()-p.ts)>24*60*60*1000) return {ok:false, reason:'too-old'};
  if(typeof p.trip!=='string'||!/^[a-z0-9-]+$/.test(p.trip||'')) return {ok:false, reason:'trip'};
  if(!p.from||typeof p.from!=='string') return {ok:false, reason:'from'};
  return {ok:true, p:{v:1, kind:'friend', fid:p.fid||null, from:String(p.from).trim().slice(0,60),
    trip:p.trip, lat:p.lat, lon:p.lon, acc:(p.acc==null?null:p.acc), ts:p.ts,
    label:p.label||null, resort:p.resort||'', source:'link'}};
}
function addFromLink(text){
  var r=parseShareLink(text);
  if(!r.ok) return r;
  var p=r.p;
  /* Mirror the point into 'sf-friends' so the map shows it, exactly as
     the map module would on opening the same link. */
  var pts=readLS(POINTS_KEY, []);
  var now=Date.now();
  var fresh=pts.some(function(x){ return x.fid&&p.fid&&x.fid===p.fid&&x.ts>=p.ts; });
  if(!fresh){
    pts=pts.filter(function(x){ return !(x.fid&&p.fid&&x.fid===p.fid); });
    pts.push(p); storeLS(POINTS_KEY, pts);
  }
  var e=addFriend({name:p.from, source:'link', tripIds:[p.trip], fid:p.fid, status:'added'});
  return {ok:true, friend:e, point:p};
}

/* ---- server sync (best-effort; local is the source of truth) ---- */
function syncFriendToServer(e){
  try{
    var client=window.SFAuth&&SFAuth.getClient?SFAuth.getClient():null;
    var u=window.SFAuth&&SFAuth.getUser?SFAuth.getUser():null;
    if(!client||!u) return Promise.resolve('no-client');
    return client.from('friends').upsert({owner_id:u.id, display_name:e.name, email:e.email||null,
      peer_user_id:null, status:(e.status==='invited'?'invited':'active'), blocked:false},
      {onConflict:'owner_id,email'}).then(function(res){
        if(res.error){ var m=String((res.error&&res.error.message)||'');
          if(/PGRST205|Could not find the table/i.test(m)) return 'no-table'; return 'error'; }
        return 'ok';
      }).catch(function(){ return 'error'; });
  }catch(err){ return Promise.resolve('error'); }
}

/* ---- map enforcement (called from sf-hub.js on map pages) ---- */
function enforceOnMap(){
  try{
    if(!window.SF||!SF.Friends) return false;
    var F=SF.Friends;
    if(F.upsertFriend && !F.upsertFriend._sfBlocked){
      var orig=F.upsertFriend;
      var wrapped=function(p, src){ if(isBlockedPoint(p)) return {ok:false, reason:'blocked'}; return orig(p, src); };
      wrapped._sfBlocked=true;
      F.upsertFriend=wrapped;
    }
    (F.list()||[]).forEach(function(p){ if(isBlockedPoint(p)&&p.fid) F.remove(p.fid); });
    F.render();
    return true;
  }catch(e){ return false; }
}

window.SFFriends = { t:t, esc:esc, list:list, blocks:blocks, isBlockedPoint:isBlockedPoint,
  isBlockedFriend:isBlockedFriend, setBlocked:setBlocked, tripPeople:tripPeople,
  mySharing:mySharing, trips:trips, addFriend:addFriend, removeFriend:removeFriend,
  parseShareLink:parseShareLink, addFromLink:addFromLink, enforceOnMap:enforceOnMap };
})();
