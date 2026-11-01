import type { Problem } from '@cld/shared';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** JSON fetch against our API; throws ApiError with the server's human-readable message. */
export async function api<T = unknown>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
    credentials: 'same-origin',
    headers: init.body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) {
    const p = data as Partial<Problem> | null;
    throw new ApiError(res.status, p?.detail ?? p?.title ?? `Request failed (${res.status})`);
  }
  return data as T;
}

export const errorMessage = (e: unknown): string =>
  e instanceof Error ? e.message : 'Something went wrong';
