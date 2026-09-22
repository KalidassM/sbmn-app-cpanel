const Api = (() => {
  function getToken() {
    return localStorage.getItem('sbmn_token');
  }

  function getUser() {
    const raw = localStorage.getItem('sbmn_user');
    return raw ? JSON.parse(raw) : null;
  }

  function setSession(token, user) {
    localStorage.setItem('sbmn_token', token);
    localStorage.setItem('sbmn_user', JSON.stringify(user));
  }

  function clearSession() {
    localStorage.removeItem('sbmn_token');
    localStorage.removeItem('sbmn_user');
  }

  async function request(path, { method = 'GET', body } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    const token = getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`/api${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (res.status === 401) {
      clearSession();
      window.location.hash = '#/login';
      throw new Error('Session expired, please log in again');
    }

    let data = null;
    try {
      data = await res.json();
    } catch (e) {
      data = null;
    }

    if (!res.ok) {
      throw new Error((data && data.error) || `Request failed (${res.status})`);
    }
    return data;
  }

  return {
    getToken,
    getUser,
    setSession,
    clearSession,
    get: (path) => request(path),
    post: (path, body) => request(path, { method: 'POST', body }),
    put: (path, body) => request(path, { method: 'PUT', body }),
    del: (path) => request(path, { method: 'DELETE' }),
  };
})();
