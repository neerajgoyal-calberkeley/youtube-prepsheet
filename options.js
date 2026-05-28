'use strict';

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

chrome.storage.sync.get(['devMode'], ({ devMode }) => {
  devModeBtn.textContent = devMode ? 'Disable bypass limit' : 'Enable bypass limit';
});

resetBtn.addEventListener('click', () => {
  chrome.storage.local.set({ cheatsheets: [] }, () => {
    showDevStatus('Cheatsheet count reset. Reload the YouTube tab.', 'success');
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

document.getElementById('privacyToggle').addEventListener('click', function () {
  this.classList.toggle('open');
  document.getElementById('privacyBody').classList.toggle('open');
});
