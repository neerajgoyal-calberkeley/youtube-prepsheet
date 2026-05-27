'use strict';

// ─── Firebase Auth REST API ────────────────────────────────────────────────

const FB_BASE = 'https://identitytoolkit.googleapis.com/v1/accounts';

let currentMode = 'signin'; // 'signin' | 'signup'

function isConfigured() {
  return typeof FIREBASE_CONFIG !== 'undefined' &&
    FIREBASE_CONFIG.apiKey &&
    !FIREBASE_CONFIG.apiKey.includes('YOUR_FIREBASE');
}

function showError(msg) {
  const el = document.getElementById('error-msg');
  el.textContent = msg;
  el.style.display = 'block';
  document.getElementById('success-msg').style.display = 'none';
}

function showSuccess(msg) {
  const el = document.getElementById('success-msg');
  el.textContent = msg;
  el.style.display = 'block';
  document.getElementById('error-msg').style.display = 'none';
}

function setLoading(loading) {
  const btn = document.getElementById('btn-submit');
  const label = document.getElementById('btn-label');
  if (loading) {
    btn.disabled = true;
    label.innerHTML = '<span class="spinner"></span>';
  } else {
    btn.disabled = false;
    label.textContent = currentMode === 'signin' ? 'Sign In' : 'Create Account';
  }
}

async function firebaseAuth(endpoint, payload) {
  const url = `${FB_BASE}:${endpoint}?key=${FIREBASE_CONFIG.apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) {
    const code = data?.error?.message || 'AUTH_ERROR';
    throw new Error(friendlyError(code));
  }
  return data;
}

function friendlyError(code) {
  const map = {
    EMAIL_NOT_FOUND: 'No account found with that email.',
    INVALID_PASSWORD: 'Incorrect password.',
    INVALID_EMAIL: 'Please enter a valid email address.',
    EMAIL_EXISTS: 'An account with this email already exists.',
    WEAK_PASSWORD: 'Password must be at least 6 characters.',
    TOO_MANY_ATTEMPTS_TRY_LATER: 'Too many attempts. Please try again later.',
    USER_DISABLED: 'This account has been disabled.',
    INVALID_LOGIN_CREDENTIALS: 'Incorrect email or password.',
  };
  return map[code] || `Authentication error: ${code}`;
}

async function onAuthSuccess(data) {
  await new Promise((resolve) => {
    chrome.runtime.sendMessage({
      action: 'saveAuth',
      userId: data.localId,
      email: data.email,
      subscribed: true,
    }, resolve);
  });

  showSuccess('Success! Redirecting…');
  setTimeout(() => {
    // If opened from upgrade page, go back to YouTube
    const params = new URLSearchParams(location.search);
    if (params.get('from') === 'upgrade') {
      window.close();
    } else {
      window.close();
    }
  }, 1200);
}

async function handleEmailAuth() {
  if (!isConfigured()) { showError('Firebase not configured. Fill in firebase-config.js.'); return; }

  const email = document.getElementById('input-email').value.trim();
  const password = document.getElementById('input-password').value;

  if (!email || !password) { showError('Please enter your email and password.'); return; }

  setLoading(true);
  document.getElementById('error-msg').style.display = 'none';

  try {
    const endpoint = currentMode === 'signin' ? 'signInWithPassword' : 'signUp';
    const data = await firebaseAuth(endpoint, { email, password, returnSecureToken: true });
    await onAuthSuccess(data);
  } catch (err) {
    showError(err.message);
  } finally {
    setLoading(false);
  }
}

async function handleGoogleAuth() {
  if (!isConfigured()) { showError('Firebase not configured. Fill in firebase-config.js.'); return; }

  try {
    const token = await new Promise((resolve, reject) => {
      chrome.identity.getAuthToken({ interactive: true }, (token) => {
        if (chrome.runtime.lastError || !token) {
          reject(new Error(chrome.runtime.lastError?.message || 'Google sign-in cancelled.'));
        } else {
          resolve(token);
        }
      });
    });

    setLoading(true);
    document.getElementById('error-msg').style.display = 'none';

    const data = await firebaseAuth('signInWithIdp', {
      postBody: `access_token=${token}&providerId=google.com`,
      requestUri: 'http://localhost',
      returnIdpCredential: true,
      returnSecureToken: true,
    });

    await onAuthSuccess(data);
  } catch (err) {
    showError(err.message);
    setLoading(false);
  }
}

// ─── Tab switching ──────────────────────────────────────────────────────────

document.getElementById('tab-signin').addEventListener('click', () => {
  currentMode = 'signin';
  document.getElementById('tab-signin').classList.add('active');
  document.getElementById('tab-signup').classList.remove('active');
  document.getElementById('btn-label').textContent = 'Sign In';
  document.getElementById('input-password').autocomplete = 'current-password';
  document.getElementById('error-msg').style.display = 'none';
});

document.getElementById('tab-signup').addEventListener('click', () => {
  currentMode = 'signup';
  document.getElementById('tab-signup').classList.add('active');
  document.getElementById('tab-signin').classList.remove('active');
  document.getElementById('btn-label').textContent = 'Create Account';
  document.getElementById('input-password').autocomplete = 'new-password';
  document.getElementById('error-msg').style.display = 'none';
});

document.getElementById('btn-submit').addEventListener('click', handleEmailAuth);
document.getElementById('btn-google').addEventListener('click', handleGoogleAuth);

document.getElementById('input-password').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') handleEmailAuth();
});

// Hide config error if already configured
if (isConfigured()) {
  document.getElementById('error-config').style.display = 'none';
}
