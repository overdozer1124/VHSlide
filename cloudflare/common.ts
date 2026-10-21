export interface Env {
  ASSETS: Fetcher;
  DIRECTORY: DurableObjectNamespace;
  ROOMS: DurableObjectNamespace;
  GOOGLE_CLIENT_ID: string;
  PUBLIC_ORIGIN?: string;
}
export interface User {
  id: string;
  name: string;
  email: string;
}
export interface Identity {
  user: User;
  session: string;
  expires: number;
}
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function insist(
  value: unknown,
  status: number,
  message: string,
): asserts value {
  if (!value) throw new HttpError(status, message);
}
export function rows<T>(
  sql: SqlStorage,
  query: string,
  ...args: SqlStorageValue[]
): T[] {
  return sql.exec(query, ...args).toArray() as unknown as T[];
}
export function one<T>(
  sql: SqlStorage,
  query: string,
  ...args: SqlStorageValue[]
): T | undefined {
  return rows<T>(sql, query, ...args)[0];
}
export const json = (data: unknown, status = 200, headers?: HeadersInit) =>
  Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
export function failure(error: unknown) {
  const status =
    error instanceof HttpError
      ? error.status
      : error instanceof SyntaxError
        ? 400
        : 503;
  return json(
    {
      error:
        status < 500
          ? (error as Error).message
          : "クラウドで処理できませんでした。無料枠の上限・接続状況を確認し、JSONも保存してください。",
    },
    status,
  );
}
export async function body(request: Request, maximum: number) {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      insist(
        length <= maximum,
        413,
        `送信データは${Math.floor(maximum / 1_000_000)}MBまでです。`,
      );
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  }
  const result = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    result.set(chunk, at);
    at += chunk.length;
  }
  return result;
}
export const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
export async function input(request: Request, maximum = 20_000) {
  return JSON.parse(text(await body(request, maximum)));
}
export const randomToken = () =>
  btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
export async function sha(value: string) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
  ]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
export function mime(bytes: Uint8Array) {
  const head = [...bytes.subarray(0, 12)];
  if (head.slice(0, 8).join() === "137,80,78,71,13,10,26,10")
    return "image/png";
  if (head[0] === 255 && head[1] === 216 && head[2] === 255)
    return "image/jpeg";
  if (/^GIF8[79]a/.test(text(bytes.subarray(0, 6)))) return "image/gif";
  if (
    text(bytes.subarray(0, 4)) === "RIFF" &&
    text(bytes.subarray(8, 12)) === "WEBP"
  )
    return "image/webp";
}
export const directory = (env: Env) =>
  env.DIRECTORY.get(env.DIRECTORY.idFromName("directory-v1"));
export const room = (env: Env, id: string) =>
  env.ROOMS.get(env.ROOMS.idFromName(id));
export function internal(path: string, data?: unknown) {
  return new Request(
    `https://internal${path}`,
    data === undefined
      ? undefined
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        },
  );
}
export async function checked(response: Response) {
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new HttpError(
      response.status,
      data.error || "作品を保存できませんでした。",
    );
  }
  return response;
}
