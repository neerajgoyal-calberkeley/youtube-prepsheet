'use strict';

function formatDate(ts) {
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday = d.toDateString() === yesterday.toDateString();

  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (isToday) return `Today ${time}`;
  if (isYesterday) return `Yesterday ${time}`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' · ' + time;
}

function renderEmpty() {
  document.getElementById('cs-list').innerHTML = `
    <div class="empty-state">
      <div class="step">
        <div class="step-num">1</div>
        <div class="step-text">
          <strong>Add your API key</strong>
          <span>Click the gear icon ⚙ above and enter your Anthropic Claude API key.</span>
        </div>
      </div>
      <div class="step">
        <div class="step-num">2</div>
        <div class="step-text">
          <strong>Open a YouTube video</strong>
          <span>Navigate to any Science, Tech, Engineering, Math or Business video.</span>
        </div>
      </div>
      <div class="step">
        <div class="step-num">3</div>
        <div class="step-text">
          <strong>Click "Create Cheatsheet"</strong>
          <span>Open this extension while watching a YouTube video and hit the button below.</span>
        </div>
      </div>
    </div>`;
}

function renderList(cheatsheets) {
  const list = document.getElementById('cs-list');
  list.innerHTML = '';

  cheatsheets.forEach((cs) => {
    const card = document.createElement('div');
    card.className = 'cs-card';

    const thumbSrc = cs.videoId
      ? `https://img.youtube.com/vi/${cs.videoId}/mqdefault.jpg`
      : null;

    card.innerHTML = `
      ${thumbSrc
        ? `<img class="cs-thumb" src="${thumbSrc}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
        : ''}
      <div class="cs-thumb-placeholder" style="${thumbSrc ? 'display:none' : ''}">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
        </svg>
      </div>
      <div class="cs-info">
        <div class="cs-title">${escapeHTML(cs.title || 'Untitled Cheatsheet')}</div>
        ${cs.channel ? `<div class="cs-channel">${escapeHTML(cs.channel)}</div>` : ''}
        <div class="cs-date">${formatDate(cs.createdAt)}</div>
      </div>
      <button class="cs-delete" data-id="${cs.id}" title="Delete">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 6 5 6 21 6"/>
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
          <path d="M10 11v6"/>
          <path d="M14 11v6"/>
          <path d="M9 6V4h6v2"/>
        </svg>
      </button>`;

    // Click card body → open viewer
    card.addEventListener('click', (e) => {
      if (e.target.closest('.cs-delete')) return;
      const url = chrome.runtime.getURL(`viewer.html?id=${cs.id}`);
      chrome.tabs.create({ url });
    });

    // Delete button
    card.querySelector('.cs-delete').addEventListener('click', (e) => {
      e.stopPropagation();
      chrome.runtime.sendMessage({ action: 'deleteCheatsheet', id: cs.id }, () => {
        init();
      });
    });

    list.appendChild(card);
  });
}

function escapeHTML(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function updateFreeBar(count, subscribed) {
  const freeBar = document.getElementById('free-bar');
  if (subscribed) {
    freeBar.style.display = 'none';
    return;
  }
  const capped = Math.min(count, 3);
  document.getElementById('free-label').textContent = `${capped} / 3 free`;
  document.getElementById('progress-fill').style.width = `${(capped / 3) * 100}%`;
}

function updateAuthBar(auth) {
  const bar = document.getElementById('auth-bar');
  if (auth.email) {
    bar.style.display = 'flex';
    document.getElementById('auth-email').textContent = auth.email;
  } else {
    bar.style.display = 'none';
  }
}

async function init() {
  const [csRes, authRes] = await Promise.all([
    new Promise((r) => chrome.runtime.sendMessage({ action: 'getCheatsheets' }, r)),
    new Promise((r) => chrome.runtime.sendMessage({ action: 'getAuth' }, r)),
  ]);

  const cheatsheets = csRes?.cheatsheets || [];
  const auth = authRes || { subscribed: false, email: null };

  document.getElementById('cs-count').textContent = cheatsheets.length;
  updateFreeBar(cheatsheets.length, auth.subscribed);
  updateAuthBar(auth);

  if (cheatsheets.length === 0) {
    renderEmpty();
  } else {
    renderList(cheatsheets);
  }

  // Show upgrade button only when not subscribed
  document.getElementById('btn-upgrade').style.display = auth.subscribed ? 'none' : 'flex';

  // Enable Create Cheatsheet only on YouTube watch pages
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const url = tabs[0]?.url || '';
    const isWatch = url.includes('youtube.com/watch');
    const createBtn = document.getElementById('btn-create');
    createBtn.disabled = !isWatch;
    createBtn.title = isWatch ? '' : 'Open a YouTube video to use this feature';
  });
}

// ─── Button listeners ───────────────────────────────────────────────────────

document.getElementById('btn-profile').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('profile.html') });
  window.close();
});

document.getElementById('btn-settings').addEventListener('click', () => {
  window.open(chrome.runtime.getURL('options.html'));
});

document.getElementById('btn-create').addEventListener('click', () => {
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    chrome.tabs.sendMessage(tab.id, { action: 'triggerCreate' }, () => {
      if (chrome.runtime.lastError) {
        // Content script not ready yet — show retry bar
        const bar = document.getElementById('error-bar');
        bar.style.display = 'flex';
        document.getElementById('btn-refresh-tab').onclick = () => {
          chrome.tabs.reload(tab.id);
          window.close();
        };
      } else {
        window.close();
      }
    });
  });
});

document.getElementById('btn-upgrade').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('upgrade.html') });
});

document.getElementById('btn-upgrade-small').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('upgrade.html') });
});

document.getElementById('btn-auth-profile').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('profile.html') });
  window.close();
});

init();
