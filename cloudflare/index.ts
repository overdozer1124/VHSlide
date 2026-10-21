import { directory, failure } from "./common.ts";
import type { Env } from "./common.ts";
export { Directory } from "./directory.ts";
export { SlideRoom } from "./room.ts";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url);
      const origin = env.PUBLIC_ORIGIN || url.origin;
      if (url.origin !== origin)
        return new Response("Not found", { status: 404 });
      if (
        (["POST", "PUT", "PATCH", "DELETE"].includes(request.method) ||
          request.headers.get("Upgrade")?.toLowerCase() === "websocket") &&
        request.headers.get("Origin") !== origin
      )
        return Response.json(
          { error: "このサイトから操作してください。" },
          { status: 403 },
        );
      const response =
        url.pathname === "/healthz"
          ? Response.json({ ok: true })
          : url.pathname.startsWith("/api/")
            ? await directory(env).fetch(request)
            : await env.ASSETS.fetch(request);
      if (response.status === 101) return response;
      const result = new Response(response.body, response);
      result.headers.set("X-Content-Type-Options", "nosniff");
      result.headers.set("Referrer-Policy", "no-referrer");
      result.headers.set(
        "Cross-Origin-Opener-Policy",
        "same-origin-allow-popups",
      );
      result.headers.set(
        "Content-Security-Policy",
        `default-src 'self'; script-src 'self' https://accounts.google.com; style-src 'self' 'unsafe-inline' https://accounts.google.com; img-src 'self' data: blob:; frame-src https://accounts.google.com; connect-src 'self' ${origin.replace(/^http/, "ws")} https://accounts.google.com; object-src 'none'; base-uri 'self'; frame-ancestors 'none'`,
      );
      if (url.pathname.startsWith("/api/"))
        result.headers.set("Cache-Control", "no-store");
      return result;
    } catch (error) {
      return failure(error);
    }
  },
} satisfies ExportedHandler<Env>;
