'use strict';

const FREE_LIMIT = 3;

function msg(action, data) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action, ...data }, (res) => {
      if (chrome.runtime.lastError) resolve(null);
      else resolve(res);
    });
  });
}

function showToast(text, duration = 2800) {
  const t = document.getElementById('toast');
  t.textContent = text;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), duration);
}

function initials(name, email) {
  if (name && name.trim()) {
    const parts = name.trim().split(/\s+/);
    return parts.length >= 2
      ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
      : parts[0].slice(0, 2).toUpperCase();
  }
  if (email) return email[0].toUpperCase();
  return '?';
}

function setAvatarEl(auth) {
  const el = document.getElementById('avatar');
  if (!el) return;
  if (auth.photoURL) {
    el.innerHTML = `<img src="${auth.photoURL}" alt="Avatar">`;
  } else {
    el.textContent = initials(auth.displayName, auth.email);
  }
}

function renderSignedIn(auth, cheatsheets, subscribed) {
  document.getElementById('signed-in').style.display = '';
  document.getElementById('not-signed-in').style.display = 'none';

  setAvatarEl(auth);
  document.getElementById('display-name').textContent = auth.displayName || auth.email || 'User';
  document.getElementById('display-email').textContent = auth.email || '';

  // Subscription badge
  const badge = document.getElementById('sub-badge');
  const badgeText = document.getElementById('sub-badge-text');
  const subDetail = document.getElementById('sub-detail');
  const btnUpgrade = document.getElementById('btn-upgrade');
  const btnVerify = document.getElementById('btn-verify');
  const btnManage = document.getElementById('btn-manage');
  const usageNote = document.getElementById('usage-note');

  if (subscribed) {
    badge.className = 'sub-badge pro';
    badge.querySelector('svg').setAttribute('fill', '#BF5700');
    badgeText.textContent = 'Pro Plan';
    subDetail.textContent = 'Unlimited cheatsheets';
    btnUpgrade.style.display = 'none';
    btnVerify.style.display = 'none';
    btnManage.style.display = '';
    usageNote.textContent = 'Unlimited cheatsheets included';
  } else {
    badge.className = 'sub-badge free';
    badge.querySelector('svg').setAttribute('fill', 'none');
    badgeText.textContent = 'Free Plan';
    subDetail.textContent = `${FREE_LIMIT} cheatsheets included`;
    btnUpgrade.style.display = '';
    btnVerify.style.display = '';
    btnManage.style.display = 'none';
    usageNote.textContent = `${FREE_LIMIT} free cheatsheets included`;
  }

  // Usage
  const count = (cheatsheets || []).length;
  document.getElementById('usage-count').textContent = subscribed ? count : `${count} / ${FREE_LIMIT}`;
  const pct = subscribed ? Math.min(100, Math.round((count / Math.max(count, 1)) * 100)) : Math.min(100, Math.round((count / FREE_LIMIT) * 100));
  document.getElementById('usage-bar').style.width = `${pct}%`;
}

function renderNotSignedIn(cheatsheets) {
  document.getElementById('signed-in').style.display = 'none';
  document.getElementById('not-signed-in').style.display = '';

  const count = (cheatsheets || []).length;
  document.getElementById('free-count').textContent = `${count} / ${FREE_LIMIT}`;
  const pct = Math.min(100, Math.round((count / FREE_LIMIT) * 100));
  document.getElementById('free-bar').style.width = `${pct}%`;
}

async function init() {
  const [authRes, csRes] = await Promise.all([
    msg('getAuth', {}),
    msg('getCheatsheets', {}),
  ]);

  const auth = authRes || {};
  const cheatsheets = csRes?.cheatsheets || [];
  const signedIn = !!auth.userId;
  const subscribed = !!auth.subscribed;

  if (signedIn) {
    renderSignedIn(auth, cheatsheets, subscribed);
  } else {
    renderNotSignedIn(cheatsheets);
  }
}

// ─── Button handlers ───────────────────────────────────────────────────────

document.getElementById('back-btn').addEventListener('click', () => window.close());

document.getElementById('btn-signin')?.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('auth.html') });
  window.close();
});

document.getElementById('btn-upgrade')?.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('upgrade.html') });
  window.close();
});

document.getElementById('btn-manage')?.addEventListener('click', async () => {
  // Opens the Stripe customer portal — replace YOUR_PORTAL_LINK with the portal URL from
  // Stripe Dashboard → Settings → Billing → Customer portal → Copy link
  const portalUrl = 'https://billing.stripe.com/p/login/YOUR_PORTAL_LINK';
  if (portalUrl.includes('YOUR_PORTAL_LINK')) {
    showToast('Stripe customer portal not configured yet.');
    return;
  }
  chrome.tabs.create({ url: portalUrl });
});

document.getElementById('btn-verify')?.addEventListener('click', async () => {
  const btn = document.getElementById('btn-verify');
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner"></div> Checking…';

  const authRes = await msg('getAuth', {});
  if (!authRes?.userId) {
    showToast('Please sign in first.');
    btn.disabled = false;
    btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg> Already paid? Verify subscription`;
    return;
  }

  const limitRes = await msg('checkLimit', {});
  btn.disabled = false;

  if (limitRes?.subscribed) {
    showToast('Pro subscription confirmed!');
    await init(); // Re-render with updated status
  } else {
    showToast('No active subscription found. Please complete payment first.');
    btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg> Already paid? Verify subscription`;
  }
});

document.getElementById('btn-signout')?.addEventListener('click', async () => {
  const btn = document.getElementById('btn-signout');
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner"></div> Signing out…';
  await msg('signOut', {});
  renderNotSignedIn([]);
  document.getElementById('not-signed-in').style.display = '';
  document.getElementById('signed-in').style.display = 'none';
  showToast('Signed out.');
  btn.disabled = false;
  btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg> Sign Out`;
});

// ─── Init ──────────────────────────────────────────────────────────────────
init();
