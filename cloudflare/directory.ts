import {
  galleryCommand,
  ensureEditGallery,
  pruneEditGallery,
} from "../src/responseGallery.ts";
import {
  worksheetSchema,
  worksheetList,
  worksheetCommand,
} from "../src/worksheets.ts";
import {
  surveySchema,
  surveyList,
  surveyCommand,
  SurveyError,
} from "../src/surveys.ts";
import {
  editSlideSchema,
  ensureEditSlideShape,
  editSlideList,
  editSlideAnswersMeta,
  editSlideAnswerContent,
  editSlideCommand,
  recordEditAnswerAsset,
  editAnswerAsset,
  takeEditShare,
  removeEditShare,
  followShareView,
  editSlideSource,
} from "../src/editSlides.ts";
import { feedbackCommand, feedbackList } from "../src/feedback.ts";
import { webbingSchema, webbingList, webbingCommand } from "../src/webbing.ts";
import {
  thinkingSchema,
  thinkingList,
  thinkingCommand,
  thinkingShareView,
} from "../src/thinkingTools.ts";
import {
  learningRecordFull,
  myLearningRecord,
} from "../src/learningRecord.ts";
import { prevAnswerFor } from "../src/prevAnswer.ts";
import { groupSchema, groupList, groupCommand } from "../src/groups.ts";
import {
  addUserApp,
  deleteUserApp,
  listUserApps,
  readUserAppHtml,
  userAppSchema,
} from "../src/userApps.ts";
import { featureVersion } from "../src/featureVersions.ts";
import {
  joinSchema,
  requestJoin,
  joinState,
  pendingJoins,
  decideJoins,
  pendingJoinCountSQL,
} from "../src/joinRequests.ts";
import {
  backupChanged,
  validCheckpoint,
  validDigest,
  revisionSchema,
  revisionQuery,
  restoreSchema,
  taskQuery,
  taskView,
  imageId,
  digestBytes,
} from "../src/backupProtocol.ts";
import {
  backupSnapshot,
  parseBackupSnapshot,
  BACKUP_METADATA_BYTES,
} from "../src/backupData.ts";
import {
  applyStage1OrgMigration,
  durableStage1OrgDb,
  usersPublicColumns,
} from "../src/stage1OrgSchema.ts";
import {
  InitialRegistrationError,
  acceptOperatorInvitation,
  applyStage1OperatorInviteMigration,
  applyStage1OperatorMigration,
  assignOperatorPublicIds,
  cancelOperatorInvitation,
  createOperatorInvitation,
  durableOperatorSql,
  issueAdminNonce,
  listOperatorInvitations,
  listOperators,
  operatorActionFromBody,
  performOperatorAction,
  revokeOperatorByPublicId,
} from "../src/stage1InitialRegistration.ts";
import { blank } from "../src/model.ts";
import type { SlideComment } from "../src/permissions.ts";
import {
  normalizeEmail,
  parseRecipients,
  sharedAccountNames,
} from "../src/preSharing.ts";
import { parseAccess } from "../src/permissions.ts";
import {
  generalDeckAccess,
  stage1FeaturesEnabled,
} from "../src/stage1Capabilities.ts";
import { writeAuditLog } from "../src/stage1Audit.ts";
import {
  bindPreregistrationsOnLogin,
  cancelPreregistration,
  canManageOrganizationPrereg,
  createPreregistration,
  durablePreregSql,
  PreregistrationError,
} from "../src/stage1Preregistration.ts";
import {
  applyForSchoolAdmin,
  decideSchoolAdminApplication,
  durableSchoolAdminSql,
  revokeSchoolAdmin,
  SchoolAdminError,
} from "../src/stage1SchoolAdmin.ts";
import {
  durableGenerationSql,
  invalidateOrganizationMember,
  reactivateOrganizationMember,
} from "../src/stage1Generation.ts";
import {
  consoleView,
  createSchool,
  operateEntry,
  durableOperateSql,
  listApplications,
  listMembers,
  listPreregistrations,
  OperateError,
} from "../src/stage1Operate.ts";
import { DurableObject } from "cloudflare:workers";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { parseDeck } from "../src/model.ts";
import type { Deck } from "../src/model.ts";
import { fromBase64 } from "../src/sharedDeck.ts";
import {
  body,
  checked,
  failure,
  HttpError,
  input,
  insist,
  internal,
  json,
  mime,
  one,
  randomToken,
  room,
  rows,
  sha,
  text,
} from "./common.ts";
import type { Env, Identity, User } from "./common.ts";

const keys = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs"),
);
const MAX_ASSETS = 5_000_000_000;
const MAX_USER_ASSETS = 500_000_000;
const BLOB_CHUNK = 64 * 1024;
interface Work {
  id: string;
  owner: string;
  title: string;
  updated: number;
  status: string;
}

/** Private account directory. Only the Worker and other bound objects can call it. */
export class Directory extends DurableObject<Env> {
  protected sql: SqlStorage;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS decks (id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES users(id), title TEXT NOT NULL, updated INTEGER NOT NULL, status TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS members (deck TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id), PRIMARY KEY(deck,user_id));
      CREATE TABLE IF NOT EXISTS grants (deck TEXT NOT NULL, user_id TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(deck,user_id), FOREIGN KEY(deck,user_id) REFERENCES members(deck,user_id) ON DELETE CASCADE);
      CREATE TABLE IF NOT EXISTS recipients (deck TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE, email TEXT NOT NULL, value TEXT NOT NULL, rank INTEGER NOT NULL, user_id TEXT, PRIMARY KEY(deck,email));
      CREATE INDEX IF NOT EXISTS recipients_email ON recipients(email);
      CREATE TABLE IF NOT EXISTS invites (hash TEXT PRIMARY KEY, deck TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE);
      CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY, deck TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE, owner TEXT NOT NULL, bytes INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS blobs (owner TEXT NOT NULL, hash TEXT NOT NULL, bytes INTEGER NOT NULL, mime TEXT NOT NULL, PRIMARY KEY(owner,hash));
      CREATE TABLE IF NOT EXISTS blob_chunks (owner TEXT NOT NULL, hash TEXT NOT NULL, part INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY(owner,hash,part));
      CREATE INDEX IF NOT EXISTS members_user ON members(user_id);
      CREATE INDEX IF NOT EXISTS assets_owner ON assets(owner);
      CREATE TABLE IF NOT EXISTS work_trash(deck TEXT PRIMARY KEY, created INTEGER NOT NULL, purging INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS rates (id TEXT PRIMARY KEY, n INTEGER NOT NULL, until INTEGER NOT NULL);
    `);
    if (
      ![
        ...this.sql.exec<{ name: string }>("PRAGMA table_info(work_trash)"),
      ].some((c) => c.name === "purging")
    )
      this.sql.exec(
        "ALTER TABLE work_trash ADD COLUMN purging INTEGER NOT NULL DEFAULT 0",
      );
    if (
      ![...this.sql.exec<{ name: string }>("PRAGMA table_info(assets)")].some(
        (c) => c.name === "hash",
      )
    )
      this.sql.exec("ALTER TABLE assets ADD COLUMN hash TEXT");
    this.sql.exec(joinSchema);
    this.sql.exec(surveySchema);
    this.sql.exec(editSlideSchema);
    ensureEditSlideShape((query, ...args) => this.sql.exec(query, ...args));
    this.sql.exec(worksheetSchema);
    this.sql.exec(webbingSchema);
    this.sql.exec(groupSchema);
    this.sql.exec(thinkingSchema);
    this.sql.exec(userAppSchema);
    this.sql.exec(revisionSchema("directory") + restoreSchema);
    this.sql
      .exec(`INSERT OR IGNORE INTO restore_tasks(id,owner,request_key,content_hash,apply_sharing,title,status,created)
      SELECT id,owner,'legacy:'||id,'',-1,title,'uploading',updated FROM decks WHERE status='restoring'`);
    applyStage1OrgMigration(durableStage1OrgDb(this.sql));
    applyStage1OperatorMigration(durableStage1OrgDb(this.sql));
    applyStage1OperatorInviteMigration(durableStage1OrgDb(this.sql));
    assignOperatorPublicIds(durableOperatorSql(this.sql), () =>
      crypto.randomUUID(),
    );
  }
  private revision(id: string) {
    return (
      one<{ revision: string }>(this.sql, revisionQuery, id)?.revision ?? "0"
    );
  }
  private task(id: string, owner: string) {
    const row = one<Record<string, unknown>>(
      this.sql,
      taskQuery + " WHERE id=? AND owner=?",
      id,
      owner,
    );
    insist(row, 404, "復元ジョブが見つかりません。");
    return taskView(row);
  }
  private rate(id: string, max: number) {
    const now = Date.now();
    const prior = one<{ n: number; until: number }>(
      this.sql,
      "SELECT n,until FROM rates WHERE id=?",
      id,
    );
    insist(
      !prior || prior.until <= now || prior.n < max,
      429,
      "操作が多いため、少し待ってからお試しください。",
    );
    this.sql.exec(
      "INSERT INTO rates VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET n=excluded.n,until=excluded.until",
      id,
      prior && prior.until > now ? prior.n + 1 : 1,
      prior && prior.until > now ? prior.until : now + 60_000,
    );
  }
  private async identity(request: Request): Promise<Identity> {
    const raw = /(?:^|;\s*)vhslide_session=([A-Za-z0-9_-]{43})(?:;|$)/.exec(
      request.headers.get("Cookie") || "",
    )?.[1];
    const session = raw ? await sha(raw) : "";
    const found = one<User & { expires: number }>(
      this.sql,
      `SELECT ${usersPublicColumns},sessions.expires FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.hash=? AND expires>?`,
      session,
      Date.now(),
    );
    insist(found, 401, "Googleアカウントでサインインしてください。");
    return {
      user: { id: found.id, name: found.name, email: found.email },
      expires: found.expires,
      session,
    };
  }
  private access(
    id: string,
    user: User,
    ownerOnly = false,
    incomplete = false,
  ) {
    const work = one<Work>(
      this.sql,
      "SELECT decks.* FROM decks JOIN members ON members.deck=decks.id WHERE decks.id=? AND members.user_id=?",
      id,
      user.id,
    );
    insist(
      work &&
        (!ownerOnly || work.owner === user.id) &&
        (work.status === "ready" || (incomplete && work.owner === user.id)) &&
        (!one(this.sql, "SELECT deck FROM work_trash WHERE deck=?", id) ||
          (incomplete && work.owner === user.id)),
      404,
      "作品が見つからないか、参加する権限がありません。",
    );
    return work;
  }
  private permissions(id: string, user: string, owner: string) {
    const grant = one<{ value: string }>(
      this.sql,
      "SELECT value FROM grants WHERE deck=? AND user_id=?",
      id,
      user,
    );
    const isMember = !!one(
      this.sql,
      "SELECT 1 AS ok FROM members WHERE deck=? AND user_id=?",
      id,
      user,
    );
    return generalDeckAccess({
      deckId: id,
      userId: user,
      ownerId: owner,
      isMember,
      grantJson: grant?.value,
    }).access;
  }
  private async claim(user: User) {
    const pending = rows<{ deck: string; email: string; value: string }>(
      this.sql,
      "SELECT recipients.deck,recipients.email,recipients.value FROM recipients JOIN decks ON decks.id=recipients.deck WHERE recipients.email=? AND recipients.user_id IS NULL AND decks.status='ready' AND decks.owner<>?",
      normalizeEmail(user.email),
      user.id,
    );
    for (const recipient of pending) {
      let value: string | undefined;
      this.ctx.storage.transactionSync(() => {
        const current = one<{ value: string }>(
          this.sql,
          "SELECT recipients.value FROM recipients JOIN decks ON decks.id=recipients.deck WHERE recipients.deck=? AND recipients.email=? AND recipients.user_id IS NULL AND decks.status='ready' AND decks.owner<>?",
          recipient.deck,
          recipient.email,
          user.id,
        );
        if (!current) return;
        value = current.value;
        this.sql.exec(
          "INSERT OR IGNORE INTO members VALUES(?,?)",
          recipient.deck,
          user.id,
        );
        this.sql.exec(
          "INSERT INTO grants VALUES(?,?,?) ON CONFLICT(deck,user_id) DO UPDATE SET value=excluded.value",
          recipient.deck,
          user.id,
          value,
        );
        this.sql.exec(
          "UPDATE recipients SET user_id=? WHERE deck=? AND email=? AND user_id IS NULL",
          user.id,
          recipient.deck,
          recipient.email,
        );
      });
      if (value)
        await checked(
          await room(this.env, recipient.deck).fetch(
            internal("/permissions", {
              user: user.id,
              access: JSON.parse(value),
            }),
          ),
        );
    }
  }
  private recipientList(id: string) {
    return rows<{
      email: string;
      value: string;
      user_id: string | null;
      name: string | null;
    }>(
      this.sql,
      "SELECT recipients.email,recipients.value,recipients.user_id,users.name FROM recipients LEFT JOIN users ON users.id=recipients.user_id WHERE deck=? ORDER BY recipients.rank,recipients.email",
      id,
    ).map((r) => ({
      email: r.email,
      access: JSON.parse(r.value),
      ...(r.user_id ? { userId: r.user_id, name: r.name } : {}),
    }));
  }
  /** Bytes charged against the photo quota. Deduplicated blobs count once
   * per owner; legacy assets (hash IS NULL, saved before dedup) count
   * individually until their deck is deleted. */
  private assetUsage(owner?: string) {
    const blob = owner
      ? one<{ n: number }>(
          this.sql,
          "SELECT COALESCE(SUM(bytes),0) AS n FROM blobs WHERE owner=?",
          owner,
        )
      : one<{ n: number }>(
          this.sql,
          "SELECT COALESCE(SUM(bytes),0) AS n FROM blobs",
        );
    const legacy = owner
      ? one<{ n: number }>(
          this.sql,
          "SELECT COALESCE(SUM(bytes),0) AS n FROM assets WHERE owner=? AND hash IS NULL",
          owner,
        )
      : one<{ n: number }>(
          this.sql,
          "SELECT COALESCE(SUM(bytes),0) AS n FROM assets WHERE hash IS NULL",
        );
    return blob!.n + legacy!.n;
  }
  /** Drop a blob whose last referencing asset row is gone. Caller must have
   * already removed the asset rows inside the same transaction. */
  private releaseBlob(owner: string, hash: string) {
    // Both referencing tables count: deck assets and edit-slide
    // answer photos (whose blobs are owned by the deck's owner).
    const refs = one<{ n: number }>(
      this.sql,
      "SELECT (SELECT COUNT(*) FROM assets WHERE owner=? AND hash=?) + (SELECT COUNT(*) FROM edit_slide_answer_assets aa JOIN edit_slide_defs d ON d.id=aa.def JOIN decks dk ON dk.id=d.deck WHERE dk.owner=? AND aa.hash=?) + (SELECT COUNT(*) FROM edit_slide_share_assets sa JOIN edit_slide_answer_assets aa2 ON aa2.asset=sa.asset JOIN edit_slide_defs d2 ON d2.id=aa2.def JOIN decks dk2 ON dk2.id=d2.deck WHERE dk2.owner=? AND aa2.hash=?) AS n",
      owner,
      hash,
      owner,
      hash,
      owner,
      hash,
    )!;
    if (refs.n) return;
    this.sql.exec(
      "DELETE FROM blob_chunks WHERE owner=? AND hash=?",
      owner,
      hash,
    );
    this.sql.exec("DELETE FROM blobs WHERE owner=? AND hash=?", owner, hash);
  }
  private storeBlob(
    owner: string,
    hash: string,
    type: string,
    bytes: Uint8Array,
  ) {
    this.sql.exec(
      "INSERT OR IGNORE INTO blobs VALUES(?,?,?,?)",
      owner,
      hash,
      bytes.length,
      type,
    );
    for (let i = 0; i < bytes.length; i += BLOB_CHUNK)
      this.sql.exec(
        "INSERT OR IGNORE INTO blob_chunks VALUES(?,?,?,?)",
        owner,
        hash,
        i / BLOB_CHUNK,
        bytes.slice(i, i + BLOB_CHUNK).buffer,
      );
  }
  /** Store one answer photo's bytes in the shared blob pool (the
   * same deduplication as deck photos, but the binding lives only
   * in the edit-slide tables — the deck's asset table and the room
   * never learn about it). Returns the dedicated read path. The
   * quota check, blob store and binding all happen in one
   * transaction, so a refused binding stores nothing. */
  private async saveAnswerAsset(
    work: Work,
    user: User,
    defId: string,
    bytes: Uint8Array,
  ) {
    const type = mime(bytes);
    insist(
      type && bytes.length <= 6_000_000,
      400,
      "6MB以下のPNG・JPEG・WebP・GIF画像を選んでください。",
    );
    const hash = await digestBytes(bytes);
    const asset = crypto.randomUUID();
    this.ctx.storage.transactionSync(() => {
      const known = one(
        this.sql,
        "SELECT hash FROM blobs WHERE owner=? AND hash=?",
        work.owner,
        hash,
      );
      if (!known) {
        insist(
          this.assetUsage() + bytes.length <= MAX_ASSETS,
          413,
          "アプリ全体の写真の保存容量の上限です（5GB）。不要な作品を整理してください。",
        );
        insist(
          this.assetUsage(work.owner) + bytes.length <= MAX_USER_ASSETS,
          413,
          "先生の写真の保存容量の上限です（500MB）。不要な作品を整理してください。",
        );
        this.storeBlob(work.owner, hash, type!, bytes);
      }
      const sql = (query: string, ...args: (string | number)[]) =>
        this.sql.exec(query, ...args);
      recordEditAnswerAsset(
        sql,
        work.id,
        user.id,
        defId,
        asset,
        hash,
        bytes.length,
        type!,
      );
    });
    return `/api/decks/${work.id}/edit-slides/${defId}/answer-assets/${asset}`;
  }
  private removeWork(id: string) {
    this.ctx.storage.transactionSync(() => {
      const shared = rows<{ owner: string; hash: string }>(
        this.sql,
        "SELECT DISTINCT owner,hash FROM assets WHERE deck=? AND hash IS NOT NULL",
        id,
      );
      this.sql.exec("DELETE FROM assets WHERE deck=?", id);
      for (const blob of shared) this.releaseBlob(blob.owner, blob.hash);
      // Edit-slide answer photos: rows out, then their blobs
      // released under the deck owner's account.
      const deckRow = one<{ owner: string }>(
        this.sql,
        "SELECT owner FROM decks WHERE id=?",
        id,
      );
      const answerHashes = rows<{ hash: string }>(
        this.sql,
        "SELECT DISTINCT aa.hash AS hash FROM edit_slide_answer_assets aa JOIN edit_slide_defs d ON d.id=aa.def WHERE d.deck=?",
        id,
      );
      this.sql.exec(
        "DELETE FROM edit_slide_share_assets WHERE share IN (SELECT id FROM edit_slide_shares WHERE deck=?)",
        id,
      );
      this.sql.exec("DELETE FROM edit_slide_shares WHERE deck=?", id);
      this.sql.exec(
        "DELETE FROM edit_slide_answer_assets WHERE def IN (SELECT id FROM edit_slide_defs WHERE deck=?)",
        id,
      );
      this.sql.exec(
        "DELETE FROM edit_slide_answers WHERE def IN (SELECT id FROM edit_slide_defs WHERE deck=?)",
        id,
      );
      this.sql.exec("DELETE FROM edit_slide_defs WHERE deck=?", id);
      this.sql.exec("DELETE FROM form_feedback WHERE deck=?", id);
      if (deckRow)
        for (const row of answerHashes)
          this.releaseBlob(deckRow.owner, row.hash);
      this.sql.exec("DELETE FROM invites WHERE deck=?", id);
      this.sql.exec("DELETE FROM recipients WHERE deck=?", id);
      this.sql.exec("DELETE FROM grants WHERE deck=?", id);
      this.sql.exec("DELETE FROM members WHERE deck=?", id);
      this.sql.exec("DELETE FROM join_requests WHERE deck=?", id);
      this.sql.exec("DELETE FROM work_trash WHERE deck=?", id);
      this.sql.exec("DELETE FROM decks WHERE id=?", id);
    });
  }
  private async saveAsset(
    work: Work,
    bytes: Uint8Array,
    user: User,
    assetId?: string,
  ) {
    const current = one<Work>(
      this.sql,
      "SELECT decks.* FROM decks JOIN members ON members.deck=decks.id WHERE decks.id=? AND members.user_id=?",
      work.id,
      user.id,
    );
    insist(
      current &&
        (["creating", "ready"].includes(current.status) ||
          (current.status === "restoring" && current.owner === user.id)),
      404,
      "作品が見つからないか、参加する権限がありません。",
    );
    const type = mime(bytes);
    insist(
      type && bytes.length <= 6_000_000,
      400,
      "6MB以下のPNG・JPEG・WebP・GIF画像を選んでください。",
    );
    const asset = assetId ?? crypto.randomUUID();
    const existing = one<{ hash: string | null }>(
      this.sql,
      "SELECT hash FROM assets WHERE id=? AND deck=?",
      asset,
      work.id,
    );
    const url = `/api/decks/${work.id}/assets/${asset}`;
    if (existing && existing.hash === null) {
      // Legacy per-deck copy (saved before dedup): keep the room-stored
      // bytes authoritative and preserve the old retry behaviour.
      try {
        await checked(
          await room(this.env, work.id).fetch(
            new Request(`https://internal/assets/${asset}`, {
              method: "POST",
              headers: { "Content-Type": type, "X-Uploaded-By": user.id },
              body: bytes,
            }),
          ),
        );
      } catch (error) {
        // The row predates this call; never delete it here.
        throw error;
      }
      return url;
    }
    const hash = await digestBytes(bytes);
    if (existing && existing.hash !== hash)
      // An id was reused with different bytes: drop the stale binding
      // before rebinding so the old blob can be released below.
      this.ctx.storage.transactionSync(() => {
        this.sql.exec("DELETE FROM assets WHERE id=?", asset);
        this.releaseBlob(work.owner, existing.hash!);
      });
    if (existing && existing.hash === hash) {
      // Retry of an upload that already bound this exact image: make sure
      // the shared copy survived, then finish without charging quota again.
      this.ctx.storage.transactionSync(() => {
        if (
          !one(
            this.sql,
            "SELECT hash FROM blobs WHERE owner=? AND hash=?",
            work.owner,
            hash,
          )
        )
          this.storeBlob(work.owner, hash, type!, bytes);
      });
      await this.announceAsset(work, asset, type!, bytes.length, user);
      return url;
    }
    // Check and reserve in one transaction: concurrent uploads cannot
    // overrun the account/owner quota, and identical images are stored
    // (and charged) only once per owner.
    this.ctx.storage.transactionSync(() => {
      const known = one(
        this.sql,
        "SELECT hash FROM blobs WHERE owner=? AND hash=?",
        work.owner,
        hash,
      );
      if (!known) {
        insist(
          this.assetUsage() + bytes.length <= MAX_ASSETS &&
            this.assetUsage(work.owner) + bytes.length <= MAX_USER_ASSETS,
          413,
          "写真の保存容量の上限です（作成者ごと500MB・アプリ全体5GB）。不要な作品を整理してください。",
        );
        this.storeBlob(work.owner, hash, type!, bytes);
      }
      this.sql.exec(
        "INSERT INTO assets VALUES(?,?,?,?,?)",
        asset,
        work.id,
        work.owner,
        bytes.length,
        hash,
      );
    });
    try {
      await this.announceAsset(work, asset, type!, bytes.length, user);
    } catch (error) {
      if (!assetId)
        this.ctx.storage.transactionSync(() => {
          this.sql.exec("DELETE FROM assets WHERE id=?", asset);
          this.releaseBlob(work.owner, hash);
        });
      throw error;
    }
    return url;
  }
  /** Record a deduplicated image in its deck's room (binding only: id,
   * type, size, uploader). The room needs the binding for document
   * validation and media visibility; the bytes stay in the directory. */
  private async announceAsset(
    work: Work,
    asset: string,
    type: string,
    size: number,
    user: User,
  ) {
    await checked(
      await room(this.env, work.id).fetch(
        new Request(`https://internal/assets/${asset}`, {
          method: "POST",
          headers: {
            "Content-Type": type,
            "X-Uploaded-By": user.id,
            "X-Shared-Blob": "1",
            "X-Shared-Bytes": String(size),
          },
          body: new Uint8Array(0),
        }),
      ),
    );
  }
  async fetch(request: Request): Promise<Response> {
    try {
      const path = new URL(request.url).pathname;
      if (
        (path === "/api/restores" && request.method === "POST") ||
        (/^\/api\/decks\/[a-f0-9-]{36}(?:\/(?:restore|trash|untrash))?$/.test(
          path,
        ) &&
          ["POST", "DELETE"].includes(request.method)) ||
        (request.method === "POST" && request.headers.has("X-Restore-Image"))
      ) {
        // Do not hold the Directory input gate while a slow client sends its body.
        const identity = await this.identity(request);
        const target = /^\/api\/decks\/([a-f0-9-]{36})/.exec(path);
        let denied: unknown;
        if (target) {
          try {
            this.access(target[1], identity.user, true, true);
          } catch (error) {
            // A known owner may replay a cancelled job with a request body.
            // Drain only this authenticated, bounded request before returning
            // its 404; otherwise workerd can reset the upload connection.
            if (
              !one(
                this.sql,
                "SELECT id FROM restore_tasks WHERE id=? AND owner=?",
                target[1],
                identity.user.id,
              )
            )
              throw error;
            this.rate(`api:${identity.user.id}`, 120);
            denied = error;
          }
        }
        const maximum =
          request.method === "DELETE"
            ? 20_000
            : request.headers.has("X-Restore-Image")
              ? 6_000_000
              : path === "/api/restores"
                ? 20_000
                : BACKUP_METADATA_BYTES + 1000;
        const bytes = await body(request, maximum);
        if (denied) throw denied;
        const buffered = new Request(request.url, {
          method: request.method,
          headers: request.headers,
          body: new Uint8Array(bytes).buffer,
        });
        return await this.ctx.blockConcurrencyWhile(async () => {
          try {
            return await this.handle(buffered);
          } catch (error) {
            return failure(error);
          }
        });
      }
      return await this.handle(request);
    } catch (error) {
      return failure(error);
    }
  }
  private async handle(request: Request): Promise<Response> {
    const url = new URL(request.url),
      path = url.pathname,
      method = request.method;
    if (path === "/platform/apply" || path.startsWith("/admin/"))
      throw new HttpError(404, "見つかりません。");
    if (path.startsWith("/api/stage1/") && !stage1FeaturesEnabled(this.env))
      throw new HttpError(404, "見つかりません。");
    if (path === "/internal/authorize" && method === "POST") {
      const data = await input(request);
      const active = one(
        this.sql,
        "SELECT sessions.hash FROM sessions JOIN members ON members.user_id=sessions.user_id JOIN decks ON decks.id=members.deck WHERE sessions.hash=? AND sessions.user_id=? AND sessions.expires>? AND members.deck=? AND decks.status='ready' AND NOT EXISTS(SELECT 1 FROM work_trash WHERE deck=decks.id)",
        data.session,
        data.user,
        Date.now(),
        data.room,
      );
      insist(
        active,
        401,
        "サインインし直すか、作品への参加権限を確認してください。",
      );
      const work = one<Work>(
        this.sql,
        "SELECT * FROM decks WHERE id=?",
        data.room,
      )!;
      return json({
        access: this.permissions(data.room, data.user, work.owner),
        host: work.owner === data.user,
      });
    }
    if (path === "/internal/touched" && method === "POST") {
      const data = await input(request);
      this.sql.exec(
        "UPDATE decks SET title=?,updated=? WHERE id=? AND status='ready'",
        String(data.title).slice(0, 200),
        Date.now(),
        data.id,
      );
      return json({ ok: true });
    }
    if (path === "/api/config" && method === "GET")
      return json({
        clientId: this.env.GOOGLE_CLIENT_ID,
        schoolClientId: this.env.GOOGLE_SCHOOL_CLIENT_ID || "",
        schoolDomain: this.env.GOOGLE_SCHOOL_DOMAIN || "",
        enabled: !!this.env.GOOGLE_CLIENT_ID,
        syncIntervalMs: 1000,
        notice:
          "写真は作成者ごと500MB・全体5GBまで。同じ写真は1回だけ数えます。授業の終わりにはJSONも保存してください。",
      });
    if (path === "/api/usage" && method === "GET") {
      const { user } = await this.identity(request);
      return json({
        used: this.assetUsage(user.id),
        limit: MAX_USER_ASSETS,
        totalUsed: this.assetUsage(),
        totalLimit: MAX_ASSETS,
      });
    }
    if (path === "/api/session" && method === "GET") {
      try {
        return json({ user: (await this.identity(request)).user });
      } catch (error) {
        if (error instanceof HttpError && error.status === 401)
          return json({ user: null });
        throw error;
      }
    }
    // Uploaded user apps are public by unguessable id and served isolated:
    // the sandbox CSP (no allow-same-origin) gives the document an opaque
    // origin, so it can never reach this app's data or session.
    const pubApp = /^\/api\/pub\/apps\/([a-f0-9-]{36})$/.exec(path);
    if (pubApp && method === "GET") {
      const html = readUserAppHtml(
        (query, ...args) => this.sql.exec(query, ...args),
        pubApp[1],
      );
      if (html === null) return new Response("Not found", { status: 404 });
      return new Response(html, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Security-Policy":
            "sandbox allow-scripts allow-forms allow-popups allow-modals allow-downloads",
          "Cache-Control": "no-store",
        },
      });
    }
    if (
      stage1FeaturesEnabled(this.env) &&
      path === "/api/stage1/operators/nonce" &&
      method === "POST"
    ) {
      const nonceValue = randomToken();
      const ctx = randomToken();
      issueAdminNonce(durableOperatorSql(this.sql), {
        nonce: nonceValue,
        ctxHash: await sha(ctx),
        expiresAt: Date.now() + 5 * 60_000,
      });
      const secure = (this.env.PUBLIC_ORIGIN || url.origin).startsWith("https:")
        ? "; Secure"
        : "";
      return json({ nonce: nonceValue }, 200, {
        "Set-Cookie": `vhslide_admin_ctx=${ctx}; Path=/; HttpOnly; SameSite=Strict; Max-Age=300${secure}`,
      });
    }
    if (
      stage1FeaturesEnabled(this.env) &&
      /^\/api\/stage1\/operators\/(add|revoke|rotate)(-by-sign-in)?$/.test(path)
    )
      throw new HttpError(404, "見つかりません。");
    const readOperatorCredential = async (credential: unknown) => {
      insist(
        typeof credential === "string",
        400,
        "サインイン情報を確認できません。",
      );
      try {
        const { payload } = await jwtVerify(credential, keys, {
          audience: [
            this.env.GOOGLE_CLIENT_ID,
            this.env.GOOGLE_SCHOOL_CLIENT_ID,
          ].filter((value): value is string => !!value),
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
        return { sub: payload.sub, nonce: payload.nonce };
      } catch (error) {
        if (error instanceof HttpError) throw error;
        throw new HttpError(401, "Googleのサインインを確認できませんでした。");
      }
    };
    const operatorCtxHash = async () => {
      const ctx =
        /(?:^|;\s*)vhslide_admin_ctx=([A-Za-z0-9_-]{43})(?:;|$)/.exec(
          request.headers.get("Cookie") || "",
        )?.[1] ?? null;
      return ctx ? await sha(ctx) : null;
    };
    if (
      stage1FeaturesEnabled(this.env) &&
      path === "/api/stage1/operators/invitations" &&
      method === "POST"
    ) {
      const data = await input(request);
      const actor = await readOperatorCredential(data.credential);
      const ctxHash = await operatorCtxHash();
      try {
        const invitation = this.ctx.storage.transactionSync(() =>
          createOperatorInvitation(durableOperatorSql(this.sql), {
            id: crypto.randomUUID(),
            email: String(data.email ?? ""),
            actor: actor.sub,
            nonce: actor.nonce,
            ctxHash,
            now: Date.now(),
            envId: this.env.STAGE1_ENV_ID || "",
            auditId: crypto.randomUUID(),
          }),
        );
        return json({ invitation }, 201);
      } catch (error) {
        if (error instanceof InitialRegistrationError)
          throw new HttpError(error.status, error.message);
        throw error;
      }
    }
    const invitationId =
      /^\/api\/stage1\/operators\/invitations\/([^/]+)$/.exec(path);
    if (
      stage1FeaturesEnabled(this.env) &&
      invitationId &&
      method === "DELETE"
    ) {
      const data = await input(request);
      const actor = await readOperatorCredential(data.credential);
      const ctxHash = await operatorCtxHash();
      try {
        this.ctx.storage.transactionSync(() =>
          cancelOperatorInvitation(durableOperatorSql(this.sql), {
            id: invitationId[1],
            actor: actor.sub,
            nonce: actor.nonce,
            ctxHash,
            now: Date.now(),
            envId: this.env.STAGE1_ENV_ID || "",
            auditId: crypto.randomUUID(),
          }),
        );
        return json({ ok: true });
      } catch (error) {
        if (error instanceof InitialRegistrationError)
          throw new HttpError(error.status, error.message);
        throw error;
      }
    }
    const revokeOperator = /^\/api\/stage1\/operators\/([^/]+)\/revoke$/.exec(
      path,
    );
    if (
      stage1FeaturesEnabled(this.env) &&
      revokeOperator &&
      method === "POST"
    ) {
      const data = await input(request);
      const actor = await readOperatorCredential(data.credential);
      const ctxHash = await operatorCtxHash();
      try {
        const result = this.ctx.storage.transactionSync(() =>
          revokeOperatorByPublicId(durableOperatorSql(this.sql), {
            publicId: revokeOperator[1],
            expectedGeneration: Number(data.expectedGeneration),
            actor: actor.sub,
            nonce: actor.nonce,
            ctxHash,
            now: Date.now(),
            envId: this.env.STAGE1_ENV_ID || "",
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
    const operatorKind =
      /^\/api\/stage1\/(?:operators\/verify|super-admin\/(bind|recover))$/.exec(
        path,
      );
    if (stage1FeaturesEnabled(this.env) && operatorKind && method === "POST") {
      const kind = path.endsWith("/verify") ? "verify" : operatorKind[1];
      const data = await input(request);
      insist(
        typeof data.credential === "string",
        400,
        "サインイン情報を確認できません。",
      );
      let operator: { sub: string; nonce: string };
      try {
        const { payload } = await jwtVerify(data.credential, keys, {
          audience: [
            this.env.GOOGLE_CLIENT_ID,
            this.env.GOOGLE_SCHOOL_CLIENT_ID,
          ].filter((value): value is string => !!value),
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
        const action = operatorActionFromBody(
          kind,
          data as Record<string, unknown>,
        );
        const result = this.ctx.storage.transactionSync(() =>
          performOperatorAction(durableOperatorSql(this.sql), {
            action,
            actor: operator.sub,
            nonce: operator.nonce,
            ctxHash,
            now: Date.now(),
            envId: this.env.STAGE1_ENV_ID || "",
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
    const origin = this.env.PUBLIC_ORIGIN || url.origin;
    const cookie = (raw: string, age: number) =>
      `vhslide_session=${raw}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${origin.startsWith("https:") ? "; Secure" : ""}`;
    if (path === "/api/auth/google" && method === "POST") {
      insist(this.env.GOOGLE_CLIENT_ID, 503, "クラウド機能は準備中です。");
      this.rate(
        `login:${request.headers.get("CF-Connecting-IP") || "unknown"}`,
        120,
      );
      const data = await input(request);
      insist(
        typeof data.credential === "string",
        400,
        "サインイン情報を確認できません。",
      );
      let user: User;
      try {
        const { payload } = await jwtVerify(data.credential, keys, {
          audience: [
            this.env.GOOGLE_CLIENT_ID,
            this.env.GOOGLE_SCHOOL_CLIENT_ID,
          ].filter((value): value is string => !!value),
          issuer: ["https://accounts.google.com", "accounts.google.com"],
          algorithms: ["RS256"],
        });
        insist(
          payload.email_verified === true &&
            typeof payload.sub === "string" &&
            typeof payload.email === "string",
          401,
          "Googleアカウントを確認できませんでした。",
        );
        user = {
          id: payload.sub,
          name: String(payload.name ?? payload.email).slice(0, 100),
          email: payload.email.slice(0, 320),
        };
      } catch {
        throw new HttpError(
          401,
          "Googleのサインインを確認できませんでした。もう一度お試しください。",
        );
      }
      const raw = randomToken(),
        hash = await sha(raw);
      this.ctx.storage.transactionSync(() => {
        this.sql.exec(
          "INSERT INTO users(id,name,email) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,email=excluded.email",
          user.id,
          user.name,
          user.email,
        );
        if (stage1FeaturesEnabled(this.env))
          bindPreregistrationsOnLogin(durablePreregSql(this.sql), {
            userId: user.id,
            email: user.email,
            emailVerified: true,
          });
        this.sql.exec(
          "INSERT INTO sessions VALUES(?,?,?)",
          hash,
          user.id,
          Date.now() + 7 * 86400_000,
        );
      });
      if ((await this.ctx.storage.getAlarm()) === null)
        await this.ctx.storage.setAlarm(Date.now() + 86400_000);
      return json({ user }, 200, { "Set-Cookie": cookie(raw, 7 * 86400) });
    }
    const identity = await this.identity(request),
      user = identity.user;
    if (path !== "/api/logout") await this.claim(user);
    if (
      stage1FeaturesEnabled(this.env) &&
      path === "/api/stage1/console" &&
      method === "GET"
    )
      return json(consoleView(durableOperateSql(this.sql), user.id));
    if (
      stage1FeaturesEnabled(this.env) &&
      path === "/api/stage1/operate-entry" &&
      method === "GET"
    ) {
      try {
        return json(operateEntry(durableOperateSql(this.sql), user.id));
      } catch (error) {
        if (error instanceof OperateError)
          throw new HttpError(error.status, error.message);
        throw error;
      }
    }
    if (
      stage1FeaturesEnabled(this.env) &&
      path === "/api/stage1/operators" &&
      method === "GET"
    ) {
      if (
        !one(
          this.sql,
          "SELECT public_id FROM stage1_operators WHERE subject=?",
          user.id,
        )
      )
        throw new HttpError(403, "運営者として登録されていません。");
      const generation = one<{ value: string }>(
        this.sql,
        "SELECT value FROM stage1_operator_meta WHERE key='generation'",
      );
      return json({
        operators: listOperators(durableOperatorSql(this.sql)),
        generation: Number(generation?.value ?? 0),
      });
    }
    if (
      stage1FeaturesEnabled(this.env) &&
      path === "/api/stage1/operators/invitations" &&
      method === "GET"
    ) {
      if (
        !one(
          this.sql,
          "SELECT public_id FROM stage1_operators WHERE subject=?",
          user.id,
        )
      )
        throw new HttpError(403, "運営者として登録されていません。");
      return json({
        invitations: listOperatorInvitations(
          durableOperatorSql(this.sql),
          Date.now(),
        ),
      });
    }
    const acceptInvitation =
      /^\/api\/stage1\/operators\/invitations\/([^/]+)\/accept$/.exec(path);
    if (
      stage1FeaturesEnabled(this.env) &&
      acceptInvitation &&
      method === "POST"
    ) {
      try {
        const result = this.ctx.storage.transactionSync(() =>
          acceptOperatorInvitation(durableOperatorSql(this.sql), {
            id: acceptInvitation[1],
            userId: user.id,
            email: user.email,
            publicId: crypto.randomUUID(),
            now: Date.now(),
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
    if (
      stage1FeaturesEnabled(this.env) &&
      path === "/api/organizations" &&
      method === "POST"
    ) {
      const data = await input(request, 20_000);
      insist(
        typeof data.name === "string",
        400,
        "学校の名前を確認してください。",
      );
      try {
        const school = this.ctx.storage.transactionSync(() =>
          createSchool(durableOperateSql(this.sql), {
            id: crypto.randomUUID(),
            name: data.name,
            actorId: user.id,
            now: Date.now(),
            auditId: crypto.randomUUID(),
          }),
        );
        return json({ school }, 201);
      } catch (error) {
        if (error instanceof OperateError)
          throw new HttpError(error.status, error.message);
        throw error;
      }
    }
    if (
      stage1FeaturesEnabled(this.env) &&
      path === "/api/organizations" &&
      method === "GET"
    ) {
      const view = consoleView(durableOperateSql(this.sql), user.id);
      insist(
        view.createSchool || view.schools.length > 0,
        403,
        "学校の一覧を見る権限がありません。",
      );
      return json({
        schools: view.createSchool
          ? view.applyTo
          : view.schools.map((school) => ({
              id: school.id,
              name: school.name,
            })),
      });
    }
    const preregList = /^\/api\/organizations\/([^/]+)\/preregistrations$/.exec(
      path,
    );
    if (stage1FeaturesEnabled(this.env) && preregList && method === "GET") {
      const organizationId = decodeURIComponent(preregList[1]);
      insist(
        canManageOrganizationPrereg(
          durablePreregSql(this.sql),
          user.id,
          organizationId,
        ),
        403,
        "この学校の事前登録を見る権限がありません。",
      );
      return json({
        preregistrations: listPreregistrations(
          durableOperateSql(this.sql),
          organizationId,
        ),
      });
    }
    const applicationList =
      /^\/api\/organizations\/([^/]+)\/school-admin-applications$/.exec(path);
    if (
      stage1FeaturesEnabled(this.env) &&
      applicationList &&
      method === "GET"
    ) {
      const organizationId = decodeURIComponent(applicationList[1]);
      insist(
        consoleView(durableOperateSql(this.sql), user.id).decideApplications,
        403,
        "申請を確認できるのはスーパー管理者だけです。",
      );
      return json({
        applications: listApplications(
          durableOperateSql(this.sql),
          organizationId,
        ),
      });
    }
    const memberList = /^\/api\/organizations\/([^/]+)\/members$/.exec(path);
    if (stage1FeaturesEnabled(this.env) && memberList && method === "GET") {
      const organizationId = decodeURIComponent(memberList[1]);
      insist(
        canManageOrganizationPrereg(
          durablePreregSql(this.sql),
          user.id,
          organizationId,
        ),
        403,
        "この学校の所属を見る権限がありません。",
      );
      return json({
        members: listMembers(durableOperateSql(this.sql), organizationId),
      });
    }
    const orgPrereg = /^\/api\/organizations\/([^/]+)\/preregistrations$/.exec(
      path,
    );
    if (stage1FeaturesEnabled(this.env) && orgPrereg && method === "POST") {
      const organizationId = decodeURIComponent(orgPrereg[1]);
      insist(
        canManageOrganizationPrereg(
          durablePreregSql(this.sql),
          user.id,
          organizationId,
        ),
        403,
        "この学校の事前登録を作成する権限がありません。",
      );
      const data = await input(request, 20_000);
      insist(
        typeof data.email === "string",
        400,
        "メールアドレスを確認してください。",
      );
      const plannedRole =
        data.plannedRole === "teacher" || data.plannedRole === "student"
          ? data.plannedRole
          : data.plannedRole == null
            ? null
            : undefined;
      insist(plannedRole !== undefined, 400, "予定の役割を確認してください。");
      const id = crypto.randomUUID();
      const now = Date.now();
      try {
        const row = this.ctx.storage.transactionSync(() => {
          const created = createPreregistration(durablePreregSql(this.sql), {
            id,
            email: data.email,
            organizationId,
            plannedRole,
            plannedIsSchoolAdmin: !!data.plannedIsSchoolAdmin,
            plannedCanCreateSpace: !!data.plannedCanCreateSpace,
            createdBy: user.id,
            createdAt: now,
          });
          writeAuditLog(
            {
              exec: (query, ...args) => {
                this.sql.exec(query, ...args);
              },
            },
            {
              id: crypto.randomUUID(),
              actorUserId: user.id,
              action: "preregistration.create",
              target: `preregistration:${id}`,
              createdAt: now,
            },
          );
          return created;
        });
        return json({ preregistration: row }, 201);
      } catch (error) {
        if (error instanceof PreregistrationError)
          throw new HttpError(error.status, error.message);
        throw error;
      }
    }
    const schoolAdminApply =
      /^\/api\/organizations\/([^/]+)\/school-admin-applications$/.exec(path);
    if (
      stage1FeaturesEnabled(this.env) &&
      schoolAdminApply &&
      method === "POST"
    ) {
      const organizationId = decodeURIComponent(schoolAdminApply[1]);
      const id = crypto.randomUUID();
      const now = Date.now();
      try {
        const row = this.ctx.storage.transactionSync(() => {
          const created = applyForSchoolAdmin(durableSchoolAdminSql(this.sql), {
            id,
            organizationId,
            applicantUserId: user.id,
            createdAt: now,
          });
          writeAuditLog(
            {
              exec: (query, ...args) => {
                this.sql.exec(query, ...args);
              },
            },
            {
              id: crypto.randomUUID(),
              actorUserId: user.id,
              action: "school_admin.apply",
              target: `school_admin_application:${id}`,
              createdAt: now,
            },
          );
          return created;
        });
        return json({ application: row }, 201);
      } catch (error) {
        if (error instanceof SchoolAdminError)
          throw new HttpError(error.status, error.message);
        throw error;
      }
    }
    const schoolAdminDecide =
      /^\/api\/school-admin-applications\/([^/]+)\/decide$/.exec(path);
    if (
      stage1FeaturesEnabled(this.env) &&
      schoolAdminDecide &&
      method === "POST"
    ) {
      const applicationId = decodeURIComponent(schoolAdminDecide[1]);
      const data = await input(request, 20_000);
      insist(
        data.decision === "登録" || data.decision === "却下",
        400,
        "決定内容を確認してください。",
      );
      const now = Date.now();
      try {
        const row = this.ctx.storage.transactionSync(() => {
          const decided = decideSchoolAdminApplication(
            durableSchoolAdminSql(this.sql),
            {
              applicationId,
              decision: data.decision,
              decidedBy: user.id,
              decidedAt: now,
            },
          );
          writeAuditLog(
            {
              exec: (query, ...args) => {
                this.sql.exec(query, ...args);
              },
            },
            {
              id: crypto.randomUUID(),
              actorUserId: user.id,
              action:
                data.decision === "登録"
                  ? "school_admin.appoint"
                  : "school_admin.reject",
              target: `school_admin_application:${applicationId}`,
              createdAt: now,
            },
          );
          return decided;
        });
        return json({ application: row });
      } catch (error) {
        if (error instanceof SchoolAdminError)
          throw new HttpError(error.status, error.message);
        throw error;
      }
    }
    const schoolAdminRevoke =
      /^\/api\/organizations\/([^/]+)\/school-admins\/([^/]+)$/.exec(path);
    if (
      stage1FeaturesEnabled(this.env) &&
      schoolAdminRevoke &&
      method === "DELETE"
    ) {
      const organizationId = decodeURIComponent(schoolAdminRevoke[1]);
      const targetUserId = decodeURIComponent(schoolAdminRevoke[2]);
      const now = Date.now();
      try {
        this.ctx.storage.transactionSync(() => {
          insist(
            revokeSchoolAdmin(durableSchoolAdminSql(this.sql), {
              organizationId,
              userId: targetUserId,
              actorUserId: user.id,
            }),
            404,
            "解除する学校管理者資格が見つかりません。",
          );
          writeAuditLog(
            {
              exec: (query, ...args) => {
                this.sql.exec(query, ...args);
              },
            },
            {
              id: crypto.randomUUID(),
              actorUserId: user.id,
              action: "school_admin.revoke",
              target: `organization:${organizationId}:user:${targetUserId}`,
              createdAt: now,
            },
          );
        });
        return json({ ok: true });
      } catch (error) {
        if (error instanceof SchoolAdminError)
          throw new HttpError(error.status, error.message);
        throw error;
      }
    }
    const memberInvalidate =
      /^\/api\/organizations\/([^/]+)\/members\/([^/]+)\/invalidate$/.exec(
        path,
      );
    if (
      stage1FeaturesEnabled(this.env) &&
      memberInvalidate &&
      method === "POST"
    ) {
      const organizationId = decodeURIComponent(memberInvalidate[1]);
      const targetUserId = decodeURIComponent(memberInvalidate[2]);
      insist(
        canManageOrganizationPrereg(
          durablePreregSql(this.sql),
          user.id,
          organizationId,
        ),
        403,
        "この学校の所属を無効化する権限がありません。",
      );
      const now = Date.now();
      const generation = this.ctx.storage.transactionSync(() => {
        const next = invalidateOrganizationMember(
          durableGenerationSql(this.sql),
          targetUserId,
          organizationId,
        );
        insist(
          next !== undefined,
          404,
          "無効化できる有効な所属が見つかりません。",
        );
        writeAuditLog(
          {
            exec: (query, ...args) => {
              this.sql.exec(query, ...args);
            },
          },
          {
            id: crypto.randomUUID(),
            actorUserId: user.id,
            action: "membership.invalidate",
            target: `organization:${organizationId}:user:${targetUserId}`,
            createdAt: now,
          },
        );
        return next;
      });
      return json({ generation });
    }
    const memberReactivate =
      /^\/api\/organizations\/([^/]+)\/members\/([^/]+)\/reactivate$/.exec(
        path,
      );
    if (
      stage1FeaturesEnabled(this.env) &&
      memberReactivate &&
      method === "POST"
    ) {
      const organizationId = decodeURIComponent(memberReactivate[1]);
      const targetUserId = decodeURIComponent(memberReactivate[2]);
      insist(
        canManageOrganizationPrereg(
          durablePreregSql(this.sql),
          user.id,
          organizationId,
        ),
        403,
        "この学校の所属を再有効化する権限がありません。",
      );
      const data = await input(request, 20_000);
      const role =
        data.role === "teacher" || data.role === "student"
          ? data.role
          : data.role == null
            ? null
            : undefined;
      insist(role !== undefined, 400, "役割を確認してください。");
      const now = Date.now();
      const member = this.ctx.storage.transactionSync(() => {
        const restored = reactivateOrganizationMember(
          durableGenerationSql(this.sql),
          targetUserId,
          organizationId,
          role,
        );
        insist(restored, 404, "再有効化できる無効な所属が見つかりません。");
        writeAuditLog(
          {
            exec: (query, ...args) => {
              this.sql.exec(query, ...args);
            },
          },
          {
            id: crypto.randomUUID(),
            actorUserId: user.id,
            action: "membership.reactivate",
            target: `organization:${organizationId}:user:${targetUserId}`,
            createdAt: now,
          },
        );
        return restored;
      });
      return json({ member });
    }
    const preregId = /^\/api\/preregistrations\/([^/]+)$/.exec(path);
    if (stage1FeaturesEnabled(this.env) && preregId && method === "DELETE") {
      const id = decodeURIComponent(preregId[1]);
      const existing = one<{ organization_id: string }>(
        this.sql,
        "SELECT organization_id FROM preregistrations WHERE id=?",
        id,
      );
      insist(existing, 404, "事前登録が見つかりません。");
      insist(
        canManageOrganizationPrereg(
          durablePreregSql(this.sql),
          user.id,
          existing.organization_id,
        ),
        403,
        "この事前登録を取り消す権限がありません。",
      );
      const now = Date.now();
      this.ctx.storage.transactionSync(() => {
        insist(
          cancelPreregistration(durablePreregSql(this.sql), id),
          409,
          "この事前登録は取り消せません。",
        );
        writeAuditLog(
          {
            exec: (query, ...args) => {
              this.sql.exec(query, ...args);
            },
          },
          {
            id: crypto.randomUUID(),
            actorUserId: user.id,
            action: "preregistration.cancel",
            target: `preregistration:${id}`,
            createdAt: now,
          },
        );
      });
      return json({ ok: true });
    }
    if (path === "/api/logout" && method === "POST") {
      this.sql.exec("DELETE FROM sessions WHERE hash=?", identity.session);
      const works = rows<{ deck: string }>(
        this.sql,
        "SELECT deck FROM members WHERE user_id=?",
        user.id,
      );
      await Promise.all(
        works.map((work) =>
          room(this.env, work.deck)
            .fetch(internal("/revoke", { session: identity.session }))
            .then(checked),
        ),
      );
      return json({ ok: true }, 200, { "Set-Cookie": cookie("", 0) });
    }
    if (method !== "GET") this.rate(`api:${user.id}`, 120);
    const lookupJoin = /^\/api\/join-requests\/([a-f0-9-]{36})$/.exec(path);
    if (lookupJoin && method === "GET")
      return json(
        joinState((q, ...a) => this.sql.exec(q, ...a), lookupJoin[1], user.id),
      );
    if (path === "/api/user-apps" && method === "GET")
      return json({
        apps: listUserApps(
          (query, ...args) => this.sql.exec(query, ...args),
          user.id,
        ),
      });
    if (path === "/api/user-apps" && method === "POST") {
      const data = await input(request, 24_000_000);
      return this.ctx.storage.transactionSync(() => {
        this.rate(`userapp:${user.id}`, 30);
        return json(
          {
            apps: addUserApp(
              (query, ...args) => this.sql.exec(query, ...args),
              user.id,
              data,
              Date.now(),
            ),
          },
          201,
        );
      });
    }
    const userAppDelete = /^\/api\/user-apps\/([a-f0-9-]{36})$/.exec(path);
    if (userAppDelete && method === "DELETE")
      return this.ctx.storage.transactionSync(() =>
        json({
          apps: deleteUserApp(
            (query, ...args) => this.sql.exec(query, ...args),
            user.id,
            userAppDelete[1],
          ),
        }),
      );
    if (path === "/api/trash" && method === "GET")
      return json({
        decks: rows(
          this.sql,
          "SELECT decks.id,decks.title,work_trash.created,work_trash.purging FROM work_trash JOIN decks ON deck=decks.id WHERE owner=? ORDER BY created DESC",
          user.id,
        ),
      });
    if (path === "/api/restores" && method === "GET")
      return json({
        jobs: rows<Record<string, unknown>>(
          this.sql,
          taskQuery +
            " WHERE owner=? AND status<>'cancelled' ORDER BY created DESC",
          user.id,
        ).map(taskView),
      });
    const jobLookup =
      /^\/api\/(?:restores\/([a-f0-9-]{36})|decks\/([a-f0-9-]{36})\/restore)$/.exec(
        path,
      );
    if (jobLookup && method === "GET")
      return json(this.task(jobLookup[1] || jobLookup[2], user.id));
    if (path === "/api/decks" && method === "GET")
      return json({
        decks: rows<Work>(
          this.sql,
          `SELECT decks.id,decks.title,decks.owner,decks.updated,decks.status,${pendingJoinCountSQL("members.user_id")} FROM decks JOIN members ON members.deck=decks.id WHERE members.user_id=? AND (status='ready' OR decks.owner=?) AND NOT EXISTS(SELECT 1 FROM work_trash WHERE deck=decks.id) ORDER BY updated DESC`,
          user.id,
          user.id,
        ),
      });
    if (
      (path === "/api/decks" || path === "/api/restores") &&
      method === "POST"
    ) {
      const restoring = path === "/api/restores";
      let deck: Deck,
        jobInput: {
          key?: string;
          contentHash?: string;
          applySharing?: boolean;
          newCopy?: boolean;
        } = {};
      try {
        const raw = text(await body(request, 10_000_000));
        if (restoring) {
          jobInput = JSON.parse(raw);
          insist(
            jobInput.newCopy === undefined ||
              typeof jobInput.newCopy === "boolean",
            400,
            "復元方法を確認してください。",
          );
          insist(
            jobInput.key === undefined || validDigest(jobInput.key),
            400,
            "復元キーが正しくありません。",
          );
          insist(
            jobInput.contentHash === undefined ||
              validDigest(jobInput.contentHash),
            400,
            "復元内容の識別子が正しくありません。",
          );
          insist(
            jobInput.applySharing === undefined ||
              typeof jobInput.applySharing === "boolean",
            400,
            "共有設定を確認してください。",
          );
        }
        deck = parseDeck(
          restoring
            ? JSON.stringify({
                version: 1,
                title: JSON.parse(raw).title,
                slides: [blank(0, 0)],
              })
            : raw,
        );
      } catch (error) {
        if (error instanceof HttpError) throw error;
        throw new HttpError(400, (error as Error).message);
      }
      const requestKey = jobInput.key ?? crypto.randomUUID();
      if (restoring) {
        const prior = one<{
          id: string;
          content_hash: string;
          apply_sharing: number;
          status: string;
        }>(
          this.sql,
          "SELECT * FROM restore_tasks WHERE owner=? AND (request_key=? OR (?=0 AND content_hash<>'' AND content_hash=? AND apply_sharing=? AND status<>'cancelled' AND NOT EXISTS(SELECT 1 FROM work_trash WHERE deck=restore_tasks.id))) ORDER BY (request_key=?) DESC,created DESC LIMIT 1",
          user.id,
          requestKey,
          Number(jobInput.newCopy === true),
          jobInput.contentHash ?? "",
          jobInput.applySharing === undefined
            ? -1
            : Number(jobInput.applySharing),
          requestKey,
        );
        if (prior) {
          insist(
            !one(
              this.sql,
              "SELECT deck FROM work_trash WHERE deck=?",
              prior.id,
            ),
            409,
            "復元済みの作品はごみ箱にあります。作品一覧に戻してから開いてください。",
          );
          insist(
            prior.content_hash === (jobInput.contentHash ?? "") &&
              prior.apply_sharing ===
                (jobInput.applySharing === undefined
                  ? -1
                  : Number(jobInput.applySharing)),
            409,
            "同じ復元キーで別の内容は復元できません。",
          );
          insist(
            !["cancelled", "cancelling"].includes(prior.status),
            409,
            "この復元は取り消されています。",
          );
          const work = this.access(prior.id, user, true, true);
          if (work.status === "creating") {
            await checked(
              await room(this.env, prior.id).fetch(
                internal("/init", { id: prior.id, deck }),
              ),
            );
            this.sql.exec(
              "UPDATE decks SET status='restoring' WHERE id=?",
              prior.id,
            );
          }
          return json({ id: prior.id });
        }
      }
      const work: Work = {
        id: crypto.randomUUID(),
        owner: user.id,
        title: deck.title,
        updated: Date.now(),
        status: "creating",
      };
      this.ctx.storage.transactionSync(() => {
        insist(
          one<{ n: number }>(
            this.sql,
            "SELECT COUNT(*) AS n FROM decks WHERE owner=?",
            user.id,
          )!.n < 40,
          413,
          "保存できる作品数の上限です（40作品）。",
        );
        this.sql.exec(
          "INSERT INTO decks(id,owner,title,updated,status) VALUES(?,?,?,?,?)",
          work.id,
          user.id,
          work.title,
          work.updated,
          work.status,
        );
        this.sql.exec("INSERT INTO members VALUES(?,?)", work.id, user.id);
        if (restoring)
          this.sql.exec(
            "INSERT INTO restore_tasks(id,owner,request_key,content_hash,apply_sharing,title,status,created) VALUES(?,?,?,?,?,?,'uploading',?)",
            work.id,
            user.id,
            requestKey,
            jobInput.contentHash ?? "",
            jobInput.applySharing === undefined
              ? -1
              : Number(jobInput.applySharing),
            deck.title,
            Date.now(),
          );
      });
      try {
        for (const slide of deck.slides)
          for (const e of slide.elements)
            if (e.type === "image") {
              const src = e.src;
              insist(
                typeof src === "string" && src.startsWith("data:"),
                400,
                "写真を含むJSONを読み込んでから保存してください。",
              );
              e.src = await this.saveAsset(
                work,
                fromBase64(src.slice(src.indexOf(",") + 1)),
                user,
              );
            }
        await checked(
          await room(this.env, work.id).fetch(
            internal("/init", { id: work.id, deck }),
          ),
        );
        this.sql.exec(
          "UPDATE decks SET status=? WHERE id=?",
          restoring ? "restoring" : "ready",
          work.id,
        );
      } catch (error) {
        try {
          await checked(
            await room(this.env, work.id).fetch(internal("/delete", {})),
          );
          this.removeWork(work.id);
          this.sql.exec(
            "UPDATE restore_tasks SET status='cancelled' WHERE id=?",
            work.id,
          );
        } catch {
          // Keep the reservation and an owner-visible row for deletion after recovery.
          this.sql.exec(
            "UPDATE decks SET status=? WHERE id=?",
            restoring ? "deleting" : "failed",
            work.id,
          );
          if (restoring)
            this.sql.exec(
              "UPDATE restore_tasks SET status='cancelling' WHERE id=?",
              work.id,
            );
        }
        throw error;
      }
      return json({ id: work.id }, 201);
    }
    const invite = /^\/api\/invites\/([A-Za-z0-9_-]{43})\/accept$/.exec(path);
    if (invite && method === "POST") {
      const found = one<{ deck: string }>(
        this.sql,
        "SELECT invites.deck FROM invites JOIN decks ON invites.deck=decks.id WHERE hash=? AND status='ready' AND NOT EXISTS(SELECT 1 FROM work_trash WHERE deck=decks.id)",
        await sha(invite[1]),
      );
      insist(found, 404, "招待リンクは無効か、更新されています。");
      const inviteHash = await sha(invite[1]);
      const result = this.ctx.storage.transactionSync(() =>
        requestJoin(
          (q, ...a) => this.sql.exec(q, ...a),
          found.deck,
          user.id,
          inviteHash,
        ),
      );
      return json(result, result.status === "pending" ? 202 : 200);
    }
    const match = /^\/api\/decks\/([a-f0-9-]{36})(?:\/(.*))?$/.exec(path);
    insist(match, 404, "見つかりません。");
    const [, id, extra] = match,
      work = this.access(
        id,
        user,
        false,
        (!extra && method === "DELETE") ||
          extra === "untrash" ||
          (extra === "assets" && method === "POST") ||
          (extra === "restore" && ["POST", "DELETE"].includes(method)),
      );
    insist(
      !one(this.sql, "SELECT deck FROM work_trash WHERE deck=?", id) ||
        (work.owner === user.id &&
          (extra === "untrash" ||
            ((!extra || extra === "restore") && method === "DELETE"))),
      404,
      "作品はごみ箱にあります。作品一覧に戻してから開いてください。",
    );
    if (extra === "gallery" || extra?.startsWith("gallery/")) {
      insist(
        (method === "GET" && extra === "gallery") ||
          (method === "POST" &&
            [
              "gallery/preview",
              "gallery/publish",
              "gallery/stop",
              "gallery/counts",
            ].includes(extra)),
        405,
        "この操作には対応していません。",
      );
      const value = method === "POST" ? await input(request, 3000000) : {};
      return this.ctx.storage.transactionSync(() => {
        const current = this.access(id, user);
        if (method !== "GET") this.rate(`gallery:${user.id}`, 60);
        return json(
          galleryCommand(
            (query, ...args) => this.sql.exec(query, ...args),
            id,
            user.id,
            current.owner === user.id,
            method === "GET" ? "read" : extra.split("/")[1],
            value,
          ),
        );
      });
    }
    if (extra === "poll") {
      insist(method === "GET", 405, "この操作には対応していません。");
      const params = new URL(request.url).searchParams;
      return this.ctx.storage.transactionSync(() => {
        const current = this.access(id, user);
        const host = current.owner === user.id;
        const sql = (query: string, ...args: (string | number)[]) =>
          this.sql.exec(query, ...args);
        const out: Record<string, unknown> = {};
        const ev = params.get("ev");
        if (ev !== null) {
          const version = featureVersion(sql, id, "editslides");
          if (ev === "" || Number(ev) !== version)
            out.editslides = {
              version,
              editSlides: editSlideList(sql, id, user.id, host, {
                  groupOk: (params.get("ecaps") ?? "").includes("editgroup"),
                }),
            };
        }
        const ea = params.get("ea");
        if (ea !== null) {
          const version = featureVersion(sql, id, "editanswers");
          if (ea === "" || Number(ea) !== version)
            out.editanswers = {
              version,
              editAnswers: editSlideAnswersMeta(sql, id, user.id, host),
            };
        }
        const ef = params.get("ef");
        if (ef !== null) {
          const version = featureVersion(sql, id, "editfeedback");
          if (ef === "" || Number(ef) !== version)
            out.editfeedback = {
              version,
              feedback: feedbackList(sql, id, user.id, host),
            };
        }
        const wv = params.get("wv");
        if (wv !== null) {
          const version = featureVersion(sql, id, "worksheets");
          if (wv === "" || Number(wv) !== version)
            out.worksheets = {
              version,
              worksheets: worksheetList(sql, id, user.id, host),
            };
        }
        const mv = params.get("mv");
        if (mv !== null) {
          const version = featureVersion(sql, id, "webbing");
          if (mv === "" || Number(mv) !== version)
            out.webbing = { version, webbing: webbingList(sql, id, host) };
        }
        const gv = params.get("gv");
        if (gv !== null) {
          const version = featureVersion(sql, id, "groups");
          if (gv === "" || Number(gv) !== version)
            out.groups = { version, ...groupList(sql, id, user.id, host) };
        }
        const tv = params.get("tv");
        if (tv !== null) {
          const version = featureVersion(sql, id, "thinking");
          if (tv === "" || Number(tv) !== version)
            out.thinking = {
              version,
              thinking: thinkingList(sql, id, user.id, host, {
                board: (params.get("tcaps") ?? "").includes("board"),
                steps: (params.get("tcaps") ?? "").includes("steps"),
                flow: (params.get("tcaps") ?? "").includes("flow"),
                board5: (params.get("tcaps") ?? "").includes("board5"),
              }),
            };
        }
        return json(out);
      });
    }
    if (extra === "worksheets" || extra?.startsWith("worksheets/")) {
      insist(
        ["GET", "POST", "DELETE"].includes(method),
        405,
        "この操作には対応していません。",
      );
      const route =
        /^worksheets(?:\/([a-f0-9-]{36})(?:\/(status|answer|field|edit|copy|merge))?)?$/.exec(
          extra,
        );
      insist(
        route &&
          (method === "GET"
            ? extra === "worksheets"
            : method === "DELETE"
              ? !!route[1] && !route[2]
              : extra === "worksheets" || !!route[2]),
        404,
        "ワークシートの操作が見つかりません。",
      );
      const value = method === "POST" ? await input(request, 300000) : {};
      return this.ctx.storage.transactionSync(() => {
        const current = this.access(id, user);
        const host = current.owner === user.id;
        const sql = (query: string, ...args: (string | number)[]) =>
          this.sql.exec(query, ...args);
        if (method !== "GET") {
          this.rate(`worksheet:${user.id}`, 120);
          worksheetCommand(
            sql,
            id,
            user.id,
            host,
            method === "DELETE" ? "delete" : (route![2] ?? "create"),
            route![1],
            value,
          );
        }
        if (method === "GET") {
          const v = new URL(request.url).searchParams.get("v");
          if (v !== null) {
            const version = featureVersion(sql, id, "worksheets");
            if (String(version) === v)
              return json({ unchanged: true, version });
            return json({
              worksheets: worksheetList(sql, id, user.id, host),
              version,
            });
          }
        }
        return json({ worksheets: worksheetList(sql, id, user.id, host) });
      });
    }
    if (extra === "surveys" || extra?.startsWith("surveys/")) {
      insist(
        ["GET", "POST", "DELETE"].includes(method),
        405,
        "この操作には対応していません。",
      );
      const route =
        /^surveys(?:\/([a-f0-9-]{36})(?:\/(status|answer|publish|edit))?)?$/.exec(
          extra,
        );
      insist(
        route &&
          (method === "GET"
            ? extra === "surveys"
            : method === "DELETE"
              ? !!route[1] && !route[2]
              : extra === "surveys" || !!route[2]),
        404,
        "アンケートの操作が見つかりません。",
      );
      const value = method === "POST" ? await input(request, 12000) : {};
      return this.ctx.storage.transactionSync(() => {
        const current = this.access(id, user);
        const host = current.owner === user.id;
        const sql = (query: string, ...args: (string | number)[]) =>
          this.sql.exec(query, ...args);
        if (method !== "GET") {
          this.rate(`survey:${user.id}`, 120);
          surveyCommand(
            sql,
            id,
            user.id,
            host,
            method === "DELETE" ? "delete" : (route![2] ?? "create"),
            route![1],
            value,
          );
        }
        return json({ surveys: surveyList(sql, id, user.id, host) });
      });
    }
    if (extra === "edit-slides" || extra?.startsWith("edit-slides/")) {
      insist(
        ["GET", "POST", "DELETE"].includes(method),
        405,
        "この操作には対応していません。",
      );
      const route =
        /^edit-slides(?:\/([a-f0-9-]{36})(?:\/(status|answer|answer-assets|answers|share-follow|share-gallery|share-remove)(?:\/([^/]+))?)?)?$/.exec(
          extra,
        );
      insist(
        route &&
          (method === "GET"
            ? extra === "edit-slides" ||
              (route[2] === "answer-assets" && !!route[3]) ||
              (route[2] === "answers" && !!route[3])
            : method === "DELETE"
              ? !!route[1] && (!route[2] || route[2] === "share-follow")
              : extra === "edit-slides" || (!!route[2] && !route[3])),
        404,
        "生徒の編集用の操作が見つかりません。",
      );
      const sql = (query: string, ...args: (string | number)[]) =>
        this.sql.exec(query, ...args);
      if (route![2] === "answers" && method === "GET") {
        // One answer's content, on demand: the console fetches a
        // slide only when its updated stamp moved.
        return this.ctx.storage.transactionSync(() => {
          const current = this.access(id, user);
          const host = current.owner === user.id;
          return json(
            editSlideAnswerContent(
              sql,
              id,
              user.id,
              host,
              route![1]!,
              route![3]!,
            ),
          );
        });
      }
      if (route![2] === "answer-assets" && method === "GET") {
        // Reading an answer photo: only its author and the host.
        // The bytes come from the shared blob pool.
        const stored = editAnswerAsset(
          sql,
          id,
          user.id,
          work.owner === user.id,
          route![1]!,
          route![3]!,
        );
        if (stored.follow) {
          // Allowed only through a follow snapshot: the room's
          // follow must be live for that definition + author,
          // however it was started or stopped.
          const followResponse = await checked(
            await room(this.env, id).fetch(internal("/internal/follow-share")),
          );
          const follow = (await followResponse.json()) as {
            active: boolean;
            mode?: string;
            defId?: string;
            owner?: string;
          };
          insist(
            follow.active &&
              follow.mode === "editslide" &&
              follow.defId === stored.follow.defId &&
              follow.owner === stored.follow.author,
            404,
            "写真が見つかりません。",
          );
        }
        const blob = one<{ mime: string; bytes: number }>(
          this.sql,
          "SELECT mime,bytes FROM blobs WHERE owner=? AND hash=?",
          work.owner,
          stored.hash,
        );
        insist(blob, 404, "写真が見つかりません。");
        const chunks = rows<{ data: ArrayBuffer }>(
          this.sql,
          "SELECT data FROM blob_chunks WHERE owner=? AND hash=? ORDER BY part",
          work.owner,
          stored.hash,
        );
        return new Response(new Blob(chunks.map((chunk) => chunk.data)), {
          headers: {
            "Content-Type": blob!.mime,
            "Content-Length": String(blob!.bytes),
            "Cache-Control": "private, no-store",
          },
        });
      }
      if (route![2] === "answer-assets") {
        // A photo for the student's own answer (open definitions
        // only, at most 10 per answer).
        this.rate(`editslide-asset:${user.id}`, 60);
        const src = await this.saveAnswerAsset(
          work,
          user,
          route![1]!,
          await body(request, 6_000_000),
        );
        return json({ src }, 201);
      }
      // An answer's JSON is capped at 256KB, so its request body
      // gets a cap near that size; definition creation (a whole
      // base slide) keeps the larger one.
      const value =
        method === "POST"
          ? await input(
              request,
              route![2] === "answer" ? 1_000_000 : 8_000_000,
            )
          : {};
      let orphans: { asset: string; hash: string }[] = [];
      const response = this.ctx.storage.transactionSync(() => {
        const current = this.access(id, user);
        const host = current.owner === user.id;
        if (
          route![2] === "share-follow" ||
          route![2] === "share-gallery" ||
          route![2] === "share-remove"
        ) {
          // Stage 2b shares: snapshot one answer for follow or for
          // the response gallery, or take a share down.
          this.rate(`editslide:${user.id}`, 120);
          const v = value as {
            author?: unknown;
            names?: unknown;
            shareId?: unknown;
            slide?: { id?: unknown };
          };
          if (route![2] === "share-follow") {
            if (method === "DELETE")
              removeEditShare(sql, id, host, route![1]!, { follow: true });
            else
              takeEditShare(
                sql,
                id,
                host,
                route![1]!,
                String(v.author ?? ""),
                "follow",
                v.names === true,
              );
          } else if (route![2] === "share-gallery") {
            takeEditShare(
              sql,
              id,
              host,
              route![1]!,
              String(v.author ?? ""),
              "gallery",
              v.names === true,
            );
            const source = editSlideSource(sql, id, route![1]!);
            insist(
              v.slide && v.slide.id === source,
              400,
              "共有先のスライドが違います。",
            );
            ensureEditGallery(
              sql,
              id,
              v.slide as Parameters<typeof ensureEditGallery>[2],
            );
          } else {
            const source = editSlideSource(sql, id, route![1]!);
            removeEditShare(sql, id, host, route![1]!, { shareId: v.shareId, author: v.author });
            if (source) pruneEditGallery(sql, id, source);
          }
          return json({
            editSlides: editSlideList(sql, id, user.id, host, {
              groupOk: (new URL(request.url).searchParams.get("ecaps") ?? "").includes(
                "editgroup",
              ),
            }),
          });
        }
        if (method !== "GET") {
          this.rate(`editslide:${user.id}`, 120);
          const result = editSlideCommand(
            sql,
            id,
            user.id,
            host,
            method === "DELETE" ? "delete" : (route![2] ?? "create"),
            route![1],
            value,
          );
          orphans = result.orphanAssets ?? [];
        }
        return json({
            editSlides: editSlideList(sql, id, user.id, host, {
              groupOk: (new URL(request.url).searchParams.get("ecaps") ?? "").includes(
                "editgroup",
              ),
            }),
          });
      });
      if (orphans.length)
        this.ctx.storage.transactionSync(() => {
          for (const orphan of orphans)
            this.releaseBlob(work.owner, orphan.hash);
        });
      return response;
    }
    if (extra === "feedback" || extra?.startsWith("feedback/")) {
      // Teacher feedback and send-backs (§4.3): small JSON commands
      // only; the rows themselves ride the poll.
      insist(method === "POST", 405, "この操作には対応していません。");
      const action = extra === "feedback" ? "send" : extra.slice(9);
      insist(
        ["send", "read", "resubmit", "cancel-reopen"].includes(action),
        404,
        "フィードバックの操作が見つかりません。",
      );
      const value = await input(request, 64_000);
      return this.ctx.storage.transactionSync(() => {
        const current = this.access(id, user);
        const host = current.owner === user.id;
        const sql = (query: string, ...args: (string | number)[]) =>
          this.sql.exec(query, ...args);
        this.rate(`feedback:${user.id}`, 120);
        feedbackCommand(sql, id, user.id, host, action, value);
        return json({ feedback: feedbackList(sql, id, user.id, host) });
      });
    }
    if (extra === "groups" || extra?.startsWith("groups/")) {
      insist(
        ["GET", "POST"].includes(method),
        405,
        "この操作には対応していません。",
      );
      const route =
        /^groups(?:\/(add|join|leave)|\/([a-f0-9-]{36})\/rename)?$/.exec(extra);
      insist(
        route && (method === "GET" ? extra === "groups" : true),
        404,
        "グループの操作が見つかりません。",
      );
      const value = method === "POST" ? await input(request, 12000) : {};
      return this.ctx.storage.transactionSync(() => {
        const current = this.access(id, user);
        const host = current.owner === user.id;
        const sql = (query: string, ...args: (string | number)[]) =>
          this.sql.exec(query, ...args);
        if (method !== "GET") {
          this.rate(`groups:${user.id}`, 120);
          groupCommand(
            sql,
            id,
            user.id,
            host,
            route![1] ?? (route![2] ? "rename" : "create"),
            route![2],
            value,
          );
        }
        if (method === "GET") {
          const v = new URL(request.url).searchParams.get("v");
          if (v !== null) {
            const version = featureVersion(sql, id, "groups");
            if (String(version) === v)
              return json({ unchanged: true, version });
            return json({ ...groupList(sql, id, user.id, host), version });
          }
        }
        return json(groupList(sql, id, user.id, host));
      });
    }
    if (extra === "webbing" || extra?.startsWith("webbing/")) {
      insist(
        ["GET", "POST", "DELETE"].includes(method),
        405,
        "この操作には対応していません。",
      );
      const route =
        /^webbing(?:\/([a-f0-9-]{36})(?:\/(status|node-add|node-edit|node-delete|lock|unlock))?)?$/.exec(
          extra,
        );
      insist(
        route &&
          (method === "GET"
            ? extra === "webbing"
            : method === "DELETE"
              ? !!route[1] && !route[2]
              : extra === "webbing" || !!route[2]),
        404,
        "ウェビングマップの操作が見つかりません。",
      );
      const value = method === "POST" ? await input(request, 12000) : {};
      return this.ctx.storage.transactionSync(() => {
        const current = this.access(id, user);
        const host = current.owner === user.id;
        const sql = (query: string, ...args: (string | number)[]) =>
          this.sql.exec(query, ...args);
        let extraResult: { createdId?: string } | undefined;
        if (method !== "GET") {
          this.rate(`webbing:${user.id}`, 300);
          extraResult = webbingCommand(
            sql,
            id,
            user.id,
            host,
            method === "DELETE" ? "delete" : (route![2] ?? "create"),
            route![1],
            value,
          );
        }
        if (method === "GET") {
          const v = new URL(request.url).searchParams.get("v");
          if (v !== null) {
            const version = featureVersion(sql, id, "webbing");
            if (String(version) === v)
              return json({ unchanged: true, version });
            return json({ webbing: webbingList(sql, id, host), version });
          }
        }
        return json({
          webbing: webbingList(sql, id, host),
          ...(extraResult?.createdId
            ? { createdId: extraResult.createdId }
            : {}),
        });
      });
    }
    if (extra === "thinking" || extra?.startsWith("thinking/")) {
      insist(
        ["GET", "POST", "DELETE"].includes(method),
        405,
        "この操作には対応していません。",
      );
      const route =
        /^thinking(?:\/([a-f0-9-]{36})(?:\/(status|scene|point|clear|lock|edit|card|cardmove|cardedit|carddelete|reorder|node|nodeedit|nodedelete))?)?$/.exec(
          extra,
        );
      insist(
        route &&
          (method === "GET"
            ? extra === "thinking"
            : method === "DELETE"
              ? !!route[1] && !route[2]
              : extra === "thinking" || !!route[2]),
        404,
        "思考ツールの操作が見つかりません。",
      );
      const value = method === "POST" ? await input(request, 12000) : {};
      return this.ctx.storage.transactionSync(() => {
        const current = this.access(id, user);
        const host = current.owner === user.id;
        const sql = (query: string, ...args: (string | number)[]) =>
          this.sql.exec(query, ...args);
        let extraResult: { createdId?: string } | undefined;
        if (method !== "GET") {
          this.rate(`thinking:${user.id}`, 300);
          extraResult = thinkingCommand(
            sql,
            id,
            user.id,
            host,
            method === "DELETE" ? "delete" : (route![2] ?? "create"),
            route![1],
            value,
          );
        }
        const caps = {
          board: (new URL(request.url).searchParams.get("caps") ?? "").includes(
            "board",
          ),
          steps: (new URL(request.url).searchParams.get("caps") ?? "").includes(
            "steps",
          ),
          flow: (new URL(request.url).searchParams.get("caps") ?? "").includes(
            "flow",
          ),
          board5: (new URL(request.url).searchParams.get("caps") ?? "").includes("board5"),
        };
        if (method === "GET") {
          const v = new URL(request.url).searchParams.get("v");
          if (v !== null) {
            const version = featureVersion(sql, id, "thinking");
            if (String(version) === v)
              return json({ unchanged: true, version });
            return json({
              thinking: thinkingList(sql, id, user.id, host, caps),
              version,
            });
          }
        }
        return json({
          thinking: thinkingList(sql, id, user.id, host, caps),
          ...(extraResult?.createdId
            ? { createdId: extraResult.createdId }
            : {}),
        });
      });
    }
    if (extra === "record" || extra === "record/me") {
      insist(method === "GET", 405, "この操作には対応していません。");
      const current = this.access(id, user);
      const host = current.owner === user.id;
      if (extra === "record")
        insist(host, 403, "みんなの記録を見られるのは先生だけです。");
      const deckResponse = await checked(
        await room(this.env, id).fetch(internal("/deck-json")),
      );
      const deck = parseDeck(JSON.stringify(await deckResponse.json()));
      const filter =
        new URL(request.url).searchParams.get("user") ?? undefined;
      return this.ctx.storage.transactionSync(() => {
        const sql = (query: string, ...args: (string | number)[]) =>
          this.sql.exec(query, ...args);
        return json(
          extra === "record"
            ? learningRecordFull(sql, deck, id, user.id, filter)
            : { record: myLearningRecord(sql, deck, id, user.id) },
        );
      });
    }
    if (extra === "thinking-share") {
      insist(method === "GET", 405, "この操作には対応していません。");
      const current = this.access(id, user);
      const followResponse = await checked(
        await room(this.env, id).fetch(internal("/internal/follow-share")),
      );
      const follow = (await followResponse.json()) as {
        active: boolean;
        shareId?: string;
        toolId?: string;
        owner?: string;
        showNames?: boolean;
      };
      const shareId = new URL(request.url).searchParams.get("share") ?? "";
      insist(
        follow.active &&
          follow.shareId === shareId &&
          typeof follow.toolId === "string" &&
          typeof follow.owner === "string",
        404,
        "いま見せているチャートはありません。",
      );
      return this.ctx.storage.transactionSync(() => {
        const sql = (query: string, ...args: (string | number)[]) =>
          this.sql.exec(query, ...args);
        const view = thinkingShareView(
          sql,
          id,
          follow.toolId!,
          follow.owner!,
          follow.showNames === true,
          current.owner,
          {
            steps: (new URL(request.url).searchParams.get("caps") ?? "").includes(
              "steps",
            ),
            flow: (new URL(request.url).searchParams.get("caps") ?? "").includes(
              "flow",
            ),
            board5: (new URL(request.url).searchParams.get("caps") ?? "").includes(
              "board5",
            ),
          },
        );
        insist(view, 404, "いま見せているチャートはありません。");
        return json({ share: view });
      });
    }
    if (extra === "edit-slide-share") {
      // The follow snapshot of one student's slide (stage 2b):
      // served only while the room's follow state points at that
      // definition + author with this share id.
      insist(method === "GET", 405, "この操作には対応していません。");
      this.access(id, user);
      const followResponse = await checked(
        await room(this.env, id).fetch(internal("/internal/follow-share")),
      );
      const follow = (await followResponse.json()) as {
        active: boolean;
        mode?: string;
        shareId?: string;
        defId?: string;
        owner?: string;
      };
      const shareId = new URL(request.url).searchParams.get("share") ?? "";
      insist(
        follow.active &&
          follow.mode === "editslide" &&
          follow.shareId === shareId &&
          typeof follow.defId === "string" &&
          typeof follow.owner === "string",
        404,
        "いま見せているスライドはありません。",
      );
      return this.ctx.storage.transactionSync(() => {
        const sql = (query: string, ...args: (string | number)[]) =>
          this.sql.exec(query, ...args);
        const view = followShareView(sql, id, follow.defId!, follow.owner!);
        insist(view, 404, "いま見せているスライドはありません。");
        return json({ share: view });
      });
    }
    if (extra === "prev-answer") {
      insist(method === "GET", 405, "この操作には対応していません。");
      this.access(id, user);
      const params = new URL(request.url).searchParams;
      return this.ctx.storage.transactionSync(() => {
        const sql = (query: string, ...args: (string | number)[]) =>
          this.sql.exec(query, ...args);
        return json({
          answer: prevAnswerFor(sql, id, user.id, {
            source: params.get("source") ?? "",
            refId: params.get("ref") ?? "",
            fieldId: params.get("field") ?? undefined,
            sceneId: params.get("scene") ?? undefined,
          }),
        });
      });
    }
    if (extra === "join-requests" && method === "GET") {
      this.access(id, user, true);
      return json({
        requests: pendingJoins((q, ...a) => this.sql.exec(q, ...a), id),
      });
    }
    if (
      (extra === "join-requests/approve" || extra === "join-requests/reject") &&
      method === "POST"
    ) {
      this.access(id, user, true);
      const value = await input(request, 6000);
      const result = this.ctx.storage.transactionSync(() => {
        this.access(id, user, true);
        return decideJoins(
          (q, ...a) => this.sql.exec(q, ...a),
          id,
          value,
          extra.endsWith("/approve"),
        );
      });
      return json(result);
    }
    if ((extra === "trash" || extra === "untrash") && method === "POST") {
      this.access(id, user, true, extra === "untrash");
      this.ctx.storage.transactionSync(() => {
        if (extra === "trash") {
          this.sql.exec(
            "INSERT OR REPLACE INTO work_trash(deck,created,purging) VALUES(?,?,0)",
            id,
            Date.now(),
          );
          this.sql.exec("DELETE FROM invites WHERE deck=?", id);
          this.sql.exec(
            "DELETE FROM join_requests WHERE deck=? AND status<>'approved'",
            id,
          );
        } else {
          insist(
            work.status === "ready" &&
              !one<{ purging: number }>(
                this.sql,
                "SELECT purging FROM work_trash WHERE deck=?",
                id,
              )?.purging,
            409,
            "完全削除の途中です。完全に削除を再試行してください。",
          );
          this.sql.exec("DELETE FROM work_trash WHERE deck=?", id);
        }
        // Touch Directory revision: backups must notice a trash / restore ABA.
        this.sql.exec("UPDATE decks SET updated=? WHERE id=?", Date.now(), id);
      });
      if (extra === "trash")
        await checked(await room(this.env, id).fetch(internal("/suspend", {})));
      return json({ ok: true });
    }
    if (
      (extra === "history" || extra?.startsWith("history/")) &&
      ["GET", "POST"].includes(method)
    ) {
      this.access(id, user, true);
      const response = await room(this.env, id).fetch(
        new Request(`https://room/${extra}`, {
          method,
          ...(method === "POST"
            ? {
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(await input(request, 2000)),
              }
            : {}),
        }),
      );
      this.access(id, user, true);
      return response;
    }
    if (extra === "backup/verify" && method === "POST") {
      this.access(id, user, true);
      const checkpoint = (await input(request)).checkpoint;
      insist(
        validCheckpoint(checkpoint),
        400,
        "バックアップの確認情報が正しくありません。",
      );
      const result = await checked(
        await room(this.env, id).fetch(internal("/backup/revision")),
      );
      const current = (await result.json()) as { revision: string };
      this.access(id, user, true);
      insist(
        checkpoint.directory === this.revision(id) &&
          checkpoint.room === current.revision,
        409,
        backupChanged,
      );
      return json({ ok: true });
    }
    if (extra === "backup" && method === "GET") {
      this.access(id, user, true);
      const people = () =>
        rows<User>(
          this.sql,
          `SELECT ${usersPublicColumns} FROM users JOIN members ON users.id=members.user_id WHERE members.deck=? AND users.id<>?`,
          id,
          work.owner,
        ).map((p) => ({
          ...p,
          access: this.permissions(id, p.id, work.owner),
        }));
      const revision = this.revision(id);
      const recipients = this.recipientList(id),
        members = people();
      const response = await checked(
        await room(this.env, id).fetch(internal("/backup")),
      );
      const data = (await response.json()) as {
        deck: Deck;
        comments: SlideComment[];
        revision: string;
      };
      const latest = await checked(
        await room(this.env, id).fetch(internal("/backup/revision")),
      );
      const roomRevision = ((await latest.json()) as { revision: string })
        .revision;
      this.access(id, user, true);
      insist(
        revision === this.revision(id) && data.revision === roomRevision,
        409,
        backupChanged,
      );
      insist(
        JSON.stringify(recipients) === JSON.stringify(this.recipientList(id)) &&
          JSON.stringify(members) === JSON.stringify(people()),
        409,
        "共有設定が変更されました。もう一度バックアップしてください。",
      );
      return json({
        ...backupSnapshot(data.deck, data.comments, recipients, members),
        checkpoint: { directory: revision, room: data.revision },
      });
    }
    if (extra === "restore" && method === "POST") {
      try {
        this.access(id, user, true, true);
        insist(
          one(this.sql, "SELECT id FROM restore_tasks WHERE id=?", id),
          409,
          "復元は専用の新しい作品にだけ実行できます。",
        );
        const task = this.task(id, user.id);
        insist(
          !["cancelled", "cancelling"].includes(task.status),
          409,
          "この復元は取り消されています。",
        );
        const work = this.access(id, user, true, true);
        insist(
          work.status === "restoring" || task.status === "ready",
          409,
          "復元は専用の新しい作品にだけ実行できます。",
        );
        let snapshot, applySharing;
        try {
          const value = await input(request, BACKUP_METADATA_BYTES + 1000);
          insist(
            typeof value.applySharing === "boolean",
            400,
            "共有設定を確認してください。",
          );
          applySharing = value.applySharing;
          snapshot = parseBackupSnapshot(value.snapshot);
        } catch (error) {
          throw error instanceof HttpError
            ? error
            : new HttpError(400, (error as Error).message);
        }
        const commitHash = await sha(
          JSON.stringify({ snapshot, applySharing }),
        );
        const prior = one<{ commit_hash: string; apply_sharing: number }>(
          this.sql,
          "SELECT * FROM restore_tasks WHERE id=?",
          id,
        )!;
        insist(
          !prior.commit_hash || prior.commit_hash === commitHash,
          409,
          "復元内容が前の試行と一致しません。",
        );
        insist(
          prior.apply_sharing === -1 ||
            prior.apply_sharing === Number(applySharing),
          409,
          "共有設定が前の試行と一致しません。",
        );
        if (task.status === "ready") return json({ id });
        await checked(
          await room(this.env, id).fetch(
            internal("/restore", { snapshot, owner: user.id, commitHash }),
          ),
        );
        this.sql.exec(
          "UPDATE restore_tasks SET commit_hash=?,apply_sharing=?,status='room_committed' WHERE id=?",
          commitHash,
          Number(applySharing),
          id,
        );

        this.ctx.storage.transactionSync(() => {
          if (applySharing)
            snapshot.sharing
              .filter((p) => p.email !== normalizeEmail(user.email))
              .forEach((p, rank) =>
                this.sql.exec(
                  "INSERT INTO recipients VALUES(?,?,?,?,NULL)",
                  id,
                  p.email,
                  JSON.stringify(p.access),
                  rank,
                ),
              );
          this.sql.exec(
            "UPDATE decks SET title=?,status='ready',updated=? WHERE id=?",
            snapshot.deck.title,
            Date.now(),
            id,
          );
          this.sql.exec(
            "UPDATE restore_tasks SET status='ready' WHERE id=?",
            id,
          );
        });
        return json({ id });
      } catch (error) {
        return failure(error);
      }
    }
    if (!extra && method === "GET") {
      const response = await checked(
        await room(this.env, id).fetch(internal("/state")),
      );
      return json({
        id,
        owner: work.owner,
        access: this.permissions(id, user.id, work.owner),
        ...((await response.json()) as object),
      });
    }
    if ((!extra || extra === "restore") && method === "DELETE") {
      if (extra === "restore")
        insist(
          ["restoring", "deleting"].includes(
            this.access(id, user, true, true).status,
          ),
          409,
          "復元は完了済みです。作品一覧を確認してください。",
        );
      this.access(id, user, true, true);
      this.ctx.storage.transactionSync(() => {
        this.sql.exec(
          "UPDATE restore_tasks SET status='cancelling' WHERE id=?",
          id,
        );
        this.sql.exec(
          "INSERT INTO work_trash(deck,created,purging) VALUES(?,?,1) ON CONFLICT(deck) DO UPDATE SET purging=1",
          id,
          Date.now(),
        );
        this.sql.exec("UPDATE decks SET status='deleting' WHERE id=?", id);
      });
      await checked(await room(this.env, id).fetch(internal("/delete", {})));
      this.ctx.storage.transactionSync(() => {
        this.removeWork(id);
        this.sql.exec(
          "UPDATE restore_tasks SET status='cancelled' WHERE id=?",
          id,
        );
      });
      return json({ ok: true });
    }
    if (extra === "invite") {
      this.access(id, user, true);
      if (method === "POST" || method === "DELETE") {
        const raw = randomToken(),
          hash = await sha(raw);
        this.ctx.storage.transactionSync(() => {
          this.sql.exec("DELETE FROM invites WHERE deck=?", id);
          this.sql.exec(
            "DELETE FROM join_requests WHERE deck=? AND status<>'approved'",
            id,
          );
          if (method === "POST")
            this.sql.exec("INSERT INTO invites VALUES(?,?)", hash, id);
        });
        return method === "POST"
          ? json({ url: `${origin}/?join=${raw}` })
          : json({ ok: true });
      }
    }
    if (extra === "recipients") {
      this.access(id, user, true);
      if (method === "GET") return json({ recipients: this.recipientList(id) });
      if (method === "POST") {
        let recipients;
        try {
          recipients = parseRecipients(
            await input(request, 1_500_000),
            user.email,
          );
        } catch (error) {
          throw new HttpError(400, (error as Error).message);
        }
        const existing = this.recipientList(id);
        insist(
          new Set([
            ...existing.map((r) => r.email),
            ...recipients.map((r) => r.email),
          ]).size <= 500,
          413,
          "事前共有は1作品500アカウントまでです。",
        );
        const notifications: { user: string; access: unknown }[] = [];
        this.ctx.storage.transactionSync(() => {
          let rank = one<{ n: number }>(
            this.sql,
            "SELECT COALESCE(MAX(rank),-1) AS n FROM recipients WHERE deck=?",
            id,
          )!.n;
          for (const recipient of recipients) {
            const prior = existing.find((r) => r.email === recipient.email);
            const known = rows<{ id: string }>(
              this.sql,
              "SELECT users.id FROM users JOIN members ON members.user_id=users.id WHERE members.deck=? AND lower(users.email)=?",
              id,
              recipient.email,
            );
            const target =
              prior?.userId ?? (known.length === 1 ? known[0].id : null);
            this.sql.exec(
              "INSERT INTO recipients VALUES(?,?,?,?,?) ON CONFLICT(deck,email) DO UPDATE SET value=excluded.value,user_id=excluded.user_id",
              id,
              recipient.email,
              JSON.stringify(recipient.access),
              ++rank,
              target,
            );
            if (target) {
              this.sql.exec(
                "INSERT INTO grants VALUES(?,?,?) ON CONFLICT(deck,user_id) DO UPDATE SET value=excluded.value",
                id,
                target,
                JSON.stringify(recipient.access),
              );
              notifications.push({ user: target, access: recipient.access });
            }
          }
        });
        for (const value of notifications)
          await checked(
            await room(this.env, id).fetch(internal("/permissions", value)),
          );
        await checked(await room(this.env, id).fetch(internal("/roster", {})));
        return json({ recipients: this.recipientList(id) });
      }
    }
    if (extra?.startsWith("recipients/") && method === "DELETE") {
      this.access(id, user, true);
      const email = normalizeEmail(decodeURIComponent(extra.slice(11)));
      const entry = one<{ user_id: string | null }>(
        this.sql,
        "SELECT user_id FROM recipients WHERE deck=? AND email=?",
        id,
        email,
      );
      insist(
        !entry?.user_id || entry.user_id !== work.owner,
        400,
        "ホストの参加権限は解除できません。",
      );
      this.ctx.storage.transactionSync(() => {
        this.sql.exec(
          "DELETE FROM recipients WHERE deck=? AND email=?",
          id,
          email,
        );
        if (entry?.user_id) {
          this.sql.exec(
            "DELETE FROM grants WHERE deck=? AND user_id=?",
            id,
            entry.user_id,
          );
          this.sql.exec(
            "DELETE FROM members WHERE deck=? AND user_id=?",
            id,
            entry.user_id,
          );
        }
      });
      if (entry?.user_id)
        await checked(
          await room(this.env, id).fetch(
            internal("/revoke", { user: entry.user_id }),
          ),
        );
      await checked(await room(this.env, id).fetch(internal("/roster", {})));
      return json({ recipients: this.recipientList(id) });
    }
    if (extra === "row-accounts" && method === "GET") {
      const members = rows<User>(
        this.sql,
        `SELECT ${usersPublicColumns} FROM users JOIN members ON users.id=members.user_id WHERE members.deck=?`,
        id,
      ).map((member) => ({
        id: member.id,
        name: member.name,
        access: this.permissions(id, member.id, work.owner),
      }));
      return json(
        sharedAccountNames(
          this.recipientList(id),
          members.filter((m) => m.id !== work.owner),
        ),
      );
    }
    if (extra === "members" && method === "GET") {
      this.access(id, user, true);
      return json({
        members: rows<User>(
          this.sql,
          `SELECT ${usersPublicColumns} FROM users JOIN members ON users.id=members.user_id WHERE members.deck=?`,
          id,
        ).map((member) => ({
          ...member,
          access: this.permissions(id, member.id, work.owner),
        })),
      });
    }
    if (extra === "permissions" && method === "GET")
      return json({ access: this.permissions(id, user.id, work.owner) });
    if (extra === "capabilities" && method === "GET") {
      insist(
        stage1FeaturesEnabled(this.env),
        404,
        "この機能は利用できません。",
      );
      const grant = one<{ value: string }>(
        this.sql,
        "SELECT value FROM grants WHERE deck=? AND user_id=?",
        id,
        user.id,
      );
      const isMember = !!one(
        this.sql,
        "SELECT 1 AS ok FROM members WHERE deck=? AND user_id=?",
        id,
        user.id,
      );
      return json(
        generalDeckAccess({
          deckId: id,
          userId: user.id,
          ownerId: work.owner,
          isMember,
          grantJson: grant?.value,
        }),
      );
    }
    if (extra?.startsWith("members/") && method === "PATCH") {
      this.access(id, user, true);
      const target = decodeURIComponent(extra.slice(8));
      insist(
        target !== work.owner &&
          one(
            this.sql,
            "SELECT user_id FROM members WHERE deck=? AND user_id=?",
            id,
            target,
          ),
        400,
        "参加者を選んでください。ホストの権限は変更できません。",
      );
      let access;
      try {
        access = parseAccess(await input(request, 1_500_000));
      } catch {
        throw new HttpError(400, "権限の設定が正しくありません。");
      }
      this.sql.exec(
        "INSERT INTO grants VALUES(?,?,?) ON CONFLICT(deck,user_id) DO UPDATE SET value=excluded.value",
        id,
        target,
        JSON.stringify(access),
      );
      this.sql.exec(
        "UPDATE recipients SET value=? WHERE deck=? AND user_id=?",
        JSON.stringify(access),
        id,
        target,
      );
      await checked(
        await room(this.env, id).fetch(
          internal("/permissions", { user: target, access }),
        ),
      );
      return json({ access });
    }
    if (extra === "comments" || /^comments\/[a-f0-9-]{36}$/.test(extra || "")) {
      const access = this.permissions(id, user.id, work.owner);
      insist(
        method === "GET" ||
          method === "DELETE" ||
          (["POST", "PUT"].includes(method) && access.comment),
        403,
        "コメントする権限がありません。",
      );
      return room(this.env, id).fetch(
        internal(`/${extra}`, {
          method,
          user,
          host: work.owner === user.id,
          ...(["POST", "PUT"].includes(method)
            ? { value: await input(request) }
            : {}),
        }),
      );
    }
    if (extra?.startsWith("members/") && method === "DELETE") {
      this.access(id, user, true);
      const removed = decodeURIComponent(extra.slice(8));
      this.sql.exec(
        "DELETE FROM join_requests WHERE deck=? AND user_id=?",
        id,
        removed,
      );
      insist(removed !== user.id, 400, "作成者は参加者から削除できません。");
      this.sql.exec(
        "DELETE FROM recipients WHERE deck=? AND user_id=?",
        id,
        removed,
      );
      this.sql.exec(
        "DELETE FROM grants WHERE deck=? AND user_id=?",
        id,
        removed,
      );
      this.sql.exec(
        "DELETE FROM members WHERE deck=? AND user_id=?",
        id,
        removed,
      );
      await checked(
        await room(this.env, id).fetch(internal("/revoke", { user: removed })),
      );
      return json({ ok: true });
    }
    if (extra === "assets" && method === "POST") {
      const digest = request.headers.get("X-Restore-Image");
      if (digest) {
        this.access(id, user, true, true);
        const task = this.task(id, user.id);
        insist(
          ["uploading", "room_committed", "ready"].includes(task.status),
          409,
          "この復元へ写真は保存できません。",
        );
        const bytes = await body(request, 6_000_000);
        insist(
          validDigest(digest) && (await digestBytes(bytes)) === digest,
          400,
          "写真の内容が一致しません。",
        );
        const asset = await imageId(id, digest);
        if (task.status !== "uploading") {
          insist(
            one(
              this.sql,
              "SELECT id FROM assets WHERE id=? AND deck=?",
              asset,
              id,
            ),
            409,
            "確定後に写真は追加できません。",
          );
          return json({ src: `/api/decks/${id}/assets/${asset}` }, 201);
        }
        return json(
          { src: await this.saveAsset(work, bytes, user, asset) },
          201,
        );
      }

      if (work.status === "restoring")
        insist(
          this.task(id, user.id).status === "uploading",
          409,
          "写真の復元は確定中です。",
        );
      insist(
        this.permissions(id, user.id, work.owner).mode !== "none",
        403,
        "写真を追加する権限がありません。",
      );
      return json(
        {
          src: await this.saveAsset(work, await body(request, 6_000_000), user),
        },
        201,
      );
    }
    if (/^assets\/[a-f0-9-]{36}$/.test(extra || "") && method === "GET") {
      const assetId = extra!.slice("assets/".length);
      const bound = one<{ hash: string | null; owner: string }>(
        this.sql,
        "SELECT hash,owner FROM assets WHERE id=? AND deck=?",
        assetId,
        id,
      );
      if (bound?.hash) {
        // Deduplicated image: the bytes live here, but the room still
        // decides who may see media of this deck.
        const verdict = await room(this.env, id).fetch(
          new Request(`https://internal/assets/${assetId}/check`, {
            headers: {
              "X-Media-User": user.id,
              "X-Media-Host": work.owner === user.id ? "1" : "0",
            },
          }),
        );
        if (!verdict.ok) return verdict;
        const blob = one<{ mime: string; bytes: number }>(
          this.sql,
          "SELECT mime,bytes FROM blobs WHERE owner=? AND hash=?",
          bound.owner,
          bound.hash,
        );
        insist(blob, 404, "写真が見つかりません。");
        const chunks = rows<{ data: ArrayBuffer }>(
          this.sql,
          "SELECT data FROM blob_chunks WHERE owner=? AND hash=? ORDER BY part",
          bound.owner,
          bound.hash,
        );
        return new Response(new Blob(chunks.map((chunk) => chunk.data)), {
          headers: {
            "Content-Type": blob.mime,
            "Content-Length": String(blob.bytes),
            "Cache-Control": "private, no-store",
          },
        });
      }
      return room(this.env, id).fetch(
        new Request(`https://internal/${extra}`, {
          headers: {
            "X-Media-User": user.id,
            "X-Media-Host": work.owner === user.id ? "1" : "0",
          },
        }),
      );
    }
    if (
      extra === "live" &&
      method === "GET" &&
      request.headers.get("Upgrade")?.toLowerCase() === "websocket"
    )
      return room(this.env, id).fetch(
        new Request("https://internal/live", {
          headers: {
            Upgrade: "websocket",
            "X-Identity": encodeURIComponent(JSON.stringify(identity)),
          },
        }),
      );
    throw new HttpError(404, "見つかりません。");
  }
  async alarm() {
    this.sql.exec("DELETE FROM sessions WHERE expires<=?", Date.now());
    this.sql.exec("DELETE FROM rates WHERE until<=?", Date.now());
  }
}
