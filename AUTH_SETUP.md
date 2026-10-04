# הפעלת הכניסה למדרום

הקוד כולל כניסה והרשמה עם Google וקוד חד־פעמי במייל, וכניסה עם SMS למספר שאומת בחשבון. כל משתמש מופנה לפי התפקיד שהוגדר בשרת: לקוח ל־`/account`, סוחר ל־`/merchant` ומנהל ל־`/admin`. הרשמה ציבורית יוצרת לקוח בלבד.

## מסד נתונים

יש להחיל את המיגרציות עד `0008_provider_auth.sql`. אין למחוק נתונים קיימים או להריץ את קבצי ה־SQL שוב ידנית; Wrangler מנהל את היסטוריית המיגרציות. לפני הרצה מרוחקת יש לוודא שה־D1 המוגדר ב־`wrangler.jsonc` הוא המסד המיועד למדרום.

```bash
npx wrangler d1 migrations apply DB --remote
```

## מייל — Resend

יש לחבר דומיין שולח מאומת ב־Resend, ולהגדיר ב־Cloudflare Worker:

- `RESEND_API_KEY` — Secret.
- `EMAIL_FROM` — כתובת שולח בדומיין המאומת.

המערכת שולחת הודעת טקסט עם קוד בן שש ספרות דרך API של Resend. אין שליחת קוד לדפדפן או החזרת קוד ב־API.

## SMS — Twilio

יש להגדיר:

- `TWILIO_ACCOUNT_SID`.
- `TWILIO_AUTH_TOKEN` — Secret.
- `TWILIO_FROM` — מספר שולח SMS מורשה בפורמט בינלאומי.

מספר ישראלי בפורמט `05xxxxxxxx` מומר ל־`+9725xxxxxxxx`. משתמש נרשם תחילה במייל או Google, ואז מאמת את מספר הטלפון מתוך האזור האישי. סוחר ומנהל יכולים לאמת טלפון מתוך דף הניהול שלהם. מספר שהוקלד בפרופיל ללא אימות אינו מאפשר כניסה. שינוי המספר מסיר את שיוך הכניסה הקודם ודורש אימות חדש.

## Google

יש ליצור OAuth Client מסוג Web application ולהגדיר:

- `GOOGLE_CLIENT_ID`.
- `GOOGLE_CLIENT_SECRET` — Secret.
- Authorized redirect URI: `https://YOUR-LIVE-DOMAIN/api/auth/google/callback`.

יש לרשום את הדומיין שבו המשתמשים ייכנסו בפועל. הגדרת OAuth כוללת מסך הסכמה, scopes של `openid email profile`, והפעלה לקהל המתאים בחשבון Google Cloud.

תהליך הכניסה בודק state עם cookie, משתמש ב־PKCE, מחליף code בצד השרת ומקבל פרופיל מאומת דרך Google userinfo. כתובת Gmail מאפשרת כניסה והרשמה ישירות. כתובת Google בדומיין אחר דורשת כניסה ראשונית בקוד למייל ואז לחיצה על „חיבור Google לחשבון” מתוך החשבון עם אותה כתובת מייל. כניסות Google הבאות משתמשות בזהות Google שנקשרה לחשבון, ולא במייל כמזהה. כניסה מאומתת למייל של הרשמת סיסמה ישנה שטרם אומתה מבטלת את האישורים וה־sessions הישנים.

## בדיקה אחרי ההגדרה

`GET /api/auth/capabilities` מציג אילו שיטות מוגדרות. זו בדיקת הגדרות בלבד, ואינה מוכיחה שהספק יכול לשלוח הודעה או שה־OAuth Client תקין. יש לבצע בפועל הרשמה במייל, קבלת SMS וכניסה עם Google בדומיין החי, וכן לבדוק כניסת לקוח, סוחר ומנהל.

קוד בתוקף עשר דקות וניתן לשימוש פעם אחת. אחרי חמישה ניסיונות שגויים הוא ננעל. שליחה נוספת דורשת המתנה של דקה; משלוחים מוגבלים לפי יעד וכתובת IP. ה־session נשמר ב־HttpOnly cookie למשך שבעה ימים. הרשמה חדשה עם סיסמה ללא אימות חסומה; סיסמאות קיימות ממשיכות לאפשר כניסה.

בדיקות ה־API המקומיות משתמשות בספקים מדומים בתוך קבצי הבדיקה בלבד. הן אינן מוכיחות שליחת הודעות אמיתית. כל נתוני החנות ביישום מגיעים מ־D1, ואין קטלוג דמה במערכת.

מקורות הטמעה: [Google ownership verification](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token), [Google OIDC](https://developers.google.com/identity/openid-connect/openid-connect), [Google OAuth](https://developers.google.com/identity/protocols/oauth2/web-server), [Resend Send Email](https://resend.com/docs/api-reference/emails/send-email), [Twilio Messages](https://www.twilio.com/docs/messaging/api/message-resource).
