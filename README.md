# מדרום — חנות ו־CRM על Cloudflare Pages

גרסה חדשה של מדרום על בסיס React, Vite, Pages Functions ו־D1. העיצוב ממשיך את צבעי האבן, הטרקוטה והזית של הפרויקט המקורי. האתר מימין לשמאל ומותאם קודם למובייל.

## מה עובד בגרסה הזו

- קטלוג ציבורי, חיפוש וסינון, חנויות, מוצר, אפשרויות מוצר, מלאי וסל.
- כניסה מאובטחת למנהל ולסוחר באמצעות סיסמה ו־cookie מסוג HttpOnly.
- מנהל יוצר חנות וחשבון סוחר, ומשנה סטטוס פרסום.
- סוחר עורך פרופיל עסק, יוצר ועורך מוצרים, מעביר מוצר לארכיון, רואה הזמנות ותנועות כספיות, ומקדם סטטוס הזמנה ששולמה.
- מסד D1 כולל טבלאות נפרדות לחנויות, מוצרים, הזמנות, חשבונות ספקים, Ledger בלתי משתנה, בקשות זיכוי ורישום פעולות.
- חיפוש נתונים רגישים מוגבל לפי המשתמש והחנות בשרת. אין מפתחות או נתוני לקוחות מהארכיון בגיט.

**טרם מחובר:** ספק סליקה Marketplace, ספק חשבוניות, SMS/מייל, אימות Google, הרשמת לקוחות, הפקת הזמנות ותהליך זיכוי. הסל מציג במפורש שאי אפשר לשלם; נקודת ה־API של checkout מחזירה 503 ואינה יוצרת הזמנה או חיוב. חשבון תשלום/חשבוניות ב־CRM מציג מצב חיבור בלבד. אין להציג את המערכת כמערכת מסחר פעילה לפני חיבור ספקים ובדיקת הקצה לקצה.

הקטלוג הראשון שמופיע כאשר D1 אינו מחובר או ריק הוא **תצוגה לדוגמה בלבד**: אין בו רכישה והוא מסומן ככזה באתר. לאחר יצירת חנות ופרסום מוצר אמיתי יוצג הקטלוג ממסד הנתונים.

## התקנה מקומית

נדרש Node.js 20.19 ומעלה ו־npm.

```bash
npm ci
npm run check
npm run build
```

להצגת העיצוב בלבד: `npm run dev`. סביבת Vite זו מציגה קטלוג לדוגמה; נקודות ה־API של Pages Functions פועלות דרך Wrangler.

## Cloudflare Pages + D1

1. צרו מאגר GitHub לפרויקט זה וחברו אותו ל־Cloudflare Pages. בחרו ענף זה כ־**Production branch** אם תרצו שכל commit לענף יגיע לאתר הראשי; אחרת הוא יהיה Preview branch.
2. הגדרות build ב־Pages: **Framework: React (Vite)**, **Root directory:** `/`, **Build command:** `npm run build`, **Build output directory:** `dist`, ומשתנה סביבה `NODE_VERSION=22`.
3. צרו מסד D1 בשם `madarom` ב־Cloudflare. ב־Pages > Settings > Bindings הוסיפו **D1 database binding** בשם המדויק `DB`. חברו מסדים נפרדים ל־Preview ול־Production כדי שלא יחלוקו נתונים.
4. העתיקו את `wrangler.example.jsonc` אל `wrangler.jsonc`, החליפו בו את `database_id` במזהה המסד שנוצר. הקובץ המקומי מוחרג מגיט. הפעילו את קובצי `migrations/` לפי סדרם על כל מסד, לאחר הזדהות ב־Wrangler:

```bash
npx wrangler d1 execute madarom --remote --file=migrations/0001_core.sql
npx wrangler d1 execute madarom --remote --file=migrations/0002_login_attempts.sql
npx wrangler d1 execute madarom --remote --file=migrations/0003_immutable_ledger.sql
```

5. צרו משתמש מנהל במסוף אינטראקטיבי; הסיסמה מוקלדת כשהיא מוסתרת. קובץ ה־SQL לא נכנס לגיט:

```bash
npm run admin:create -- admin@example.com "שם המנהל"
npx wrangler d1 execute madarom --remote --file=admin-seed.sql
```

מחקו לאחר מכן את `admin-seed.sql` במחשב. אם עדיין לא בחרתם חשבון Cloudflare, שמרו את ענף הקוד ואפשר לבצע צעדים אלה לאחר חיבור הפריסה.

לבדיקת API מול מסד מקומי, הפעילו את אותן פקודות עם `--local` במקום `--remote`, ואז `npm run build` ו־`npx wrangler pages dev dist`.

## אבטחה ומעבר מהגרסה הקודמת

הארכיון הקודם הכיל קובץ JSON עם נתוני לקוחות, התחברויות והזמנות. הוא שימש להבנת המבנה בלבד. **אין** להוסיף אותו לגיט ואין העברת נתונים אוטומטית. מעבר נתונים דורש מיפוי של ישויות עסקיות, סיסמאות קיימות, סליקה והזמנות מול המסד החדש ובדיקה פרטנית לפני כתיבה.

ספק סליקה אמיתי חייב לאמת webhooks, לשמור idempotency, להפריד הזמנה ראשית להזמנה לכל חנות, להפיק מסמכים דרך ספק חשבוניות ולרשום תנועות Ledger רק לאחר אישור תשלום. המערכת אינה מחשבת או מציגה חיוב אמיתי לפני שהחיבורים האלה קיימים.

## מבנה

- `src/`: חנות ו־CRM.
- `functions/api/[[path]].ts`: API של Cloudflare Pages.
- `functions/_lib/`: אימות, בדיקת קלט והרשאות.
- `migrations/`: סכמת D1.
- `scripts/create-admin.mjs`: יצירת חשבון מנהל ראשון ללא סיסמה בקוד.

## מחקר ויישום

בחיפוש ובמיון יושמו אפשרויות בולטות ותגיות קטגוריה שמבהירות את מצב הסינון, בהתאם למחקר השימושיות של [Baymard](https://baymard.com/research/ecommerce-product-lists). שדות עם תוויות, הודעות שגיאה טקסטואליות וניווט מקלדת נבנו לפי [WCAG 2.2](https://www.w3.org/TR/WCAG22/). מבנה הפריסה וה־D1 binding תואמים לתיעוד הרשמי של [Cloudflare Pages](https://developers.cloudflare.com/pages/functions/bindings/).
