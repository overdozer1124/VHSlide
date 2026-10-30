import assert from "node:assert/strict";
export async function acceptAndApprove(
  call: (p: string, m?: string, v?: any, c?: string) => Promise<any>,
  work: string,
  token: string | null,
  guest: string,
  owner?: string,
) {
  const r = await call(
    `/api/invites/${token}/accept`,
    "POST",
    undefined,
    guest,
  );
  assert.ok(r.status === 202 || r.status === 200, await r.clone().text());
  const data = await r.json();
  if (data.status === "pending") {
    assert.equal(
      (await call(`/api/decks/${work}`, "GET", undefined, guest)).status,
      404,
    );
    const approval = await call(
      `/api/decks/${work}/join-requests/approve`,
      "POST",
      { requestIds: [data.requestId] },
      owner,
    );
    assert.equal(approval.status, 200, await approval.clone().text());
  } else assert.equal(data.status, "approved");
}
