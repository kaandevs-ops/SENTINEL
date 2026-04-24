export async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message = body?.error?.message || body?.message || `Request failed (${res.status})`;
    throw new Error(message);
  }
  return body;
}

export function unwrapData(payload, fallback = null) {
  if (payload && typeof payload === "object" && "ok" in payload) {
    return payload.ok ? payload.data ?? fallback : fallback;
  }
  return payload ?? fallback;
}

export function unwrapList(payload) {
  if (payload && typeof payload === "object" && "ok" in payload) {
    return Array.isArray(payload.data) ? payload.data : [];
  }
  return Array.isArray(payload?.data) ? payload.data : [];
}
