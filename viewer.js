'use strict';

const params = new URLSearchParams(location.search);
const cheatsheetId = params.get('id');

let currentCheatsheet = null;
let originalHtml = null;
let editMode = false;

// ─── Load cheatsheet ────────────────────────────────────────────────────────

async function loadCheatsheet() {
  if (!cheatsheetId) {
    document.getElementById('viewer-content').innerHTML = '<p style="color:#dc2626;padding:40px">No cheatsheet ID specified.</p>';
    return;
  }

  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: 'getCheatsheets' }, (res) => {
      const list = res?.cheatsheets || [];
      const cs = list.find((c) => c.id === cheatsheetId);
      if (!cs) {
        document.getElementById('viewer-content').innerHTML = '<p style="color:#dc2626;padding:40px">Cheatsheet not found.</p>';
        return;
      }

      currentCheatsheet = cs;
      originalHtml = cs.html;

      document.title = `${cs.title || 'Cheatsheet'} — YouTube Cheatsheet`;
      document.getElementById('viewer-title').textContent = cs.title || 'Study Cheatsheet';

      const date = new Date(cs.createdAt);
      const meta = [
        cs.channel,
        date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
        date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
      ].filter(Boolean).join(' · ');
      document.getElementById('viewer-meta').textContent = meta;

      document.getElementById('viewer-content').innerHTML = cs.html;
      document.getElementById('action-bar').style.display = 'flex';

      resolve(cs);
    });
  });
}

// ─── Utilities ──────────────────────────────────────────────────────────────

function toast(msg, duration = 2500) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), duration);
}

function getPlainText() {
  const content = document.getElementById('viewer-content');
  const tmp = document.createElement('div');
  tmp.innerHTML = content.innerHTML;
  return tmp.textContent || '';
}

function getTitle() {
  return currentCheatsheet?.title || 'Study Cheatsheet';
}

// ─── Actions ────────────────────────────────────────────────────────────────

function handleEdit() {
  const content = document.getElementById('viewer-content');
  editMode = true;
  content.contentEditable = 'true';
  content.focus();

  document.getElementById('action-icons').style.display = 'none';
  document.getElementById('edit-controls').style.display = 'flex';
}

function handleSaveEdit() {
  const content = document.getElementById('viewer-content');
  const updatedHtml = content.innerHTML;
  editMode = false;
  content.contentEditable = 'false';
  originalHtml = updatedHtml;
  sharedFilename = null; // content changed — next share will re-download

  document.getElementById('action-icons').style.display = 'flex';
  document.getElementById('edit-controls').style.display = 'none';

  chrome.runtime.sendMessage({
    action: 'updateCheatsheet',
    id: cheatsheetId,
    html: updatedHtml,
  }, () => toast('Edits saved!'));
}

function handleCancelEdit() {
  const content = document.getElementById('viewer-content');
  editMode = false;
  content.contentEditable = 'false';
  content.innerHTML = originalHtml;

  document.getElementById('action-icons').style.display = 'flex';
  document.getElementById('edit-controls').style.display = 'none';
}

function handlePDF() {
  window.print();
}

function handleWord() {
  const title = getTitle();
  const safeTitle = title.replace(/[^a-z0-9\s]/gi, '').replace(/\s+/g, '_');
  const docHtml = [
    '<html xmlns:o="urn:schemas-microsoft-com:office:office"',
    ' xmlns:w="urn:schemas-microsoft-com:office:word">',
    '<head><meta charset="UTF-8">',
    `<title>${title}</title>`,
    '<style>body{font-family:Calibri,sans-serif;font-size:11pt;} h2,h3{color:#A24A00;}</style>',
    '</head><body>',
    `<h1 style="color:#BF5700">${title}</h1><hr>`,
    document.getElementById('viewer-content').innerHTML,
    '</body></html>',
  ].join('');

  const blob = new Blob([docHtml], { type: 'application/msword' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${safeTitle}_cheatsheet.doc`;
  a.click();
  URL.revokeObjectURL(url);
  toast('Word document downloaded!');
}

// Track whether the file has been downloaded in this viewer session
let sharedFilename = null;

const CHEATSHEET_PRINT_CSS = `*{box-sizing:border-box;margin:0;padding:0;}body{font-family:system-ui,sans-serif;font-size:13px;line-height:1.7;color:#1A1A1A;padding:28px 36px;max-width:860px;margin:0 auto;}.cs-banner{background:#BF5700;color:#fff;margin:-28px -36px 28px;padding:20px 36px;}.cs-banner h1{font-size:20px;font-weight:800;}.cs-banner p{opacity:.8;font-size:11px;margin-top:3px;}h2{font-size:15.5px;font-weight:700;color:#1A1A1A;border-bottom:2px solid #BF5700;padding-bottom:6px;margin:22px 0 9px;}h3{font-size:14px;font-weight:700;color:#1A1A1A;margin:16px 0 6px;}h4{font-size:13px;font-weight:600;color:#444;margin:12px 0 5px;}p{margin-bottom:10px;}ul,ol{padding-left:22px;margin-bottom:10px;}li{margin-bottom:4px;}hr{border:none;border-top:1px solid #eee;margin:18px 0;}strong{color:#A24A00;font-weight:700;}code{font-family:monospace;font-size:12px;background:#FFF5EC;padding:2px 5px;border-radius:3px;color:#A24A00;}@media print{.cs-banner{-webkit-print-color-adjust:exact;print-color-adjust:exact;}body{padding:0;}}`;

function buildShareableHtml(title, inner) {
  const esc = (s) => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>${esc(title)}</title><style>${CHEATSHEET_PRINT_CSS}</style></head><body><div class="cs-banner"><h1>${esc(title)}</h1><p>Generated by YouTube Cheatsheet</p></div>${inner}</body></html>`;
}

// Download once; subsequent share actions reuse the same file.
function ensureSharedFile() {
  if (sharedFilename) return { filename: sharedFilename, fresh: false };
  const title = getTitle();
  const inner = document.getElementById('viewer-content').innerHTML;
  const safe = title.replace(/[^a-z0-9\s]/gi, '').replace(/\s+/g, '_').slice(0, 60);
  const filename = `${safe}_cheatsheet.html`;
  const blob = new Blob([buildShareableHtml(title, inner)], { type: 'text/html' });
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = blobUrl; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(blobUrl);
  sharedFilename = filename;
  return { filename, fresh: true };
}

function handleEmail() {
  const { filename, fresh } = ensureSharedFile();
  const note = fresh ? `"${filename}" saved to Downloads` : `"${filename}" already in Downloads`;
  const sub = encodeURIComponent(getTitle() + ' — Study Cheatsheet');
  const body = encodeURIComponent(`Hi,\n\nSee attached my study cheatsheet for "${getTitle()}".\n\nGenerated by YouTube Cheatsheet`);
  window.open(`mailto:?subject=${sub}&body=${body}`);
  toast(`${note} — attach it to your email.`, 4000);
}

function handleWhatsApp() {
  const { filename, fresh } = ensureSharedFile();
  const note = fresh ? `"${filename}" saved to Downloads` : `"${filename}" already in Downloads`;
  const text = encodeURIComponent(`📚 *${getTitle()}* — Study Cheatsheet`);
  window.open(`https://wa.me/?text=${text}`, '_blank');
  toast(`${note} — attach it in WhatsApp.`, 4000);
}

async function handleDiscord() {
  const { filename, fresh } = ensureSharedFile();
  const note = fresh ? `"${filename}" saved to Downloads` : `"${filename}" already in Downloads`;
  try { await navigator.clipboard.writeText(`📚 **${getTitle()}** — Study Cheatsheet`); } catch (_) {}
  window.open('https://discord.com/channels/@me', '_blank');
  toast(`${note} — attach it in Discord.`, 4000);
}

async function handleSlack() {
  const { filename, fresh } = ensureSharedFile();
  const note = fresh ? `"${filename}" saved to Downloads` : `"${filename}" already in Downloads`;
  try { await navigator.clipboard.writeText(`📚 *${getTitle()}* — Study Cheatsheet`); } catch (_) {}
  window.open('https://slack.com', '_blank');
  toast(`${note} — attach it in Slack.`, 4000);
}

function handleSMS() {
  const { filename, fresh } = ensureSharedFile();
  const note = fresh ? `"${filename}" saved to Downloads` : `"${filename}" already in Downloads`;
  const text = encodeURIComponent(`Check out my study cheatsheet for "${getTitle()}"!`);
  window.open(`sms:?body=${text}`);
  toast(`${note} — attach it in Messages.`, 4000);
}

// ─── Event listeners ────────────────────────────────────────────────────────

document.getElementById('btn-close').addEventListener('click', () => window.close());

document.getElementById('btn-save-edit').addEventListener('click', handleSaveEdit);
document.getElementById('btn-cancel-edit').addEventListener('click', handleCancelEdit);

document.querySelectorAll('.action-btn[data-action]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    switch (btn.dataset.action) {
      case 'edit':     handleEdit();           break;
      case 'pdf':      handlePDF();            break;
      case 'word':     handleWord();           break;
      case 'email':    await handleEmail();    break;
      case 'whatsapp': await handleWhatsApp(); break;
      case 'discord':  await handleDiscord();  break;
      case 'slack':    await handleSlack();    break;
      case 'sms':      await handleSMS();      break;
    }
  });
});

// ─── Init ───────────────────────────────────────────────────────────────────

loadCheatsheet();
