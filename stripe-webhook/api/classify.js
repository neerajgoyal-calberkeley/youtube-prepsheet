'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
    projectId: process.env.FIREBASE_PROJECT_ID,
  });
}

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).end(); return; }

  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) { res.status(401).json({ error: 'unauthorized' }); return; }

  try {
    await admin.auth().verifyIdToken(auth.slice(7));
  } catch {
    res.status(401).json({ error: 'invalid_token' }); return;
  }

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const { title, channel } = JSON.parse(Buffer.concat(chunks).toString());

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 5,
      messages: [{
        role: 'user',
        content: `Is this YouTube video about a STEMB topic — Science, Technology, Engineering, Mathematics, or Business/Finance/Economics?\n\nTitle: "${title}"\nChannel: "${channel}"\n\nReply with only the single word YES or NO.`,
      }],
    });
    const isSTEMB = response.content[0].text.trim().toUpperCase().startsWith('YES');
    res.json({ isSTEMB });
  } catch (err) {
    res.json({ isSTEMB: true, error: err.message });
  }
};
