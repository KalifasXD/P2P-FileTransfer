// helpers.js

// --- constants ---
export const SESSION_ID_LENGTH = 20;
export const TOKEN_LENGTH = 32;
export const SESSION_ID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';

// --- utils ---
export function secureRandomInt(max) {
  const maxUnbiased = Math.floor(256 / max) * max;
  const buf = new Uint8Array(1);
  let x;
  do {
    crypto.getRandomValues(buf);
    x = buf[0];
  } while (x >= maxUnbiased);
  return x % max;
}

export function generateSecureId(len = SESSION_ID_LENGTH) {
  let s = '';
  for (let i = 0; i < len; i++) {
    s += SESSION_ID_CHARS[secureRandomInt(SESSION_ID_CHARS.length)];
  }
  return s;
}

export function generateSecureToken(len = TOKEN_LENGTH) {
  let s = '';
  for (let i = 0; i < len; i++) {
    s += SESSION_ID_CHARS[secureRandomInt(SESSION_ID_CHARS.length)];
  }
  return s;
}

export function isValidSessionId(id) {
  return typeof id === 'string' && new RegExp(`^[a-z0-9]{${SESSION_ID_LENGTH}}$`).test(id);
}

export function isValidToken(t) {
  return typeof t === 'string' && new RegExp(`^[a-z0-9]{${TOKEN_LENGTH}}$`).test(t);
}

// --- network ---
export const HTTP_ORIGIN = (() => {
  const host = window.location.hostname || 'localhost';
  return `http://${host}:8081`; // adjust per env
})();

export async function fetchTurnServers(room) {
  try {
    const resp = await fetch(`${HTTP_ORIGIN}/turn-credentials`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json',
                 'Access-Control-Allow-Origin': '*'
       },
      body: JSON.stringify({ room })
    });
    if (!resp.ok) {
      console.warn('TURN creds request failed, falling back to STUN');
      return [{ urls: 'stun:stun.l.google.com:19302' }];
    }
    const data = await resp.json();
    if (data && Array.isArray(data.iceServers)) return data.iceServers;
  } catch (e) {
    console.warn('Failed to fetch TURN creds:', e);
  }
  return [{ urls: 'stun:stun.l.google.com:19302' }];
}

// --- optional auth ---
export function getJWT() {
  return localStorage.getItem('auth_jwt') || null;
}
