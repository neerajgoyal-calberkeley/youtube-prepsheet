'use strict';

// ════════════════════════════════════════════════════════════════
//  SETUP GUIDE — read top to bottom, do steps in order
// ════════════════════════════════════════════════════════════════
//
// ── STEP 1: Firebase project ─────────────────────────────────
// 1. Go to https://console.firebase.google.com/
// 2. Create a new project (or use an existing one)
// 3. Project Settings → General → Your apps → Add app (Web)
// 4. Copy the config values into FIREBASE_CONFIG below
// 5. In Authentication → Sign-in method, enable:
//      • Email/Password
//      • Google
//      • Anonymous
//
// ── STEP 2: Google Sign-In for Chrome extensions ─────────────
// 6. Go to https://console.cloud.google.com/
// 7. APIs & Services → Credentials → Create Credentials →
//      OAuth 2.0 Client ID → Application type: Chrome Extension
// 8. Enter your extension ID (chrome://extensions → Details → ID)
// 9. Copy the generated client_id
// 10. Add to manifest.json:
//       "oauth2": {
//         "client_id": "YOUR_CLIENT_ID.apps.googleusercontent.com",
//         "scopes": ["openid", "email", "profile"]
//       }
//
// ── STEP 3: Firestore ────────────────────────────────────────
// 11. Firebase Console → Firestore Database → Create database
// 12. Start in production mode, choose a region
// 13. Paste these security rules (Firestore → Rules tab):
//
//   rules_version = '2';
//   service cloud.firestore {
//     match /databases/{database}/documents {
//       match /subscriptions/{userId} {
//         allow read: if request.auth != null && request.auth.uid == userId;
//         allow write: if false;
//       }
//     }
//   }
//
// ── STEP 4: Stripe ───────────────────────────────────────────
// 14. Create a product at https://dashboard.stripe.com/products
//     Name: "YouTube Prepsheet Pro"  Price: $10/month recurring
// 15. Stripe Dashboard → Payment Links → Create link
//     • Select the $10/month product
// 16. The extension automatically appends ?client_reference_id={uid}
//     to the payment link at checkout to map payments to Firebase users.
// 17. Copy the Payment Link URL (without any query params) into
//     STRIPE_PAYMENT_LINK below.
//
// ── STEP 5: Deploy the webhook ───────────────────────────────
// 18. Deploy stripe-webhook/ to Vercel:
//       cd stripe-webhook && npm install && npx vercel --yes
// 19. Register the deployed URL in:
//     Stripe Dashboard → Developers → Webhooks → Add destination
//     Events to listen for:
//       • checkout.session.completed
//       • customer.subscription.deleted
// 20. Set these environment variables in Vercel:
//       STRIPE_SECRET_KEY         — your Stripe secret key
//       STRIPE_WEBHOOK_SECRET     — webhook signing secret from Stripe
//       FIREBASE_SERVICE_ACCOUNT  — your service account JSON (minified, as a string)
//       FIREBASE_PROJECT_ID       — your Firebase project ID
//
// ── STEP 6: Load the extension ───────────────────────────────
// 21. Copy this file to firebase-config.js and fill in your values
// 22. chrome://extensions → Developer mode → Load unpacked → select this folder
//
// ════════════════════════════════════════════════════════════════

const FIREBASE_CONFIG = {
  apiKey:     'YOUR_FIREBASE_API_KEY',
  authDomain: 'YOUR_PROJECT_ID.firebaseapp.com',
  projectId:  'YOUR_PROJECT_ID',
};

// Stripe Payment Link URL (no query params — the extension appends ?client_reference_id=...)
const STRIPE_PAYMENT_LINK = 'https://buy.stripe.com/YOUR_LINK';
