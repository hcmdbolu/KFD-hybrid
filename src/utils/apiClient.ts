/**
 * KIID FROM DREAM POS - Centralized Cloud & Local API Client
 * Provides base URL abstraction, bearer JWT injection, tenant-scoping, and resilient error handling.
 */

export const API_BASE_URL: string = (
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE_URL) || ''
).replace(/\/+$/, '');

export function getApiUrl(endpoint: string): string {
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  if (!API_BASE_URL) {
    return cleanEndpoint;
  }
  return `${API_BASE_URL}${cleanEndpoint}`;
}

export function getAuthToken(): string | null {
  try {
    return localStorage.getItem('kiid_pos_auth_token');
  } catch {
    return null;
  }
}

export function getAuthHeaders(storeId: string = 'store_default'): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-store-id': storeId,
  };

  const token = getAuthToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
    headers['x-session-token'] = token;
  }

  return headers;
}

export async function apiFetch(
  endpoint: string,
  options: RequestInit & { storeId?: string } = {}
): Promise<Response> {
  const url = getApiUrl(endpoint);
  const storeId = options.storeId || 'store_default';
  const defaultHeaders = getAuthHeaders(storeId);

  const mergedHeaders = {
    ...defaultHeaders,
    ...(options.headers as Record<string, string> || {}),
  };

  return fetch(url, {
    ...options,
    headers: mergedHeaders,
  });
}

export function getEventsSourceUrl(storeId: string = 'store_default'): string {
  return getApiUrl(`/api/events?store_id=${encodeURIComponent(storeId)}`);
}

