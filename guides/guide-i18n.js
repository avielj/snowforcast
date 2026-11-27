/* SnowForecast guide pages — shared i18n runtime (guides/guide-i18n.js).
   Same language model as the map pages: localStorage key 'sf-lang', default 'he',
   piste/lift/place names stay in their official French form in both languages
   (they are data inside the strings, never translated by this runtime).
   Pages define window.GUIDE_STR = {he:{...}, en:{...}} and call GuideI18n.init().
   Elements: data-i18n (plain text), data-i18n-html (innerHTML, keeps <b>/<a>/<br>),
   data-i18n-ph (placeholder), data-i18n-title (title attr). Language buttons use
   data-lang-seg + data-lang="he|en" and onclick="GuideI18n.setLang('he')".
   After every apply() a 'guide-lang' event fires on document so the live
   snow banner can re-render from its cached data. Theme is NOT handled here:
   the head boot script sets data-theme from localStorage (else the device
   decides via prefers-color-scheme in the page CSS). */
window.GuideI18n = (function(){
  function lang(){ try{ return localStorage.getItem('sf-lang')||'he'; }catch(e){ return 'he'; } }
  function t(k){
    var L = window.GUIDE_STR || {};
    var d = L[lang()] || {};
    if (d[k] != null) return d[k];
    var h = (L.he || {})[k];
    return h != null ? h : k;
  }
  function apply(){
    var l = lang();
    document.documentElement.lang = l;
    document.documentElement.dir = l === 'en' ? 'ltr' : 'rtl';
    document.querySelectorAll('[data-i18n]').forEach(function(el){
      el.textContent = t(el.getAttribute('data-i18n'));
    });
    document.querySelectorAll('[data-i18n-html]').forEach(function(el){
      el.innerHTML = t(el.getAttribute('data-i18n-html'));
    });
    document.querySelectorAll('[data-i18n-ph]').forEach(function(el){
      el.setAttribute('placeholder', t(el.getAttribute('data-i18n-ph')));
    });
    document.querySelectorAll('[data-i18n-title]').forEach(function(el){
      el.setAttribute('title', t(el.getAttribute('data-i18n-title')));
    });
    var L = window.GUIDE_STR || {};
    if (L[l] && L[l].title) document.title = L[l].title;
    var md = document.querySelector('meta[name="description"]');
    if (md && L[l] && L[l].description) md.setAttribute('content', L[l].description);
    document.querySelectorAll('[data-lang-seg]').forEach(function(b){
      b.setAttribute('aria-pressed', b.getAttribute('data-lang') === l ? 'true' : 'false');
    });
    document.dispatchEvent(new CustomEvent('guide-lang', {detail:{lang:l}}));
  }
  function setLang(l){
    try{ localStorage.setItem('sf-lang', l); }catch(e){}
    apply();
  }
  function init(str){
    window.GUIDE_STR = str;
    apply();
  }
  return {init:init, setLang:setLang, t:t, apply:apply, lang:lang};
})();
