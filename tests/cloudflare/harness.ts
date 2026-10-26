import { Miniflare, createFetchMock } from "miniflare";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { readFile } from "node:fs/promises";
import { resolve, extname, dirname } from "node:path";

/** Only test processes own this signing key. Production verifies Google's JWKS. */
export async function harness(storage: string, origin: string, port?: number) {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const key = {
    ...(await exportJWK(publicKey)),
    kid: "test-google",
    alg: "RS256",
    use: "sig",
  };
  const sign = (id: string, audience = "test.apps.googleusercontent.com") =>
    new SignJWT({
      email: `${id}@example.test`,
      email_verified: true,
      name: id === "friend" ? "児童 友だち" : id,
    })
      .setProtectedHeader({ alg: "RS256", kid: key.kid })
      .setSubject(id)
      .setIssuer("https://accounts.google.com")
      .setAudience(audience)
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(privateKey);
  const start = (audit?: {
    scriptPath: string;
    hook: (request: any) => Promise<Response>;
  }) => {
    const mock = createFetchMock();
    mock.disableNetConnect();
    mock
      .get("https://www.googleapis.com")
      .intercept({ path: "/oauth2/v3/certs", method: "GET" })
      .reply(200, { keys: [key] })
      .persist();
    return new Miniflare({
      modules: true,
      scriptPath: audit?.scriptPath ?? ".wrangler-build/index.js",
      ...(audit ? { modulesRoot: dirname(audit.scriptPath) } : {}),
      compatibilityDate: "2026-08-01",
      host: "127.0.0.1",
      ...(port ? { port } : {}),
      bindings: {
        GOOGLE_CLIENT_ID: "test.apps.googleusercontent.com",
        PUBLIC_ORIGIN: origin,
      },
      durableObjects: {
        DIRECTORY: { className: "Directory", useSQLite: true },
        ROOMS: { className: "SlideRoom", useSQLite: true },
      },
      durableObjectsPersist: storage,
      fetchMock: mock,
      serviceBindings: {
        ...(audit ? { RECOVERY_AUDIT: audit.hook } : {}),
        ASSETS: async (request) => {
          const url = new URL(request.url);
          // Browser fixtures request a real test-signed JWT via this local-only service.
          if (port && url.pathname === "/__test/token")
            return new Response(
              await sign(url.searchParams.get("name") || "test"),
            );
          const root = resolve("dist"),
            path = resolve(root, `.${decodeURIComponent(url.pathname)}`);
          if (!path.startsWith(`${root}/`) && path !== root)
            return new Response("Not found", { status: 404 });
          let file = path,
            data: Buffer;
          try {
            data = await readFile(file);
          } catch {
            file = resolve(root, "index.html");
            data = await readFile(file);
          }
          const types: Record<string, string> = {
            ".html": "text/html",
            ".css": "text/css",
            ".js": "application/javascript",
            ".json": "application/json",
            ".svg": "image/svg+xml",
          };
          return new Response(data, {
            headers: {
              "Content-Type":
                types[extname(file)] || "application/octet-stream",
            },
          });
        },
      },
    });
  };
  return { start, sign };
}
