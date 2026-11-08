// 検証専用 trial-apply 画面の純粋モジュール（Codex 再レビュー 6715453178 への対応）。
//
// 目的：送信に使う単一の不変の要求オブジェクトから、送信直前に非秘密項目と
// 一致／不一致の事実だけを表示し、その同じオブジェクトを送信する。
// 表示・ログ・Issue・チャットに ID トークン・一回値・Cookie・nonce・主体
// ハッシュを出さない。送信前の表示と応答は同一の試験 ID で対応づける。
//
// - buildTrialRequest(...) は要求オブジェクトを深く凍結して返す。
//   凍結後に書き換えようとすると失敗する（strict mode では例外）。
//   表示の元と送信する本体が同一のオブジェクトであることが、表示値と
//   実送信の同一性の根拠である。
// - preSendView(...) は表示記録だけを返す。含むのは試験 ID・試験種別・
//   env_id・purpose・主体の確認事実・一回値の比較事実のみ。ID トークン・
//   一回値・nonce・主体ハッシュは含まない。
// - compareOneTime(trialValue, fixedValue) は「一致」／「不一致」の
//   真偽だけを返し、値そのものは返さない。
// - verifyDisplayMatchesSent(display, sentBody) は表示の env_id・purpose
//   が実際に送る本体のものと一致することを確認する。秘密は表示に
//   含まれないため、比較対象は非秘密項目だけである。
// - makeTrialLogEntry(...) は表示と応答を同一の試験 ID で結んだ記録を
//   返す。応答は HTTP 状態と理由コードだけを含む。
// - assertNoSecrets(text, secrets) は試験用の検査関数。表示・ログ文字列
//   に秘密らしい値が含まれていないことを確認する。失敗時の例外文には
//   秘密の値を含めない。
//
// このモジュールはネットワーク通信を一切行わない。Node（テスト）と
// ブラウザー（trial-apply 画面）の両方から同じ実装を使うため、依存する
// のは Object.freeze と JSON だけである。秘密の比較は呼び出し側
// （ブラウザー画面）のメモリー内だけで行い、このモジュールは値を
// 保存・出力しない。

function fail(code, message) {
  const e = new Error(message);
  e.code = code;
  throw e;
}

function deepFreeze(obj) {
  if (obj === null || typeof obj !== "object") return obj;
  for (const value of Object.values(obj)) deepFreeze(value);
  return Object.freeze(obj);
}

function requireNonEmptyString(value, what) {
  if (typeof value !== "string" || value.length === 0) {
    fail("bad_trial_input", `${what} が空でない文字列ではありません`);
  }
  return value;
}

// 送信に使う単一の要求オブジェクトを作り、深く凍結して返す。
// 凍結後に書き換えようとすると失敗する。表示の元と送信する本体は
// この同じオブジェクトである。
export function buildTrialRequest({ idToken, oneTimeValue, purpose, envId }) {
  requireNonEmptyString(idToken, "ID トークン");
  requireNonEmptyString(oneTimeValue, "一回値");
  requireNonEmptyString(purpose, "用途");
  requireNonEmptyString(envId, "環境ID");
  return deepFreeze({
    id_token: idToken,
    one_time_value: oneTimeValue,
    purpose,
    env_id: envId,
  });
}

// 一回値の比較結果を真偽だけ返す。値そのものは返さない。
// 戻り値は "一致" または "不一致" のどちらかだけである。
export function compareOneTime(trialValue, fixedValue) {
  requireNonEmptyString(trialValue, "送信する一回値");
  requireNonEmptyString(fixedValue, "固定の一回値");
  return trialValue === fixedValue ? "一致" : "不一致";
}

// 送信直前の表示記録だけを返す。含むのは試験 ID・試験種別・env_id・
// purpose・主体の確認事実・一回値の比較事実のみ。
// subjectConfirmed は真偽だけを受け取る（主体ハッシュや sub は渡さない）。
// oneTimeFact は compareOneTime の戻り値（"一致"／"不一致"）だけを受け取る。
export function preSendView(request, { trialId, kind, subjectConfirmed, oneTimeFact }) {
  requireNonEmptyString(trialId, "試験 ID");
  if (kind !== "env-mismatch" && kind !== "one-time-mismatch") {
    fail("bad_trial_input", "試験種別が env-mismatch / one-time-mismatch ではありません");
  }
  if (typeof subjectConfirmed !== "boolean") {
    fail("bad_trial_input", "主体の確認結果が真偽ではありません");
  }
  if (oneTimeFact !== "一致" && oneTimeFact !== "不一致") {
    fail("bad_trial_input", "一回値の比較結果が「一致」／「不一致」ではありません");
  }
  return deepFreeze({
    trial_id: trialId,
    kind,
    env_id: request.env_id,
    purpose: request.purpose,
    subject: subjectConfirmed
      ? "主体Aとして確認（署名・iss・aud・exp・nonce 通過）"
      : "未確認",
    one_time: oneTimeFact,
  });
}

// 表示の env_id・purpose が、実際に送る本体のものと一致することを確認する。
// 不一致なら例外（表示と実送信の食い違い）。秘密は表示に含まれないため、
// 比較対象は非秘密項目だけである。
export function verifyDisplayMatchesSent(display, sentBody) {
  requireNonEmptyString(display.trial_id, "試験 ID");
  if (display.env_id !== sentBody.env_id) {
    fail("display_sent_mismatch", "表示の env_id と送信する env_id が一致しません");
  }
  if (display.purpose !== sentBody.purpose) {
    fail("display_sent_mismatch", "表示の purpose と送信する purpose が一致しません");
  }
  return true;
}

// 表示と応答を同一の試験 ID で結んだ記録を返す。応答は HTTP 状態と
// 理由コードだけを含む。ID トークン・一回値・Cookie・nonce は含まない。
export function makeTrialLogEntry({ display, response }) {
  requireNonEmptyString(display.trial_id, "試験 ID");
  if (!response || typeof response.status !== "number") {
    fail("bad_trial_input", "応答の HTTP 状態が数値ではありません");
  }
  return deepFreeze({
    trial_id: display.trial_id,
    display,
    response: {
      status: response.status,
      error: typeof response.error === "string" ? response.error : null,
    },
  });
}

// 表示・ログ文字列に秘密らしい値が含まれていないことを確認する
// （試験用の検査関数）。失敗時の例外文には秘密の値を含めない。
export function assertNoSecrets(text, secrets) {
  if (typeof text !== "string") fail("bad_trial_input", "検査対象が文字列ではありません");
  for (const s of secrets || []) {
    if (typeof s === "string" && s.length > 0 && text.includes(s)) {
      fail("secret_leaked", "表示・ログに秘密らしい値が含まれています");
    }
  }
  return true;
}

// 表示記録が許された鍵だけを持つことを確認する（試験用の検査関数）。
// 許された鍵：trial_id・kind・env_id・purpose・subject・one_time。
export function assertDisplayKeys(display) {
  const allowed = new Set(["trial_id", "kind", "env_id", "purpose", "subject", "one_time"]);
  for (const key of Object.keys(display)) {
    if (!allowed.has(key)) {
      fail("bad_display", "表示記録に許されない鍵があります");
    }
  }
  return true;
}
