'use strict';

const Stripe = require('stripe');
const admin  = require('firebase-admin');

// Initialize Firebase Admin once using service account JSON stored as env var
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(
      JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
    ),
    projectId: process.env.FIREBASE_PROJECT_ID,
  });
}

const db     = admin.firestore();
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).send('Method not allowed');
    return;
  }

  // Collect raw body — required for Stripe signature verification
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const rawBody = Buffer.concat(chunks);

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      req.headers['stripe-signature'],
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    res.status(400).send(`Webhook Error: ${err.message}`);
    return;
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const uid = session.client_reference_id;
        if (uid) {
          await db.collection('subscriptions').doc(uid).set({
            status: 'active',
            stripeCustomerId: session.customer,
            stripeSubscriptionId: session.subscription,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          }, { merge: true });
          console.log(`Subscription activated for uid=${uid}`);
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        const snap = await db.collection('subscriptions')
          .where('stripeCustomerId', '==', sub.customer)
          .limit(1)
          .get();
        if (!snap.empty) {
          await snap.docs[0].ref.set({
            status: 'cancelled',
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          }, { merge: true });
          console.log(`Subscription cancelled for customer=${sub.customer}`);
        }
        break;
      }
    }
  } catch (err) {
    console.error('Webhook processing error:', err);
    res.status(500).send('Internal error');
    return;
  }

  res.status(200).json({ received: true });
};
