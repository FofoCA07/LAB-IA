const base = '/api/lab/api/auth';

async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(`${base}/${path}`, {
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      ...options,
    });
  } catch {
    throw new Error('No se pudo conectar con LAB-IA.');
  }
  if (!response.ok) {
    throw new Error(path === 'pair' && [400, 401, 429].includes(response.status)
      ? 'Código inválido o expirado.'
      : 'La sesión no pudo iniciarse.');
  }
  return response;
}

export async function getSession() {
  const response = await request('session', { headers: { 'X-Lab-Request': '1' } });
  try {
    const data = await response.json();
    if (data.authenticated === false) return { authenticated: false };
    if (data.authenticated === true && typeof data.csrfToken === 'string' && data.csrfToken.length > 0) {
      return { authenticated: true, csrfToken: data.csrfToken };
    }
  } catch { /* Only expose the fixed message below. */ }
  throw new Error('La sesión no pudo iniciarse.');
}

export async function pairDevice(code) {
  await request('pair', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: code.trim() }),
  });
}

export async function logout(csrfToken) {
  await request('logout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Lab-CSRF': csrfToken },
    body: '{}',
  });
}
