# Interview Orbit

ממשק מקומי להכנה לראיון עבודה בעזרת Gemini.

## הפעלה

1. התקן Node.js 18 ומעלה.
2. הרץ `npm install`.
3. העתק את `.env.example` ל-`.env` והכנס את מפתח Gemini שלך.
4. הרץ `npm start` ופתח `http://localhost:3000`. פקודת ההפעלה משתמשת באישורי האבטחה של Windows כדי לאפשר חיבור TLS תקין ל-Gemini.

הקובץ `.env` אינו מיועד לשיתוף.

## פריסה

GitHub Pages מריץ את הממשק בלבד. השרת עולה בנפרד דרך `render.yaml`, ושומר את `GEMINI_API_KEY` בתוך Secret של Render. ב-GitHub Actions יש להגדיר Secret בשם `INTERVIEW_API_URL` עם כתובת השרת, למשל `https://interview-orbit-api.onrender.com`.

אין להעלות `.env`, `public/config.js`, או מפתח Gemini ל-GitHub.
