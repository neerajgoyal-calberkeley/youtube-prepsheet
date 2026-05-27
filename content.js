'use strict';

(function () {
  // ─── State ───────────────────────────────────────────────────────────────

  const state = {
    videoId: null,
    isSTEMB: null,
    buttonShown: false,
    panelOpen: false,
    timerInterval: null,
    activeTab: 'create',
    currentCheatsheetId: null,
    editMode: false,
    savedHtml: null,
    prefetchedTranscript: null, // pre-fetched while user reads button
    sharedFilename: null,       // set after first share download; cleared on new generation
  };

  // ─── Utilities ───────────────────────────────────────────────────────────

  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  function getVideoId() {
    return new URLSearchParams(location.search).get('v');
  }

  function getVideoTitle() {
    return (
      document.querySelector('h1.ytd-watch-metadata yt-formatted-string')?.textContent?.trim() ||
      document.querySelector('#above-the-fold #title h1')?.textContent?.trim() ||
      document.querySelector('h1.title')?.textContent?.trim() ||
      document.title.replace(' - YouTube', '').trim() ||
      ''
    );
  }

  function getChannelName() {
    return (
      document.querySelector('ytd-channel-name #channel-name a')?.textContent?.trim() ||
      document.querySelector('#channel-name a')?.textContent?.trim() ||
      document.querySelector('.ytd-channel-name a')?.textContent?.trim() ||
      ''
    );
  }

  function escapeHTML(str) {
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function htmlToText(html) {
    const d = document.createElement('div');
    d.innerHTML = html;
    return d.textContent || '';
  }

  function formatDate(ts) {
    const d = new Date(ts);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const isYest = d.toDateString() === yesterday.toDateString();
    const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    if (isToday) return `Today · ${time}`;
    if (isYest) return `Yesterday · ${time}`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' · ' + time;
  }

  function toast(msg, duration = 2800) {
    let el = document.getElementById('yt-cs-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'yt-cs-toast';
      el.className = 'yt-cs-toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('yt-cs-toast-show');
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.remove('yt-cs-toast-show'), duration);
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────────

  function init() {
    const newVideoId = getVideoId();
    if (!newVideoId || newVideoId === state.videoId) return;

    cleanup();

    state.videoId = newVideoId;
    state.isSTEMB = null;
    state.buttonShown = false;
    state.panelOpen = false;
    state.activeTab = 'create';
    state.currentCheatsheetId = null;
    state.editMode = false;
    state.savedHtml = null;
    state.prefetchedTranscript = null;
    state.sharedFilename = null;

    beginClassification();
    waitForVideoElement();
  }

  function cleanup() {
    clearInterval(state.timerInterval);
    state.timerInterval = null;
    document.getElementById('yt-cs-btn')?.remove();
    document.getElementById('yt-cs-panel')?.remove();
    document.getElementById('yt-cs-toast')?.remove();
  }

  // ─── Classification ──────────────────────────────────────────────────────

  async function beginClassification() {
    await sleep(500);
    const title = getVideoTitle();
    const channel = getChannelName();
    if (!title) return;

    chrome.runtime.sendMessage(
      { action: 'classify', videoId: state.videoId, title, channel },
      (response) => {
        if (chrome.runtime.lastError) return;
        state.isSTEMB = response?.isSTEMB ?? false;
      }
    );
  }

  // ─── Timer & button ──────────────────────────────────────────────────────

  function waitForVideoElement() {
    const tryFind = () => {
      const video = document.querySelector('video');
      if (video) startPlaybackTimer(video);
      else setTimeout(tryFind, 500);
    };
    tryFind();
  }

  function startPlaybackTimer(video) {
    state.timerInterval = setInterval(() => {
      if (state.buttonShown) { clearInterval(state.timerInterval); return; }
      if (video.currentTime >= 60) {
        showCheatsheetButton();
        clearInterval(state.timerInterval);
      }
    }, 1000);
  }

  // Brand icon — lightbulb with light rays
  const BRAND_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">
    <line x1="10" y1="1" x2="10" y2="2.8"/>
    <line x1="14.2" y1="2.3" x2="13.2" y2="3.3"/>
    <line x1="16.5" y1="6.5" x2="14.9" y2="7"/>
    <line x1="5.8" y1="2.3" x2="6.8" y2="3.3"/>
    <line x1="3.5" y1="6.5" x2="5.1" y2="7"/>
    <path d="M7.5 14C6.6 12.8 6 11.3 6 9.5a4 4 0 0 1 8 0c0 1.8-.6 3.3-1.5 4.5"/>
    <line x1="7.5" y1="14" x2="12.5" y2="14"/>
    <line x1="8" y1="15.5" x2="12" y2="15.5"/>
    <line x1="8.5" y1="17" x2="11.5" y2="17"/>
  </svg>`;

  function showCheatsheetButton() {
    if (state.buttonShown) return;
    state.buttonShown = true;

    const player = document.querySelector('#movie_player');
    if (!player) return;

    const btn = document.createElement('button');
    btn.id = 'yt-cs-btn';
    btn.title = 'Create Study Cheatsheet';
    btn.setAttribute('aria-label', 'Create Study Cheatsheet');
    btn.innerHTML = `
      <span class="yt-cs-btn-icon">${BRAND_ICON_SVG}</span>
      <span>Create Cheatsheet</span>`;

    btn.addEventListener('click', onButtonClick);
    player.appendChild(btn);

    requestAnimationFrame(() => requestAnimationFrame(() => btn.classList.add('yt-cs-visible')));

    // Pre-fetch transcript in background — by the time the user clicks it's ready
    prefetchTranscript();
  }

  async function prefetchTranscript() {
    try {
      const result = await fetchTranscript();
      if (result.text) state.prefetchedTranscript = result;
    } catch (_) {}
  }

  // ─── Limit check ─────────────────────────────────────────────────────────

  function checkLimit() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'checkLimit' }, (res) => {
        if (chrome.runtime.lastError) { resolve({ allowed: true }); return; }
        resolve(res || { allowed: true });
      });
    });
  }

  // ─── Button click ────────────────────────────────────────────────────────

  async function onButtonClick() {
    if (state.panelOpen) {
      const panel = document.getElementById('yt-cs-panel');
      if (panel) panel.classList.toggle('yt-cs-open');
      state.panelOpen = !state.panelOpen;
      return;
    }

    // Enforce limit before generating
    const limitResult = await checkLimit();
    if (!limitResult.allowed) {
      chrome.runtime.sendMessage({ action: 'openTab', url: chrome.runtime.getURL('upgrade.html') });
      return;
    }

    openPanel();
    await generateCheatsheet();
  }

  // ─── Generate ────────────────────────────────────────────────────────────

  const COOKING_TOASTS = [
    'Noodling it over…',
    'Your dumpling is cooking…',
    'Brewing your coffee-grade notes…',
    'Simmering the key concepts…',
    'Kneading the knowledge together…',
    'Folding in the insights…',
    'Letting it marinate…',
    'Stirring the ideas…',
    'Chopping up the details…',
    'Preheating the brain oven…',
    'Seasoning your study notes…',
    'Whisking it all together…',
    'Slow-cooking the good stuff…',
  ];

  function showAiLoading() {
    const msg = COOKING_TOASTS[Math.floor(Math.random() * COOKING_TOASTS.length)];
    toast(msg, 6000);
    showBody(`<div class="yt-cs-loading">
      <div class="yt-cs-spinner"></div>
      <p class="yt-cs-loading-title">Building your cheatsheet…</p>
      <p class="yt-cs-loading-sub">This usually takes 15–30 seconds</p>
    </div>`);
  }

  async function generateCheatsheet() {
    switchTab('create');
    hideActionBar();
    state.sharedFilename = null;

    // Use pre-fetched transcript if ready, otherwise fetch now
    let transcript, duration, debugSteps;
    if (state.prefetchedTranscript) {
      ({ text: transcript, duration, debugSteps } = state.prefetchedTranscript);
      state.prefetchedTranscript = null;
      showAiLoading();
    } else {
      showBody(`<div class="yt-cs-loading">
        <div class="yt-cs-spinner"></div>
        <p class="yt-cs-loading-title">Extracting transcript…</p>
      </div>`);
      try {
        ({ text: transcript, duration, debugSteps } = await fetchTranscript());
      } catch (err) {
        showBody(errorHTML('Failed to extract transcript.', err.message));
        return;
      }
      if (!transcript) {
        showBody(debugErrorHTML(debugSteps || []));
        return;
      }
      showAiLoading();
    }

    // Stream the generation — content starts appearing within ~1s
    await streamGenerate(transcript, duration);
  }

  function streamGenerate(transcript, duration) {
    return new Promise((resolve) => {
      const port = chrome.runtime.connect({ name: 'generate' });

      let htmlBuffer = '';
      let contentDiv = null;
      let flushTimer = null;

      const flush = () => {
        flushTimer = null;
        if (contentDiv) contentDiv.innerHTML = htmlBuffer;
      };

      const scheduleFlush = () => {
        if (!flushTimer) flushTimer = setTimeout(flush, 80);
      };

      port.onMessage.addListener((msg) => {
        if (msg.type === 'chunk') {
          htmlBuffer += msg.chunk;

          if (!contentDiv) {
            // First chunk — replace spinner with streaming content div
            const wrapper = document.createElement('div');
            wrapper.className = 'yt-cs-content yt-cs-streaming';
            showBody(null, wrapper);
            contentDiv = wrapper;
          }

          scheduleFlush();

        } else if (msg.type === 'done') {
          if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }

          state.savedHtml = msg.html;
          const finalDiv = document.createElement('div');
          finalDiv.className = 'yt-cs-content';
          finalDiv.innerHTML = msg.html;
          showBody(null, finalDiv);
          showActionBar();

          chrome.runtime.sendMessage({
            action: 'saveCheatsheet',
            videoId: state.videoId,
            title: getVideoTitle(),
            channel: getChannelName(),
            html: msg.html,
          }, (saveRes) => {
            if (saveRes?.id) state.currentCheatsheetId = saveRes.id;
          });

          port.disconnect();
          resolve();

        } else if (msg.type === 'error') {
          if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
          showBody(errorHTML('Generation failed.', msg.error));
          port.disconnect();
          resolve();
        }
      });

      port.onDisconnect.addListener(() => resolve());

      port.postMessage({
        transcript,
        durationSeconds: duration,
        isSTEMB: state.isSTEMB,
        title: getVideoTitle(),
      });
    });
  }

  function fetchTranscript() {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action: 'getTranscript', videoId: state.videoId }, (res) => {
        if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); return; }
        if (res?.fatalError) { reject(new Error(res.fatalError)); return; }
        resolve({ text: res?.text ?? null, duration: res?.duration ?? 0, debugSteps: res?.debugSteps ?? [] });
      });
    });
  }

  // ─── Panel ───────────────────────────────────────────────────────────────

  function openPanel() {
    let panel = document.getElementById('yt-cs-panel');
    if (!panel) { panel = buildPanel(); document.body.appendChild(panel); }
    requestAnimationFrame(() => requestAnimationFrame(() => panel.classList.add('yt-cs-open')));
    state.panelOpen = true;
  }

  function buildPanel() {
    const panel = document.createElement('div');
    panel.id = 'yt-cs-panel';
    panel.setAttribute('role', 'complementary');
    panel.setAttribute('aria-label', 'Study Cheatsheet');

    panel.innerHTML = `
      <div class="yt-cs-header">
        <div class="yt-cs-brand">
          <div class="yt-cs-brand-icon">${BRAND_ICON_SVG}</div>
          <span class="yt-cs-brand-name">Cheatsheet</span>
        </div>
        <div class="yt-cs-header-right">
          <button class="yt-cs-close-btn" id="yt-cs-close-btn" title="Close">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      </div>

      <div class="yt-cs-tabs">
        <button class="yt-cs-tab active" data-tab="create">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
          New Cheatsheet
        </button>
        <button class="yt-cs-tab" data-tab="history">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          History
        </button>
      </div>

      <div class="yt-cs-body" id="yt-cs-body"></div>

      <div class="yt-cs-action-bar" id="yt-cs-action-bar">
        <span class="yt-cs-action-label">Save &amp; Share</span>
        <div class="yt-cs-action-row" id="yt-cs-icons">
          <button class="yt-cs-action-btn" data-action="edit" data-tooltip="Edit notes">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="yt-cs-action-btn" data-action="pdf" data-tooltip="Save as PDF">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><polyline points="9 15 12 18 15 15"/></svg>
          </button>
          <button class="yt-cs-action-btn" data-action="word" data-tooltip="Word doc">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><polyline points="8 13 10 19 12 13 14 19 16 13"/></svg>
          </button>
          <button class="yt-cs-action-btn" data-action="email" data-tooltip="Email">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
          </button>
          <button class="yt-cs-action-btn" data-action="whatsapp" data-tooltip="WhatsApp">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
          </button>
          <button class="yt-cs-action-btn" data-action="discord" data-tooltip="Discord">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><circle cx="9" cy="10" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="10" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="10" r="1" fill="currentColor" stroke="none"/></svg>
          </button>
          <button class="yt-cs-action-btn" data-action="slack" data-tooltip="Slack">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 10c-.83 0-1.5-.67-1.5-1.5v-5c0-.83.67-1.5 1.5-1.5s1.5.67 1.5 1.5v5c0 .83-.67 1.5-1.5 1.5z"/><path d="M20.5 10H19V8.5c0-.83.67-1.5 1.5-1.5s1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/><path d="M9.5 14c.83 0 1.5.67 1.5 1.5v5c0 .83-.67 1.5-1.5 1.5S8 21.33 8 20.5v-5c0-.83.67-1.5 1.5-1.5z"/><path d="M3.5 14H5v1.5c0 .83-.67 1.5-1.5 1.5S2 16.33 2 15.5 2.67 14 3.5 14z"/><path d="M14 14.5c0-.83.67-1.5 1.5-1.5h5c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5h-5c-.83 0-1.5-.67-1.5-1.5z"/><path d="M15.5 19H14v1.5c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5-.67-1.5-1.5-1.5z"/><path d="M10 9.5C10 8.67 9.33 8 8.5 8h-5C2.67 8 2 8.67 2 9.5S2.67 11 3.5 11h5c.83 0 1.5-.67 1.5-1.5z"/><path d="M8.5 5H10V3.5C10 2.67 9.33 2 8.5 2S7 2.67 7 3.5 7.67 5 8.5 5z"/></svg>
          </button>
          <button class="yt-cs-action-btn" data-action="sms" data-tooltip="SMS">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><line x1="8" y1="10" x2="16" y2="10"/><line x1="8" y1="14" x2="12" y2="14"/></svg>
          </button>
        </div>
        <div class="yt-cs-edit-controls" id="yt-cs-edit-controls">
          <button class="yt-cs-save-btn" id="yt-cs-save-edit">Save Edits</button>
          <button class="yt-cs-cancel-btn" id="yt-cs-cancel-edit">Cancel</button>
        </div>
      </div>`;

    // Wire up close
    panel.querySelector('#yt-cs-close-btn').addEventListener('click', () => {
      panel.classList.remove('yt-cs-open');
      state.panelOpen = false;
    });

    // Wire up tabs
    panel.querySelectorAll('.yt-cs-tab').forEach((tab) => {
      tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });

    // Wire up action buttons
    panel.querySelectorAll('.yt-cs-action-btn[data-action]').forEach((btn) => {
      btn.addEventListener('click', () => handleAction(btn.dataset.action));
    });

    panel.querySelector('#yt-cs-save-edit').addEventListener('click', saveEdit);
    panel.querySelector('#yt-cs-cancel-edit').addEventListener('click', cancelEdit);

    return panel;
  }

  // ─── Tab switching ────────────────────────────────────────────────────────

  function switchTab(tab) {
    state.activeTab = tab;
    document.querySelectorAll('.yt-cs-tab').forEach((t) => {
      t.classList.toggle('active', t.dataset.tab === tab);
    });

    if (tab === 'history') {
      hideActionBar();
      loadHistory();
    } else {
      // Restore create view
      if (state.savedHtml) {
        showBody(`<div class="yt-cs-content">${state.savedHtml}</div>`);
        showActionBar();
      } else {
        showBody(emptyCreateHTML());
        hideActionBar();
      }
    }
  }

  async function loadHistory() {
    showBody(`<div class="yt-cs-loading"><div class="yt-cs-spinner"></div></div>`);

    const res = await new Promise((r) => chrome.runtime.sendMessage({ action: 'getCheatsheets' }, r));
    const sheets = res?.cheatsheets || [];

    if (sheets.length === 0) {
      showBody(emptyHistoryHTML());
      return;
    }

    const listEl = document.createElement('div');
    listEl.className = 'yt-cs-history-list';

    sheets.forEach((cs) => {
      const card = document.createElement('div');
      card.className = 'yt-cs-history-card';
      card.dataset.id = cs.id;

      const thumbSrc = cs.videoId
        ? `https://img.youtube.com/vi/${cs.videoId}/mqdefault.jpg`
        : null;

      card.innerHTML = `
        ${thumbSrc
          ? `<img class="yt-cs-hist-thumb" src="${thumbSrc}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
          : ''}
        <div class="yt-cs-hist-placeholder" style="${thumbSrc ? 'display:none' : ''}">
          ${BRAND_ICON_SVG}
        </div>
        <div class="yt-cs-hist-info">
          <div class="yt-cs-hist-title">${escapeHTML(cs.title || 'Untitled')}</div>
          ${cs.channel ? `<div class="yt-cs-hist-channel">${escapeHTML(cs.channel)}</div>` : ''}
          <div class="yt-cs-hist-date">${formatDate(cs.createdAt)}</div>
        </div>
        <div class="yt-cs-hist-actions">
          <button class="yt-cs-hist-btn" data-id="${cs.id}" title="Delete">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
          </button>
        </div>`;

      // Click card body → load into create tab
      card.addEventListener('click', (e) => {
        if (e.target.closest('.yt-cs-hist-btn')) return;
        state.currentCheatsheetId = cs.id;
        state.savedHtml = cs.html;
        switchTab('create');
      });

      // Delete
      card.querySelector('.yt-cs-hist-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        chrome.runtime.sendMessage({ action: 'deleteCheatsheet', id: cs.id }, () => loadHistory());
      });

      listEl.appendChild(card);
    });

    showBody(null, listEl);
  }

  // ─── Action bar ───────────────────────────────────────────────────────────

  function showActionBar() {
    document.getElementById('yt-cs-action-bar')?.classList.add('yt-cs-bar-visible');
  }

  function hideActionBar() {
    document.getElementById('yt-cs-action-bar')?.classList.remove('yt-cs-bar-visible');
  }

  function enterEditMode() {
    state.editMode = true;
    const body = document.getElementById('yt-cs-body');
    body.contentEditable = 'true';
    body.focus();
    document.getElementById('yt-cs-icons').style.display = 'none';
    document.getElementById('yt-cs-edit-controls').style.display = 'flex';
    document.querySelector('.yt-cs-action-label').textContent = 'Editing…';
  }

  function saveEdit() {
    const body = document.getElementById('yt-cs-body');
    const updatedHtml = body.innerHTML;
    state.editMode = false;
    state.savedHtml = updatedHtml;
    state.sharedFilename = null; // content changed — next share will re-download
    body.contentEditable = 'false';
    document.getElementById('yt-cs-icons').style.display = 'flex';
    document.getElementById('yt-cs-edit-controls').style.display = 'none';
    document.querySelector('.yt-cs-action-label').textContent = 'Save & Share';

    if (state.currentCheatsheetId) {
      chrome.runtime.sendMessage(
        { action: 'updateCheatsheet', id: state.currentCheatsheetId, html: updatedHtml },
        () => toast('Edits saved!')
      );
    } else {
      toast('Edits saved locally.');
    }
  }

  function cancelEdit() {
    const body = document.getElementById('yt-cs-body');
    state.editMode = false;
    body.contentEditable = 'false';
    if (state.savedHtml) body.innerHTML = `<div class="yt-cs-content">${state.savedHtml}</div>`;
    document.getElementById('yt-cs-icons').style.display = 'flex';
    document.getElementById('yt-cs-edit-controls').style.display = 'none';
    document.querySelector('.yt-cs-action-label').textContent = 'Save & Share';
  }

  const CHEATSHEET_PRINT_CSS = `*{box-sizing:border-box;margin:0;padding:0;}body{font-family:system-ui,sans-serif;font-size:13px;line-height:1.7;color:#1A1A1A;padding:28px 36px;max-width:860px;margin:0 auto;}.cs-banner{background:#BF5700;color:#fff;margin:-28px -36px 28px;padding:20px 36px;}.cs-banner h1{font-size:20px;font-weight:800;}.cs-banner p{opacity:.8;font-size:11px;margin-top:3px;}h2{font-size:15.5px;font-weight:700;color:#1A1A1A;border-bottom:2px solid #BF5700;padding-bottom:6px;margin:22px 0 9px;}h3{font-size:14px;font-weight:700;color:#1A1A1A;margin:16px 0 6px;}h4{font-size:13px;font-weight:600;color:#444;margin:12px 0 5px;}p{margin-bottom:10px;}ul,ol{padding-left:22px;margin-bottom:10px;}li{margin-bottom:4px;}hr{border:none;border-top:1px solid #eee;margin:18px 0;}strong{color:#A24A00;font-weight:700;}code{font-family:monospace;font-size:12px;background:#FFF5EC;padding:2px 5px;border-radius:3px;color:#A24A00;}@media print{.cs-banner{-webkit-print-color-adjust:exact;print-color-adjust:exact;}body{padding:0;}}`;

  function buildShareableHtml(title, inner) {
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>${escapeHTML(title)}</title><style>${CHEATSHEET_PRINT_CSS}</style></head><body><div class="cs-banner"><h1>${escapeHTML(title)}</h1><p>Generated by YouTube Cheatsheet</p></div>${inner}</body></html>`;
  }

  function openPrintWindow(title, inner) {
    const pw = window.open('', '_blank', 'width=900,height=700');
    if (!pw) { toast('Allow popups to save as PDF.'); return false; }
    pw.document.write(buildShareableHtml(title, inner));
    pw.document.close();
    pw.focus();
    setTimeout(() => pw.print(), 400);
    return true;
  }

  // Download cheatsheet as HTML file to Downloads (no dialog — same as Word export).
  // Returns the filename. Subsequent shares reuse the same file.
  function ensureSharedFile(title, inner) {
    if (state.sharedFilename) return { filename: state.sharedFilename, fresh: false };
    const safe = title.replace(/[^a-z0-9\s]/gi, '').replace(/\s+/g, '_').slice(0, 60);
    const filename = `${safe}_cheatsheet.html`;
    const blob = new Blob([buildShareableHtml(title, inner)], { type: 'text/html' });
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);
    state.sharedFilename = filename;
    return { filename, fresh: true };
  }

  async function handleAction(action) {
    if (action === 'edit') { enterEditMode(); return; }

    const title = getVideoTitle() || 'Study Cheatsheet';
    const body = document.getElementById('yt-cs-body');
    const inner = body?.querySelector('.yt-cs-content')?.innerHTML || body?.innerHTML || '';

    if (action === 'pdf') {
      openPrintWindow(title, inner);
      return;
    }

    if (action === 'word') {
      const safe = title.replace(/[^a-z0-9\s]/gi, '').replace(/\s+/g, '_');
      const docHtml = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="UTF-8"><title>${escapeHTML(title)}</title><style>body{font-family:Calibri,sans-serif;font-size:11pt;}h2{color:#BF5700;border-bottom:2pt solid #BF5700;padding-bottom:3pt;}h3{color:#1A1A1A;}strong{color:#A24A00;}</style></head><body><h1 style="color:#BF5700;font-size:16pt;">${escapeHTML(title)}</h1><hr>${inner}</body></html>`;
      const blob = new Blob([docHtml], { type: 'application/msword' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${safe}_cheatsheet.doc`; a.click();
      URL.revokeObjectURL(url);
      toast('Word document downloaded!');
      return;
    }

    // Social sharing — download file once, then open the platform
    const { filename, fresh } = ensureSharedFile(title, inner);
    const fileNote = fresh
      ? `"${filename}" saved to Downloads`
      : `"${filename}" already in Downloads`;

    switch (action) {
      case 'email': {
        const sub = encodeURIComponent(`${title} — Study Cheatsheet`);
        const bod = encodeURIComponent(`Hi,\n\nSee attached my study cheatsheet for "${title}".\n\nGenerated by YouTube Cheatsheet`);
        window.open(`mailto:?subject=${sub}&body=${bod}`);
        toast(`${fileNote} — attach it to your email.`, 4000);
        break;
      }
      case 'whatsapp': {
        const msg = encodeURIComponent(`📚 *${title}* — Study Cheatsheet`);
        window.open(`https://wa.me/?text=${msg}`, '_blank');
        toast(`${fileNote} — attach it in WhatsApp.`, 4000);
        break;
      }
      case 'discord': {
        navigator.clipboard.writeText(`📚 **${title}** — Study Cheatsheet`).catch(() => {});
        window.open('https://discord.com/channels/@me', '_blank');
        toast(`${fileNote} — attach it in Discord.`, 4000);
        break;
      }
      case 'slack': {
        navigator.clipboard.writeText(`📚 *${title}* — Study Cheatsheet`).catch(() => {});
        window.open('https://slack.com', '_blank');
        toast(`${fileNote} — attach it in Slack.`, 4000);
        break;
      }
      case 'sms': {
        const msg = encodeURIComponent(`Check out my study cheatsheet for "${title}"!`);
        window.open(`sms:?body=${msg}`);
        toast(`${fileNote} — attach it in Messages.`, 4000);
        break;
      }
    }
  }

  // ─── Body helpers ─────────────────────────────────────────────────────────

  function showBody(html, el) {
    const body = document.getElementById('yt-cs-body');
    if (!body) return;
    if (el) {
      body.innerHTML = '';
      body.appendChild(el);
    } else {
      body.innerHTML = html || '';
    }
  }

  // ─── Template helpers ─────────────────────────────────────────────────────

  function loadingHTML() {
    return `<div class="yt-cs-loading">
      <div class="yt-cs-spinner"></div>
      <p class="yt-cs-loading-title">Extracting transcript…</p>
    </div>`;
  }

  function emptyCreateHTML() {
    return `<div class="yt-cs-empty">
      <div class="yt-cs-empty-icon">${BRAND_ICON_SVG}</div>
      <h3>No cheatsheet yet</h3>
      <p>Close this panel and click the <strong style="color:#BF5700">Cheatsheet</strong> button on the video to generate one.</p>
    </div>`;
  }

  function emptyHistoryHTML() {
    return `<div class="yt-cs-empty">
      <div class="yt-cs-empty-icon">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
      </div>
      <h3>No history yet</h3>
      <p>Cheatsheets you create will appear here.</p>
    </div>`;
  }

  function errorHTML(title, detail) {
    const optionsUrl = chrome.runtime.getURL('options.html');
    return `<div class="yt-cs-error">
      <div class="yt-cs-error-icon">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      </div>
      <h3>${escapeHTML(title)}</h3>
      <p>${escapeHTML(detail || '')}</p>
      <a class="yt-cs-error-link" href="${optionsUrl}" target="_blank">Open Settings</a>
    </div>`;
  }

  function debugErrorHTML(steps) {
    const lines = steps.map((s) => `<li>${escapeHTML(s)}</li>`).join('');
    return `<div class="yt-cs-debug-error">
      <p>Transcript extraction failed. Diagnostic steps:</p>
      <ol>${lines}</ol>
    </div>`;
  }

  // ─── Popup trigger ───────────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action !== 'triggerCreate') return false;
    if (!state.panelOpen) openPanel();
    else document.getElementById('yt-cs-panel')?.classList.add('yt-cs-open');
    generateCheatsheet();
    sendResponse({ ok: true });
    return false;
  });

  // ─── YouTube SPA navigation ───────────────────────────────────────────────

  init();
  document.addEventListener('yt-navigate-finish', init);
})();
