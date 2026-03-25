# TradeSig App — Setup Guide

## Poora setup 4 steps mein

---

## STEP 1 — GitHub pe repo banao

1. GitHub.com pe jao → Login karo
2. "New Repository" click karo
3. Name: `tradesig-proxy`
4. Public rakho
5. "Create repository" click karo
6. Is ZIP ke andar `tradesig-app` folder ka sara content upload karo
   - server.js
   - package.json
   - render.yaml
   - public/index.html

---

## STEP 2 — Render pe deploy karo

1. Render.com pe jao → GitHub se login karo
2. "New +" → "Web Service" click karo
3. GitHub repo `tradesig-proxy` select karo
4. Settings:
   - Name: tradesig-proxy
   - Build Command: `npm install`
   - Start Command: `node server.js`
   - Plan: Free
5. "Create Web Service" click karo
6. Deploy hone do (2-3 minute)
7. **URL copy karo** — kuch aisa hoga: `https://tradesig-proxy.onrender.com`

---

## STEP 3 — HTML mein URL update karo

`public/index.html` file kholo, line dhundo:

```
const PROXY_URL = 'YOUR_RENDER_URL_HERE';
```

Isko badlo:

```
const PROXY_URL = 'https://tradesig-proxy.onrender.com';
```

(apna actual Render URL daalo)

GitHub pe is file ko update karo (edit → commit).

---

## STEP 4 — APK banao

1. Netlify.com pe jao → free account banao
2. `public` folder drag & drop karo
3. URL milega jaise: `https://tradesig-abc123.netlify.app`
4. WebIntoApp.com pe jao
5. Ye URL daalo → APK download karo
6. Sabke phone pe bhejo → Install karo

---

## Done! App kaam karega

- Signals automatically 30 sec mein refresh honge
- Entry, SL, TP sab dikhega
- Sound alert bhi aayega
- Multiple phones pe install ho sakta hai

---

## Problem aaye to

- Render URL sahi hai? (`https://` se shuru ho)
- GitHub repo public hai?
- Render dashboard mein logs check karo
