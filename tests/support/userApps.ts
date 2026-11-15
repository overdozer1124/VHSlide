import assert from "node:assert/strict";

type Call = (
  path: string,
  method?: string,
  value?: unknown,
  cookie?: string,
  source?: string,
) => Promise<Response>;

const HTML =
  "<!doctype html><html><body><p id=\"marker\">アップロード成功</p><script>document.title='ok'</script></body></html>";

/**
 * Account-level user apps: URL registration, HTML upload, public isolated
 * serving, per-user isolation. Runs against both servers.
 */
export async function exerciseUserApps(
  call: Call,
  owner: string,
  other: string,
) {
  const list = async (cookie: string) => {
    const r = await call("/api/user-apps", "GET", undefined, cookie);
    assert.equal(r.status, 200);
    return (await r.json()).apps as {
      id: string;
      name: string;
      kind: string;
      url: string;
      sizeBytes: number;
    }[];
  };
  assert.deepEqual(await list(owner), []);

  // URL registration is validated like any embed URL.
  const bad = await call(
    "/api/user-apps",
    "POST",
    { kind: "url", name: "bad", url: "javascript:alert(1)" },
    owner,
  );
  assert.equal(bad.status, 400);
  const added = await call(
    "/api/user-apps",
    "POST",
    { kind: "url", name: "外部ツール", url: "https://example.com/tool" },
    owner,
  );
  assert.equal(added.status, 201);
  let apps = await list(owner);
  assert.equal(apps.length, 1);
  assert.equal(apps[0].kind, "url");
  assert.equal(apps[0].url, "https://example.com/tool");
  const urlAppId = apps[0].id;

  // Upload: stored server-side and served publicly by id, isolated.
  const uploaded = await call(
    "/api/user-apps",
    "POST",
    { kind: "upload", name: "自作ツール", html: HTML },
    owner,
  );
  assert.equal(uploaded.status, 201);
  apps = await list(owner);
  assert.equal(apps.length, 2);
  const upload = apps.find((a) => a.kind === "upload")!;
  assert.equal(upload.sizeBytes, new TextEncoder().encode(HTML).length);
  const pub = await call(`/pub/apps/${upload.id}`, "GET", undefined, "");
  assert.equal(pub.status, 200);
  assert.match(pub.headers.get("content-type") ?? "", /text\/html/);
  assert.match(
    pub.headers.get("content-security-policy") ?? "",
    /sandbox/,
  );
  assert.ok((await pub.text()).includes("アップロード成功"));
  const missing = await call(
    "/pub/apps/123e4567-e89b-12d3-a456-426614174000",
    "GET",
    undefined,
    "",
  );
  assert.equal(missing.status, 404);

  // Other accounts see none of this and cannot delete it.
  assert.deepEqual(await list(other), []);
  const stolen = await call(
    `/api/user-apps/${upload.id}`,
    "DELETE",
    undefined,
    other,
  );
  assert.equal(stolen.status, 200);
  assert.equal((await list(owner)).length, 2);
  const stillThere = await call(
    `/pub/apps/${upload.id}`,
    "GET",
    undefined,
    "",
  );
  assert.equal(stillThere.status, 200);

  // Owner deletes: list shrinks and the public copy stops serving.
  const afterUrl = await call(
    `/api/user-apps/${urlAppId}`,
    "DELETE",
    undefined,
    owner,
  );
  assert.equal(afterUrl.status, 200);
  assert.deepEqual(
    (await list(owner)).map((a) => a.id),
    [upload.id],
  );
  await call(`/api/user-apps/${upload.id}`, "DELETE", undefined, owner);
  assert.deepEqual(await list(owner), []);
  const gone = await call(`/pub/apps/${upload.id}`, "GET", undefined, "");
  assert.equal(gone.status, 404);
}
