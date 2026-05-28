'use strict';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-sonnet-4-6';
const CLASSIFICATION_MODEL = 'claude-haiku-4-5-20251001';

// Threshold: videos >= 20 minutes use the long-video prompt
const LONG_VIDEO_THRESHOLD_SECONDS = 1200;

// ─── Prompts ───────────────────────────────────────────────────────────────

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

Output Format: Generate the output as HTML code only. Do not include any markdown or plain text. Do not wrap in a full HTML document — output only the body content. Use a <style> block at the top for any custom styles.`;

const SHORT_VIDEO_SYSTEM = `You are an assistant that generates cheatsheets from the provided transcript text. Use the plain text extracted from the transcript text to create a 1-2 page cheatsheet for students in HTML format without any markdown, ready for direct rendering on the UI.

Instructions:
1. Main Concept: Create a section with the heading 'Main Concept' (id: 'concept-heading') and an explanation (id: 'concept-body'). Provide a concise explanation of the main concept in 75-150 words, using 1-2 paragraphs.
2. Applicability: In a section titled 'Applicability', explain in 2-3 sentences how the concept applies in real life or a person's career.
3. Key Terms, Formulas, and Theorems: Create a section with this title. Briefly explain and give all relevant formulas — it is a must to include their mathematical representations using Unicode symbols (∫, Σ, √, ², ³, π, θ, α, β, γ, Δ, etc.). Highlight and explain all definitions, and state and explain all theorems. Use a bulleted list.
4. How to Apply: In this section, explain in a few bulleted steps how a student can apply these definitions, formulas, and theorems to a question. Focus on educational content only.
5. Example Question and Solution: Provide an example question (different from the input but applying the same high-level concept) in a section called 'Example Question' and solve it step-by-step in a section called 'Solution'.
6. Formatting: After each section, including the last one, add a horizontal line (<hr>) for UI rendering.

Content Guidelines: Do not include any objectionable content including pornographic, violent, hateful, harassing, illegal, defamatory, or privacy-violating content.

Output Format: Generate the output as HTML code only. Do not include any markdown or plain text. Do not wrap in a full HTML document — output only the body content. Use a <style> block at the top for any custom styles.`;

const GENERAL_SYSTEM = `You are an assistant that generates cheatsheets from the provided transcript text. Use the plain text extracted from the transcript text to create a 1-page general cheatsheet for students in HTML format without any markdown, ready for direct rendering on the UI.

Instructions:
1. Main Concept: Create a section with the heading 'Main Concept' (id: 'concept-heading') and an explanation (id: 'concept-body'). Provide a concise explanation of the main concept in 75-150 words.
2. Key Terms: Create a section titled 'Key Terms'. List and define the most important terms in a bulleted list.
3. Formulas and Theorems: Create a section titled 'Formulas and Theorems'. Include any formulas or theorems with their mathematical representations using Unicode symbols. If none apply, state "No specific formulas or theorems apply to this topic."
4. Other Relevant Information: Create a section titled 'Other Relevant Information'. Include 4-8 bulleted points covering important additional content from the video not addressed above.
5. Formatting: After each section, including the last one, add a horizontal line (<hr>) for UI rendering.

Content Guidelines: Do not include any objectionable content.

Output Format: Generate the output as HTML code only. Do not include any markdown or plain text. Do not wrap in a full HTML document — output only the body content. Use a <style> block at the top for any custom styles.`;

// ─── Helpers ───────────────────────────────────────────────────────────────

// ─── Firebase config helper ────────────────────────────────────────────────

async function getFirebaseConfig() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['firebaseConfig'], (r) => resolve(r.firebaseConfig || null));
  });
}

// ─── Firestore subscription check ─────────────────────────────────────────

async function checkFirestoreSubscription(userId) {
  const cfg = await getFirebaseConfig();
  if (!cfg?.projectId) return false;
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${cfg.projectId}/databases/(default)/documents/subscriptions/${userId}`;
    const res = await fetch(url);
    if (!res.ok) return false;
    const data = await res.json();
    return data.fields?.status?.stringValue === 'active';
  } catch (_) { return false; }
}

// ─── Shareable HTML page builder ──────────────────────────────────────────

function escapeHtmlBg(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildShareableHtml(cheatsheetHtml, title) {
  const date = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtmlBg(title)} — Study Cheatsheet</title>
<style>
*{box-sizing:border-box;margin:0;padding:0;}
body{font-family:system-ui,-apple-system,sans-serif;font-size:13px;line-height:1.7;color:#1A1A1A;padding:36px 40px;max-width:860px;margin:0 auto;}
.cs-banner{background:#BF5700;color:#fff;margin:-36px -40px 32px;padding:24px 40px;border-radius:0;}
.cs-banner h1{font-size:22px;font-weight:800;margin-bottom:4px;}
.cs-banner p{opacity:.82;font-size:12px;}
h2{font-size:15.5px;font-weight:700;color:#1A1A1A;border-bottom:2px solid #BF5700;padding-bottom:6px;margin:24px 0 10px;}
h3{font-size:14px;font-weight:700;color:#1A1A1A;margin:18px 0 7px;}
h4{font-size:13px;font-weight:600;color:#444;margin:14px 0 5px;}
p{margin-bottom:10px;}
ul,ol{padding-left:22px;margin-bottom:12px;}
li{margin-bottom:5px;}
hr{border:none;border-top:1px solid #F0F0F0;margin:20px 0;}
strong{color:#A24A00;font-weight:700;}
em{color:#555;}
code,pre{font-family:monospace;font-size:12px;background:#FFF5EC;padding:2px 6px;border-radius:3px;color:#A24A00;}
@media print{
  .cs-banner{-webkit-print-color-adjust:exact;print-color-adjust:exact;}
  body{padding:0;max-width:none;}
}
</style>
</head>
<body>
<div class="cs-banner">
  <h1>${escapeHtmlBg(title)}</h1>
  <p>Generated by YouTube Summarizer · ${date}</p>
</div>
${cheatsheetHtml}
</body>
</html>`;
}


async function getAuth() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['userId', 'email', 'subscribed'], (r) => {
      resolve({ userId: r.userId || null, email: r.email || null, subscribed: r.subscribed || false });
    });
  });
}

async function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['apiKey', 'model'], (result) => {
      resolve({
        apiKey: result.apiKey || '',
        model: result.model || DEFAULT_MODEL,
      });
    });
  });
}

async function callClaude({ apiKey, model, system, userContent, maxTokens }) {
  const body = {
    model,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: userContent }],
  };
  if (system) body.system = system;

  const response = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    const msg = errData.error?.message || `API error ${response.status}`;
    throw new Error(msg);
  }

  const data = await response.json();
  return data.content[0].text;
}

// ─── Classification cache (session-scoped) ─────────────────────────────────

async function getCached(videoId) {
  return new Promise((resolve) => {
    chrome.storage.session.get([`cls_${videoId}`], (r) => {
      resolve(r[`cls_${videoId}`] ?? null);
    });
  });
}

function setCache(videoId, isSTEMB) {
  chrome.storage.session.set({ [`cls_${videoId}`]: isSTEMB });
}

// ─── Handlers ──────────────────────────────────────────────────────────────

async function handleClassify({ videoId, title, channel }) {
  const cached = await getCached(videoId);
  if (cached !== null) return { isSTEMB: cached };

  const { apiKey } = await getSettings();
  if (!apiKey) return { isSTEMB: null, error: 'no_api_key' };

  try {
    const userContent = `Is this YouTube video about a STEMB topic — Science, Technology, Engineering, Mathematics, or Business/Finance/Economics?

Title: "${title}"
Channel: "${channel}"

Reply with only the single word YES or NO.`;

    const result = await callClaude({
      apiKey,
      model: CLASSIFICATION_MODEL,
      system: null,
      userContent,
      maxTokens: 5,
    });

    const isSTEMB = result.trim().toUpperCase().startsWith('YES');
    setCache(videoId, isSTEMB);
    return { isSTEMB };
  } catch (err) {
    console.error('[YT Cheatsheet] Classification error:', err.message);
    // Default to true so students don't miss a useful cheatsheet
    return { isSTEMB: true, error: err.message };
  }
}

async function handleGenerateCheatsheet({ transcript, durationSeconds, isSTEMB, title }) {
  const { apiKey, model } = await getSettings();
  if (!apiKey) {
    return { error: 'No API key found. Please open the extension settings and enter your Claude API key.' };
  }

  let system;
  if (!isSTEMB) {
    system = GENERAL_SYSTEM;
  } else if (durationSeconds >= LONG_VIDEO_THRESHOLD_SECONDS) {
    system = LONG_VIDEO_SYSTEM;
  } else {
    system = SHORT_VIDEO_SYSTEM;
  }

  // Cap transcript at ~100k characters to stay well within context limits
  const MAX_CHARS = 100000;
  const trimmedTranscript = transcript.length > MAX_CHARS
    ? transcript.slice(0, MAX_CHARS) + '\n\n[Transcript truncated due to length]'
    : transcript;

  const userContent = `Video Title: "${title}"\n\nTranscript:\n${trimmedTranscript}`;

  try {
    let html = await callClaude({ apiKey, model, system, userContent, maxTokens: 4096 });
    // Strip any <style> blocks — our injected CSS owns all styling so colours stay consistent
    html = html.replace(/<style[\s\S]*?<\/style>/gi, '').trim();
    return { html };
  } catch (err) {
    return { error: err.message };
  }
}

async function handleTestApiKey({ apiKey }) {
  try {
    await callClaude({
      apiKey,
      model: CLASSIFICATION_MODEL,
      system: null,
      userContent: 'Say "OK" and nothing else.',
      maxTokens: 5,
    });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ─── Caption fetching (runs in background SW, outside YouTube's SW scope) ──

function parseJSON3(data) {
  if (!data?.events) return '';
  return data.events
    .filter((e) => e.segs)
    .map((e) => e.segs.map((s) => s.utf8 || '').join(''))
    .join(' ').replace(/[\n\r]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

function parseXML(raw) {
  const matches = raw.match(/<text[^>]*>([\s\S]*?)<\/text>/g) || [];
  return matches
    .map((m) => m.replace(/<[^>]*>/g, ''))
    .map((t) => t
      .replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
      .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10))))
    .join(' ').replace(/\s+/g, ' ').trim();
}

async function fetchCaptionURL(baseUrl, log, credentials = 'include') {
  const cleanBase = baseUrl
    .replace(/([?&])fmt=[^&]*/g, (m, sep) => sep === '?' ? '?' : '')
    .replace(/\?&/, '?').replace(/[?&]$/, '');
  const sep = cleanBase.includes('?') ? '&' : '?';

  for (const url of [`${cleanBase}${sep}fmt=json3`, cleanBase]) {
    try {
      log(`  bg-fetch [${credentials}] ${url.substring(0, 80)}`);
      const res = await fetch(url, { credentials });
      const raw = await res.text();
      log(`  → ${res.status} ${raw.length}b`);
      if (!res.ok || !raw.length) continue;

      if (raw.trimStart().startsWith('{')) {
        const text = parseJSON3(JSON.parse(raw));
        if (text) { log('  ✓ json3'); return text; }
      }
      if (raw.includes('<text')) {
        const text = parseXML(raw);
        if (text) { log('  ✓ xml'); return text; }
      }
      log(`  body not parseable: "${raw.substring(0, 60)}"`);
    } catch (e) { log(`  err: ${e.message}`); }
  }
  return null;
}

async function getTranscript(tabId, videoId) {
  const steps = [];
  const log = (s) => steps.push(s);

  // ── Step 1: read ytInitialPlayerResponse from page's MAIN world (read-only) ─
  // We only extract data here; all fetching happens in the background SW below
  // so that YouTube's own service worker cannot intercept and blank the responses.
  log('Step 1: reading ytInitialPlayerResponse via executeScript (MAIN world)');
  let pageData = null;
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      args: [videoId],
      func: async (videoId) => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        let pr = window.ytInitialPlayerResponse;
        for (let i = 0; i < 10 && pr?.videoDetails?.videoId !== videoId; i++) {
          await sleep(400);
          pr = window.ytInitialPlayerResponse;
        }
        if (!pr || pr.videoDetails?.videoId !== videoId) {
          return { found: false, gotVideoId: pr?.videoDetails?.videoId };
        }
        const tracks = pr.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
        return {
          found: true,
          duration: parseInt(pr.videoDetails.lengthSeconds || '0', 10),
          tracks: tracks.map((t) => ({ lang: t.languageCode, baseUrl: t.baseUrl })),
        };
      },
    });
    pageData = results?.[0]?.result;
    log(`  found=${pageData?.found} tracks=${pageData?.tracks?.length ?? 0} [${(pageData?.tracks || []).map((t) => t.lang).join(', ')}]`);
  } catch (e) {
    log(`  executeScript error: ${e.message}`);
  }

  // ── Step 2: fetch caption URLs from background (bypasses YouTube's SW) ───
  if (pageData?.found && pageData.tracks?.length) {
    const sorted = [
      ...pageData.tracks.filter((t) => t.lang === 'en'),
      ...pageData.tracks.filter((t) => t.lang?.startsWith('en') && t.lang !== 'en'),
      ...pageData.tracks.filter((t) => !t.lang?.startsWith('en')),
    ];
    for (const track of sorted) {
      log(`Step 2: fetching lang=${track.lang} from background`);
      const text = await fetchCaptionURL(track.baseUrl, log);
      if (text) return { text, duration: pageData.duration, debugSteps: steps };
    }
    log('Step 2: all tracks returned empty from background');
  }

  // ── Step 3: YouTube internal API (fetched from background) ───────────────
  for (const client of [
    { clientName: 'WEB', clientVersion: '2.20231121.08.00', hl: 'en', gl: 'US' },
    { clientName: 'TVHTML5_SIMPLY_EMBEDDED_PLAYER', clientVersion: '2.0', hl: 'en', gl: 'US' },
  ]) {
    log(`Step 3: youtubei/v1/player client=${client.clientName}`);
    try {
      const res = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId, context: { client } }),
        credentials: 'include',
      });
      log(`  → ${res.status}`);
      if (!res.ok) continue;
      const data = await res.json();
      const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
      log(`  tracks=${tracks.length}`);
      if (!tracks.length) continue;
      const track = tracks.find((t) => t.languageCode === 'en') ||
                    tracks.find((t) => t.languageCode?.startsWith('en')) ||
                    tracks[0];
      const duration = parseInt(data.videoDetails?.lengthSeconds || '0', 10);
      const text = await fetchCaptionURL(track.baseUrl, log);
      if (text) return { text, duration, debugSteps: steps };
    } catch (e) { log(`  error: ${e.message}`); }
  }

  // ── Step 4: public timedtext API (fetched from background) ───────────────
  for (const { lang, kind } of [
    { lang: 'en', kind: '' }, { lang: 'en', kind: 'asr' },
    { lang: 'en-US', kind: '' }, { lang: 'en-GB', kind: '' },
  ]) {
    let url = `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${lang}`;
    if (kind) url += `&kind=${kind}`;
    log(`Step 4: ${url}`);
    try {
      const res = await fetch(url, { credentials: 'include' });
      const raw = await res.text();
      log(`  → ${res.status} ${raw.length}b`);
      if (!res.ok || !raw.length) continue;
      if (raw.trimStart().startsWith('{')) {
        const text = parseJSON3(JSON.parse(raw));
        if (text) return { text, duration: 0, debugSteps: steps };
      }
      if (raw.includes('<text')) {
        const text = parseXML(raw);
        if (text) return { text, duration: 0, debugSteps: steps };
      }
    } catch (e) { log(`  error: ${e.message}`); }
  }

  log('ALL STEPS FAILED');
  return { text: null, duration: 0, debugSteps: steps };
}

// ─── Streaming generation (port-based) ────────────────────────────────────
// Uses chrome.runtime.connect so chunks arrive incrementally in content.js.
// The user sees content within ~1s instead of waiting 15-30s for the full response.

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'generate') return;

  port.onMessage.addListener(async ({ transcript, durationSeconds, isSTEMB, title }) => {
    const { apiKey, model } = await getSettings();
    if (!apiKey) {
      port.postMessage({ type: 'error', error: 'No API key found. Open Settings and add your Claude API key.' });
      return;
    }

    let system;
    if (!isSTEMB) {
      system = GENERAL_SYSTEM;
    } else if (durationSeconds >= LONG_VIDEO_THRESHOLD_SECONDS) {
      system = LONG_VIDEO_SYSTEM;
    } else {
      system = SHORT_VIDEO_SYSTEM;
    }

    const MAX_CHARS = 100000;
    const trimmedTranscript = transcript.length > MAX_CHARS
      ? transcript.slice(0, MAX_CHARS) + '\n\n[Transcript truncated due to length]'
      : transcript;

    let response;
    try {
      response = await fetch(ANTHROPIC_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model,
          max_tokens: 4096,
          stream: true,
          system,
          messages: [{ role: 'user', content: `Video Title: "${title}"\n\nTranscript:\n${trimmedTranscript}` }],
        }),
      });
    } catch (err) {
      port.postMessage({ type: 'error', error: err.message });
      return;
    }

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      port.postMessage({ type: 'error', error: errData.error?.message || `API error ${response.status}` });
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let accumulated = '';
    let sseBuffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        sseBuffer += decoder.decode(value, { stream: true });
        const lines = sseBuffer.split('\n');
        sseBuffer = lines.pop(); // hold incomplete last line

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (raw === '[DONE]') continue;
          try {
            const ev = JSON.parse(raw);
            if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
              accumulated += ev.delta.text;
              port.postMessage({ type: 'chunk', chunk: ev.delta.text });
            }
          } catch (_) {}
        }
      }
    } catch (err) {
      port.postMessage({ type: 'error', error: 'Stream interrupted: ' + err.message });
      return;
    }

    const html = accumulated.replace(/<style[\s\S]*?<\/style>/gi, '').trim();
    port.postMessage({ type: 'done', html });
  });
});

// ─── Message router ────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const { action } = message;

  if (action === 'classify') {
    handleClassify(message).then(sendResponse).catch((err) => sendResponse({ isSTEMB: true, error: err.message }));
    return true;
  }

  if (action === 'generateCheatsheet') {
    handleGenerateCheatsheet(message).then(sendResponse).catch((err) => sendResponse({ error: err.message }));
    return true;
  }

  if (action === 'testApiKey') {
    handleTestApiKey(message).then(sendResponse).catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (action === 'checkLimit') {
    (async () => {
      const [list, auth, devData] = await Promise.all([
        new Promise((r) => chrome.storage.local.get(['cheatsheets'], (d) => r(d.cheatsheets || []))),
        getAuth(),
        new Promise((r) => chrome.storage.sync.get(['devMode'], r)),
      ]);
      const count = list.length;

      // Developer bypass — skip all limit/subscription checks while testing
      if (devData.devMode) {
        sendResponse({ allowed: true, count, subscribed: true, devMode: true });
        return;
      }

      let subscribed = auth.subscribed || false;

      // If not cached as subscribed, re-check Firestore in case payment just went through
      if (!subscribed && auth.userId) {
        subscribed = await checkFirestoreSubscription(auth.userId);
        if (subscribed) chrome.storage.sync.set({ subscribed: true });
      }

      const allowed = subscribed || count < 3;
      sendResponse({ allowed, count, subscribed });
    })();
    return true;
  }

  if (action === 'saveCheatsheet') {
    const { videoId, title, channel, html } = message;
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    const entry = { id, videoId: videoId || '', title: title || '', channel: channel || '', html, createdAt: Date.now() };
    chrome.storage.local.get(['cheatsheets'], (r) => {
      const list = r.cheatsheets || [];
      list.unshift(entry);
      chrome.storage.local.set({ cheatsheets: list }, () => sendResponse({ success: true, id }));
    });
    return true;
  }

  if (action === 'updateCheatsheet') {
    const { id, html } = message;
    chrome.storage.local.get(['cheatsheets'], (r) => {
      const list = r.cheatsheets || [];
      const idx = list.findIndex((c) => c.id === id);
      if (idx !== -1) list[idx].html = html;
      chrome.storage.local.set({ cheatsheets: list }, () => sendResponse({ success: true }));
    });
    return true;
  }

  if (action === 'getCheatsheets') {
    chrome.storage.local.get(['cheatsheets'], (r) => {
      sendResponse({ cheatsheets: r.cheatsheets || [] });
    });
    return true;
  }

  if (action === 'deleteCheatsheet') {
    const { id } = message;
    chrome.storage.local.get(['cheatsheets'], (r) => {
      const list = (r.cheatsheets || []).filter((c) => c.id !== id);
      chrome.storage.local.set({ cheatsheets: list }, () => sendResponse({ success: true }));
    });
    return true;
  }

  if (action === 'openTab') {
    chrome.tabs.create({ url: message.url });
    sendResponse({ success: true });
    return true;
  }

  if (action === 'saveAuth') {
    const { userId, email, subscribed } = message;
    chrome.storage.sync.set({ userId, email, subscribed: subscribed ?? true }, () =>
      sendResponse({ success: true })
    );
    return true;
  }

  if (action === 'getAuth') {
    getAuth().then(sendResponse);
    return true;
  }

  if (action === 'signOut') {
    chrome.storage.sync.remove(['userId', 'email', 'subscribed'], () =>
      sendResponse({ success: true })
    );
    return true;
  }

  if (action === 'getTranscript') {
    const tabId = _sender.tab.id;
    const videoId = message.videoId;

    // ── Phase 1: MAIN world — cache storage, TextTrack, player response + fetch ─
    chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      args: [videoId],
      func: async (videoId) => {
        const steps = [];
        const log = (s) => steps.push(s);
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

        const parseJSON3 = (data) => {
          if (!data?.events) return '';
          return data.events
            .filter((e) => e.segs)
            .map((e) => e.segs.map((s) => s.utf8 || '').join(''))
            .join(' ').replace(/[\n\r]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
        };
        const parseXML = (raw) => {
          const matches = raw.match(/<text[^>]*>([\s\S]*?)<\/text>/g) || [];
          return matches
            .map((m) => m.replace(/<[^>]*>/g, ''))
            .map((t) => t
              .replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
              .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>'))
            .join(' ').replace(/\s+/g, ' ').trim();
        };

        // ── A: Check data captured by the document_start interceptor ────────────
        // interceptor.js (MAIN world, document_start) wraps window.fetch and XHR
        // to capture any timedtext responses the YouTube player itself fetches.
        // The player's requests carry YouTube's internal auth context and succeed
        // where our out-of-band fetches get bot-blocked (200 0b / 403).
        log('A: interceptor data check');
        const captData = window._ytCSCaptionData || {};
        const captKeys = Object.keys(captData).filter((k) => k.includes(videoId));
        log(`  captured for this video: ${captKeys.length}`);

        const tryParseCaptured = (raw) => {
          if (!raw || !raw.length) return null;
          if (raw.trimStart().startsWith('{')) {
            try { const t = parseJSON3(JSON.parse(raw)); if (t) return t; } catch (_) {}
          }
          if (raw.includes('<text')) { const t = parseXML(raw); if (t) return t; }
          return null;
        };

        for (const k of captKeys) {
          const text = tryParseCaptured(captData[k]);
          if (text) { log('  ✓ interceptor (already captured)'); return { text, duration: document.querySelector('video')?.duration || 0, debugSteps: steps }; }
        }

        // Caption not yet captured — trigger the player to load them now
        log('  triggering player caption load');
        let triggered = false;
        try {
          const player = document.querySelector('#movie_player');
          if (player && typeof player.setOption === 'function') {
            player.setOption('captions', 'track', { languageCode: 'en' });
            triggered = true;
            log('  setOption(captions, track, en) called');
          }
          if (!triggered) {
            const ccBtn = document.querySelector('.ytp-subtitles-button');
            if (ccBtn) {
              const wasOn = ccBtn.getAttribute('aria-pressed') === 'true';
              if (!wasOn) { ccBtn.click(); triggered = true; log('  CC button clicked ON'); }
              else { log('  CC already on — captions should load soon'); triggered = true; }
            }
          }
        } catch (e) { log(`  trigger error: ${e.message}`); }

        if (triggered) {
          await sleep(3000); // wait for player to fetch caption data
          const captKeys2 = Object.keys(window._ytCSCaptionData || {}).filter((k) => k.includes(videoId));
          log(`  after trigger: ${captKeys2.length} captured`);
          for (const k of captKeys2) {
            const text = tryParseCaptured((window._ytCSCaptionData || {})[k]);
            if (text) { log('  ✓ interceptor (post-trigger)'); return { text, duration: document.querySelector('video')?.duration || 0, debugSteps: steps }; }
          }
          log('  interceptor: still no data after trigger');
        }

        // ── B: HTML5 TextTrack (no network fetch) ────────────────────────────
        log('B: TextTrack API');
        const video = document.querySelector('video');
        if (video) {
          const tts = Array.from(video.textTracks || []);
          log(`  textTracks: ${tts.length}`);
          for (const tt of tts) {
            if (tt.kind !== 'subtitles' && tt.kind !== 'captions') continue;
            const prev = tt.mode;
            tt.mode = 'hidden';
            await sleep(1200);
            const cues = Array.from(tt.cues || []);
            log(`  [${tt.language}] cues=${cues.length}`);
            if (cues.length > 0) {
              const text = cues.map((c) => (c.text || '').replace(/<[^>]*>/g, '').trim()).filter(Boolean).join(' ');
              if (text) { log('  ✓ TextTrack'); return { text, duration: video.duration || 0, debugSteps: steps }; }
            }
            tt.mode = prev;
          }
          log('  TextTrack: no accessible cues');
        }

        // ── C: Get caption track URLs from player ─────────────────────────────
        let playerResponse = null;
        const playerEl = document.querySelector('#movie_player');
        if (playerEl && typeof playerEl.getPlayerResponse === 'function') {
          try { playerResponse = playerEl.getPlayerResponse(); log(`C: getPlayerResponse() id=${playerResponse?.videoDetails?.videoId}`); }
          catch (e) { log(`C: getPlayerResponse err: ${e.message}`); }
        }
        if (!playerResponse || playerResponse.videoDetails?.videoId !== videoId) {
          let pr = window.ytInitialPlayerResponse;
          for (let i = 0; i < 10 && pr?.videoDetails?.videoId !== videoId; i++) { await sleep(400); pr = window.ytInitialPlayerResponse; }
          playerResponse = pr;
          log(`C: ytInitialPlayerResponse id=${playerResponse?.videoDetails?.videoId}`);
        }

        let duration = 0;
        let captionTracks = [];
        if (playerResponse?.videoDetails?.videoId === videoId) {
          duration = parseInt(playerResponse.videoDetails.lengthSeconds || '0', 10);
          captionTracks = playerResponse.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
          log(`  tracks: ${captionTracks.length} [${captionTracks.map((t) => t.languageCode).join(', ')}]`);
        }

        // ── D: Fetch caption URLs from page context ───────────────────────────
        const fetchCaption = async (baseUrl, label) => {
          const clean = baseUrl.replace(/([?&])fmt=[^&]*/g, (m, s) => s === '?' ? '?' : '').replace(/\?&/, '?').replace(/[?&]$/, '');
          const sep = clean.includes('?') ? '&' : '?';
          for (const url of [`${clean}${sep}fmt=json3`, clean]) {
            try {
              const r = await fetch(url, { cache: 'no-store' });
              const raw = await r.text();
              log(`  [${label}] ${r.status} ${raw.length}b`);
              if (!r.ok || !raw.length) continue;
              if (raw.trimStart().startsWith('{')) { const text = parseJSON3(JSON.parse(raw)); if (text) { log(`  ✓ json3`); return text; } }
              if (raw.includes('<text')) { const text = parseXML(raw); if (text) { log(`  ✓ xml`); return text; } }
            } catch (e) { log(`  [${label}] err: ${e.message}`); }
          }
          return null;
        };

        const sorted = [
          ...captionTracks.filter((t) => t.languageCode === 'en'),
          ...captionTracks.filter((t) => t.languageCode?.startsWith('en') && t.languageCode !== 'en'),
          ...captionTracks.filter((t) => !t.languageCode?.startsWith('en')),
        ];
        for (const track of sorted) {
          const text = await fetchCaption(track.baseUrl, track.languageCode);
          if (text) return { text, duration, debugSteps: steps };
        }

        return { text: null, duration, tracks: sorted.map((t) => ({ lang: t.languageCode, baseUrl: t.baseUrl })), debugSteps: steps };
      },
    })
    .then(async (results) => {
      const phase1 = results?.[0]?.result ?? { text: null, duration: 0, tracks: [], debugSteps: ['executeScript returned nothing'] };
      if (phase1.text) { sendResponse(phase1); return; }

      const log2 = (s) => phase1.debugSteps.push(s);

      // ── Phase 2: background SW fetches caption URLs from phase 1 ─────────────
      // Extension background SW is a different origin — YouTube's page SW cannot
      // intercept these requests. Try without cookies first (public videos), then with.
      for (const track of (phase1.tracks || [])) {
        for (const creds of ['omit', 'include']) {
          log2(`P2: bg-fetch lang=${track.lang} creds=${creds}`);
          const text = await fetchCaptionURL(track.baseUrl, log2, creds);
          if (text) { sendResponse({ text, duration: phase1.duration, debugSteps: phase1.debugSteps }); return; }
        }
      }

      // ── Phase 3: YouTube's internal get_transcript API ────────────────────────
      // Used by YouTube's own "Show transcript" panel — completely separate from
      // the timedtext endpoint and unaffected by the 200-0b issue.
      log2('P3: get_transcript API');
      try {
        const vidBytes = new TextEncoder().encode(videoId);
        const params = btoa(String.fromCharCode(0x0a, vidBytes.length, ...vidBytes));
        for (const creds of ['omit', 'include']) {
          const r = await fetch('https://www.youtube.com/youtubei/v1/get_transcript', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: creds,
            body: JSON.stringify({
              context: { client: { clientName: 'WEB', clientVersion: '2.20231121.08.00', hl: 'en', gl: 'US' } },
              params,
            }),
          });
          log2(`  ${r.status} [creds=${creds}]`);
          if (!r.ok) { log2(`  body: ${(await r.text()).substring(0, 120)}`); continue; }
          const data = await r.json();
          log2(`  top-level keys: [${Object.keys(data).join(', ')}]`);
          const segs = (
            data?.actions?.[0]?.updateEngagementPanelAction?.content?.transcriptRenderer
              ?.transcript?.transcriptSearchPanelRenderer?.body?.transcriptSegmentListRenderer?.initialSegments
            || data?.actions?.[0]?.updateEngagementPanelAction?.content?.transcriptRenderer
              ?.content?.transcriptSearchPanelRenderer?.body?.transcriptSegmentListRenderer?.initialSegments
            || []
          );
          log2(`  segments: ${segs.length}`);
          if (segs.length > 0) {
            const text = segs
              .map((s) => (s?.transcriptSegmentRenderer?.snippet?.runs || []).map((r) => r.text || '').join(''))
              .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
            if (text) { log2('  ✓ get_transcript'); sendResponse({ text, duration: phase1.duration, debugSteps: phase1.debugSteps }); return; }
          }
        }
      } catch (e) { log2(`P3 error: ${e.message}`); }

      // ── Phase 4: scrape watch page HTML for fresh signed caption URLs ─────────
      log2('P4: scraping watch page HTML');
      try {
        const pageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
          credentials: 'include',
          headers: { 'Accept-Language': 'en-US,en;q=0.9' },
        });
        const html = await pageRes.text();
        log2(`  page: ${pageRes.status} ${html.length}b`);

        const durationMatch = html.match(/"lengthSeconds":"(\d+)"/);
        const duration = durationMatch ? parseInt(durationMatch[1], 10) : phase1.duration;

        // Robust regex: handles both escaped (\"baseUrl\":) and raw formats,
        // and decodes Unicode escapes in the URL
        const urlMatches = [...html.matchAll(/"baseUrl"\s*:\s*"([^"]*timedtext[^"]*)"/g)];
        const captionUrls = [...new Set(
          urlMatches.map((m) => m[1]
            .replace(/\\u0026/g, '&').replace(/\\u003d/g, '=').replace(/\\u003f/g, '?').replace(/\\\//g, '/'))
        )];
        log2(`  caption URLs in HTML: ${captionUrls.length}`);

        for (const url of captionUrls) {
          for (const creds of ['omit', 'include']) {
            const text = await fetchCaptionURL(url, log2, creds);
            if (text) { sendResponse({ text, duration, debugSteps: phase1.debugSteps }); return; }
          }
        }
        if (!captionUrls.length) log2('  no timedtext URLs found — video may have no captions');
      } catch (e) { log2(`P4 error: ${e.message}`); }

      log2('ALL PHASES FAILED');
      sendResponse({ text: null, duration: 0, debugSteps: phase1.debugSteps });
    })
    .catch((err) => sendResponse({ text: null, duration: 0, fatalError: err.message, debugSteps: [`executeScript threw: ${err.message}`] }));
    return true;
  }

});
