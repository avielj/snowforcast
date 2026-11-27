/* map-shared.js — SnowForecast shared UI + features (Round 2).
   Provides: theme (device + manual override), bottom-bar sheets, toast,
   Record (Wake Lock + local tracks), Friends (tap-to-route), Trip groups,
   navigation mode (WS6 phase 1), search helpers, SOS extras, offline badge.
   Defensive by design: every page hook is guarded; this file never assumes
   a page global (L, DATA, STR) exists. Page inline scripts must not
   reference SF at top level (node_test runs them in a vm without SF).
   HONEST LIMITS (recorded here and in the summary pane):
   - Screen Wake Lock is released by the OS when the screen locks or the
     browser goes to background; background GPS in a browser is best-effort
     and the OS may throttle or stop it. Tracks are saved locally as they
     are recorded, so a lock/background gap loses points, not the whole day.
   - Friends are position-drop snapshots (ws7 §2): a friend's point arrives
     in a ?f= share link, is stored locally with its fix time, and expires
     after 60 min. This build routes to a given lat/lon and stores friends
     locally; it does NOT live-sync anyone's position. */
(function(){
'use strict';

/* ================= i18n (shared strings) ================= */
var SF_STR = {
he:{
  search:'חיפוש', route:'מסלול', record:'הקלטה', plan:'תכנון', sos:'SOS', settings:'הגדרות',
  'bar.search':'חיפוש', 'bar.route':'מסלול', 'bar.plan':'תכנון', 'bar.sos':'SOS',
  'settings.themeAuto':'לפי המכשיר', 'settings.themeLight':'בהיר', 'settings.themeDark':'כהה',
  close:'סגירה', cancel:'ביטול', back:'חזרה', demo:'דמו',
  startPoint:'נקודת התחלה', villageDemo:'הכפר (דמו)', myLocation:'המיקום שלי',
  gpsSearching:'מחפש GPS…', gpsError:'לא ניתן לקבל מיקום',
  saveOffline:'שמור מפה לאופליין', savedOffline:'המפה נשמרה לאופליין', savingOffline:'שומר מפה…',
  offlineSavedOn:'נשמר', offlineClear:'מחק מפה שמורה',
  recStart:'התחל הקלטה', recStop:'עצור', recRecording:'מקליט…', recSaved:'ההקלטה נשמרה',
  recSummary:'סיכום היום', recNoPoints:'לא נרשמו נקודות בהקלטה זו.',
  recDistance:'מרחק', recDuration:'משך', recVertical:'גובה מצטבר', recTopSpeed:'מהירות מרבית',
  recLongestRun:'הריצה הארוכה ביותר', recToday:'היום', recLeaderboard:'טבלת היום (במכשיר זה בלבד)',
  recExport:'ייצוא GPX', recDelete:'מחיקה', recShowOnMap:'הצגה על המפה', recHide:'הסתר',
  recLimits:'הערה: נעילת מסך שומרת על ההקלטה פתוחה, אך כשהמסך ננעל או הדפדפן עובר לרקע, מערכת ההפעלה עלולה לשחרר את הנעילה ולהגביל GPS. הנקודות נשמרות מקומית תוך כדי ההקלטה, כך שהפסקה לא מוחקת את מה שכבר נרשם.',
  recTracks:'הקלטות', recNone:'אין הקלטות עדיין.', recNoAlt:'— (אין נתוני גובה)',
  friend:'חבר', friends:'חברים', addFriend:'הוספת חבר', friendName:'שם החבר',
  friendLat:'קו רוחב', friendLon:'קו אורך', placeOnMap:'סמן על המפה', pasteLink:'הדבקת קישור (Google Maps / geo:)',
  shareMyLocation:'שיתוף המיקום שלי', linkCopied:'הקישור הועתק', friendAdded:'החבר נוסף',
  invalidLink:'לא נמצאו קואורדינטות בקישור', tapMapToPlace:'הקש על המפה כדי למקם את החבר',
  navigateTo:'נווט אל', noFriends:'אין חברים עדיין — הוסף חבר או הזמן חבר לקבוצה.',
  demoFriendNote:'חבר דמו — הקש על הסמן במפה כדי לנווט אליו.',
  trips:'קבוצות טיול', tripGroups:'קבוצות טיול', mySharing:'שיתוף המיקום שלי',
  sharingOn:'משתף', sharingOff:'כבוי', members:'חברים בקבוצה', invite:'הזמנה לקבוצה',
  inviteCopied:'קישור ההזמנה הועתק', joinTrip:'הצטרפות לקבוצה', addMember:'הוספת חבר',
  memberName:'שם', you:'אתה', locationOff:'מיקום כבוי', pickTripFirst:'בחר קבוצה קודם',
  tripActive:'קבוצה פעילה', noMembers:'אין חברים נוספים עדיין.',
  liveSyncNote:'המיקומים הם תמונת מצב מרגע השיתוף, לא מעקב חי. הם פגים אחרי 60 דקות.',
  'friends.title':'חברים וטיולים 👥',
  'friends.openRow':'👥 חברים וטיולים',
  'friends.openRowCount':'👥 חברים וטיולים · {n} בהר',
  'friends.trip':'טיול',
  'friends.noTrip':'אין טיול פעיל באתר הזה — צרו טיול או פתחו קישור הזמנה.',
  'friends.shareMySpot':'📍 שתף את המיקום שלי בטיול הזה',
  'friends.shareOffNote':'כבוי — שום דבר לא משותף עד שתלחצו כאן.',
  'friends.shareLocating':'מאתר את ה־GPS…',
  'friends.shareGpsFail':'לא הצלחנו לקבל GPS. נסו שוב, או שתפו את מרכז המפה.',
  'friends.shareMapCentre':'שתף את מרכז המפה',
  'friends.shareMapCentreNote':'נקודת מרכז המפה, לא מיקום GPS.',
  'friends.sharedAt':'✓ שותף ב־{time} — הקישור מוכן למטה',
  'friends.shareAgain':'↻ קח מיקום חדש',
  'friends.shareAgainNote':'המיקום מ־{time} — שתפו שוב כדי לקבל מיקום עדכני.',
  'friends.stopSharing':'■ הפסק שיתוף',
  'friends.stopSharingNote':'הפסקת השיתוף מוחקת את הנקודה מהטלפון שלכם. קישורים שכבר נשלחו ימשיכו לעבוד עד שיפוגו.',
  'friends.shareVia':'שתף דרך…',
  'friends.copyLink':'📋 העתק קישור',
  'friends.linkCopied':'הקישור הועתק',
  'friends.shareWhats':'💬 שתף בוואטסאפ',
  'friends.shareText':'📍 {name} שיתף את המיקום שלו במפת {resort} — פתחו כדי לראות ולנווט אליו: {url}',
  'friends.expiredNote':'המיקום האחרון ששיתפתם פג ב־{time}.',
  'friends.expiredLink':'המיקום המשותף הזה פג.',
  'friends.onMountain':'מי בהר',
  'friends.sharedAgo':'📍 לפני {n} דק׳ · {dist} בקו אווירי',
  'friends.sharedStale':'⚠️ לפני {n} דק׳ — אולי כבר זז',
  'friends.noPosition':'— לא שיתף מיקום',
  'friends.youSharing':'אתם — משתפים מאז {time}',
  'friends.youNotSharing':'אתם — לא משתפים',
  'friends.routeTo':'נווט אל {name} ▶',
  'friends.dismiss':'הסתר',
  'friends.showOnMap':'הצג במפה',
  'friends.freshnessNote':'המיקומים הם תמונת מצב מרגע השיתוף, לא מעקב חי. הם פגים אחרי 60 דקות.',
  'friends.noRoute':'אין מסלול גלישה לנקודה הזו (היא מחוץ לרשת המסלולים). המרחק בקו אווירי: {dist}.',
  'friends.farPoint':'⚠️ הנקודה רחוקה מ{resort} — בדקו שהיא נכונה.',
  'friends.joinTitle':'{name} שיתף את המיקום שלו בטיול {trip}',
  'friends.joinBody':'הצטרפו לטיול כדי לראות אותו על המפה. כל מי שיש לו את הקישור יכול להצטרף — אין אישור מנהל.',
  'friends.join':'הצטרף לטיול',
  'friends.justShow':'רק הצג את הנקודה הזו',
  'friends.unknownTrip':'הטיול {trip} לא מוכר בטלפון הזה — הנקודה תוצג פעם אחת.',
  'friends.yourName':'השם שלכם בטיול',
  'friends.newTrip':'+ טיול חדש',
  'friends.leaveTrip':'עזוב טיול',
  'friends.leaveConfirm':'לעזוב את {trip}? הנקודות ששיתפתם בטיול יפוגו. החברים לא יקבלו הודעה.',
  'friends.inviteLink':'קישור הזמנה',
  'friends.pastTrip':'טיול קודם',
  'friends.manualTitle':'הוספת נקודה משותפת ידנית',
  'friends.manualHint':'הדביקו קישור שיתוף או קואורדינטות (למשל 45.09240, 6.06994).',
  'friends.manualBad':'לא זיהינו קישור או קואורדינטות — בדקו והדביקו שוב.',
  'friends.meetLabel':'נקודת מפגש',
  'friends.shareMeet':'שתף כנקודת מפגש',
  'friends.whatsappLive':'רוצים שיתוף חי באמת? המיקום החי של וואטסאפ (15 דק׳ / שעה / 8 שעות) עובד כבר היום — הוא רץ בוואטסאפ, לא במפה הזו, והמיקום החי של החברים לא יופיע כאן.',
  'friends.newPointToast':'📍 {name} — שותף לפני {n} דק׳',
  'friends.wrongResort':'הנקודה הזו שייכת למפת {resort}.',
  'friends.openResortMap':'פתח את מפת {resort}',
  navStart:'התחל ניווט', navNextStep:'הצעד הבא', navOnPiste:'מסלול', navOnLift:'מעלית', navOnWalk:'הליכה',
  navRidingLift:'נוסע במעלית', navThen:'אחר כך', navRemaining:'נותר', navEnd:'סיום',
  navOffRoute:'סטית מהמסלול', navReroute:'נתב מחדש', navSearchingGps:'מחפש GPS…',
  navPreview:'תצוגה מקדימה', navArrived:'הגעת ליעד', navPlanReturn:'תכנון חזרה',
  navReplace:'יש מסלול פעיל. להחליף אותו במסלול החדש?', navFollow:'עקוב', navFree:'שחרר',
  navEta:'הגעה משוערת', navDest:'יעד', navLocked:'ההגדרות נעולות בזמן ניווט',
  theme:'ערכת נושא', themeAuto:'לפי המכשיר', themeLight:'בהיר', themeDark:'כהה',
  language:'שפה', about:'אודות', offline:'אופליין', layers:'שכבות', legend:'מקרא',
  sosCall:'חיוג חירום 112', sosCopy:'העתקת מיקום', sosCopied:'המיקום הועתק',
  sosShare:'שיתוף מיקום', sosWhatsapp:'שליחה בוואטסאפ', recents:'אחרונים', noResults:'לא נמצאו תוצאות',
  searchPlaceholder:'חיפוש יעד, מסלול או מעלית…', routeTo:'מסלול אל', details:'פרטים',
  endNav:'סיום ניווט', clearRoute:'ניקוי מסלול', planReturn:'תכנון חזרה',
  km:'ק״מ', min:'דקות', m:'מ׳', kmh:'קמ״ש'
},
en:{
  search:'Search', route:'Route', record:'Record', plan:'Plan', sos:'SOS', settings:'Settings',
  'bar.search':'Search', 'bar.route':'Route', 'bar.plan':'Plan', 'bar.sos':'SOS',
  'settings.themeAuto':'Device', 'settings.themeLight':'Light', 'settings.themeDark':'Dark',
  close:'Close', cancel:'Cancel', back:'Back', demo:'demo',
  startPoint:'Start point', villageDemo:'Village (demo)', myLocation:'My location',
  gpsSearching:'Searching for GPS…', gpsError:'Could not get location',
  saveOffline:'Save map for offline', savedOffline:'Map saved for offline', savingOffline:'Saving map…',
  offlineSavedOn:'Saved', offlineClear:'Delete saved map',
  recStart:'Start recording', recStop:'Stop', recRecording:'Recording…', recSaved:'Recording saved',
  recSummary:'Day summary', recNoPoints:'No points were recorded in this track.',
  recDistance:'Distance', recDuration:'Duration', recVertical:'Vertical', recTopSpeed:'Top speed',
  recLongestRun:'Longest run', recToday:'Today', recLeaderboard:'Today’s board (this device only)',
  recExport:'Export GPX', recDelete:'Delete', recShowOnMap:'Show on map', recHide:'Hide',
  recLimits:'Note: wake lock keeps the screen on, but when the screen locks or the browser goes to background the OS may release the lock and throttle GPS. Points are saved locally while recording, so an interruption never erases what was already recorded.',
  recTracks:'Tracks', recNone:'No tracks yet.', recNoAlt:'— (no altitude data)',
  friend:'Friend', friends:'Friends', addFriend:'Add friend', friendName:'Friend’s name',
  friendLat:'Latitude', friendLon:'Longitude', placeOnMap:'Place on map', pasteLink:'Paste link (Google Maps / geo:)',
  shareMyLocation:'Share my location', linkCopied:'Link copied', friendAdded:'Friend added',
  invalidLink:'No coordinates found in the link', tapMapToPlace:'Tap the map to place the friend',
  navigateTo:'Navigate to', noFriends:'No friends yet — add one or invite someone to the trip.',
  demoFriendNote:'Demo friend — tap the marker on the map to navigate to them.',
  trips:'Trip groups', tripGroups:'Trip groups', mySharing:'Share my location',
  sharingOn:'Sharing', sharingOff:'Off', members:'Group members', invite:'Invite to group',
  inviteCopied:'Invite link copied', joinTrip:'Join group', addMember:'Add member',
  memberName:'Name', you:'You', locationOff:'Location off', pickTripFirst:'Pick a group first',
  tripActive:'Active group', noMembers:'No other members yet.',
  liveSyncNote:'Positions are snapshots from when they were shared, not live tracking. They expire after 60 minutes.',
  'friends.title':'Friends & trips 👥',
  'friends.openRow':'👥 Friends & trips',
  'friends.openRowCount':'👥 Friends & trips · {n} on the mountain',
  'friends.trip':'Trip',
  'friends.noTrip':'No active trip at this resort — create a trip or open an invite link.',
  'friends.shareMySpot':'📍 Share my spot in this trip',
  'friends.shareOffNote':'Off — nothing is shared until you tap this.',
  'friends.shareLocating':'Getting your GPS position…',
  'friends.shareGpsFail':'Could not get GPS. Try again, or share the map centre instead.',
  'friends.shareMapCentre':'Share the map centre',
  'friends.shareMapCentreNote':'Map-centre point, not a GPS position.',
  'friends.sharedAt':'✓ Shared at {time} — link ready below',
  'friends.shareAgain':'↻ Take a fresh position',
  'friends.shareAgainNote':'Position from {time} — share again for a fresh position.',
  'friends.stopSharing':'■ Stop sharing',
  'friends.stopSharingNote':'Stopping deletes the point from your phone. Links already sent keep working until they expire.',
  'friends.shareVia':'Share via…',
  'friends.copyLink':'📋 Copy link',
  'friends.linkCopied':'Link copied',
  'friends.shareWhats':'💬 Share on WhatsApp',
  'friends.shareText':'📍 {name} shared their spot on the {resort} map — open to see it and route to them: {url}',
  'friends.expiredNote':'Your last shared position expired at {time}.',
  'friends.expiredLink':'This shared position has expired.',
  'friends.onMountain':"Who's on the mountain",
  'friends.sharedAgo':'📍 {n} min ago · {dist} as the crow flies',
  'friends.sharedStale':'⚠️ {n} min ago — may have moved',
  'friends.noPosition':'— No shared position',
  'friends.youSharing':'You — sharing since {time}',
  'friends.youNotSharing':'You — not sharing',
  'friends.routeTo':'Route to {name} ▶',
  'friends.dismiss':'Dismiss',
  'friends.showOnMap':'Show on map',
  'friends.freshnessNote':'Positions are snapshots from when they were shared, not live tracking. They expire after 60 minutes.',
  'friends.noRoute':"No ski route to this point (it's off the piste network). Straight-line distance: {dist}.",
  'friends.farPoint':'⚠️ This point is far from {resort} — check it is correct.',
  'friends.joinTitle':'{name} shared their spot in the trip {trip}',
  'friends.joinBody':'Join the trip to see them on the map. Anyone with the link can join — there is no admin approval.',
  'friends.join':'Join trip',
  'friends.justShow':'Just show this point',
  'friends.unknownTrip':"Trip {trip} isn't known on this phone — the point is shown once.",
  'friends.yourName':'Your name in this trip',
  'friends.newTrip':'+ New trip',
  'friends.leaveTrip':'Leave trip',
  'friends.leaveConfirm':"Leave {trip}? Your shared points in this trip will expire. Other members won't be told.",
  'friends.inviteLink':'Invite link',
  'friends.pastTrip':'Past trip',
  'friends.manualTitle':'Add a shared point manually',
  'friends.manualHint':'Paste a share link or coordinates (e.g. 45.09240, 6.06994).',
  'friends.manualBad':"Couldn't recognise a link or coordinates — check and paste again.",
  'friends.meetLabel':'Meeting point',
  'friends.shareMeet':'Share as meeting point',
  'friends.whatsappLive':"Want truly live sharing? WhatsApp live location (15 min / 1 h / 8 h) works today — it runs in WhatsApp, not on this map, and friends' live positions won't appear here.",
  'friends.newPointToast':'📍 {name} — shared {n} min ago',
  'friends.wrongResort':'This point belongs to the {resort} map.',
  'friends.openResortMap':'Open the {resort} map',
  navStart:'Start navigation', navNextStep:'Next step', navOnPiste:'Piste', navOnLift:'Lift', navOnWalk:'Walk',
  navRidingLift:'Riding lift', navThen:'Then', navRemaining:'remaining', navEnd:'End',
  navOffRoute:'You are off route', navReroute:'Re-route', navSearchingGps:'Searching for GPS…',
  navPreview:'Preview', navArrived:'You arrived', navPlanReturn:'Plan return',
  navReplace:'A route is already active. Replace it with the new route?', navFollow:'Follow', navFree:'Free',
  navEta:'ETA', navDest:'Destination', navLocked:'Settings are locked while navigating',
  theme:'Theme', themeAuto:'Device', themeLight:'Light', themeDark:'Dark',
  language:'Language', about:'About', offline:'Offline', layers:'Layers', legend:'Legend',
  sosCall:'Emergency call 112', sosCopy:'Copy location', sosCopied:'Location copied',
  sosShare:'Share location', sosWhatsapp:'Send on WhatsApp', recents:'Recent', noResults:'No results',
  searchPlaceholder:'Search a place, piste or lift…', routeTo:'Route to', details:'Details',
  endNav:'End navigation', clearRoute:'Clear route', planReturn:'Plan return',
  km:'km', min:'min', m:'m', kmh:'km/h'
}};
window.SF_STR = SF_STR;

/* ================= utils ================= */
function $(id){ return document.getElementById(id); }
function lang(){ var l=(document.documentElement.getAttribute('lang')||'he'); return l.indexOf('en')===0?'en':'he'; }
function t(k){ var L=SF_STR[lang()]; return (L&&L[k])||SF_STR.en[k]||k; }
function tf(k, vars){ var L=SF_STR[lang()]||{}; var s=(L[k]!=null?L[k]:(SF_STR.en[k]!=null?SF_STR.en[k]:k)); if(vars) for(var a in vars) s=String(s).split('{'+a+'}').join(vars[a]); return s; }
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
function haversine(a,b){ var R=6371000, dLa=(b[0]-a[0])*Math.PI/180, dLo=(b[1]-a[1])*Math.PI/180;
  var la1=a[0]*Math.PI/180, la2=b[0]*Math.PI/180;
  var h=Math.sin(dLa/2)*Math.sin(dLa/2)+Math.cos(la1)*Math.cos(la2)*Math.sin(dLo/2)*Math.sin(dLo/2);
  return 2*R*Math.asin(Math.sqrt(h)); }
function fmtDist(m){ if(m==null||isNaN(m)) return '—'; return m>=1000?(m/1000).toFixed(1)+' '+t('km'):Math.round(m)+' '+t('m'); }
function fmtDur(s){ if(s==null||isNaN(s)) return '—'; var m=Math.round(s/60); return m>=60?Math.floor(m/60)+'h '+(m%60)+' '+t('min'):m+' '+t('min'); }
function fmtClock(ts){ var d=new Date(ts); return ('0'+d.getHours()).slice(-2)+':'+('0'+d.getMinutes()).slice(-2); }
function store(k,v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }
function read(k,def){ try{ var v=localStorage.getItem(k); return v==null?def:JSON.parse(v); }catch(e){ return def; } }
function ls(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } }
function setLs(k,v){ try{ localStorage.setItem(k,v); }catch(e){} }

/* search helpers: fold accents + case so "Peclet" finds "Péclet", etc. */
function searchFold(s){ return String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
  .replace(/[’‘`]/g,"'").replace(/[-_]/g,' ').replace(/\s+/g,' ').trim().toLowerCase(); }
var CAT_KEYWORDS = {
  he:{'מעלית':'lift','מסלול':'piste','כחול':'blue','אדום':'red','שחור':'black','ירוק':'green','כפר':'village','תחנה':'station'},
  en:{'lift':'lift','piste':'piste','slope':'piste','blue':'blue','red':'red','black':'black','green':'green','village':'village','station':'station'}
};
function matchCategory(q){ var f=searchFold(q); var kw=CAT_KEYWORDS[lang()]||CAT_KEYWORDS.en;
  for(var k in kw){ if(f.indexOf(searchFold(k))!==-1) return kw[k]; } return null; }

/* ================= theme ================= */
function applyTheme(){
  var pref = ls('sf-theme'); // 'light' | 'dark' | null (device)
  var root = document.documentElement;
  if(pref==='light'||pref==='dark'){ root.setAttribute('data-theme', pref); }
  else { root.removeAttribute('data-theme'); }
  var seg = document.querySelectorAll('[data-theme-btn]');
  for(var i=0;i<seg.length;i++){ seg[i].classList.toggle('active', (seg[i].getAttribute('data-theme-btn')||'auto')===(pref||'auto')); }
}
function setTheme(mode){ setLs('sf-theme', mode==='auto'?'':mode); if(mode==='auto'){ try{localStorage.removeItem('sf-theme');}catch(e){} } applyTheme(); }

/* ================= toast (status) ================= */
var toastTimer = null;
function toast(msg, isErr){
  var el = $('status'); if(!el) return;
  el.textContent = msg;
  el.classList.add('show'); if(isErr) el.classList.add('err'); else el.classList.remove('err');
  if(toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(function(){ el.classList.remove('show'); }, 6000);
}
function setStatus(msg, isErr){ toast(msg, isErr); }

/* ================= bottom sheet ================= */
var sheetPane = null;
function sheetEl(){ return $('sheet'); }
function openSheet(pane, detent){
  var sh = sheetEl(); if(!sh) return;
  sheetPane = pane;
  var panes = sh.querySelectorAll('.pane');
  for(var i=0;i<panes.length;i++){ panes[i].classList.toggle('active', panes[i].id==='pane-'+pane); }
  sh.classList.add('open');
  sh.classList.remove('peek','half','full');
  sh.classList.add(detent||'peek');
  sh.style.height = '';
  var mw = $('mapWrap'); if(mw) mw.classList.add('sheet-open');
  var rc = $('routeCard'); if(rc) rc.classList.remove('show');
  var scrim = $('scrim'); if(scrim) scrim.classList.toggle('show', (detent||'peek')==='full');
  var btns = document.querySelectorAll('#actionbar .navbtn[data-pane]');
  for(var j=0;j<btns.length;j++){ btns[j].setAttribute('aria-pressed', btns[j].getAttribute('data-pane')===pane?'true':'false'); }
}
function closeSheet(){
  var sh = sheetEl(); if(!sh) return;
  sheetPane = null;
  sh.classList.remove('open','peek','half','full'); sh.style.height = '';
  sh.querySelectorAll('.pane.active').forEach(function(p){ p.classList.remove('active'); }); // closed-sheet controls must measure 0x0 (L1: a hidden settings-pane button otherwise steals the LANG tap)
  var app = document.getElementById('app'); if(app) app.classList.remove('sos-over-nav');
  var mw = $('mapWrap'); if(mw) mw.classList.remove('sheet-open');
  var scrim = $('scrim'); if(scrim) scrim.classList.remove('show');
  var btns = document.querySelectorAll('#actionbar .navbtn[data-pane]');
  for(var j=0;j<btns.length;j++){ btns[j].setAttribute('aria-pressed','false'); }
  if(window.SFMap && SFMap.getRoute && SFMap.getRoute()){ var rc=$('routeCard'); if(rc) rc.classList.add('show'); }
}
function cycleDetent(){
  var sh = sheetEl(); if(!sh) return;
  if(!sh.classList.contains('open')){ openSheet(sheetPane||'search','peek'); return; }
  if(sh.classList.contains('peek')){ sh.classList.replace('peek','half'); }
  else if(sh.classList.contains('half')){ sh.classList.replace('half','full'); var sc=$('scrim'); if(sc) sc.classList.add('show'); }
  else { closeSheet(); }
}
function initSheetDrag(){
  var h = document.querySelector('#sheet .sheet-handle'); var sh = sheetEl();
  if(!h||!sh) return;
  h.addEventListener('click', function(){ cycleDetent(); });
  var startY=null, startH=0;
  h.addEventListener('touchstart', function(e){ startY=e.touches[0].clientY; startH=sh.getBoundingClientRect().height; }, {passive:true});
  h.addEventListener('touchmove', function(e){
    if(startY==null) return; e.preventDefault();
    var nh = startH + (startY - e.touches[0].clientY);
    if(nh<40){ sh.style.height='0px'; } else { sh.style.height=Math.min(nh, window.innerHeight*0.9)+'px'; sh.classList.add('open'); }
  }, {passive:false});
  h.addEventListener('touchend', function(){
    if(startY==null) return; startY=null;
    var vh = window.innerHeight, hgt = sh.getBoundingClientRect().height;
    sh.style.height='';
    if(hgt<vh*0.12){ closeSheet(); }
    else if(hgt<vh*0.40){ sh.classList.remove('half','full'); sh.classList.add('peek'); }
    else if(hgt<vh*0.68){ sh.classList.remove('peek','full'); sh.classList.add('half'); }
    else { sh.classList.remove('peek','half'); sh.classList.add('full'); var sc=$('scrim'); if(sc) sc.classList.add('show'); }
  });
}

/* ================= config / state ================= */
var cfg = { slug:'', resortName:'', demoFriend:null, trips:[], activeTrip:null };
var TRIPS = {
  'alpe-2027':   { id:'alpe-2027',   resort:'alpe-d-huez', he:'אלפ דואז · 8–15 בינואר',        en:"Alpe d'Huez · 8–15 Jan" },
  'laplagne-2027':{ id:'laplagne-2027',resort:'la-plagne',   he:'לה פלאן · 31 בינואר – 7 בפברואר', en:'La Plagne · 31 Jan – 7 Feb' }
};
function tripName(tr){ return lang()==='en'?tr.en:tr.he; }
function tripsState(){ return read('sf-trips', {active:null, mySharing:{}, members:{}, joined:{}}); }
function saveTripsState(s){ store('sf-trips', s); }

/* ================= start label / demo badge ================= */
function setStartLabel(text, isDemo){
  var el = $('startLabel'); if(!el) return;
  el.innerHTML = '<span class="dot'+(isDemo?' demo':'')+'"></span><span>'+esc(text)+'</span>';
}

/* ================= offline badge ================= */
function offlineInfo(){ return read('sf-offline-'+cfg.slug, null); }
function renderOfflineBadge(){
  var info = offlineInfo();
  var el = $('offlineStatus'); if(el){ el.textContent = info ? (t('offlineSavedOn')+' '+info.date+' · '+info.mb+' MB') : ''; }
  var chip = $('offlineChip'); if(chip){ chip.classList.toggle('saved', !!info); }
  var gb = $('gearBtn'); if(gb){ gb.classList.toggle('has-dot', !!info); }
}
function markOfflineSaved(mb){ store('sf-offline-'+cfg.slug, {mb: Math.round(mb*10)/10, date: new Date().toISOString().slice(0,10)}); renderOfflineBadge(); }
function clearOfflineSaved(){ try{ localStorage.removeItem('sf-offline-'+cfg.slug); }catch(e){} renderOfflineBadge(); }

/* ================= Record (Wake Lock + local tracks) =================
   Wake lock: requested on start, released on stop. The OS releases it when
   the screen locks or the browser backgrounds — we re-request on
   visibilitychange when visible again, and we say so in the UI. Points are
   written to IndexedDB as they arrive (auto-save), so an interruption loses
   points, never the whole track. */
var Rec = (function(){
  var rec = { active:false, id:null, points:[], startTs:0, watchId:null, lock:null, db:null, lastSave:0 };
  var DBNAME='sf-tracks', STORE='tracks';

  function idb(){ return new Promise(function(res){
    if(!('indexedDB' in window)){ res(null); return; }
    var rq = indexedDB.open(DBNAME, 1);
    rq.onupgradeneeded = function(){ rq.result.createObjectStore(STORE, {keyPath:'id'}); };
    rq.onsuccess = function(){ res(rq.result); };
    rq.onerror = function(){ res(null); };
  }); }
  function idbPut(track){ if(!rec.db) return; try{ var tx=rec.db.transaction(STORE,'readwrite'); tx.objectStore(STORE).put(track); }catch(e){} }
  function idbAll(){ return new Promise(function(res){
    idb().then(function(db){ if(!db){ res([]); return; }
      try{ var rq=db.transaction(STORE,'readonly').objectStore(STORE).getAll();
        rq.onsuccess=function(){ res(rq.result||[]); }; rq.onerror=function(){ res([]); };
      }catch(e){ res([]); } });
  }); }
  function idbDel(id){ idb().then(function(db){ if(!db) return; try{ db.transaction(STORE,'readwrite').objectStore(STORE).delete(id); }catch(e){} }); }

  function requestLock(){
    if(!('wakeLock' in navigator)) return Promise.resolve(null);
    return navigator.wakeLock.request('screen').then(function(l){
      rec.lock = l;
      l.addEventListener('release', function(){ if(rec.active && !document.hidden){ requestLock(); } });
      return l;
    }).catch(function(){ return null; });
  }
  document.addEventListener('visibilitychange', function(){
    if(rec.active && !document.hidden && (!rec.lock || rec.lock.released)){ requestLock(); }
  });

  function onFix(pos){
    if(!rec.active) return;
    var c = pos.coords||{};
    rec.points.push({ t: Date.now(), lat:c.latitude, lon:c.longitude,
      alt:(c.altitude==null?null:c.altitude), acc:(c.accuracy==null?null:c.accuracy),
      spd:(c.speed==null?null:c.speed) });
    if(Date.now()-rec.lastSave>30000){ rec.lastSave=Date.now(); saveCurrent(); }
  }
  function onFixErr(){ /* keep recording; points resume when GPS returns */ }

  function saveCurrent(){
    if(!rec.points.length) return;
    var track = { id: rec.id, resort: cfg.slug, startTs: rec.startTs, endTs: Date.now(),
      points: rec.points, stats: computeStats(rec.points, rec.startTs, Date.now()) };
    idbPut(track);
  }
  function computeStats(points, startTs, endTs){
    var st = { distance:0, duration: Math.max(0,(endTs-startTs)/1000), gain:0, loss:0, topSpeed:0, longestRun:0, n: points.length };
    if(points.length<2) return st;
    var hasAlt = points.some(function(p){ return p.alt!=null; });
    var runStart = 0, runDist = 0, runGain = 0;
    var lastMoveTs = points[0].t;
    for(var i=1;i<points.length;i++){
      var a=points[i-1], b=points[i];
      var d = haversine([a.lat,a.lon],[b.lat,b.lon]);
      var dt = Math.max(1,(b.t-a.t)/1000);
      st.distance += d;
      var spd = (b.spd!=null?b.spd:(d/dt));
      if(spd>st.topSpeed) st.topSpeed = spd;
      if(hasAlt && a.alt!=null && b.alt!=null){
        var dh = b.alt-a.alt; if(dh>0) st.gain+=dh; else st.loss-=dh;
      }
      // longest continuous run: break on a stop (>=60s with speed <0.5 m/s) or a gap >180s
      var stopped = (spd<0.5 && dt>=60) || dt>180;
      if(stopped){
        if(runDist>st.longestRun) st.longestRun = runDist;
        runStart=i; runDist=0; runGain=0;
      } else { runDist += d; if(hasAlt && a.alt!=null && b.alt!=null && b.alt<a.alt) runGain += (a.alt-b.alt); }
      if(spd>=0.5) lastMoveTs = b.t;
    }
    if(runDist>st.longestRun) st.longestRun = runDist;
    if(!hasAlt){ st.gain=null; st.loss=null; }
    return st;
  }

  function setRecUI(on){
    var btn = $('recBtn'); if(!btn) return;
    btn.classList.toggle('recording', !!on);
    var lbl = btn.querySelector('.reclbl'); if(lbl) lbl.textContent = on ? t('recStop') : t('record');
    var ic = btn.querySelector('.recbtn'); if(ic) ic.textContent = on ? '■' : '●';
    btn.setAttribute('aria-label', on ? t('recStop') : t('recStart'));
  }

  function start(){
    if(rec.active) return;
    rec.active = true; rec.id = 'trk-'+Date.now(); rec.points=[]; rec.startTs=Date.now(); rec.lastSave=Date.now();
    setRecUI(true);
    requestLock();
    if('geolocation' in navigator){
      try{ rec.watchId = navigator.geolocation.watchPosition(onFix, onFixErr, {enableHighAccuracy:true, maximumAge:5000, timeout:20000}); }catch(e){}
    }
    toast(t('recRecording'));
    idb().then(function(db){ rec.db=db; });
  }
  function stop(){
    if(!rec.active) return;
    rec.active = false;
    if(rec.watchId!=null && 'geolocation' in navigator){ try{ navigator.geolocation.clearWatch(rec.watchId); }catch(e){} rec.watchId=null; }
    if(rec.lock){ try{ var p=rec.lock.release(); if(p&&p.catch) p.catch(function(){}); }catch(e){} rec.lock=null; }
    setRecUI(false);
    saveCurrent();
    toast(t('recSaved'));
    renderSummary();
    openSheet('summary','peek');
  }
  function toggle(){ if(rec.active) stop(); else start(); }

  function gpx(track){
    var s='<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="SnowForecast">\n<trk><name>'+esc(track.id)+'</name><trkseg>\n';
    track.points.forEach(function(p){
      s+='<trkpt lat="'+p.lat+'" lon="'+p.lon+'">'+(p.alt!=null?'<ele>'+Math.round(p.alt)+'</ele>':'')+'<time>'+new Date(p.t).toISOString()+'</time></trkpt>\n';
    });
    return s+'</trkseg></trk></gpx>';
  }
  function download(name, text, mime){
    var b = new Blob([text], {type: mime||'application/gpx+xml'});
    var a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  var drawnLayer = null;
  function showOnMap(track){
    if(!window.SFMap || !SFMap.getMap || !window.L) return;
    var map = SFMap.getMap(); if(!map) return;
    if(drawnLayer){ map.removeLayer(drawnLayer); drawnLayer=null; }
    var latlngs = track.points.map(function(p){ return [p.lat,p.lon]; });
    if(latlngs.length<2) return;
    drawnLayer = L.polyline(latlngs, {color:'#e0218a', weight:4}).addTo(map);
    map.fitBounds(drawnLayer.getBounds().pad(0.2));
  }
  function hideTrack(){ if(drawnLayer && window.SFMap && SFMap.getMap()){ SFMap.getMap().removeLayer(drawnLayer); } drawnLayer=null; }

  function trackRow(tr){
    var st = tr.stats||{};
    var d = new Date(tr.startTs);
    var day = d.toLocaleDateString(lang()==='en'?'en-GB':'he-IL', {day:'numeric', month:'short'});
    var html = '<div class="member"><div class="who"><b>'+esc(day+' · '+fmtClock(tr.startTs))+'</b>'
      + '<small>'+esc(fmtDist(st.distance||0))+' · '+esc(fmtDur(st.duration||0))
      + (st.topSpeed? ' · '+esc((st.topSpeed*3.6).toFixed(0)+' '+t('kmh')):'')+'</small></div>'
      + '<button class="btn" data-act="show" data-id="'+esc(tr.id)+'">'+esc(t('recShowOnMap'))+'</button>'
      + '<button class="btn" data-act="gpx" data-id="'+esc(tr.id)+'">GPX</button>'
      + '<button class="btn danger" data-act="del" data-id="'+esc(tr.id)+'">'+esc(t('recDelete'))+'</button></div>';
    return html;
  }
  function renderSummary(){
    var pane = $('pane-summary'); if(!pane) return;
    var title = pane.querySelector('h2 span'); if(title) title.textContent = t('recSummary');
    idbAll().then(function(all){
      all.sort(function(a,b){ return b.startTs-a.startTs; });
      var mine = all.filter(function(x){ return x.resort===cfg.slug; });
      var today = new Date(); today.setHours(0,0,0,0);
      var todays = mine.filter(function(x){ return x.startTs>=today.getTime(); });
      var totDist=0, totDur=0, topSpd=0, longest=0, gain=0;
      todays.forEach(function(x){ var s=x.stats||{}; totDist+=(s.distance||0); totDur+=(s.duration||0);
        if((s.topSpeed||0)>topSpd) topSpd=s.topSpeed||0; if((s.longestRun||0)>longest) longest=s.longestRun||0;
        if(s.gain) gain+=s.gain; });
      var html = '<p class="muted">'+esc(t('recLimits'))+'</p>';
      html += '<div class="card"><h3>'+esc(t('recToday'))+'</h3>'
        + '<div class="kv"><span>'+esc(t('recDistance'))+'</span><b>'+esc(fmtDist(totDist))+'</b></div>'
        + '<div class="kv"><span>'+esc(t('recDuration'))+'</span><b>'+esc(fmtDur(totDur))+'</b></div>'
        + '<div class="kv"><span>'+esc(t('recVertical'))+'</span><b>'+(gain?esc(Math.round(gain)+' '+t('m')):esc(t('recNoAlt')))+'</b></div>'
        + '<div class="kv"><span>'+esc(t('recTopSpeed'))+'</span><b>'+(topSpd?esc((topSpd*3.6).toFixed(0)+' '+t('kmh')):'—')+'</b></div>'
        + '<div class="kv"><span>'+esc(t('recLongestRun'))+'</span><b>'+esc(fmtDist(longest))+'</b></div></div>';
      if(todays.length>1){
        var board = todays.slice().sort(function(a,b){ return (b.stats.distance||0)-(a.stats.distance||0); });
        html += '<div class="card"><h3>'+esc(t('recLeaderboard'))+'</h3>';
        board.forEach(function(x,i){ html += '<div class="kv"><span>'+(i+1)+'. '+esc(fmtClock(x.startTs))+'</span><b>'+esc(fmtDist(x.stats.distance||0))+'</b></div>'; });
        html += '</div>';
      }
      html += '<div class="card"><h3>'+esc(t('recTracks'))+'</h3>';
      html += mine.length ? mine.slice(0,10).map(trackRow).join('') : '<p class="muted">'+esc(t('recNone'))+'</p>';
      html += '</div>';
      var body = pane.querySelector('.summary-body'); if(body) body.innerHTML = html;
      pane.querySelectorAll('[data-act]').forEach(function(b){
        b.addEventListener('click', function(){
          var id=b.getAttribute('data-id'), act=b.getAttribute('data-act');
          var tr = mine.find(function(x){ return x.id===id; }); if(!tr) return;
          if(act==='show'){ showOnMap(tr); closeSheet(); }
          else if(act==='gpx'){ download(id+'.gpx', gpx(tr)); }
          else if(act==='del'){ idbDel(id); renderSummary(); }
        });
      });
    });
  }

  return { start:start, stop:stop, toggle:toggle, isActive:function(){ return rec.active; },
    renderSummary:renderSummary, computeStats:computeStats, idbAll:idbAll, hideTrack:hideTrack };
})();

/* ================= Friends — ws7 position drops (?f=) =================
   Web-only, no backend, no live sync: a friend's point arrives as a
   base64url JSON payload in a ?f= share link (spec round2/ws7-sharing.md
   §2.4), is stored locally in sf-friends with its fix time, and expires
   after 60 min (fresh <15 min, stale 15–60, expired >60 → pruned on load
   and whenever the Friends sheet opens). Newer ts wins per (trip, fid);
   an older re-opened link never rewinds a fresher point. Every rendered
   point shows its age; the sheet states plainly that positions are
   snapshots, not live tracking. Sharing is off by default and always a
   deliberate tap: "Share my spot" takes one GPS fix and produces a link
   the user sends themselves (Web Share / copy / wa.me). "Stop sharing"
   deletes the local record only — links already sent keep working until
   they expire. Trip ids stay the code's own (alpe-2027, laplagne-2027).
   Demo friend + #friend= / #trip= hash imports are kept as-is. */
var Friends = (function(){
  /* ---- pure payload functions (no DOM, no Leaflet, no storage) ---- */
  var FRESH_MS = 15*60*1000, STALE_MS = 60*60*1000, DAY_MS = 24*60*60*1000;
  var PALETTE = ['#7dd3fc','#f87171','#4ade80','#facc15','#c084fc','#fb923c','#2dd4bf','#f472b6','#a3e635'];
  var RESORT_FILES = {'alpe-d-huez':'map-alpe-d-huez.html','la-plagne':'map-la-plagne.html','val-thorens':'map-val-thorens.html'};
  var RESORT_NAMES = {'alpe-d-huez':"Alpe d'Huez",'la-plagne':'La Plagne','val-thorens':'Val Thorens'};

  var markers = {};       // id -> {marker, acc}
  var justOpened = {};    // id -> true (link-opened this session; visible once)
  var pendingPrompt = null; // {type:'join'|'unknown'|'mismatch'|'expired', payload, enc, entry}
  var peekId = null;
  var shareState = 'idle'; // idle | locating | shared | failed
  var shareRec = null;     // current sf-share record
  var lastShareExpiredAt = null;
  var justStopped = false;
  var meetShare = null;    // {url, label, ts}
  var confirmLeave = false;
  var showNewTrip = false;

  function hash32(s){ var h=0; s=String(s||''); for(var i=0;i<s.length;i++){ h=((h<<5)-h+s.charCodeAt(i))|0; } return Math.abs(h); }
  function b64urlEncode(str){
    try{
      var bytes = new TextEncoder().encode(str);
      var bin=''; for(var i=0;i<bytes.length;i++) bin+=String.fromCharCode(bytes[i]);
      return btoa(bin).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
    }catch(e){ return null; }
  }
  function b64urlDecode(s){
    try{
      var b64 = String(s).replace(/-/g,'+').replace(/_/g,'/');
      while(b64.length%4) b64+='=';
      var bin = atob(b64);
      var bytes = new Uint8Array(bin.length);
      for(var i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i);
      return new TextDecoder().decode(bytes);
    }catch(e){ return null; }
  }
  function encodePayload(p){ if(!p||typeof p!=='object') return null; try{ return b64urlEncode(JSON.stringify(p)); }catch(e){ return null; } }
  function decodePayload(s){ if(!s||typeof s!=='string') return null; var txt=b64urlDecode(s); if(txt==null) return null; try{ var o=JSON.parse(txt); return (o&&typeof o==='object'&&!Array.isArray(o))?o:null; }catch(e){ return null; } }
  function validatePayload(p, now){
    now = (typeof now==='number')?now:Date.now();
    if(!p||typeof p!=='object') return {ok:false, reason:'not-object'};
    if(p.v!==1) return {ok:false, reason:'version'};
    if(p.kind!=='friend'&&p.kind!=='meet') return {ok:false, reason:'kind'};
    if(typeof p.lat!=='number'||!isFinite(p.lat)||p.lat<-90||p.lat>90) return {ok:false, reason:'lat'};
    if(typeof p.lon!=='number'||!isFinite(p.lon)||p.lon<-180||p.lon>180) return {ok:false, reason:'lon'};
    if(typeof p.ts!=='number'||!isFinite(p.ts)) return {ok:false, reason:'ts'};
    if(p.ts < now-DAY_MS) return {ok:false, reason:'too-old'};
    if(p.ts > now+5*60*1000) return {ok:false, reason:'future'};
    if(typeof p.trip!=='string'||!p.trip||p.trip.length>40||!/^[a-z0-9-]+$/.test(p.trip)) return {ok:false, reason:'trip'};
    if(p.from!=null&&(typeof p.from!=='string'||p.from.length>60)) return {ok:false, reason:'from'};
    if(p.label!=null&&(typeof p.label!=='string'||p.label.length>60)) return {ok:false, reason:'label'};
    if(p.resort!=null&&(typeof p.resort!=='string'||!/^[a-z0-9-]+$/.test(p.resort))) return {ok:false, reason:'resort'};
    if(p.acc!=null&&(typeof p.acc!=='number'||!isFinite(p.acc)||p.acc<0)) return {ok:false, reason:'acc'};
    if(p.fid!=null&&(typeof p.fid!=='string'||p.fid.length>60)) return {ok:false, reason:'fid'};
    if(p.kind==='friend'&&(!p.from||!p.from.trim())) return {ok:false, reason:'from'};
    var ts = p.ts>now ? now : p.ts; // small future skew clamped to now
    return {ok:true, p:{v:1, kind:p.kind,
      fid:(typeof p.fid==='string'&&p.fid)?p.fid:null,
      from:(typeof p.from==='string'?p.from.trim().slice(0,60):''),
      trip:p.trip, lat:p.lat, lon:p.lon,
      acc:(typeof p.acc==='number'?Math.round(p.acc):null), ts:ts,
      label:(typeof p.label==='string'?p.label.trim().slice(0,60):null),
      resort:(typeof p.resort==='string'?p.resort:null)}};
  }
  function freshness(ts, now){
    if(ts==null) return 'fresh';
    now = (typeof now==='number')?now:Date.now();
    var age = now-ts; if(age<0) age=0;
    if(age<FRESH_MS) return 'fresh';
    if(age<STALE_MS) return 'stale';
    return 'expired';
  }
  function ageMin(ts, now){ return Math.max(0, Math.floor((((typeof now==='number')?now:Date.now())-ts)/60000)); }
  function ageText(ts, now){ var n=ageMin(ts,now); return lang()==='he' ? ('לפני '+n+' דק׳') : (n+' min ago'); }
  function shareUrl(resort, payload){
    var enc=encodePayload(payload); if(!enc) return null;
    var file = RESORT_FILES[resort]||('map-'+resort+'.html');
    var dir = '/guides/';
    try{ var pa=location.pathname||''; var i=pa.lastIndexOf('/'); if(i>=0) dir=pa.slice(0,i+1); }catch(e){}
    return location.origin+dir+file+'?f='+enc;
  }
  function meetPayload(trip, lat, lon, label){
    return {v:1, kind:'meet', fid:null, from:myName(), trip:trip, lat:lat, lon:lon, acc:null, ts:Date.now(), label:(label||null), resort:cfg.slug};
  }

  /* ---- store (localStorage only: sf-friends, sf-share, sf-me) ---- */
  function list(){ return read('sf-friends', []); }
  function save(l){ store('sf-friends', l); }
  function loadFriends(){ return list(); }
  function saveFriends(l){ save(l); }
  function loadShare(){ return read('sf-share', null); }
  function saveShare(rec){ store('sf-share', rec); shareRec=rec; }
  function clearShare(){ try{ localStorage.removeItem('sf-share'); }catch(e){} shareRec=null; }
  function colorFor(fid){ return PALETTE[hash32(fid||'?')%PALETTE.length]; }
  function initials(name){
    var parts=String(name||'?').trim().split(/\s+/).filter(Boolean);
    var a=parts.length?parts[0].charAt(0):'?';
    var b=parts.length>1?parts[parts.length-1].charAt(0):'';
    return (a+b).toUpperCase();
  }
  function fidFor(pt){
    if(pt.fid) return pt.fid;
    if(pt.kind==='meet') return 'meet-'+pt.ts+'-'+hash32(pt.lat+'|'+pt.lon+'|'+(pt.label||'')).toString(36);
    return 'm-'+hash32(pt.trip+'|'+(pt.from||'')).toString(36);
  }
  function upsertFriend(pt, source){
    var l=list(); var now=Date.now();
    var fid=fidFor(pt);
    var name = pt.kind==='meet' ? (pt.label||tf('friends.meetLabel')) : (pt.from||t('friend'));
    var entry=null;
    for(var i=0;i<l.length;i++){ if(l[i].trip===pt.trip && l[i].fid===fid){ entry=l[i]; break; } }
    if(entry && entry.ts!=null && pt.ts!=null && entry.ts>=pt.ts) return {entry:entry, changed:false};
    var rec={id: entry?entry.id:('fr-'+now+'-'+Math.random().toString(36).slice(2,7)),
      fid:fid, trip:pt.trip, kind:pt.kind||'friend', name:name,
      color: entry?entry.color:colorFor(fid),
      lat:pt.lat, lon:pt.lon, acc:(pt.acc==null?null:pt.acc), ts:(pt.ts==null?null:pt.ts),
      receivedAt:now, source:source||'link', resort:pt.resort||cfg.slug||'',
      label: pt.kind==='meet'?(pt.label||null):null};
    if(entry){ l[l.indexOf(entry)]=rec; } else { l.push(rec); }
    save(l); render();
    return {entry:rec, changed:true};
  }
  function add(f){
    f=f||{};
    if(f.fid&&f.trip){
      var r=upsertFriend({v:1, kind:f.kind||'friend', fid:f.fid, from:f.name, trip:f.trip,
        lat:f.lat, lon:f.lon, acc:(f.acc==null?null:f.acc), ts:(f.ts==null?null:f.ts),
        label:f.label||null, resort:f.resort||cfg.slug||''}, f.source||'manual');
      return r.entry;
    }
    var l=list();
    if(!f.id) f.id='fr-'+Date.now();
    if(f.ts==null) f.ts=null;
    if(!f.kind) f.kind='friend';
    if(!f.resort) f.resort=cfg.slug||'';
    if(f.acc==null) f.acc=null;
    if(!f.source) f.source='manual';
    var i=l.findIndex(function(x){ return x.id===f.id; });
    if(i>=0) l[i]=f; else l.push(f);
    save(l); render(); return f;
  }
  function remove(id){ save(list().filter(function(x){ return x.id!==id; })); render(); }
  function get(id){ return list().find(function(x){ return x.id===id; }); }
  function pruneExpired(now){
    now=(typeof now==='number')?now:Date.now();
    var l=list(), kept=[], n=0;
    l.forEach(function(f){ if(f.ts!=null&&freshness(f.ts,now)==='expired') n++; else kept.push(f); });
    if(n) save(kept);
    var rec=loadShare();
    if(rec&&rec.ts!=null&&freshness(rec.ts,now)==='expired'){ lastShareExpiredAt=rec.ts; clearShare(); if(shareState==='shared') shareState='idle'; }
    if(n) render();
    return n;
  }

  /* ---- my identity + my share ---- */
  function myIdentity(){ var me=read('sf-me', null)||{}; return {name:me.name||'', color:me.color||PALETTE[0], fids:me.fids||{}}; }
  function setMyIdentity(name){ var me=read('sf-me', null)||{}; me.name=String(name||'').slice(0,60); me.color=me.color||PALETTE[0]; me.fids=me.fids||{}; store('sf-me', me); }
  function myName(){ return myIdentity().name||t('you'); }
  function myColor(){ return myIdentity().color; }
  function myFid(tripId){
    var me=read('sf-me', null)||{}; me.fids=me.fids||{};
    if(!me.fids[tripId]){ me.fids[tripId]='m-'+Math.random().toString(36).slice(2,10); store('sf-me', me); }
    return me.fids[tripId];
  }
  function activeTripForResort(){
    var id=(typeof Trips!=='undefined'&&Trips.activeId)?Trips.activeId():null;
    if(id&&TRIPS[id]&&TRIPS[id].resort===cfg.slug) return id;
    return null;
  }
  function shareTripId(){ return activeTripForResort(); }
  function syncShareState(){
    var rec=loadShare();
    if(!rec){ shareState='idle'; shareRec=null; return; }
    if(rec.ts!=null&&freshness(rec.ts)==='expired'){ lastShareExpiredAt=rec.ts; clearShare(); shareState='idle'; return; }
    shareRec=rec; shareState='shared';
  }
  function buildSharePayload(lat, lon, acc, ts, tripId){
    return {v:1, kind:'friend', fid:myFid(tripId), from:myName(), trip:tripId, lat:lat, lon:lon, acc:(acc==null?null:Math.round(acc)), ts:ts, label:null, resort:cfg.slug};
  }
  function doShareFix(lat, lon, acc, ts, fromCentre){
    var tripId=shareTripId(); if(!tripId) return;
    var p=buildSharePayload(lat, lon, acc, ts, tripId);
    var url=shareUrl(cfg.slug, p);
    saveShare({trip:tripId, lat:lat, lon:lon, acc:(acc==null?null:Math.round(acc)), ts:ts, url:url, fromCentre:!!fromCentre, name:myName()});
    shareState='shared'; justStopped=false; lastShareExpiredAt=null;
    renderSheet(); render();
  }
  function shareMySpot(){
    var tripId=shareTripId();
    if(!tripId){ openFriendsSheet('half'); return; }
    openFriendsSheet('half');
    shareState='locating'; renderSheet();
    if(!('geolocation' in navigator)){ shareState='failed'; renderSheet(); return; }
    try{
      navigator.geolocation.getCurrentPosition(function(pos){
        var c=pos.coords||{};
        if(c.latitude==null){ shareState='failed'; renderSheet(); return; }
        doShareFix(c.latitude, c.longitude, c.accuracy, pos.timestamp||Date.now(), false);
      }, function(){ shareState='failed'; renderSheet(); },
      {enableHighAccuracy:true, timeout:15000, maximumAge:0});
    }catch(e){ shareState='failed'; renderSheet(); }
  }
  function shareMapCentre(){
    var tripId=shareTripId(); if(!tripId) return;
    var map=(window.SFMap&&SFMap.getMap)?SFMap.getMap():null;
    if(!map) return;
    var c=map.getCenter();
    doShareFix(c.lat, c.lng, null, Date.now(), true);
  }
  function stopSharing(){
    clearShare(); shareState='idle'; justStopped=true; renderSheet(); render();
  }
  function shareTextFor(rec){ return tf('friends.shareText',{name:rec.name||myName(), resort:cfg.resortName||cfg.slug, url:rec.url}); }
  function copyText(txt, okMsg){
    if(navigator.clipboard&&navigator.clipboard.writeText){ navigator.clipboard.writeText(txt).then(function(){ toast(okMsg||tf('friends.linkCopied')); }, function(){ toast(txt); }); }
    else { toast(txt); }
  }
  function copyShareLink(){ if(shareRec) copyText(shareRec.url, tf('friends.linkCopied')); }
  function shareVia(){
    if(!shareRec) return;
    if(navigator.share){ navigator.share({title:document.title, text:shareTextFor(shareRec), url:shareRec.url}).catch(function(){}); }
    else copyShareLink();
  }
  function openShareWhats(){ if(shareRec) window.open('https://wa.me/?text='+encodeURIComponent(shareTextFor(shareRec)),'_blank'); }
  function shareMeetingPoint(){
    var tripId=shareTripId(); if(!tripId) return;
    var labelInp=$('friendsMeetLabel'); var label=labelInp?labelInp.value.trim():'';
    var map=(window.SFMap&&SFMap.getMap)?SFMap.getMap():null; if(!map) return;
    var c=map.getCenter();
    var p=meetPayload(tripId, c.lat, c.lng, label||null);
    var r=upsertFriend(p,'manual'); justOpened[r.entry.id]=true;
    meetShare={url:shareUrl(cfg.slug, p), label:(label||tf('friends.meetLabel')), ts:p.ts};
    renderSheet(); render();
  }

  /* ---- markers + list ---- */
  function startLL(){ return (window.SFMap&&SFMap.getStart)?SFMap.getStart():null; }
  function distFromStart(f){ var s=startLL(); if(!s||f.lat==null||f.lon==null) return null; return haversine(s,[f.lat,f.lon]); }
  function isFar(f){ if(!cfg.centre||f.lat==null||f.lon==null) return false; return haversine(cfg.centre,[f.lat,f.lon])>50000; }
  function isVisible(f){
    if(!f||f.lat==null||f.lon==null) return false;
    if(f.resort&&cfg.slug&&f.resort!==cfg.slug) return false;
    if(f.ts!=null&&freshness(f.ts)==='expired') return false;
    if(f.demo) return true;
    if(!f.trip) return true;
    if(activeTripForResort()===f.trip) return true;
    if(justOpened[f.id]) return true;
    return false;
  }
  function visibleList(){ return list().filter(isVisible); }
  function markerHtml(f){
    var initial=(f.name||'?').trim().charAt(0).toUpperCase();
    return '<div class="fm-pin"><span>'+esc(initial)+'</span></div>'
      +'<div class="fm-name">'+esc(f.name||t('friend'))+'</div>'
      +(f.demo?'<span class="fm-demo">'+esc(t('demo').toUpperCase())+'</span>':'');
  }
  function circleHtml(f, stale){
    if(f.kind==='meet'){
      return '<div class="fm-wrap'+(stale?' stale':'')+'"><div class="fm-meet">📍</div>'
        +'<div class="fm-name">'+esc(f.label||f.name||tf('friends.meetLabel'))+'</div></div>'
        +(stale?'<span class="fm-clock">🕐</span>':'');
    }
    return '<div class="fm-wrap'+(stale?' stale':'')+'"><div class="fm-circle" style="background:'+esc(f.color||'#7dd3fc')+'"><span>'+esc(initials(f.name))+'</span></div>'
      +'<div class="fm-name">'+esc(f.name||t('friend'))+'</div></div>'
      +(stale?'<span class="fm-clock">🕐</span>':'');
  }
  function clearMarkers(){
    if(window.L&&window.SFMap&&SFMap.getMap){
      var map=SFMap.getMap();
      if(map){
        Object.keys(markers).forEach(function(id){
          try{ if(markers[id].marker) map.removeLayer(markers[id].marker); }catch(e){}
          try{ if(markers[id].acc) map.removeLayer(markers[id].acc); }catch(e){}
          delete markers[id];
        });
      }
    }
  }
  function render(){
    if(window.L&&window.SFMap&&SFMap.getMap){
      var map=SFMap.getMap();
      if(map){
        clearMarkers();
        visibleList().forEach(function(f){
          var stale=f.ts!=null&&freshness(f.ts)==='stale';
          var mk;
          if(f.demo){
            mk=L.marker([f.lat,f.lon],{icon:L.divIcon({className:'friend-marker',html:markerHtml(f),iconSize:[44,64],iconAnchor:[22,52]})}).addTo(map);
            mk.on('click',function(){ navigateTo(f); });
          }else{
            mk=L.marker([f.lat,f.lon],{icon:L.divIcon({className:'friend-marker',html:circleHtml(f,stale),iconSize:[44,64],iconAnchor:[22,52]})}).addTo(map);
            mk.on('click',function(){ openPeek(f.id); });
          }
          var el=mk.getElement&&mk.getElement();
          if(el){ el.setAttribute('aria-label','Friend '+(f.name||'')+(f.demo?' (demo)':'')+(stale?' (stale)':'')); el.setAttribute('role','button'); }
          var rec={marker:mk, acc:null};
          if(f.acc!=null&&f.acc>50){
            try{ rec.acc=L.circle([f.lat,f.lon],{radius:f.acc,color:f.color||'#38bdf8',weight:1,fillOpacity:0.15,interactive:false}).addTo(map); }catch(e){ rec.acc=null; }
          }
          markers[f.id]=rec;
        });
        // my own shared position ("You (shared HH:MM)")
        var rec2=loadShare();
        if(rec2&&rec2.ts!=null&&freshness(rec2.ts)!=='expired'){
          var me={id:'__me', kind:'friend', name:t('you'), color:myColor(), lat:rec2.lat, lon:rec2.lon, acc:rec2.acc, ts:rec2.ts};
          var stale2=freshness(rec2.ts)==='stale';
          var mk2=L.marker([rec2.lat,rec2.lon],{icon:L.divIcon({className:'friend-marker',html:circleHtml(me,stale2),iconSize:[44,64],iconAnchor:[22,52]})}).addTo(map);
          mk2.on('click',function(){ openFriendsSheet('peek'); });
          markers['__me']={marker:mk2, acc:null};
        }
      }
    }
    renderList();
  }
  function ageLine(f){
    if(f.ts==null) return '';
    var n=ageMin(f.ts);
    var d=distFromStart(f);
    if(freshness(f.ts)==='stale') return tf('friends.sharedStale',{n:n});
    if(d==null) return ageText(f.ts);
    return tf('friends.sharedAgo',{n:n, dist:fmtDist(d)});
  }
  function renderList(){
    var box=$('friendList');
    var n=visibleList().filter(function(f){ return !f.demo; }).length;
    var er=$('friendsEntryRoute'); if(er) er.textContent = n>0?tf('friends.openRowCount',{n:n}):tf('friends.openRow');
    var es=$('friendsEntrySettings'); if(es) es.textContent=tf('friends.openRow');
    if(!box) return;
    var l=visibleList();
    var html=l.length?'':'<p class="muted">'+esc(t('noFriends'))+'</p>';
    l.forEach(function(f){
      var sub=f.demo?esc(f.place||'')+(f.demo?' · '+esc(t('demo')):''):esc(ageLine(f));
      html+='<div class="member"><div class="who"><b>'+esc(f.name||t('friend'))+'</b>'
        +'<small>'+sub+'</small></div>'
        +'<button class="btn primary" data-fnav="'+esc(f.id)+'">'+esc(t('navigateTo'))+'</button>'
        +'<button class="btn danger" data-fdel="'+esc(f.id)+'">✕</button></div>';
    });
    box.innerHTML=html;
    box.querySelectorAll('[data-fnav]').forEach(function(b){ b.addEventListener('click',function(){ var f=get(b.getAttribute('data-fnav')); if(f) navigateTo(f); }); });
    box.querySelectorAll('[data-fdel]').forEach(function(b){ b.addEventListener('click',function(){ remove(b.getAttribute('data-fdel')); }); });
  }
  function navigateTo(f){
    if(window.SFMap&&SFMap.setDest){ SFMap.setDest(f.lat,f.lon,f.name||t('friend')); }
    if(window.SFMap&&SFMap.getRoute&&!SFMap.getRoute()){
      var d=distFromStart(f);
      toast(tf('friends.noRoute',{dist:d==null?'—':fmtDist(d)}), true);
    } else {
      toast(t('routeTo')+' '+(f.name||''));
    }
    closeSheet();
  }
  function routeToFriend(id){ var f=get(id); if(f) navigateTo(f); }

  /* ---- Friends sheet ---- */
  function hopUrl(resort, enc){
    var file=RESORT_FILES[resort]||('map-'+resort+'.html');
    var dir='/guides/';
    try{ var pa=location.pathname||''; var i=pa.lastIndexOf('/'); if(i>=0) dir=pa.slice(0,i+1); }catch(e){}
    return location.origin+dir+file+'?f='+enc;
  }
  function promptHtml(pp){
    if(pp.type==='join'){
      return '<div class="card"><h3>'+esc(tf('friends.joinTitle',{name:pp.payload.from, trip:tripName(TRIPS[pp.payload.trip])}))+'</h3>'
        +'<p class="muted">'+esc(tf('friends.joinBody'))+'</p>'
        +'<div class="row"><button class="btn primary" data-act="join">'+esc(tf('friends.join'))+'</button>'
        +'<button class="btn" data-act="justshow">'+esc(tf('friends.justShow'))+'</button></div></div>';
    }
    if(pp.type==='unknown'){
      return '<div class="card"><h3>'+esc(pp.payload.from||t('friend'))+'</h3>'
        +'<p class="muted">'+esc(tf('friends.unknownTrip',{trip:pp.payload.trip}))+'</p>'
        +'<div class="row"><button class="btn primary" data-act="justshow">'+esc(tf('friends.justShow'))+'</button></div></div>';
    }
    if(pp.type==='mismatch'){
      var rn=RESORT_NAMES[pp.payload.resort]||pp.payload.resort;
      var hop=hopUrl(pp.payload.resort, pp.enc);
      return '<div class="card"><h3>'+esc(tf('friends.wrongResort',{resort:rn}))+'</h3>'
        +'<div class="row"><a class="btn primary" href="'+esc(hop)+'">'+esc(tf('friends.openResortMap',{resort:rn}))+'</a>'
        +'<button class="btn" data-act="promptclose">'+esc(t('cancel'))+'</button></div></div>';
    }
    return '<div class="card"><p class="muted">'+esc(tf('friends.expiredLink'))+'</p>'
      +'<div class="row"><button class="btn" data-act="promptclose">'+esc(t('close'))+'</button></div></div>';
  }
  function peekHtml(f){
    var d=distFromStart(f);
    var h='<div class="card"><h3>'+esc(f.name||t('friend'))+'</h3>';
    h+='<p class="muted">'+esc(ageLine(f));
    if(f.acc!=null) h+=' · ±'+Math.round(f.acc)+' m';
    h+='</p>';
    if(isFar(f)) h+='<p class="warn">'+esc(tf('friends.farPoint',{resort:cfg.resortName||cfg.slug}))+'</p>';
    h+='<div class="row"><button class="btn primary" data-act="route" data-id="'+esc(f.id)+'">'+esc(tf('friends.routeTo',{name:f.name||t('friend')}))+'</button>'
      +'<button class="btn" data-act="show" data-id="'+esc(f.id)+'">'+esc(tf('friends.showOnMap'))+'</button>'
      +'<button class="btn danger" data-act="dismiss" data-id="'+esc(f.id)+'">'+esc(tf('friends.dismiss'))+'</button></div></div>';
    return h;
  }
  function shareHtml(){
    var tripId=activeTripForResort();
    var h='<h3>'+esc(tf('friends.shareMySpot'))+'</h3>';
    if(!tripId) return h+'<p class="muted">'+esc(tf('friends.noTrip'))+'</p>';
    h+='<div class="row"><label>'+esc(tf('friends.trip'))+'</label><select id="friendsTripSel" aria-label="'+esc(tf('friends.trip'))+'">';
    Object.keys(TRIPS).forEach(function(id){
      if(TRIPS[id].resort!==cfg.slug) return;
      h+='<option value="'+esc(id)+'"'+(id===tripId?' selected':'')+'>'+esc(tripName(TRIPS[id]))+'</option>';
    });
    h+='</select></div>';
    if(shareState==='locating'){
      h+='<p class="muted">'+esc(tf('friends.shareLocating'))+'</p>';
    } else if(shareState==='failed'){
      h+='<p class="warn">'+esc(tf('friends.shareGpsFail'))+'</p>'
        +'<div class="row"><button class="btn" data-act="centre">'+esc(tf('friends.shareMapCentre'))+'</button>'
        +'<button class="btn" data-act="share">'+esc(tf('friends.shareMySpot'))+'</button></div>'
        +'<p class="muted">'+esc(tf('friends.shareMapCentreNote'))+'</p>';
    } else if(shareState==='shared'&&shareRec){
      h+='<p class="muted">'+esc(tf('friends.sharedAt',{time:fmtClock(shareRec.ts)}))+'</p>'
        +(shareRec.fromCentre?'<p class="muted">'+esc(tf('friends.shareMapCentreNote'))+'</p>':'')
        +'<div class="share-url" dir="ltr">'+esc(shareRec.url)+'</div>'
        +'<div class="row"><button class="btn primary" data-act="via">'+esc(tf('friends.shareVia'))+'</button>'
        +'<button class="btn" data-act="copy">'+esc(tf('friends.copyLink'))+'</button>'
        +'<button class="btn" data-act="wa">'+esc(tf('friends.shareWhats'))+'</button></div>'
        +'<p class="muted">'+esc(tf('friends.shareAgainNote',{time:fmtClock(shareRec.ts)}))+'</p>'
        +'<div class="row"><button class="btn" data-act="share">'+esc(tf('friends.shareAgain'))+'</button>'
        +'<button class="btn danger" data-act="stop">'+esc(tf('friends.stopSharing'))+'</button></div>';
    } else {
      h+='<div class="row"><button class="btn primary block" data-act="share">'+esc(tf('friends.shareMySpot'))+'</button></div>'
        +'<p class="muted">'+esc(tf('friends.shareOffNote'))+'</p>';
      if(lastShareExpiredAt) h+='<p class="muted">'+esc(tf('friends.expiredNote',{time:fmtClock(lastShareExpiredAt)}))+'</p>';
      if(justStopped) h+='<p class="muted">'+esc(tf('friends.stopSharingNote'))+'</p>';
    }
    return h;
  }
  function membersHtml(){
    var tripId=activeTripForResort();
    var h='<h3>'+esc(tf('friends.onMountain'))+'</h3>';
    if(!tripId) return h+'<p class="muted">'+esc(tf('friends.noTrip'))+'</p>';
    var pts=visibleList().filter(function(f){ return f.trip===tripId&&!f.demo; });
    var mem=(typeof Trips!=='undefined'&&Trips.members)?Trips.members(tripId):[];
    var rec=loadShare();
    var meLine=(shareState==='shared'&&rec&&rec.trip===tripId)?tf('friends.youSharing',{time:fmtClock(rec.ts)}):tf('friends.youNotSharing');
    h+='<div class="member"><div class="who"><b>'+esc(myName())+'</b><small>'+esc(meLine)+'</small></div></div>';
    var used={};
    mem.forEach(function(m){
      var pt=null;
      for(var i=0;i<pts.length;i++){ if((pts[i].name||'').trim().toLowerCase()===(m.name||'').trim().toLowerCase()){ pt=pts[i]; break; } }
      if(pt) used[pt.id]=true;
      h+='<div class="member"><div class="who"><b>'+esc(m.name)+'</b><small>'+(pt?esc(ageLine(pt)):esc(tf('friends.noPosition')))+'</small></div>'
        +(pt?'<button class="btn primary" data-act="route" data-id="'+esc(pt.id)+'">'+esc(t('navigateTo'))+'</button>':'')+'</div>';
    });
    pts.forEach(function(f){
      if(used[f.id]) return;
      h+='<div class="member"><div class="who"><b>'+esc(f.name||t('friend'))+'</b><small>'+esc(ageLine(f))+(isFar(f)?' · '+esc(tf('friends.farPoint',{resort:cfg.resortName||cfg.slug})):'')+'</small></div>'
        +'<button class="btn primary" data-act="route" data-id="'+esc(f.id)+'">'+esc(t('navigateTo'))+'</button>'
        +'<button class="btn danger" data-act="dismiss" data-id="'+esc(f.id)+'">✕</button></div>';
    });
    if(!mem.length&&!pts.length) h+='<p class="muted">'+esc(tf('friends.noPosition'))+'</p>';
    return h;
  }
  function tripsMiniHtml(){
    var tripId=activeTripForResort();
    var h='';
    if(tripId){
      h+='<div class="row"><button class="btn" data-act="invite">'+esc(tf('friends.inviteLink'))+'</button>';
      if(!confirmLeave) h+='<button class="btn danger" data-act="leave">'+esc(tf('friends.leaveTrip'))+'</button>';
      h+='</div>';
      if(confirmLeave){
        h+='<p class="warn">'+esc(tf('friends.leaveConfirm',{trip:tripName(TRIPS[tripId])}))+'</p>'
          +'<div class="row"><button class="btn danger" data-act="leaveyes">'+esc(tf('friends.leaveTrip'))+'</button>'
          +'<button class="btn" data-act="leaveno">'+esc(t('cancel'))+'</button></div>';
      }
    }
    if(!showNewTrip){
      h+='<div class="row"><button class="btn" data-act="newtrip">'+esc(tf('friends.newTrip'))+'</button></div>';
    } else {
      h+='<div class="row"><input type="text" id="friendsNewTripName" required placeholder="'+esc(cfg.resortName||cfg.slug)+'" aria-label="'+esc(tf('friends.newTrip'))+'"></div>'
        +'<div class="row"><input type="date" id="friendsNewTripStart" aria-label="start"><input type="date" id="friendsNewTripEnd" aria-label="end"></div>'
        +'<div class="row"><button class="btn primary" data-act="newtrip-create">'+esc(tf('friends.newTrip'))+'</button>'
        +'<button class="btn" data-act="newtrip-cancel">'+esc(t('cancel'))+'</button></div>';
    }
    return h;
  }
  function renderSheet(){
    var body=$('friendsBody'); if(!body) return;
    var html='';
    if(pendingPrompt) html+=promptHtml(pendingPrompt);
    else if(peekId){ var pf=get(peekId); if(pf) html+=peekHtml(pf); else peekId=null; }
    html+=shareHtml();
    html+=membersHtml();
    html+='<h3>'+esc(tf('friends.manualTitle'))+'</h3>'
      +'<p class="muted">'+esc(tf('friends.manualHint'))+'</p>'
      +'<div class="row"><input type="text" id="friendsManual" placeholder="45.09240, 6.06994" aria-label="'+esc(tf('friends.manualTitle'))+'"></div>'
      +'<div class="row"><button class="btn primary" data-act="manual">'+esc(t('addFriend'))+'</button></div>';
    html+='<h3>'+esc(tf('friends.meetLabel'))+'</h3>'
      +'<div class="row"><input type="text" id="friendsMeetLabel" placeholder="'+esc(tf('friends.meetLabel'))+'" aria-label="'+esc(tf('friends.meetLabel'))+'"></div>'
      +'<div class="row"><button class="btn" data-act="meet">'+esc(tf('friends.shareMeet'))+'</button></div>';
    if(meetShare){
      html+='<div class="share-url" dir="ltr">'+esc(meetShare.url)+'</div>'
        +'<div class="row"><button class="btn" data-act="copymeet">'+esc(tf('friends.copyLink'))+'</button>'
        +'<button class="btn" data-act="wameet">'+esc(tf('friends.shareWhats'))+'</button></div>';
    }
    html+='<h3>'+esc(tf('friends.yourName'))+'</h3>'
      +'<div class="row"><input type="text" id="friendsMyName" value="'+esc(myIdentity().name)+'" aria-label="'+esc(tf('friends.yourName'))+'"></div>';
    html+=tripsMiniHtml();
    html+='<p class="muted">'+esc(tf('friends.freshnessNote'))+'</p>'
      +'<p class="muted">'+esc(tf('friends.whatsappLive'))+' <a href="https://wa.me/" target="_blank" rel="noopener">WhatsApp ↗</a></p>';
    body.innerHTML=html;
    wireSheet(body);
  }
  function wireSheet(body){
    function on(act, fn){ body.querySelectorAll('[data-act="'+act+'"]').forEach(function(b){ b.addEventListener('click', function(ev){ ev.preventDefault(); fn(b); }); }); }
    on('join', function(){ var p=pendingPrompt&&pendingPrompt.payload; pendingPrompt=null; if(p&&TRIPS[p.trip]) Trips.join(p.trip); renderSheet(); render(); });
    on('justshow', function(){ pendingPrompt=null; renderSheet(); render(); });
    on('promptclose', function(){ pendingPrompt=null; renderSheet(); });
    on('route', function(b){ var f=get(b.getAttribute('data-id')); if(f) navigateTo(f); });
    on('show', function(b){ var f=get(b.getAttribute('data-id')); if(f&&window.SFMap&&SFMap.getMap){ try{ SFMap.getMap().panTo([f.lat,f.lon]); }catch(e){} } closeSheet(); });
    on('dismiss', function(b){ var id=b.getAttribute('data-id'); if(id){ remove(id); } peekId=null; pendingPrompt=null; closeSheet(); });
    on('share', function(){ shareMySpot(); });
    on('centre', function(){ shareMapCentre(); });
    on('stop', function(){ stopSharing(); });
    on('via', function(){ shareVia(); });
    on('copy', function(){ copyShareLink(); });
    on('wa', function(){ openShareWhats(); });
    on('copymeet', function(){ if(meetShare) copyText(meetShare.url, tf('friends.linkCopied')); });
    on('wameet', function(){ if(meetShare) window.open('https://wa.me/?text='+encodeURIComponent(tf('friends.shareText',{name:meetShare.label,resort:cfg.resortName||cfg.slug,url:meetShare.url})),'_blank'); });
    on('meet', function(){ shareMeetingPoint(); });
    on('manual', function(){ submitManual(); });
    on('invite', function(){ var id=activeTripForResort(); if(id) Trips.copyInvite(id); });
    on('leave', function(){ confirmLeave=true; renderSheet(); });
    on('leaveyes', function(){ var id=activeTripForResort(); if(id) leaveTrip(id); });
    on('leaveno', function(){ confirmLeave=false; renderSheet(); });
    on('newtrip', function(){ showNewTrip=true; renderSheet(); });
    on('newtrip-cancel', function(){ showNewTrip=false; renderSheet(); });
    on('newtrip-create', function(){
      var inp=body.querySelector('#friendsNewTripName');
      if(!inp||!inp.value.trim()){ if(inp&&inp.reportValidity) inp.reportValidity(); return; }
      var st=body.querySelector('#friendsNewTripStart');
      var en=body.querySelector('#friendsNewTripEnd');
      var id=Trips.addCustomTrip(inp.value, st?st.value:'', en?en.value:'');
      if(!id) return;
      showNewTrip=false; confirmLeave=false; pendingPrompt=null; peekId=null;
      renderSheet(); render();
    });
    var sel=body.querySelector('#friendsTripSel');
    if(sel) sel.addEventListener('change', function(){
      Trips.setActive(sel.value);
      var r=loadShare();
      shareState=(r&&r.trip===sel.value)?'shared':'idle'; shareRec=(r&&r.trip===sel.value)?r:null;
      renderSheet(); render();
    });
    var nm=body.querySelector('#friendsMyName');
    if(nm) nm.addEventListener('change', function(){ setMyIdentity(nm.value); renderList(); });
    var man=body.querySelector('#friendsManual');
    if(man) man.addEventListener('keydown', function(e){ if(e.key==='Enter'){ e.preventDefault(); submitManual(); } });
  }
  function openFriendsSheet(detent){
    pruneExpired();
    peekId=null;
    renderSheet();
    openSheet('friends', detent||'half');
  }
  function openPeek(id){
    peekId=id; pendingPrompt=null;
    pruneExpired();
    renderSheet();
    openSheet('friends','peek');
  }
  function leaveTrip(tripId){
    var s=tripsState();
    if(s.active===tripId) s.active=null;
    if(s.joined) delete s.joined[tripId];
    if(s.mySharing) delete s.mySharing[tripId];
    if(s.members) delete s.members[tripId];
    saveTripsState(s);
    if(typeof Trips!=='undefined'&&Trips.removeCustom) Trips.removeCustom(tripId);
    save(list().filter(function(f){ return f.trip!==tripId; }));
    if(shareRec&&shareRec.trip===tripId){ clearShare(); shareState='idle'; }
    confirmLeave=false; pendingPrompt=null; peekId=null;
    renderSheet(); render(); Trips.renderChip(); Trips.renderSettings();
  }

  /* ---- incoming links ---- */
  function rawF(){
    try{
      var sp=new URLSearchParams(location.search||'');
      var f=sp.get('f'); if(f) return {enc:f, from:'search'};
      var h=location.hash||'';
      var m=h.match(/#f=([^&]+)/); if(m) return {enc:decodeURIComponent(m[1]), from:'hash'};
    }catch(e){}
    return null;
  }
  function stripF(){
    try{
      var u=new URL(location.href);
      var hadF=u.searchParams.has('f');
      u.searchParams.delete('f');
      var hadHashF=/^#f=[^&]*$/.test(u.hash||'');
      if(hadHashF) u.hash='';
      if(hadF||hadHashF) history.replaceState(null,'',u.pathname+u.search+u.hash);
    }catch(e){}
  }
  function handleIncomingPayload(p, enc){
    if(p.resort&&cfg.slug&&p.resort!==cfg.slug){
      pendingPrompt={type:'mismatch', payload:p, enc:enc||encodePayload(p)};
      renderSheet(); openSheet('friends','peek'); return;
    }
    if(freshness(p.ts)==='expired'){
      pendingPrompt={type:'expired', payload:p};
      renderSheet(); openSheet('friends','peek'); return;
    }
    var res=upsertFriend(p,'link');
    justOpened[res.entry.id]=true;
    var known=!!TRIPS[p.trip];
    var member=false;
    if(known){
      var st=tripsState();
      member=(activeTripForResort()===p.trip)||!!(st.joined&&st.joined[p.trip]);
    }
    if(!known){
      pendingPrompt={type:'unknown', payload:p, entry:res.entry};
    } else if(!member){
      pendingPrompt={type:'join', payload:p, entry:res.entry};
    } else {
      pendingPrompt=null; peekId=res.entry.id;
      toast(tf('friends.newPointToast',{name:p.from, n:ageMin(p.ts)}));
    }
    render();
    renderSheet();
    openSheet('friends','peek');
  }
  function processIncomingLink(){
    pruneExpired();
    try{
      var sp=new URLSearchParams(location.search||'');
      var tr=sp.get('trip');
      if(tr&&TRIPS[tr]) Trips.join(tr);
    }catch(e){}
    var raw=rawF();
    if(!raw) return;
    var dec=decodePayload(raw.enc);
    if(!dec) return; // malformed: ignore silently
    var v=validatePayload(dec);
    if(!v.ok) return; // invalid: ignore silently
    stripF();
    handleIncomingPayload(v.p, raw.enc);
  }
  function submitManual(){
    var inp=$('friendsManual'); var v=inp?inp.value.trim():'';
    if(!v){ toast(tf('friends.manualBad'), true); return; }
    var m=v.match(/[?&#]f=([A-Za-z0-9\-_]+)/);
    if(m){
      var dec=decodePayload(m[1]);
      var val=dec?validatePayload(dec):null;
      if(val&&val.ok){ handleIncomingPayload(val.p, m[1]); return; }
      toast(tf('friends.manualBad'), true); return;
    }
    var c=parseLink(v);
    if(!c){ toast(tf('friends.manualBad'), true); return; }
    var tripId=activeTripForResort();
    add({name:t('friend'), lat:c.lat, lon:c.lon, trip:tripId||null, source:'manual'});
    if(inp) inp.value='';
    toast(t('friendAdded')); renderSheet(); render();
  }
  function joinTripFromLink(tripId){
    if(tripId&&TRIPS[tripId]) Trips.join(tripId);
    pendingPrompt=null; renderSheet(); render();
  }

  /* ---- legacy: parse a Google Maps / geo: link into {lat,lon} ---- */
  function parseLink(s){
    if(!s) return null;
    var m = String(s).match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
    if(m) return {lat:parseFloat(m[1]), lon:parseFloat(m[2])};
    m = String(s).match(/geo:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
    if(m) return {lat:parseFloat(m[1]), lon:parseFloat(m[2])};
    m = String(s).match(/q=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
    if(m) return {lat:parseFloat(m[1]), lon:parseFloat(m[2])};
    m = String(s).match(/(-?\d{1,2}\.\d+)[ ,]+(-?\d{1,3}\.\d+)/);
    if(m) return {lat:parseFloat(m[1]), lon:parseFloat(m[2])};
    return null;
  }
  var placing = null; // {name} while waiting for a map tap
  function startPlacing(name){
    placing = {name:name||t('friend')};
    toast(t('tapMapToPlace'));
    closeSheet();
  }
  function onMapTap(lat, lon){
    if(!placing) return false;
    add({name: placing.name, lat:lat, lon:lon});
    toast(t('friendAdded'));
    placing = null;
    return true;
  }
  function shareMyLocation(){ shareMySpot(); }
  function importFromHash(){
    var h = location.hash||'';
    var m = h.match(/#friend=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:&name=([^&]*))?(?:&trip=([^&]*))?/);
    if(m){
      add({name: m[3]?decodeURIComponent(m[3]):t('friend'), lat:parseFloat(m[1]), lon:parseFloat(m[2]), trip: m[4]?decodeURIComponent(m[4]):null});
      toast(t('friendAdded'));
      try{ history.replaceState(null,'',location.pathname+location.search); }catch(e){}
    }
    var tm = h.match(/#trip=([a-z0-9-]+)/);
    if(tm && TRIPS[tm[1]]){ Trips.join(tm[1]); try{ history.replaceState(null,'',location.pathname+location.search); }catch(e){} }
  }
  function ensureDemo(){
    if(!cfg.demoFriend) return;
    // 'sf-friends' is shared across the three resort pages (same origin), so a
    // demo friend left by another resort must be replaced, not reused — otherwise
    // this resort shows a friend 200 km away, off-screen (L3).
    var l = list();
    var cur = null;
    for(var i=0;i<l.length;i++){ if(l[i].demo){ cur=l[i]; break; } }
    if(cur && (cur.lat!==cfg.demoFriend.lat || cur.lon!==cfg.demoFriend.lon)){ remove(cur.id); }
    if(!list().some(function(x){ return x.demo; })){
      add({name: cfg.demoFriend.name, lat: cfg.demoFriend.lat, lon: cfg.demoFriend.lon, place: cfg.demoFriend.place||'', demo:true, resort: cfg.slug||''});
    }
  }
  return { list:list, add:add, remove:remove, render:render, navigateTo:navigateTo,
    parseLink:parseLink, startPlacing:startPlacing, onMapTap:onMapTap,
    shareMyLocation:shareMyLocation, importFromHash:importFromHash, ensureDemo:ensureDemo,
    encodePayload:encodePayload, decodePayload:decodePayload, validatePayload:validatePayload,
    freshness:freshness, ageText:ageText, shareUrl:shareUrl, meetPayload:meetPayload,
    loadFriends:loadFriends, saveFriends:saveFriends, upsertFriend:upsertFriend,
    pruneExpired:pruneExpired, processIncomingLink:processIncomingLink,
    openSheet:openFriendsSheet, renderSheet:renderSheet, openPeek:openPeek,
    shareMySpot:shareMySpot, shareMapCentre:shareMapCentre, stopSharing:stopSharing,
    routeToFriend:routeToFriend, shareMeetingPoint:shareMeetingPoint,
    joinTripFromLink:joinTripFromLink, setMyIdentity:setMyIdentity, myIdentity:myIdentity,
    syncShareState:syncShareState, loadShare:loadShare, get:get, isVisible:isVisible };
})();

/* ================= Trip groups =================
   Two built-in trips (Alpe d'Huez 8–15 Jan 2027, La Plagne 31 Jan–7 Feb
   2027). Members are visible only inside their trip. Location sharing is
   OFF by default for everyone — explicit opt-in per member. No member
   names are pre-filled: only "you" exists until the user adds people. */
var Trips = (function(){
  function activeId(){
    var s = tripsState();
    if(s.active && TRIPS[s.active]) return s.active;
    return cfg.activeTrip||null;
  }
  function activeTrip(){ var id=activeId(); return id?TRIPS[id]:null; }
  function mySharing(tripId){
    var s = tripsState();
    return !!s.mySharing[tripId];
  }
  function setMySharing(tripId, on){
    var s = tripsState(); s.mySharing[tripId]=!!on; saveTripsState(s);
    renderChip(); renderSettings();
  }
  function members(tripId){ var s=tripsState(); return s.members[tripId]||[]; }
  function addMember(tripId, name){
    var s = tripsState(); s.members[tripId]=s.members[tripId]||[];
    s.members[tripId].push({id:'mb-'+Date.now(), name:name, sharing:false});
    saveTripsState(s); renderSettings();
  }
  function setMemberSharing(tripId, memberId, on){
    var s = tripsState(); (s.members[tripId]||[]).forEach(function(m){ if(m.id===memberId) m.sharing=!!on; });
    saveTripsState(s); renderSettings();
  }
  function join(tripId){
    var s = tripsState(); s.joined[tripId]=true; s.active=tripId; saveTripsState(s);
    renderChip(); renderSettings();
    toast(tripName(TRIPS[tripId]));
  }
  function setActive(tripId){
    var s = tripsState(); s.active=tripId; saveTripsState(s);
    renderChip(); renderSettings();
  }
  function inviteLink(tripId){
    return location.origin+location.pathname+'#trip='+tripId;
  }
  /* user-created trips (ws7 §2.3.1/§3.4.4): stored in sf-trips state as
     `custom`, merged into TRIPS at init so every TRIPS consumer (chip,
     settings, Friends) sees them. The resort is always the current page. */
  function loadCustom(){
    var s=tripsState();
    var custom=s.custom||{};
    Object.keys(custom).forEach(function(id){ if(!TRIPS[id]) TRIPS[id]=custom[id]; });
  }
  function addCustomTrip(name, startDate, endDate){
    name=String(name||'').trim().slice(0,60);
    if(!name) return null;
    var base=name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'')||'trip';
    var id=base+'-'+Math.random().toString(36).slice(2,6);
    var rec={id:id, resort:cfg.slug, he:name, en:name, startDate:startDate||'', endDate:endDate||''};
    var s=tripsState(); s.custom=s.custom||{}; s.custom[id]=rec;
    s.joined=s.joined||{}; s.joined[id]=true; s.active=id;
    saveTripsState(s);
    TRIPS[id]=rec;
    renderChip(); renderSettings();
    return id;
  }
  function removeCustom(tripId){
    var s=tripsState();
    if(s.custom&&s.custom[tripId]){ delete s.custom[tripId]; saveTripsState(s); }
    if(TRIPS[tripId]) delete TRIPS[tripId];
  }
  function copyInvite(tripId){
    var url = inviteLink(tripId);
    if(navigator.clipboard && navigator.clipboard.writeText){ navigator.clipboard.writeText(url).then(function(){ toast(t('inviteCopied')); }, function(){ toast(url); }); }
    else { toast(url); }
  }
  function renderChip(){
    var chip = $('tripChip'); if(!chip) return;
    var tr = activeTrip();
    var label = tr ? tripName(tr) : t('tripGroups');
    chip.classList.toggle('no-trip', !tr); /* short generic label: no cap needed (P1-2) */
    var sw = chip.querySelector('.switch');
    var on = tr ? mySharing(tr.id) : false;
    chip.querySelector('.trip-label').textContent = '👥 '+label;
    if(sw){
      sw.setAttribute('aria-checked', on?'true':'false');
      sw.textContent = on ? t('sharingOn') : t('sharingOff');
      sw.setAttribute('aria-label', t('mySharing')+(tr?' — '+tripName(tr):''));
    }
  }
  function renderSettings(){
    var box = $('tripList'); if(!box) return;
    var html = '<p class="muted">'+esc(t('liveSyncNote'))+'</p>';
    Object.keys(TRIPS).forEach(function(id){
      var tr = TRIPS[id];
      var on = mySharing(id);
      var mem = members(id);
      html += '<div class="card"><h3>👥 '+esc(tripName(tr))+'</h3>'
        + '<div class="row"><span>'+esc(t('mySharing'))+'</span>'
        + '<button class="switch" role="switch" aria-checked="'+(on?'true':'false')+'" data-trip-share="'+id+'" aria-label="'+esc(t('mySharing'))+' — '+esc(tripName(tr))+'">'+esc(on?t('sharingOn'):t('sharingOff'))+'</button></div>'
        + '<div class="row"><span>'+esc(t('members'))+'</span></div>'
        + '<div class="member"><div class="who"><b>'+esc(t('you'))+'</b><small>'+esc(on?t('sharingOn'):t('locationOff'))+'</small></div></div>';
      mem.forEach(function(m){
        html += '<div class="member"><div class="who"><b>'+esc(m.name)+'</b><small>'+esc(m.sharing?t('sharingOn'):t('locationOff'))+'</small></div>'
          + '<button class="switch" role="switch" aria-checked="'+(m.sharing?'true':'false')+'" data-member-share="'+id+':'+m.id+'" aria-label="'+esc(t('mySharing'))+' — '+esc(m.name)+'">'+esc(m.sharing?t('sharingOn'):t('sharingOff'))+'</button></div>';
      });
      html += '<div class="row"><input type="text" data-member-name="'+id+'" placeholder="'+esc(t('memberName'))+'" aria-label="'+esc(t('memberName'))+'">'
        + '<button class="btn" data-member-add="'+id+'">'+esc(t('addMember'))+'</button></div>'
        + '<div class="row"><button class="btn" data-trip-invite="'+id+'">'+esc(t('invite'))+'</button>'
        + '<button class="btn" data-trip-activate="'+id+'">'+esc(t('tripActive'))+'</button></div>'
        + '</div>';
    });
    box.innerHTML = html;
    box.querySelectorAll('[data-trip-share]').forEach(function(b){ b.addEventListener('click', function(){ var id=b.getAttribute('data-trip-share'); setMySharing(id, !mySharing(id)); }); });
    box.querySelectorAll('[data-member-share]').forEach(function(b){ b.addEventListener('click', function(){
      var parts=b.getAttribute('data-member-share').split(':'); var m=members(parts[0]).find(function(x){ return x.id===parts[1]; });
      if(m) setMemberSharing(parts[0], parts[1], !m.sharing); }); });
    box.querySelectorAll('[data-member-add]').forEach(function(b){ b.addEventListener('click', function(){
      var id=b.getAttribute('data-member-add'); var inp=box.querySelector('[data-member-name="'+id+'"]');
      var name=inp&&inp.value.trim(); if(name){ addMember(id, name); } }); });
    box.querySelectorAll('[data-trip-invite]').forEach(function(b){ b.addEventListener('click', function(){ copyInvite(b.getAttribute('data-trip-invite')); }); });
    box.querySelectorAll('[data-trip-activate]').forEach(function(b){ b.addEventListener('click', function(){ setActive(b.getAttribute('data-trip-activate')); }); });
  }
  return { activeId:activeId, activeTrip:activeTrip, mySharing:mySharing, setMySharing:setMySharing,
    members:members, addMember:addMember, setMemberSharing:setMemberSharing, join:join,
    setActive:setActive, inviteLink:inviteLink, copyInvite:copyInvite,
    loadCustom:loadCustom, addCustomTrip:addCustomTrip, removeCustom:removeCustom,
    renderChip:renderChip, renderSettings:renderSettings };
})();

/* ================= Recents ================= */
var Recents = {
  add: function(name, lat, lon, kind){
    var l = read('sf-recent', []);
    l = l.filter(function(x){ return x.name!==name; });
    l.unshift({name:name, lat:lat, lon:lon, kind:kind||'', ts:Date.now()});
    store('sf-recent', l.slice(0,5));
  },
  list: function(){ return read('sf-recent', []); },
  sorted: function(){
    var s = (window.SFMap && SFMap.getStart) ? SFMap.getStart() : null;
    var l = this.list().slice();
    if(s){ l.sort(function(a,b){ return haversine(s,[a.lat,a.lon]) - haversine(s,[b.lat,b.lon]); }); }
    return l;
  }
};

/* ================= Navigation mode (WS6 phase 1) =================
   Explicit Start tap enters nav mode (a computed route alone is a preview).
   Phase 1: manual step advance in Preview (no GPS), GPS progress via
   nearest-vertex on the route polyline, off-route banner + MANUAL re-route
   (never automatic), no silent re-routing, no voice, no heading-up rotation.
   Remaining time is an estimate scaled from the router's total time. */
var Nav = (function(){
  var st = { active:false, legs:[], idx:0, cum:[], poly:[], polyCum:[], totalMin:0, totalDist:0,
    destName:'', destLL:null, progIdx:0, progDist:0, offCount:0, preview:true, following:true,
    watchId:null, lastFix:null, noFixTimer:null, line:null, startTs:0 };

  function getRoute(){ return (window.SFMap && SFMap.getRoute) ? SFMap.getRoute() : null; }
  function map(){ return (window.SFMap && SFMap.getMap) ? SFMap.getMap() : null; }

  function start(){
    var r = getRoute();
    if(!r || !r.legs || !r.legs.length){ toast(t('navPreview')); return false; }
    st.legs = r.legs; st.totalMin = r.totalMin||0; st.totalDist = r.totalDist||0;
    st.destName = r.destName||''; st.destLL = r.destLL||null; st.idx = 0;
    st.cum = []; var c=0; r.legs.forEach(function(l){ c += (l.dist||0); st.cum.push(c); });
    st.poly = r.polyline||[]; st.polyCum=[0]; var pc=0;
    for(var i=1;i<st.poly.length;i++){ pc += haversine(st.poly[i-1], st.poly[i]); st.polyCum.push(pc); }
    st.progIdx=0; st.progDist=0; st.offCount=0; st.preview=true; st.following=true; st.lastFix=null;
    st.startTs = Date.now();
    st.active = true;
    document.getElementById('app').classList.add('navmode');
    closeSheet();
    var rc=$('routeCard'); if(rc) rc.classList.remove('show');
    // highlight the route polyline
    if(window.L && map() && st.poly.length>1){
      try{ st.line = L.polyline(st.poly, {color:'#1e7ac8', weight:6, opacity:0.9}).addTo(map()); }catch(e){ st.line=null; }
    }
    render();
    // GPS watch; if no fix in 12s we stay in honest Preview mode
    if('geolocation' in navigator){
      try{
        st.watchId = navigator.geolocation.watchPosition(onFix, onFixErr, {enableHighAccuracy:true, maximumAge:5000, timeout:20000});
        st.noFixTimer = setTimeout(function(){ if(st.active && !st.lastFix){ st.preview=true; render(); } }, 12000);
      }catch(e){}
    }
    return true;
  }
  function onFix(pos){
    if(!st.active) return;
    var c = pos.coords||{}; if(c.latitude==null) return;
    st.lastFix = {lat:c.latitude, lon:c.longitude, acc:c.accuracy||null};
    st.preview = false;
    if(st.poly.length>1){
      var best=-1, bestD=1e9;
      var from = Math.max(0, st.progIdx-5), to = Math.min(st.poly.length-1, st.progIdx+300);
      for(var i=from;i<=to;i++){ var d=haversine([c.latitude,c.longitude], st.poly[i]); if(d<bestD){ bestD=d; best=i; } }
      if(bestD>40){ st.offCount++; }
      else {
        st.offCount=0;
        if(best>=st.progIdx){ st.progIdx=best; st.progDist=st.polyCum[best]; }
      }
      if(st.offCount>=3){ var b=$('offRouteBanner'); if(b) b.classList.add('show'); }
      else { var b2=$('offRouteBanner'); if(b2) b2.classList.remove('show'); }
      // advance leg by progress distance
      var ni=0; while(ni<st.cum.length && st.cum[ni]<=st.progDist) ni++;
      if(ni<st.legs.length) st.idx=ni;
      if(st.following && map()){ try{ map().panTo([c.latitude,c.longitude], {animate:true}); }catch(e){} }
    }
    render();
    if(remainingDist()<50){ arrived(); }
  }
  function onFixErr(){ /* no GPS: stay in Preview; banner after 12s timer */ 
    var b=$('gpsBanner'); if(b && st.active){ b.classList.add('show'); setTimeout(function(){ b.classList.remove('show'); }, 8000); }
  }
  function remainingDist(){
    if(st.poly.length>1 && st.polyCum.length){ return Math.max(0, (st.polyCum[st.polyCum.length-1]||st.totalDist) - st.progDist); }
    var rem=0; for(var i=st.idx;i<st.legs.length;i++) rem+=(st.legs[i].dist||0);
    return rem;
  }
  function remainingMin(){
    if(st.totalDist>0 && st.poly.length>1){ return st.totalMin * remainingDist()/st.totalDist; }
    var rem=0; for(var i=st.idx;i<st.legs.length;i++) rem+=(st.legs[i].time||0);
    return rem;
  }
  function legRemaining(){
    if(st.poly.length>1){ return Math.max(0, st.cum[st.idx]-st.progDist); }
    return st.legs[st.idx]?st.legs[st.idx].dist||0:0;
  }
  function kindLabel(kind){
    return kind==='lift'?t('navOnLift'):kind==='walk'?t('navOnWalk'):t('navOnPiste');
  }
  function render(){
    var card=$('navCard'); if(!card) return;
    var leg = st.legs[st.idx];
    var badge = card.querySelector('.nc-badge');
    var dist = card.querySelector('.nc-dist');
    var inst = card.querySelector('.nc-inst');
    var thenEl = card.querySelector('.nc-then');
    var nextBtn = card.querySelector('[data-nav-next]');
    var followBtn = card.querySelector('[data-nav-follow]');
    if(!leg){ if(badge) badge.textContent=t('navArrived'); return; }
    if(st.preview){ badge.textContent=t('navPreview'); badge.className='nc-badge preview'; }
    else if(leg.kind==='lift'){ badge.textContent=t('navOnLift'); badge.className='nc-badge lift'; }
    else { badge.textContent=kindLabel(leg.kind); badge.className='nc-badge'; }
    var lr = legRemaining();
    dist.innerHTML = esc(fmtDist(lr)) + (leg.kind==='lift'?'':' <small>'+esc(leg.name||'')+'</small>');
    if(leg.kind==='lift'){ inst.textContent = t('navRidingLift')+' '+ (leg.name||''); }
    else if(leg.kind==='walk'){ inst.textContent = t('navOnWalk')+': '+(leg.name||''); }
    else { inst.textContent = t('navOnPiste')+': '+(leg.name||''); }
    var nx = st.legs[st.idx+1];
    thenEl.textContent = nx ? (t('navThen')+': '+kindLabel(nx.kind)+' '+(nx.name||'')) : '';
    if(nextBtn) nextBtn.style.display = st.preview?'':'none';
    if(followBtn) followBtn.textContent = st.following?t('navFree'):t('navFollow');
    var strip=$('navStrip'); if(strip){
      var tm = strip.querySelector('.ns-time');
      var sub = strip.querySelector('.ns-sub');
      var rem = remainingMin();
      if(tm) tm.innerHTML = esc(fmtDur(rem*60))+' <small>'+esc(t('navRemaining'))+'</small>';
      if(sub) sub.textContent = fmtDist(remainingDist())+' · '+t('navEta')+' '+fmtClock(Date.now()+rem*60000)+' · '+st.destName;
    }
  }
  function nextStep(){
    if(!st.active) return;
    if(st.idx < st.legs.length-1){ st.idx++; render(); }
    else { arrived(); }
  }
  function arrived(){
    if(!st.active) return;
    var card=$('navCard'); if(card){
      var badge=card.querySelector('.nc-badge'); if(badge){ badge.textContent=t('navArrived'); badge.className='nc-badge'; }
      var dist=card.querySelector('.nc-dist'); if(dist) dist.textContent='✓';
      var inst=card.querySelector('.nc-inst'); if(inst) inst.textContent=t('navArrived')+' — '+st.destName;
      var thenEl=card.querySelector('.nc-then'); if(thenEl) thenEl.textContent='';
      var nextBtn=card.querySelector('[data-nav-next]'); if(nextBtn) nextBtn.style.display='none';
    }
    var strip=$('navStrip'); if(strip){ var tm=strip.querySelector('.ns-time'); if(tm) tm.textContent=t('navArrived'); }
  }
  function planReturn(){
    var total = st.totalMin||0;
    end();
    if(window.SFMap && SFMap.planReturn){ SFMap.planReturn(total); }
    else { openSheet('plan','half'); }
  }
  function reroute(){
    if(!st.lastFix) return;
    var b=$('offRouteBanner'); if(b) b.classList.remove('show');
    if(window.SFMap && SFMap.rerouteFrom){
      var ok = SFMap.rerouteFrom(st.lastFix.lat, st.lastFix.lon);
      if(ok){ end(true); start(); }
    }
  }
  function end(keepWatch){
    if(!st.active) return;
    st.active=false;
    if(!keepWatch && st.watchId!=null && 'geolocation' in navigator){ try{ navigator.geolocation.clearWatch(st.watchId); }catch(e){} }
    if(st.noFixTimer){ clearTimeout(st.noFixTimer); st.noFixTimer=null; }
    if(st.line && map()){ try{ map().removeLayer(st.line); }catch(e){} st.line=null; }
    document.getElementById('app').classList.remove('navmode');
    var b=$('offRouteBanner'); if(b) b.classList.remove('show');
    var gb=$('gpsBanner'); if(gb) gb.classList.remove('show');
    if(getRoute()){ var rc=$('routeCard'); if(rc) rc.classList.add('show'); }
  }
  function confirmReplace(){
    if(!st.active) return true;
    return window.confirm ? confirm(t('navReplace')) : true;
  }
  return { start:start, end:function(){ end(false); }, nextStep:nextStep, planReturn:planReturn,
    reroute:reroute, confirmReplace:confirmReplace, render:render,
    toggleFollow:function(){ st.following=!st.following; render(); },
    get active(){ return st.active; } };
})();

/* ================= SOS wiring ================= */
var SOS = {
  wire: function(){
    var copyBtn=$('sosCopyBtn'), shareBtn=$('sosShareBtn'), waBtn=$('sosWaBtn');
    function locText(){
      var c = $('sosCoords'); var txt = c?c.textContent:'';
      var s = (window.SFMap && SFMap.getStart) ? SFMap.getStart() : null;
      var ll = s ? s[0].toFixed(5)+','+s[1].toFixed(5) : '';
      return (txt||'') + (ll?'\nhttps://maps.google.com/?q='+ll:'');
    }
    if(copyBtn) copyBtn.addEventListener('click', function(){
      var txt=locText();
      if(navigator.clipboard && navigator.clipboard.writeText){ navigator.clipboard.writeText(txt).then(function(){ toast(t('sosCopied')); }, function(){ toast(txt); }); }
      else { toast(txt); }
    });
    if(shareBtn) shareBtn.addEventListener('click', function(){
      var txt=locText();
      if(navigator.share){ navigator.share({text:txt}).catch(function(){}); }
      else if(navigator.clipboard && navigator.clipboard.writeText){ navigator.clipboard.writeText(txt).then(function(){ toast(t('sosCopied')); }); }
      else { toast(txt); }
    });
    if(waBtn) waBtn.addEventListener('click', function(){
      window.open('https://wa.me/?text='+encodeURIComponent(locText()), '_blank');
    });
  }
};

/* ================= dynamic re-render on language change ================= */
function renderDynamic(){
  Trips.renderChip(); Trips.renderSettings(); Friends.render();
  if(sheetPane==='friends') Friends.renderSheet();
  var rb=$('recBtn'); if(rb){ var lbl=rb.querySelector('.reclbl'); if(lbl) lbl.textContent = Rec.isActive()?t('recStop'):t('record'); }
  renderOfflineBadge();
  if(Nav.active) Nav.render();
  var sum=$('pane-summary'); if(sum && sum.classList.contains('active')) Rec.renderSummary();
  // re-label nav bar items
  document.querySelectorAll('#actionbar .navbtn .navlbl[data-i18n]').forEach(function(l){
    l.textContent = t(l.getAttribute('data-i18n'));
  });
}

/* ================= map tap helper (pages call this first) ================= */
function onMapTap(lat, lon){
  if(Friends.onMapTap(lat, lon)) return 'friend';
  if(sheetEl() && sheetEl().classList.contains('open')){ closeSheet(); return 'closed'; }
  return null;
}
function closeSheetIfOpen(){
  if(sheetEl() && sheetEl().classList.contains('open')){ closeSheet(); return true; }
  return false;
}

/* ================= init ================= */
function init(config){
  cfg = config||{};
  cfg.demoFriend = cfg.demoFriend||null;
  Trips.loadCustom();
  applyTheme();
  if(window.matchMedia){
    try{ matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function(){ if(!ls('sf-theme')) applyTheme(); }); }catch(e){}
  }
  // navbar buttons
  document.querySelectorAll('#actionbar .navbtn[data-pane]').forEach(function(b){
    b.addEventListener('click', function(){
      var p=b.getAttribute('data-pane');
      if(sheetPane===p && sheetEl().classList.contains('open')){ closeSheet(); }
      else { openSheet(p, p==='settings'?'half':'peek'); }
    });
  });
  var fre=$('friendsEntryRoute'); if(fre) fre.addEventListener('click', function(){ Friends.openSheet(); });
  var fes=$('friendsEntrySettings'); if(fes) fes.addEventListener('click', function(){ Friends.openSheet(); });
  var recBtn=$('recBtn'); if(recBtn) recBtn.addEventListener('click', function(){ Rec.toggle(); });
  var gear=$('gearBtn'); if(gear) gear.addEventListener('click', function(){ openSheet('settings','half'); });
  var fab=$('gpsFab'); if(fab) fab.addEventListener('click', function(){
    if(window.SFMap && SFMap.locate) SFMap.locate();
  });
  var sl=$('startLabel'); if(sl) sl.addEventListener('click', function(){
    if(window.SFMap && SFMap.locate) SFMap.locate();
  });
  var oc=$('offlineChip'); if(oc) oc.addEventListener('click', function(){
    if(window.SFMap && SFMap.saveOffline) SFMap.saveOffline();
  });
  var tc=$('tripChip'); if(tc){
    var sw=tc.querySelector('.switch');
    if(sw) sw.addEventListener('click', function(e){
      e.stopPropagation();
      var tr=Trips.activeTrip();
      if(!tr){ openSheet('settings','half'); toast(t('pickTripFirst')); return; }
      Trips.setMySharing(tr.id, !Trips.mySharing(tr.id));
    });
    tc.querySelector('.trip-label').addEventListener('click', function(){ openSheet('settings','half'); });
  }
  // sheet close buttons + scrim
  document.querySelectorAll('#sheet .pane h2 .x').forEach(function(x){ x.addEventListener('click', closeSheet); });
  var scrim=$('scrim'); if(scrim) scrim.addEventListener('click', closeSheet);
  initSheetDrag();
  // route card
  var det=$('rcDetails'); if(det) det.addEventListener('click', function(){ openSheet('route','peek'); });
  var stBtn=$('rcStart'); if(stBtn) stBtn.addEventListener('click', function(){ Nav.start(); });
  var endBtn=$('rcEnd'); if(endBtn) endBtn.addEventListener('click', function(){
    if(window.SFMap && SFMap.clearRoute) SFMap.clearRoute();
  });
  // nav strip + card
  var nsEnd=$('nsEnd'); if(nsEnd) nsEnd.addEventListener('click', function(){ Nav.end(); });
  var ncNext=document.querySelector('[data-nav-next]'); if(ncNext) ncNext.addEventListener('click', function(){ Nav.nextStep(); });
  var ncFollow=document.querySelector('[data-nav-follow]'); if(ncFollow) ncFollow.addEventListener('click', function(){ Nav.toggleFollow(); });
  var ncPlan=document.querySelector('[data-nav-plan]'); if(ncPlan) ncPlan.addEventListener('click', function(){ Nav.planReturn(); });
  var rr=$('rrBtn'); if(rr) rr.addEventListener('click', function(){ Nav.reroute(); });
  var sf=$('sosFab'); if(sf) sf.addEventListener('click', function(){
    if(Nav.active){ document.getElementById('app').classList.add('sos-over-nav'); }
    openSheet('sos','peek');
  });
  // search input: focus opens the Search sheet (input stays focusable)
  var si=$('search'); if(si) si.addEventListener('focus', function(){
    if(sheetPane!=='search' || !sheetEl().classList.contains('open')) openSheet('search','peek');
  });
  // theme seg buttons
  document.querySelectorAll('[data-theme-btn]').forEach(function(b){
    b.addEventListener('click', function(){ setTheme(b.getAttribute('data-theme-btn')); });
  });
  // SOS
  SOS.wire();
  // friends / trips / hash
  Friends.ensureDemo();
  Friends.render();
  Trips.renderChip(); Trips.renderSettings();
  renderOfflineBadge();
  Rec.renderSummary();
  Friends.importFromHash();
  Friends.syncShareState();
  Friends.pruneExpired();
  Friends.renderSheet();
  Friends.processIncomingLink();
  // re-render dynamic SF UI when the page flips language
  if(window.MutationObserver){
    var mo = new MutationObserver(function(muts){
      muts.forEach(function(m){ if(m.attributeName==='lang'||m.attributeName==='dir') renderDynamic(); });
    });
    mo.observe(document.documentElement, {attributes:true});
  }
}

/* ================= export ================= */
window.SF = {
  t:t, toast:toast, setStatus:setStatus, openSheet:openSheet, closeSheet:closeSheet,
  cycleDetent:cycleDetent, applyTheme:applyTheme, setTheme:setTheme, init:init,
  renderDynamic:renderDynamic, setStartLabel:setStartLabel,
  searchFold:searchFold, matchCategory:matchCategory,
  Rec:Rec, Friends:Friends, Trips:Trips, Nav:Nav, Recents:Recents, SOS:SOS,
  onMapTap:onMapTap, closeSheetIfOpen:closeSheetIfOpen,
  sheetOpen:function(){ var sh=document.getElementById('sheet'); return !!(sh&&sh.classList.contains('open')); },
  Offline:{ renderBadge:renderOfflineBadge, markSaved:markOfflineSaved, clearSaved:clearOfflineSaved },
  getCfg:function(){ return cfg; }
};
/* Global shims so the pages' inline onclick handlers (openSheet('search'),
   closeSheet(), cycleDetent()) keep working after the pages drop their own
   sheet functions. */
window.openSheet = function(p, d){ return SF.openSheet(p, d); };
window.closeSheet = SF.closeSheet;
window.cycleDetent = SF.cycleDetent;
window.sheetIsOpen = function(){ var sh=document.getElementById('sheet'); return !!(sh&&sh.classList.contains('open')); };
})();
