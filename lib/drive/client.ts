export type JsonFetchResult<T> = {
  ok: boolean;
  status: number;
  data: T | null;
  rawText: string;
};

export async function requestDriveJson<T>(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<JsonFetchResult<T>> {
  const response = await fetch(input, init);
  const rawText = await response.text();

  if (!rawText) {
    return {
      ok: response.ok,
      status: response.status,
      data: null,
      rawText,
    };
  }

  try {
    return {
      ok: response.ok,
      status: response.status,
      data: JSON.parse(rawText) as T,
      rawText,
    };
  } catch {
    return {
      ok: response.ok,
      status: response.status,
      data: null,
      rawText,
    };
  }
}
