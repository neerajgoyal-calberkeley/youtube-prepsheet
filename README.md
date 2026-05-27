# YouTube Cheatsheet — Chrome Extension

> Instantly generate a 1-page AI study cheatsheet from any YouTube video using Claude AI.

A Chrome Extension (Manifest V3) that injects a **Create Cheatsheet** button into the YouTube player. After 60 seconds of playback, click it to generate a formatted, shareable study cheatsheet — streamed directly from the Claude API.

---

## Features

- **One-click cheatsheet** — appears on every YouTube video after 60 seconds of playback
- **Streaming generation** — content starts appearing within ~1 second, full sheet in 15–30s
- **Smart prompts** — STEMB videos (Science, Tech, Engineering, Math, Business) get a richer format with formulas, worked examples, and theorems; all other videos get a clean key-concepts summary
- **History tab** — browse and reload past cheatsheets without re-generating
- **Inline editing** — edit any cheatsheet before saving or sharing
- **Export** — save as PDF (print dialog) or Word `.doc`
- **Share** — email, WhatsApp, Discord, Slack, SMS; file downloads once and reuses across channels
- **Free tier + Pro** — 3 free cheatsheets, then $10/month subscription via Stripe
- **Settings page** — choose your Claude model (Sonnet, Opus, Haiku) and manage your API key

---

## Architecture

```
Chrome Extension (MV3)
  ├── content.js        injected into YouTube — button, panel, transcript extraction
  ├── background.js     service worker — Claude API calls (streaming), classification
  ├── interceptor.js    runs in page context to read ytInitialPlayerResponse
  └── popup.js          toolbar popup — quick "Create Cheatsheet" trigger

Firebase (Auth + Firestore)
  └── subscriptions/{uid}   { status, stripeCustomerId, stripeSubscriptionId }

Stripe Payment Link
  └── appends ?client_reference_id={firebase_uid} at checkout

Vercel Serverless Function (stripe-webhook/)
  └── checkout.session.completed   → sets status: active
  └── customer.subscription.deleted → sets status: cancelled
```

---

## Project Structure

```
├── manifest.json          Chrome Extension Manifest V3
├── background.js          Service worker: Claude API, classification, storage
├── content.js             YouTube page: button injection, panel, transcript fetch
├── interceptor.js         Page-world script to read ytInitialPlayerResponse
├── styles.css             Injected CSS for button and slide-in panel
│
├── popup.html / popup.js          Toolbar popup
├── options.html / options.js      Settings page (API key, model, dev tools)
├── viewer.html / viewer.js        Full-page cheatsheet viewer
├── upgrade.html                   Upgrade / paywall page
├── auth.html / auth.js            Sign-in page (Email + Google)
├── profile.html / profile.js      Account page
│
├── firebase-config.js     Firebase credentials + Stripe Payment Link URL
│
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   ├── icon128.png
│   └── logo512.png
│
└── stripe-webhook/        Vercel serverless function
    ├── api/webhook.js     Handles Stripe events → writes to Firestore
    ├── package.json
    └── vercel.json
```

---

## Quick Start (personal use)

1. **Clone the repo**
   ```bash
   git clone https://github.com/YOUR_USERNAME/youtube-cheatsheet.git
   cd youtube-cheatsheet
   ```

2. **Load the extension in Chrome**
   - Go to `chrome://extensions`
   - Enable **Developer mode** (top-right toggle)
   - Click **Load unpacked** → select this folder

3. **Add your API key**
   - Click the extension icon → **Open Settings** (gear icon)
   - Paste your [Anthropic API key](https://console.anthropic.com/account/keys)
   - Click **Save Settings**

4. **Use it**
   - Open any YouTube video
   - After 60 seconds, a **Create Cheatsheet** button appears in the top-right of the player
   - Click it — cheatsheet streams in from the right in ~15–30 seconds

> The free tier allows 3 cheatsheets without an account. The subscription/paywall features require the Firebase + Stripe backend below.

---

## Full Setup (Firebase + Stripe backend)

Follow these steps to run the full version with accounts and paid subscriptions.

### 1. Firebase

1. Create a project at [console.firebase.google.com](https://console.firebase.google.com)
2. **Authentication** → Sign-in method → enable **Email/Password**, **Google**, and **Anonymous**
3. **Firestore Database** → Create database (production mode)
4. Paste these security rules (Firestore → Rules tab):
   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /subscriptions/{userId} {
         allow read: if request.auth != null && request.auth.uid == userId;
         allow write: if false;
       }
     }
   }
   ```
5. **Project Settings** → Your apps → Add Web app → copy `apiKey`, `authDomain`, `projectId`
6. Update `firebase-config.js`:
   ```js
   const FIREBASE_CONFIG = {
     apiKey:     'YOUR_API_KEY',
     authDomain: 'YOUR_PROJECT.firebaseapp.com',
     projectId:  'YOUR_PROJECT_ID',
   };
   ```

### 2. Google OAuth (for Chrome Extension sign-in)

1. [Google Cloud Console](https://console.cloud.google.com) → APIs & Services → Credentials → Create OAuth 2.0 Client ID
2. Application type: **Chrome Extension**
3. Enter your extension ID (found at `chrome://extensions` → Details)
4. Copy the generated client ID into `manifest.json`:
   ```json
   "oauth2": {
     "client_id": "YOUR_CLIENT_ID.apps.googleusercontent.com",
     "scopes": ["openid", "email", "profile"]
   }
   ```

### 3. Stripe

1. Create a product at [dashboard.stripe.com/products](https://dashboard.stripe.com/products) — e.g. "Pro", $10/month recurring
2. **Payment Links** → Create link → select the product
3. Copy the Payment Link URL into `firebase-config.js`:
   ```js
   const STRIPE_PAYMENT_LINK = 'https://buy.stripe.com/YOUR_LINK';
   ```
   The extension appends `?client_reference_id={firebase_uid}` automatically at checkout.

### 4. Deploy the Stripe Webhook

```bash
cd stripe-webhook
npm install
npm install -g vercel
vercel login
vercel --yes
```

After deploying, go to **Vercel Dashboard → Project → Settings → Environment Variables** and add:

| Variable | Value |
|---|---|
| `STRIPE_SECRET_KEY` | Your Stripe secret key (`sk_live_…`) |
| `STRIPE_WEBHOOK_SECRET` | From Stripe → Webhooks → your endpoint → Signing secret |
| `FIREBASE_SERVICE_ACCOUNT` | The full JSON of your Firebase service account key (minified, as a string) |
| `FIREBASE_PROJECT_ID` | Your Firebase project ID |

Then register the Vercel URL in **Stripe Dashboard → Developers → Webhooks → Add destination**, listening for:
- `checkout.session.completed`
- `customer.subscription.deleted`

---

## How Transcript Extraction Works

YouTube blocks direct caption fetches from extension contexts. This extension works around that with a two-file approach:

- **`interceptor.js`** runs in the page's JavaScript context (`"world": "MAIN"`) and intercepts `ytInitialPlayerResponse` — the JSON object YouTube embeds in the page that contains caption track URLs
- **`content.js`** reads the intercepted data from a DOM element and uses it to fetch the caption XML directly from YouTube's CDN

This approach is more reliable than scraping the DOM and survives YouTube's occasional UI changes.

---

## Cost Estimates

| Component | Cost |
|---|---|
| Claude Sonnet (per cheatsheet) | ~$0.005 – $0.02 depending on video length |
| Claude Haiku (per cheatsheet) | ~$0.001 – $0.005 |
| Firebase | Free tier covers most usage |
| Vercel | Free tier covers webhook volume |
| Stripe | 2.9% + $0.30 per transaction |

---

## Development Tips

**Reload after changes:**
1. Go to `chrome://extensions` → click **↺** on the extension card
2. Hard-reload the YouTube tab (`Cmd+Shift+R`)

**Inspect the service worker:**
- `chrome://extensions` → click **Service Worker** link on the card

**Dev bypass (test without hitting the 3-cheatsheet limit):**
- Settings page → scroll to **Developer / Testing** → click **Enable bypass limit**

**Reset free-tier counter:**
- Settings page → **Reset cheatsheet count**

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Button never appears | Watch for at least 60 seconds; check the API key is saved in Settings |
| "Failed to extract transcript" | The video may not have captions; try a different video |
| API errors | Check your key at [console.anthropic.com](https://console.anthropic.com); ensure it has credits |
| Subscribe button does nothing | Firebase + Stripe backend not configured; see Full Setup above |
| Extension not loading | Ensure Developer Mode is on in `chrome://extensions` |

---

## Privacy

- Your API key is stored **only in your browser** via `chrome.storage.sync`
- Transcripts are sent directly to Anthropic's API — no intermediate server
- Email and user ID are stored in Firebase only to verify subscription status
- No browsing history is collected
- Payments handled entirely by Stripe — no card data ever touches this extension

Full privacy policy in the extension's Settings page.

---

## License

MIT
