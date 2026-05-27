'use strict';

const apiKeyInput  = document.getElementById('apiKey');
const modelSelect  = document.getElementById('model');
const saveBtn      = document.getElementById('saveBtn');
const testBtn      = document.getElementById('testBtn');
const toggleKeyBtn = document.getElementById('toggleKeyBtn');
const statusMsg    = document.getElementById('statusMsg');

// Load saved settings
chrome.storage.sync.get(['apiKey', 'model'], (result) => {
  if (result.apiKey) apiKeyInput.value = result.apiKey;
  if (result.model)  modelSelect.value = result.model;
});

// Toggle API key visibility
toggleKeyBtn.addEventListener('click', () => {
  const isHidden = apiKeyInput.type === 'password';
  apiKeyInput.type = isHidden ? 'text' : 'password';
  toggleKeyBtn.textContent = isHidden ? 'Hide' : 'Show';
});

// Save settings
saveBtn.addEventListener('click', () => {
  const key   = apiKeyInput.value.trim();
  const model = modelSelect.value;

  if (!key) {
    showStatus('Please enter your API key.', 'error');
    return;
  }

  chrome.storage.sync.set({ apiKey: key, model }, () => {
    showStatus('Settings saved!', 'success');
  });
});

// Test connection
testBtn.addEventListener('click', async () => {
  const key = apiKeyInput.value.trim();
  if (!key) {
    showStatus('Enter your API key first.', 'error');
    return;
  }

  showStatus('Testing connection…', 'info');
  testBtn.disabled = true;
  saveBtn.disabled = true;

  chrome.runtime.sendMessage({ action: 'testApiKey', apiKey: key }, (response) => {
    testBtn.disabled = false;
    saveBtn.disabled = false;

    if (response?.success) {
      showStatus('Connection successful! Your API key is working.', 'success');
    } else {
      showStatus(`Connection failed: ${response?.error || 'Unknown error'}`, 'error');
    }
  });
});

function showStatus(message, type) {
  statusMsg.textContent = message;
  statusMsg.className = `status ${type}`;
  statusMsg.style.display = 'block';

  if (type === 'success') {
    setTimeout(() => { statusMsg.style.display = 'none'; }, 4000);
  }
}

// ─── Developer / testing controls ─────────────────────────────────────────

const devStatus  = document.getElementById('devStatus');
const resetBtn   = document.getElementById('resetBtn');
const devModeBtn = document.getElementById('devModeBtn');

function showDevStatus(msg, type) {
  devStatus.textContent = msg;
  devStatus.className = `status ${type}`;
  devStatus.style.display = 'block';
  setTimeout(() => { devStatus.style.display = 'none'; }, 3500);
}

// Reflect current dev mode state on page load
chrome.storage.sync.get(['devMode'], ({ devMode }) => {
  devModeBtn.textContent = devMode ? 'Disable bypass limit' : 'Enable bypass limit';
});

resetBtn.addEventListener('click', () => {
  chrome.storage.local.set({ cheatsheets: [] }, () => {
    showDevStatus('Cheatsheet count reset to 0. Reload the YouTube tab.', 'success');
  });
});

devModeBtn.addEventListener('click', () => {
  chrome.storage.sync.get(['devMode'], ({ devMode }) => {
    const next = !devMode;
    chrome.storage.sync.set({ devMode: next }, () => {
      devModeBtn.textContent = next ? 'Disable bypass limit' : 'Enable bypass limit';
      showDevStatus(
        next ? 'Bypass enabled — limit ignored while testing.' : 'Bypass disabled — limit enforced.',
        next ? 'success' : 'info'
      );
    });
  });
});

document.getElementById('privacyToggle').addEventListener('click', function() {
  this.classList.toggle('open');
  document.getElementById('privacyBody').classList.toggle('open');
});
