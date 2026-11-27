/* sf-auth.js — SnowForecast Supabase Auth (Google / Apple sign-in).
   Guest-first by design: if guides/supabase-config.js is empty (or the
   Supabase CDN is unreachable), the app runs exactly as today in guest
   mode — local-only data, no errors, no network calls. Nothing here
   throws when Supabase is absent: every public method is a safe no-op
   until a client exists and a user is signed in.
   UI: one account card rendered into #sfAuthBox inside the Settings
   sheet (no new bottom-bar item, nothing floats over the map).
   MODULAR — works on ANY page, not just the maps: the unified homepage
   (resort picker + sign-in) needs only supabase-config.js + this file.
   If the page has <div id="sfAuthBox"></div> (or [data-sf-auth-box]),
   the card renders there automatically; otherwise the page builds its
   own UI from the SFAuth interface below (no map globals required —
   SF.toast and SF_STR are used only when present, with local fallbacks).
   INTEGRATION INTERFACE (for the unified-site coordinator — no
   duplication: do not re-implement sign-in elsewhere):
     SFAuth.configured()            -> bool (URL + anon key present)
     SFAuth.isSignedIn()            -> bool
     SFAuth.getUser()               -> {id, email, name} | null
     SFAuth.getClient()             -> supabase client | null
     SFAuth.signIn('google'|'apple')-> Promise<{ok, reason?}> (OAuth
                                      redirect; 'provider-disabled' when
                                      the provider is off in the dashboard)
     SFAuth.signOut()               -> Promise<{ok}>
     SFAuth.onAuthChange(cb)        -> cb(user|null) on every auth change
     SFAuth.render([el])            -> (re)render the account card into
                                      el, or #sfAuthBox / [data-sf-auth-box]
     document 'sf-auth-change' event -> CustomEvent, detail {user}
   After OAuth the user returns to the CURRENT page (redirectTo =
   location.origin + location.pathname), so signing in from the homepage
   stays on the homepage and signing in from a map stays on that map.
   sf-sync.js is map-only and is NOT needed on the homepage.
   Depends on: window.SF_SUPABASE (supabase-config.js). Loads
   @supabase/supabase-js from CDN only when a config is present. */
(function(){
'use strict';

/* ================= i18n (merged into SF_STR so page t() sees it) ================= */
var AUTH_STR = {
he:{
  'auth.title':'👤 חשבון',
  'auth.guest':'מצב אורח',
  'auth.guestNote':'הכל נשמר רק במכשיר הזה — טיולים, חברים והקלטות לא עוברים בין מכשירים.',
  'auth.notConfigured':'התחברות וסנכרון עדיין לא הוגדרו. כדי להפעיל אותם, מלאו את ה־URL וה־anon key ב־supabase-config.js.',
  'auth.unavailable':'החיבור ל־Supabase לא זמין כרגע — ממשיכים כאורח, הכל נשמר מקומית.',
  'auth.loading':'טוען את החשבון…',
  'auth.signInGoogle':'התחברות עם Google',
  'auth.signInApple':'התחברות עם Apple',
  'auth.appleNotEnabled':'כניסה עם Apple עדיין לא הופעלה בפרויקט — תיפתח כשתופעל בדשבורד (דורש חשבון Apple Developer). בינתיים הכניסה עם Google עובדת.',
  'auth.signInNote':'התחברות מאפשרת סנכרון טיולים, שיתוף מיקום והקלטות בין מכשירים — רק עם חברי הטיול שלכם.',
  'auth.signedInAs':'מחובר כ־',
  'auth.signOut':'התנתקות',
  'auth.syncOff':'סנכרון כבוי',
  'auth.syncPending':'ממתינים לסנכרון: {n}',
  'auth.synced':'מסונכרן ✓',
  'auth.offline':'אין קליטה — השינויים יישלחו כשתחזרו לאינטרנט',
  'auth.syncError':'הסנכרון נכשל — ננסה שוב אוטומטית',
  'auth.syncTablesMissing':'טבלאות הסנכרון (ski) עדיין לא נוצרו בפרויקט — האפליקציה ממשיכה מקומית בלבד עד שה־SQL יורץ בדשבורד.',
  'auth.signInError':'ההתחברות נכשלה — נסו שוב.',
  'auth.providerDisabled':'כניסה דרך {provider} עדיין לא הופעלה בפרויקט — נסו ספק אחר, או הפעילו אותו בדשבורד (Authentication → Providers).'
},
en:{
  'auth.title':'👤 Account',
  'auth.guest':'Guest mode',
  'auth.guestNote':'Everything stays on this device only — trips, friends and tracks do not move between devices.',
  'auth.notConfigured':'Sign-in and sync are not set up yet. To enable them, fill in the URL and anon key in supabase-config.js.',
  'auth.unavailable':'Could not reach Supabase right now — continuing as a guest, everything stays local.',
  'auth.loading':'Loading account…',
  'auth.signInGoogle':'Sign in with Google',
  'auth.signInApple':'Sign in with Apple',
  'auth.appleNotEnabled':'Sign in with Apple is not enabled in the project yet — it will work once it is enabled in the dashboard (needs a paid Apple Developer account). Google sign-in works in the meantime.',
  'auth.signInNote':'Signing in syncs trips, shared positions and tracks across devices — only with your trip members.',
  'auth.signedInAs':'Signed in as ',
  'auth.signOut':'Sign out',
  'auth.syncOff':'Sync off',
  'auth.syncPending':'Waiting to sync: {n}',
  'auth.synced':'Synced ✓',
  'auth.offline':'No connection — changes will be sent when you are back online',
  'auth.syncError':'Sync failed — will retry automatically',
  'auth.syncTablesMissing':'The sync tables (ski) have not been created in the project yet — the app keeps working locally only until the SQL is run in the dashboard.',
  'auth.signInError':'Sign-in failed — please try again.',
  'auth.providerDisabled':'Sign-in with {provider} is not enabled in the project yet — try another provider, or enable it in the dashboard (Authentication → Providers).'
}};
if(window.SF_STR){
  for(var _l in AUTH_STR){ if(window.SF_STR[_l]) for(var _k in AUTH_STR[_l]) window.SF_STR[_l][_k]=AUTH_STR[_l][_k]; }
}

function lang(){ var l='he'; try{ l=(document.documentElement.getAttribute('lang')||'he'); }catch(e){} return l.indexOf('en')===0?'en':'he'; }
function at(k, vars){
  var L=(window.SF_STR&&window.SF_STR[lang()])||{};
  // L3: on a page WITHOUT map-shared.js there is no SF_STR — fall back
  // to this file's own strings in the PAGE language, not English-only.
  var A=AUTH_STR[lang()]||AUTH_STR.en;
  var s=(L[k]!=null?L[k]:(A[k]!=null?A[k]:(AUTH_STR.en[k]!=null?AUTH_STR.en[k]:k)));
  if(vars) for(var a in vars) s=String(s).split('{'+a+'}').join(vars[a]);
  return s;
}
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
function fmtClock(ts){ try{ var d=new Date(ts); return ('0'+d.getHours()).slice(-2)+':'+('0'+d.getMinutes()).slice(-2); }catch(e){ return ''; } }

/* ================= config =================
   Accepts either global name: guides/supabase-config.js sets
   window.SF_SUPABASE; the template in supabase/supabase-config.example.js
   uses window.SNOWFORECAST_SUPABASE. Both are read here. */
var SUPABASE_CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js';
var SCHEMA = 'ski'; // tables live in the `ski` schema (see sf-sync.js)

function readConfig(){
  var c = window.SF_SUPABASE || window.SNOWFORECAST_SUPABASE || {};
  var url = (typeof c.url==='string') ? c.url.trim() : '';
  var key = (typeof c.anonKey==='string') ? c.anonKey.trim() : '';
  return { url:url, anonKey:key };
}
function configured(){
  var c = readConfig();
  return !!c.url && !!c.anonKey && c.url.indexOf('https://')===0;
}

/* ================= state ================= */
var client = null;      // supabase client (null until loaded)
var clientFailed = false;
var clientLoading = false;
var user = null;        // {id, email, name} or null
var lastSignInError = null; // L3: last sign-in failure text, shown in the card itself
var listeners = [];     // onAuthChange callbacks
var boxRenderedFor = ''; // lang+state key, to avoid redundant re-renders

function currentUser(u){
  if(!u) return null;
  var md = u.user_metadata || {};
  return { id:u.id||null, email:u.email||null,
    name:(md.full_name||md.name||u.email||'').toString() };
}
function notify(){
  if(user) lastSignInError = null; // a successful sign-in clears a stale error
  for(var i=0;i<listeners.length;i++){ try{ listeners[i](user); }catch(e){} }
  // DOM event so pages without a SFAuth reference (e.g. the unified
  // homepage) can react: document.addEventListener('sf-auth-change',
  // function(e){ var user = e.detail.user; ... })
  try{
    document.dispatchEvent(new CustomEvent('sf-auth-change', {detail:{user:user}}));
  }catch(e){}
}

/* ================= client bootstrap ================= */
function createClient(){
  if(client || clientLoading || clientFailed) return;
  var c = readConfig();
  if(!c.url || !c.anonKey) return; // guest mode: never load the CDN
  clientLoading = true;
  function build(){
    try{
      if(!window.supabase || !window.supabase.createClient){ clientFailed=true; clientLoading=false; render(); return; }
      client = window.supabase.createClient(c.url, c.anonKey, {
        auth:{ persistSession:true, autoRefreshToken:true, detectSessionInUrl:true },
        db:{ schema:SCHEMA }
      });
      clientLoading = false;
      // restore session, then watch for changes (incl. the OAuth redirect return)
      if(client.auth && client.auth.getSession){
        client.auth.getSession().then(function(res){
          var s = res && res.data && res.data.session;
          user = s ? currentUser(s.user) : null;
          render(); notify();
        }).catch(function(){ user=null; render(); notify(); });
      }
      if(client.auth && client.auth.onAuthStateChange){
        client.auth.onAuthStateChange(function(_event, session){
          user = session ? currentUser(session.user) : null;
          render(); notify();
        });
      }
      render();
    }catch(e){ client=null; clientFailed=true; clientLoading=false; render(); }
  }
  if(window.supabase && window.supabase.createClient){ build(); return; } // test seam / preloaded
  var s = document.createElement('script');
  s.src = SUPABASE_CDN; s.async = true;
  s.onload = build;
  s.onerror = function(){ clientFailed=true; clientLoading=false; render(); }; // offline: stay guest, no console error
  document.head.appendChild(s);
}

/* ================= public API =================
   OAuth note: the app never touches a Client ID / Secret — Supabase
   manages the provider server-side. signInWithOAuth redirects to
   Supabase, which returns to redirectTo() below (the current map page).
   That requires, in the dashboard (parallel task, see SETUP.md §2):
     - Google / Apple provider enabled with its own client credentials;
     - the Supabase callback URL registered at the provider:
       https://zryunaixiaxlxedlvlyv.supabase.co/auth/v1/callback
     - Site URL https://snowforcast.vercel.app and Redirect URLs
       https://snowforcast.vercel.app/** allow-listed (URL Configuration).
   If the provider is not enabled yet, signInWithOAuth fails with a
   "provider is not enabled" error — surfaced as 'provider-disabled'
   so the UI can say so plainly instead of failing silently. */
function redirectUrl(){
  try{ return location.origin + location.pathname; }catch(e){ return ''; }
}
function signIn(provider){
  if(!client || !client.auth || !client.auth.signInWithOAuth) return Promise.resolve({ok:false, reason:'no-client'});
  return client.auth.signInWithOAuth({ provider:provider,
    options:{ redirectTo:redirectUrl() } }).then(function(res){
    if(res && res.error){
      var msg = String((res.error && res.error.message) || '');
      if(/not enabled/i.test(msg)) return {ok:false, reason:'provider-disabled', provider:provider};
      return {ok:false, reason:'oauth-error'};
    }
    return {ok:true};
  }).catch(function(e){
    var msg = String((e && e.message) || '');
    if(/not enabled/i.test(msg)) return {ok:false, reason:'provider-disabled', provider:provider};
    return {ok:false, reason:'oauth-error'};
  });
}
function signOut(){
  if(!client || !client.auth || !client.auth.signOut) return Promise.resolve({ok:false});
  return client.auth.signOut().then(function(){ user=null; render(); notify(); return {ok:true}; })
    .catch(function(){ return {ok:false}; });
}

/* ================= UI: account card (Settings sheet + homepage) ================= */
function syncLine(){
  if(!user) return '';
  var st = null;
  try{ st = (window.SFSync && SFSync.getStatus) ? SFSync.getStatus() : null; }catch(e){ st=null; }
  if(!st || !st.enabled) return '<p class="muted">'+esc(at('auth.syncOff'))+'</p>';
  if(!st.online) return '<p class="muted">'+esc(at('auth.offline'))+'</p>';
  if(st.tablesMissing) return '<p class="muted">'+esc(at('auth.syncTablesMissing'))+'</p>';
  if(st.lastError) return '<p class="muted">'+esc(at('auth.syncError'))+'</p>';
  if(st.pending>0) return '<p class="muted">'+esc(at('auth.syncPending',{n:st.pending}))+'</p>';
  var line = at('auth.synced');
  if(st.lastSyncAt) line += ' · '+fmtClock(st.lastSyncAt);
  return '<p class="muted">'+esc(line)+'</p>';
}
/* Renders into the given element, or #sfAuthBox / [data-sf-auth-box]
   when no element is passed (map Settings sheet + unified homepage).
   Safe to call on any page: no-op when no container exists. */
var lastBox = null;
function defaultBox(){
  try{
    var b = document.getElementById('sfAuthBox');
    if(b) return b;
    return document.querySelector('[data-sf-auth-box]');
  }catch(e){ return null; }
}
function render(box){
  box = box || lastBox || defaultBox();
  if(!box) return;
  lastBox = box;
  var key = lang()+'|'+(configured()?'cfg':'nocfg')+'|'+(clientLoading?'loading':clientFailed?'failed':client?'client':'noclient')
    +'|'+(user?('u:'+user.id):'guest')
    +'|se'+(lastSignInError?'1':'0')
    +'|box:'+((box.id||'')+(box.getAttribute?box.getAttribute('data-sf-auth-box')||'':''));
  try{
    var st = (window.SFSync && SFSync.getStatus) ? SFSync.getStatus() : null;
    if(st) key += '|pend'+st.pending+'|on'+(st.online?'1':'0')+'|err'+(st.lastError?'1':'0')
      +'|tm'+(st.tablesMissing?'1':'0')+'|syn'+(st.lastSyncAt||0);
  }catch(e){}
  if(key===boxRenderedFor) return; // already rendered for this state
  boxRenderedFor = key;
  var h = '<h3>'+esc(at('auth.title'))+'</h3>';
  if(!configured()){
    h += '<div class="card"><div class="member"><div class="who"><b>'+esc(at('auth.guest'))+'</b>'
      + '<small>'+esc(at('auth.guestNote'))+'</small></div></div>'
      + '<p class="muted">'+esc(at('auth.notConfigured'))+'</p></div>';
  } else if(clientLoading){
    h += '<div class="card"><p class="muted">'+esc(at('auth.loading'))+'</p></div>';
  } else if(clientFailed || !client){
    h += '<div class="card"><div class="member"><div class="who"><b>'+esc(at('auth.guest'))+'</b>'
      + '<small>'+esc(at('auth.guestNote'))+'</small></div></div>'
      + '<p class="muted">'+esc(at('auth.unavailable'))+'</p></div>';
  } else if(!user){
    h += '<div class="card"><div class="member"><div class="who"><b>'+esc(at('auth.guest'))+'</b>'
      + '<small>'+esc(at('auth.guestNote'))+'</small></div></div>'
      + '<div class="row"><button class="btn primary block" data-auth="google">'+esc(at('auth.signInGoogle'))+'</button></div>'
      // Apple is NOT enabled in the Supabase project yet (needs a paid
      // Apple Developer account + Services ID / key in the dashboard).
      // The button stays visible but disabled, with a plain note, so
      // nobody taps into a dead end. To switch it on once the provider
      // is enabled: remove `disabled` below (signIn('apple') already
      // works — see signInWithOAuth in sf-auth.js).
      + '<div class="row"><button class="btn block" data-auth="apple" disabled>'+esc(at('auth.signInApple'))+'</button></div>'
      + '<p class="muted">'+esc(at('auth.appleNotEnabled'))+'</p>'
      + '<p class="muted">'+esc(at('auth.signInNote'))+'</p>'
      // L3: on a page without SF.toast a sign-in failure was silent.
      // The error is rendered in the card itself (toast as well, when
      // the map page provides it — see the click handler below).
      + (lastSignInError?'<p class="muted">'+esc(lastSignInError)+'</p>':'')
      + '</div>';
  } else {
    var initial = (user.name||user.email||'?').trim().charAt(0).toUpperCase();
    h += '<div class="card"><div class="member"><div class="sf-auth-avatar" aria-hidden="true">'+esc(initial)+'</div>'
      + '<div class="who"><b>'+esc(user.name||user.email||'')+'</b>'
      + '<small>'+esc(user.email||'')+'</small></div>'
      + '<button class="btn" data-auth="signout">'+esc(at('auth.signOut'))+'</button></div>'
      + syncLine() + '</div>';
  }
  box.innerHTML = h;
  box.querySelectorAll('[data-auth]').forEach(function(b){
    b.addEventListener('click', function(){
      var kind = b.getAttribute('data-auth');
      if(kind==='signout'){ signOut(); return; }
      signIn(kind).then(function(r){
        if(!r.ok){
          // Shown in the card (see render) AND as a toast when the
          // page provides one — never silent on either kind of page.
          lastSignInError = (r.reason==='provider-disabled')
            ? at('auth.providerDisabled',{provider:kind==='apple'?'Apple':'Google'})
            : at('auth.signInError');
          boxRenderedFor=''; render();
          if(window.SF && SF.toast) SF.toast(lastSignInError, true);
        }
      });
    });
  });
}

/* ================= boot ================= */
function boot(){
  render();
  if(configured()) createClient();
  // re-render on language flip (pages set documentElement.lang)
  if(window.MutationObserver){
    var mo = new MutationObserver(function(muts){
      for(var i=0;i<muts.length;i++){ if(muts[i].attributeName==='lang'){ boxRenderedFor=''; render(); break; } }
    });
    try{ mo.observe(document.documentElement, {attributes:true}); }catch(e){}
  }
  window.addEventListener('online', function(){ boxRenderedFor=''; render(); });
  window.addEventListener('offline', function(){ boxRenderedFor=''; render(); });
}
if(document.readyState==='loading'){ document.addEventListener('DOMContentLoaded', boot); }
else { boot(); }

window.SFAuth = {
  configured:configured, isSignedIn:function(){ return !!user; },
  getUser:function(){ return user; }, getClient:function(){ return client; },
  signIn:signIn, signOut:signOut, render:render,
  onAuthChange:function(cb){ if(typeof cb==='function') listeners.push(cb); }
};
})();
