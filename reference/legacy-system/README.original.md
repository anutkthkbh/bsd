# מדרום — הקניון הדיגיטלי

## שדרוגים בגרסה זו

### 🔒 אבטחה
| מה שודרג | פרטים |
|---|---|
| **Security Headers** | CSP מלא, HSTS, X-Frame-Options, Referrer-Policy, Permissions-Policy |
| **Rate Limiting** | Login (10/10min), קוד אימות (5/10min), API כללי (120/min) עם ניקוי זיכרון |
| **JWT** | Algorithm pinning (HS256), Issuer check, תגובת TOKEN_EXPIRED מובחנת |
| **bcrypt** | 12 rounds ב-production, 10 ב-dev |
| **Body limit** | מגבלת גוף בקשה 256kb |
| **Input sanitization** | חיתוך whitespace אוטומטי בכל שדות הטקסט |
| **Request ID** | X-Request-Id header לכל בקשה — עוזר ב-debugging |
| **Startup validation** | השרת לא עולה ב-production ללא JWT_SECRET חזק |
| **Trust proxy** | מוגדר ב-production לשימוש נכון ב-req.ip |

### 🌐 SEO
| מה שודרג | פרטים |
|---|---|
| **Meta tags מלאים** | Title, description, keywords, robots, canonical |
| **Open Graph** | og:type, og:image (1200×630), og:locale (he_IL) |
| **Twitter Card** | summary_large_image |
| **JSON-LD** | Organization, WebSite + SearchAction, ItemList |
| **robots.txt** | נחסמים: /api/, /admin/, /merchant/ |
| **sitemap.xml** | נוצר דינמית — חנויות פעילות + מוצרים במלאי |
| **Google Fonts** | Heebo + Frank Ruhl Libre (per brand-and-design.md) |
| **manifest.json** | PWA — שם, צבע, RTL |

### 🗄️ מסד נתונים
| מה שודרג | פרטים |
|---|---|
| **JSON file → SQLite** | `better-sqlite3` עם WAL mode לביצועים |
| **כתיבה אטומית** | Transaction מובטחת — אין נתונים פגומים בקריסה |
| **Concurrency** | WAL מאפשר קריאות מקבילות |
| **גיבוי** | פונקציית `createBackup()` מובנית |
| **DATABASE_PATH** | נתיב מוגדר בסביבה |
| **Graceful shutdown** | DB נסגר בצורה נקייה ב-SIGINT/SIGTERM |

### 🔑 אימות
| מה שודרג | פרטים |
|---|---|
| **Google OAuth אמיתי** | `GoogleLogin` מ-`@react-oauth/google` — ללא חשבונות דמה |
| **Token storage** | sessionStorage (לא localStorage) — נמחק בסגירת Tab |
| **Token expiry** | בדיקה client-side לפני כל בקשה + הודעה ידידותית |
| **GoogleOAuthProvider** | עוטף את כל האפליקציה ב-main.jsx |
| **autoComplete** | כל שדות הטופס עם autoComplete נכון |
| **Pattern validation** | קוד אימות מקבל רק ספרות |

### 🧹 נתוני דמה שהוסרו
- חשבונות הלקוחות `נועה לוי` / `אורי כהן` — נמחקו מ-db.json
- המערך `googleAccounts` עם חשבונות מזויפים — הוסר מ-AuthModal.jsx
- הודעות "סביבת הדגמה" — הוסרו מה-UI

---

## התקנה

### דרישות
- Node.js 18+
- npm 9+

### שרת (Backend)

```bash
# מהתיקייה הראשית
npm install          # מתקין כולל better-sqlite3

# הגדרת סביבה
cp .env.example .env
# ערוך .env — בדגש על JWT_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD, GOOGLE_CLIENT_ID

# הרצה
npm run server:dev   # dev עם nodemon
npm run server       # production
```

### לקוח (Frontend)

```bash
cd my-app
npm install

# הגדרת סביבה
cp .env.example .env
# ערוך .env — VITE_GOOGLE_CLIENT_ID חייב להיות זהה ל-GOOGLE_CLIENT_ID בשרת

npm run dev          # dev server
npm run build        # production build
```

---

## Google OAuth — הגדרה

1. כנס ל-[Google Cloud Console](https://console.cloud.google.com/)
2. צור פרויקט חדש או בחר קיים
3. **APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client ID**
4. בחר **Web application**
5. הוסף ל-**Authorized JavaScript origins**:
   - `http://localhost:5173` (dev)
   - `https://madarom.co.il` (production)
6. העתק את ה-**Client ID** ל-.env של שרת ולקוח

---

## עלייה לאוויר (Production)

ראה `docs/security-and-launch.md` לפירוט מלא. בקצרה:

```dotenv
NODE_ENV=production
PAYMENTS_MODE=provider
PAYMENT_PROVIDER=cardcom
ALLOWED_ORIGINS=https://madarom.co.il,https://www.madarom.co.il
JWT_SECRET=<96+ תווים רנדומליים>
DATABASE_PATH=/var/data/madarom.db
```

> ⚠️ **לא להפעיל ב-production ללא:**  
> HTTPS מוגדר, JWT_SECRET חזק, ALLOWED_ORIGINS מדויק, SMTP פעיל, PAYMENTS_MODE=provider

---

## מבנה הפרויקט

```
madarom/
├── server/
│   ├── index.js            # ← שודרג
│   ├── lib/
│   │   ├── auth.js         # ← שודרג — JWT algorithm pinning, bcrypt 12
│   │   ├── db.js           # ← שודרג — SQLite + WAL
│   │   ├── security.js     # ← שודרג — CSP, HSTS, Rate limit, Request ID
│   │   ├── googleAuth.js   # ← ללא שינוי (כבר תקין)
│   │   └── ...
│   ├── routes/
│   │   ├── sitemap.js      # ← חדש — SEO sitemap.xml + robots.txt
│   │   └── ...
│   └── data/
│       └── db.json         # ← נוקה (SQLite DB ייווצר אוטומטית)
├── my-app/
│   ├── index.html          # ← שודרג — SEO, OG, JSON-LD, Fonts
│   ├── public/
│   │   └── manifest.json   # ← חדש — PWA manifest
│   └── src/
│       ├── main.jsx        # ← שודרג — GoogleOAuthProvider
│       ├── style.css       # ← שודרג — Brand tokens (Heebo + FRL)
│       ├── api/client.js   # ← שודרג — sessionStorage, expiry check
│       └── components/
│           └── AuthModal.jsx # ← שודרג — Google OAuth אמיתי
├── .env.example            # ← שודרג — כל המשתנים מתועדים
├── package.json            # ← שודרג — +better-sqlite3
└── README.md               # ← חדש
```
