/**
 * Stripe → Firebase Webhook
 *
 * Deploy this to Firebase Cloud Functions or Vercel.
 *
 * SETUP:
 * 1. npm install stripe firebase-admin
 * 2. Set environment variables:
 *      STRIPE_SECRET_KEY      — from Stripe Dashboard → Developers → API keys
 *      STRIPE_WEBHOOK_SECRET  — from Stripe Dashboard → Webhooks → your endpoint → Signing secret
 *      FIREBASE_PROJECT_ID    — your Firebase project ID
 * 3. In your Stripe product, add a metadata field `firebase_uid` on the subscription.
 *    The easiest way: after the user pays, redirect them back to your extension with their
 *    Firebase UID in the success URL (add `?client_reference_id={firebase_uid}` to the
 *    Stripe Payment Link URL, then read it from the checkout.session.completed event).
 * 4. Deploy:
 *      Firebase: `firebase deploy --only functions`
 *      Vercel:   `vercel deploy`
 * 5. Register the deployed URL in Stripe Dashboard → Webhooks → Add endpoint.
 *    Listen for: checkout.session.completed, customer.subscription.deleted
 */

'use strict';

const Stripe = require('stripe');
const admin  = require('firebase-admin');

// ── Init ──────────────────────────────────────────────────────────────────────

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  projectId: process.env.FIREBASE_PROJECT_ID,
});

const db     = admin.firestore();
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// ── Handler (works as Express middleware or Vercel serverless function) ────────

async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).send('Method not allowed');
    return;
  }

  const sig  = req.headers['stripe-signature'];
  const body = req.body; // raw Buffer — see note below

  let event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    res.status(400).send(`Webhook Error: ${err.message}`);
    return;
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        // client_reference_id is the Firebase UID you appended to the Payment Link URL
        const uid = session.client_reference_id;
        if (uid) {
          await db.collection('subscriptions').doc(uid).set({
            status: 'active',
            stripeCustomerId: session.customer,
            stripeSubscriptionId: session.subscription,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          }, { merge: true });
          console.log(`Subscription activated for uid=${uid}`);
        } else {
          console.warn('checkout.session.completed: no client_reference_id — cannot map to Firebase user');
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        // Look up the user by stripeCustomerId
        const snap = await db.collection('subscriptions')
          .where('stripeCustomerId', '==', sub.customer)
          .limit(1)
          .get();
        if (!snap.empty) {
          const docRef = snap.docs[0].ref;
          await docRef.set({ status: 'cancelled', updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
          console.log(`Subscription cancelled for customer=${sub.customer}`);
        }
        break;
      }

      default:
        // Ignore other events
        break;
    }
  } catch (err) {
    console.error('Error processing webhook event:', err);
    res.status(500).send('Internal error');
    return;
  }

  res.status(200).json({ received: true });
}

// ── Export for Firebase Cloud Functions ──────────────────────────────────────
// If using Firebase Functions:
//   const functions = require('firebase-functions');
//   exports.stripeWebhook = functions.https.onRequest(handler);
//
// IMPORTANT for Firebase: add this to firebase.json so the raw body is preserved:
//   "functions": { "ignore": [], "source": "." }
// And set rawBody parsing in the function (Firebase does this automatically for onRequest).

// ── Export for Vercel ────────────────────────────────────────────────────────
// In vercel.json:
// {
//   "functions": { "api/webhook.js": { "memory": 256 } },
//   "routes": [{ "src": "/api/webhook", "dest": "/api/webhook.js" }]
// }
//
// IMPORTANT: Vercel needs the raw body buffer for Stripe signature verification.
// Add this to the handler export:
module.exports = async (req, res) => {
  // Collect raw body chunks for signature verification
  if (!req.body) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    req.body = Buffer.concat(chunks);
  }
  return handler(req, res);
};
