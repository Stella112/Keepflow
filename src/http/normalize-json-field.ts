export function normalizeJsonObjectField(body: unknown, field: string): unknown {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return body;
  }

  const record = body as Record<string, unknown>;
  const value = record[field];
  if (typeof value !== 'string') {
    return body;
  }

  try {
    return { ...record, [field]: JSON.parse(value) as unknown };
  } catch {
    return body;
  }
}
