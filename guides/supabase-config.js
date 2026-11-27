/* supabase-config.js — SnowForecast Supabase project settings.
   =====================================================================
   פרויקט: "options" (org aj) — הפרויקט הקיים של אביאל, אושר 27.11.2026.
   Project: "options" (org aj) — Aviel's existing project, approved
   2026-11-27. Tables live in the separate `ski` schema only
   (supabase/ski-schema.sql) — existing tables are never touched.

   ה־URL וה־publishable key נלקחו מ־Supabase Dashboard → Settings → API.
   The URL and publishable key are from Supabase Dashboard → Settings → API.

   אבטחה / Security:
   - ה־publishable key הוא מפתח ציבורי (public) — מותר שיופיע בקוד
     הלקוח; הוא יכול לעשות רק מה שמדיניות ה־RLS ב־ski-schema.sql
     מתירה למשתמש המחובר. The publishable key is a public key — safe
     to ship in client code; it can only do what the RLS policies in
     ski-schema.sql allow the signed-in user.
   - לעולם אל תשימו כאן את ה־service_role key — הוא סודי ונותן גישה
     מלאה למסד הנתונים. Never put the service_role key here — it is
     secret and grants full database access.
   - הקובץ הזה נדחף לריפו במכוון (החלטה 27.11.2026): המפתח הוא
     publishable/ציבורי ומיועד לקוד לקוח; בלי הקובץ האתר החי ירוץ
     במצב אורח. This file IS pushed to the repo by decision
     (27.11.2026): the key is publishable/public by design.
   - אם השדות ריקים, האפליקציה עובדת בדיוק כמו היום במצב אורח
     (הכל מקומי במכשיר, בלי שגיאות). If left empty, the app runs
     exactly as today in guest mode (everything local on the device,
     no errors).

   הקובץ הזה נטען לפני sf-auth.js. אם window.SF_SUPABASE כבר הוגדר
   (למשל בבדיקות), הערכים הקיימים נשמרים ולא נדרסים.
   This file loads before sf-auth.js. If window.SF_SUPABASE is already
   defined (e.g. in tests), the existing values are kept.
   ===================================================================== */
window.SF_SUPABASE = window.SF_SUPABASE || {
  url: 'https://zryunaixiaxlxedlvlyv.supabase.co',
  anonKey: 'sb_publishable_RSep1EnW0m2cpdArirIm8A_3lbgNw27'
};
/* Alias for the name used by supabase/supabase-config.example.js —
   sf-auth.js reads either global. */
window.SNOWFORECAST_SUPABASE = window.SNOWFORECAST_SUPABASE || window.SF_SUPABASE;
