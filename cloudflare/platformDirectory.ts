import { createRemoteJWKSet, jwtVerify } from "jose";
import {
  InitialRegistrationError,
  applyPlatformApproval,
  durableOperatorSql,
} from "../src/stage1InitialRegistration.ts";
import { Directory } from "./directory.ts";
import { failure, HttpError, input, insist, json, sha } from "./common.ts";
import type { Env } from "./common.ts";

const keys = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs"),
);

type PlatformEnv = Env & {
  STAGE1_OPERATION_ID?: string;
  STAGE1_PURPOSE?: string;
  STAGE1_EXPIRES_AT?: string;
  STAGE1_SUBJECT?: string;
  STAGE1_ONE_TIME?: string;
};

/**
 * Directory for the one-operation temporary build only.
 * The normal Worker entry never routes `/platform/apply` here.
 */
export class PlatformDirectory extends Directory {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/platform/apply" && request.method === "POST") {
      try {
        return await this.apply(request);
      } catch (error) {
        return failure(error);
      }
    }
    return super.fetch(request);
  }

  private async apply(request: Request): Promise<Response> {
    const env = this.env as PlatformEnv;
    const purpose = env.STAGE1_PURPOSE;
    const expiresAt = Number(env.STAGE1_EXPIRES_AT);
    if (
      (purpose !== "bootstrap" && purpose !== "full-replace") ||
      !env.STAGE1_ENV_ID ||
      !env.STAGE1_OPERATION_ID ||
      !env.STAGE1_SUBJECT ||
      !env.STAGE1_ONE_TIME ||
      !Number.isFinite(expiresAt)
    ) {
      throw new HttpError(503, "対象環境が設定されていません。");
    }
    const data = await input(request);
    insist(
      typeof data.credential === "string",
      400,
      "サインイン情報を確認できません。",
    );
    let operator: { sub: string; nonce: string };
    try {
      const { payload } = await jwtVerify(data.credential, keys, {
        audience: [env.GOOGLE_CLIENT_ID, env.GOOGLE_SCHOOL_CLIENT_ID].filter(
          (value): value is string => !!value,
        ),
        issuer: ["https://accounts.google.com", "accounts.google.com"],
        algorithms: ["RS256"],
      });
      insist(
        payload.email_verified === true &&
          typeof payload.sub === "string" &&
          typeof payload.nonce === "string",
        401,
        "確認用の番号が無効です。",
      );
      operator = { sub: payload.sub, nonce: payload.nonce };
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(401, "Googleのサインインを確認できませんでした。");
    }
    const ctx =
      /(?:^|;\s*)vhslide_admin_ctx=([A-Za-z0-9_-]{43})(?:;|$)/.exec(
        request.headers.get("Cookie") || "",
      )?.[1] ?? null;
    const ctxHash = ctx ? await sha(ctx) : null;
    try {
      const result = this.ctx.storage.transactionSync(() =>
        applyPlatformApproval(durableOperatorSql(this.sql), {
          now: Date.now(),
          expiresAt,
          operationId: env.STAGE1_OPERATION_ID!,
          subject: operator.sub,
          nonce: operator.nonce,
          ctxHash,
          presented: {
            purpose: String(data.purpose ?? ""),
            envId: String(data.envId ?? ""),
            oneTime: String(data.oneTime ?? ""),
          },
          expected: {
            purpose,
            envId: env.STAGE1_ENV_ID!,
            oneTime: env.STAGE1_ONE_TIME!,
            subject: env.STAGE1_SUBJECT!,
          },
          auditId: crypto.randomUUID(),
        }),
      );
      return json(result);
    } catch (error) {
      if (error instanceof InitialRegistrationError)
        throw new HttpError(error.status, error.message);
      throw error;
    }
  }
}
