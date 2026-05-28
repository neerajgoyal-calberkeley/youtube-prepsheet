'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
    projectId: process.env.FIREBASE_PROJECT_ID,
  });
}

const db = admin.firestore();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const FREE_LIMIT = 3;
const LONG_VIDEO_THRESHOLD = 1200;

const LONG_VIDEO_SYSTEM = `You are an assistant that generates cheatsheets from the provided transcript text. Use the plain text extracted from the transcript text to create a 1-3 page cheatsheet for students in HTML format without any markdown, ready for direct rendering on the UI.

Instructions:
1. Main Concept: Create a section with the heading 'Main Concept' (id: 'concept-heading') and an explanation (id: 'concept-body'). Provide a concise explanation of the main concept in 100-300 words, using 2-3 paragraphs.
2. Applicability: In a section titled 'Applicability', explain in 2-3 sentences how the concept applies in real life or a person's career.
3. Key Terms, Formulas, and Theorems: Create a section with this title. Briefly explain and give all relevant formulas — it is a must to include their mathematical representations using Unicode symbols (∫, Σ, √, ², ³, π, θ, α, β, γ, Δ, etc.). Highlight and explain all definitions, and state and explain all theorems that fall under this topic. Use a bulleted list.
4. How to Apply: In this section, explain in a few bulleted steps how a student can apply these definitions, formulas, and theorems to a question. Focus on educational content only.
5. Example Question and Solution: Provide an example question (different from the input but applying the same high-level concept) in a section called 'Example Question' and solve it step-by-step in a section called 'Solution'.
6. Additional Information: In a final section called 'Additional Information', pull in relevant information from the video not included above. This should be 6-15 bullets.
7. Formatting: After each section, including the last one, add a horizontal line (<hr>) for UI rendering.

Content Guidelines: Do not include any objectionable content including pornographic, violent, hateful, harassing, illegal, defamatory, or privacy-violating content.

Output Format: Generate the output as HTML code only. Do not include any markdown or plain text. Do not wrap in a full HTML document — output only the body content. Do not include a <style> block.`;

const SHORT_VIDEO_SYSTEM = `You are an assistant that generates cheatsheets from the provided transcript text. Use the plain text extracted from the transcript text to create a 1-2 page cheatsheet for students in HTML format without any markdown, ready for direct rendering on the UI.

Instructions:
1. Main Concept: Create a section with the heading 'Main Concept' (id: 'concept-heading') and an explanation (id: 'concept-body'). Provide a concise explanation of the main concept in 75-150 words, using 1-2 paragraphs.
2. Applicability: In a section titled 'Applicability', explain in 2-3 sentences how the concept applies in real life or a person's career.
3. Key Terms, Formulas, and Theorems: Create a section with this title. Briefly explain and give all relevant formulas — it is a must to include their mathematical representations using Unicode symbols (∫, Σ, √, ², ³, π, θ, α, β, γ, Δ, etc.). Highlight and explain all definitions, and state and explain all theorems. Use a bulleted list.
4. How to Apply: In this section, explain in a few bulleted steps how a student can apply these definitions, formulas, and theorems to a question. Focus on educational content only.
5. Example Question and Solution: Provide an example question (different from the input but applying the same high-level concept) in a section called 'Example Question' and solve it step-by-step in a section called 'Solution'.
6. Formatting: After each section, including the last one, add a horizontal line (<hr>) for UI rendering.

Content Guidelines: Do not include any objectionable content including pornographic, violent, hateful, harassing, illegal, defamatory, or privacy-violating content.

Output Format: Generate the output as HTML code only. Do not include any markdown or plain text. Do not wrap in a full HTML document — output only the body content. Do not include a <style> block.`;

const GENERAL_SYSTEM = `You are an assistant that generates cheatsheets from the provided transcript text. Use the plain text extracted from the transcript text to create a 1-page general cheatsheet for students in HTML format without any markdown, ready for direct rendering on the UI.

Instructions:
1. Main Concept: Create a section with the heading 'Main Concept' (id: 'concept-heading') and an explanation (id: 'concept-body'). Provide a concise explanation of the main concept in 75-150 words.
2. Key Terms: Create a section titled 'Key Terms'. List and define the most important terms in a bulleted list.
3. Formulas and Theorems: Create a section titled 'Formulas and Theorems'. Include any formulas or theorems with their mathematical representations using Unicode symbols. If none apply, state "No specific formulas or theorems apply to this topic."
4. Other Relevant Information: Create a section titled 'Other Relevant Information'. Include 4-8 bulleted points covering important additional content from the video not addressed above.
5. Formatting: After each section, including the last one, add a horizontal line (<hr>) for UI rendering.

Content Guidelines: Do not include any objectionable content.

Output Format: Generate the output as HTML code only. Do not include any markdown or plain text. Do not wrap in a full HTML document — output only the body content. Do not include a <style> block.`;

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).end(); return; }

  // Verify Firebase ID token
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) { res.status(401).json({ error: 'unauthorized' }); return; }

  let uid;
  try {
    const decoded = await admin.auth().verifyIdToken(auth.slice(7));
    uid = decoded.uid;
  } catch {
    res.status(401).json({ error: 'invalid_token' }); return;
  }

  // Check subscription and free tier in parallel
  const [subSnap, usageSnap] = await Promise.all([
    db.collection('subscriptions').doc(uid).get(),
    db.collection('usage').doc(uid).get(),
  ]);

  const isSubscribed = subSnap.data()?.status === 'active';

  if (!isSubscribed) {
    const count = usageSnap.data()?.count || 0;
    if (count >= FREE_LIMIT) {
      res.status(403).json({ error: 'free_limit_reached' }); return;
    }
    await db.collection('usage').doc(uid).set({
      count: admin.firestore.FieldValue.increment(1),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  }

  // Parse body
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const { transcript, durationSeconds, isSTEMB, title } = JSON.parse(Buffer.concat(chunks).toString());

  const MAX_CHARS = 100000;
  const trimmed = transcript.length > MAX_CHARS
    ? transcript.slice(0, MAX_CHARS) + '\n\n[Transcript truncated due to length]'
    : transcript;

  let system;
  if (!isSTEMB) system = GENERAL_SYSTEM;
  else if (durationSeconds >= LONG_VIDEO_THRESHOLD) system = LONG_VIDEO_SYSTEM;
  else system = SHORT_VIDEO_SYSTEM;

  const model = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';

  // Stream response
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no');

  try {
    const stream = anthropic.messages.stream({
      model,
      max_tokens: 4096,
      system,
      messages: [{ role: 'user', content: `Video Title: "${title}"\n\nTranscript:\n${trimmed}` }],
    });

    let accumulated = '';
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
        accumulated += event.delta.text;
        res.write(`data: ${JSON.stringify({ type: 'chunk', chunk: event.delta.text })}\n\n`);
      }
    }

    const html = accumulated.replace(/<style[\s\S]*?<\/style>/gi, '').trim();
    res.write(`data: ${JSON.stringify({ type: 'done', html })}\n\n`);
  } catch (err) {
    res.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`);
  }

  res.end();
};
