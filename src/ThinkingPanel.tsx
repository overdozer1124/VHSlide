import { useEffect, useRef, useState } from "react";
import { useActivityPanel } from "./ActivitiesPanel";
import { useThinking } from "./ThinkingContext";
import type {
  ThinkingDefinition,
  ThinkingTemplate,
  ThinkingUnit,
  ThinkingView,
} from "./thinkingTools";
import { ThinkingResults } from "./ThinkingResults";
import { usePageVisible } from "./usePageVisible";

export const THINKING_TEMPLATE_LABELS: Record<ThinkingTemplate, string> = {
  axis2: "座標軸（2つの軸）",
  axis1: "数直線（1つの軸）",
  emotion: "感情メーター",
  ratio: "心情円（2つの気持ちの割合）",
};
export const THINKING_UNIT_LABELS: Record<ThinkingUnit, string> = {
  individual: "個人",
  group: "班",
  class: "全体",
};

function defaultDefinition(template: ThinkingTemplate): ThinkingDefinition {
  const base: ThinkingDefinition = {
    title: "",
    xMin: "",
    xMax: "",
    yMin: "",
    yMax: "",
    scale: "none",
    vertical: false,
    nameA: "",
    nameB: "",
    scenes: [],
    sceneMode: "teacher",
    reason: true,
  };
  if (template === "axis2")
    return {
      ...base,
      xMin: "反対",
      xMax: "賛成",
      yMin: "自信がない",
      yMax: "自信がある",
    };
  if (template === "axis1") return { ...base, xMin: "少ない", xMax: "多い" };
  if (template === "emotion")
    return { ...base, xMin: "いやな気持ち", xMax: "よい気持ち" };
  return { ...base, nameA: "言いたい", nameB: "黙っていたい" };
}

export function ThinkingPanel({
  host,
  onEmbed,
}: {
  host: boolean;
  onEmbed?: (tool: ThinkingView) => void;
}) {
  const ctx = useThinking();
  const activity = useActivityPanel();
  const open = activity.open && activity.active === "thinking";
  const visible = usePageVisible();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [deleteId, setDeleteId] = useState("");
  const [editId, setEditId] = useState("");
  const [resultsId, setResultsId] = useState("");
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (!open || !ctx.enabled || !visible) return;
    void ctx.refresh().catch((e: Error) => {
      if (alive.current) setError(e.message);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ctx.enabled, visible]);

  async function run(action: () => Promise<unknown>, done: string) {
    setBusy(true);
    setError("");
    try {
      await action();
      if (alive.current) setMessage(done);
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  return (
    <div className="thinking-panel">
      <p className="webbing-panel-note">
        考えを「点」で表す思考ツールです。軸や気持ちの上に点を置き、場面ごとに残すことで、考えの変化が見えます。個人・班・全体のどれでも使えます。
      </p>
      {ctx.error && (
        <p role="alert" className="webbing-panel-error">
          {ctx.error}
        </p>
      )}
      {error && (
        <p role="alert" className="webbing-panel-error">
          {error}
        </p>
      )}
      {message && <p className="webbing-panel-message">{message}</p>}
      <div className="thinking-webbing-link">
        <span>
          全員で1枚に書き込む「ウェビングマップ」も思考ツールの1つです。
        </span>
        <button type="button" onClick={() => activity.select("webbing")}>
          ウェブマップを開く
        </button>
      </div>
      {host && (
        <ThinkingToolForm
          busy={busy}
          onSubmit={async (template, unit, definition) => {
            await run(async () => {
              await ctx.command(undefined, undefined, {
                template,
                unit,
                definition,
              });
            }, "思考ツールを作成しました。受付を開始すると配置できます。");
          }}
        />
      )}
      <div className="thinking-tool-list">
        {ctx.tools.length === 0 && (
          <p className="webbing-panel-note">
            まだ思考ツールがありません。
            {host ? "上のフォームから作成してください。" : ""}
          </p>
        )}
        {ctx.tools.map((tool) => (
          <article key={tool.id} className="thinking-tool-card">
            <header>
              <strong>{tool.definition.title}</strong>
              <span className="thinking-tool-meta">
                {THINKING_TEMPLATE_LABELS[tool.template]} ·{" "}
                {THINKING_UNIT_LABELS[tool.unit]} ·{" "}
                {tool.status === "open"
                  ? "受付中"
                  : tool.status === "closed"
                    ? "受付終了"
                    : "下書き"}
                {tool.unit !== "class" &&
                  ` · ${new Set(tool.points.map((p) => p.owner)).size}件`}
              </span>
            </header>
            {host && (
              <div className="thinking-tool-actions">
                {tool.status !== "open" ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () => ctx.command(tool.id, "status", { status: "open" }),
                        "受付を開始しました。",
                      )
                    }
                  >
                    受付を開始
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () =>
                          ctx.command(tool.id, "status", { status: "closed" }),
                        "受付を終了しました。",
                      )
                    }
                  >
                    受付を終了
                  </button>
                )}
                {onEmbed && tool.status !== "draft" && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      onEmbed(tool);
                      activity.close();
                    }}
                  >
                    スライドに配置
                  </button>
                )}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setResultsId(resultsId === tool.id ? "" : tool.id)}
                >
                  結果を見る
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setEditId(editId === tool.id ? "" : tool.id)}
                >
                  設定を編集
                </button>
                {deleteId === tool.id ? (
                  <>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await ctx.command(tool.id, undefined, {}, "DELETE");
                          setDeleteId("");
                        }, "思考ツールを削除しました。")
                      }
                    >
                      本当に削除する
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setDeleteId("")}
                    >
                      やめる
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setDeleteId(tool.id)}
                  >
                    削除
                  </button>
                )}
              </div>
            )}
            {host &&
              tool.definition.sceneMode === "teacher" &&
              tool.definition.scenes.length > 0 && (
                <div className="thinking-scene-switch">
                  <label>
                    今の場面
                    <select
                      aria-label="今の場面"
                      value={tool.scene}
                      disabled={busy}
                      onChange={(e) =>
                        void run(
                          () =>
                            ctx.command(tool.id, "scene", {
                              scene: e.target.value,
                            }),
                          "場面を切り替えました。",
                        )
                      }
                    >
                      {tool.definition.scenes.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              )}
            {host && editId === tool.id && (
              <ThinkingToolForm
                busy={busy}
                initial={{
                  template: tool.template,
                  unit: tool.unit,
                  definition: tool.definition,
                }}
                hasPoints={tool.points.length > 0}
                onSubmit={async (_template, unit, definition) => {
                  await run(async () => {
                    await ctx.command(tool.id, "edit", { unit, definition });
                    setEditId("");
                  }, "設定を保存しました。");
                }}
              />
            )}
            {host && resultsId === tool.id && <ThinkingResults tool={tool} />}
          </article>
        ))}
      </div>
    </div>
  );
}

function ThinkingToolForm({
  busy,
  initial,
  hasPoints,
  onSubmit,
}: {
  busy: boolean;
  initial?: {
    template: ThinkingTemplate;
    unit: ThinkingUnit;
    definition: ThinkingDefinition;
  };
  hasPoints?: boolean;
  onSubmit: (
    template: ThinkingTemplate,
    unit: ThinkingUnit,
    definition: ThinkingDefinition,
  ) => Promise<void>;
}) {
  const [template, setTemplate] = useState<ThinkingTemplate>(
    initial?.template ?? "axis2",
  );
  const [unit, setUnit] = useState<ThinkingUnit>(initial?.unit ?? "individual");
  const [def, setDef] = useState<ThinkingDefinition>(
    initial?.definition ?? defaultDefinition("axis2"),
  );
  const editing = !!initial;
  function patch(p: Partial<ThinkingDefinition>) {
    setDef((d) => ({ ...d, ...p }));
  }
  function pickTemplate(t: ThinkingTemplate) {
    setTemplate(t);
    if (!editing) setDef(defaultDefinition(t));
  }
  return (
    <form
      className="thinking-create"
      onSubmit={(e) => {
        e.preventDefault();
        if (!def.title.trim()) return;
        void onSubmit(template, unit, def);
        if (!editing) setDef(defaultDefinition(template));
      }}
    >
      <fieldset className="thinking-templates">
        <legend>{editing ? "種類（変更できません）" : "ひな形を選ぶ"}</legend>
        {(Object.keys(THINKING_TEMPLATE_LABELS) as ThinkingTemplate[]).map(
          (t) => (
            <label key={t} className={template === t ? "is-active" : ""}>
              <input
                type="radio"
                name="thinking-template"
                value={t}
                checked={template === t}
                disabled={editing}
                onChange={() => pickTemplate(t)}
              />
              {THINKING_TEMPLATE_LABELS[t]}
            </label>
          ),
        )}
      </fieldset>
      <label>
        ツールの名前
        <input
          value={def.title}
          maxLength={60}
          placeholder="例：物語を読んだ気持ち"
          onChange={(e) => patch({ title: e.target.value })}
        />
      </label>
      <label>
        書き込む単位
        <select
          value={unit}
          disabled={hasPoints}
          onChange={(e) => setUnit(e.target.value as ThinkingUnit)}
        >
          <option value="individual">個人（1人1つの点）</option>
          <option value="group">班（班で1つの点）</option>
          <option value="class">全体（全員で1つの点）</option>
        </select>
        {hasPoints && (
          <span className="thinking-form-note">
            回答があるため、単位は変更できません。
          </span>
        )}
      </label>
      {(template === "axis2" || template === "axis1" || template === "emotion") && (
        <div className="thinking-form-grid">
          <label>
            {template === "axis2" ? "横軸の左端" : "軸のはじめ"}
            <input
              value={def.xMin}
              maxLength={40}
              onChange={(e) => patch({ xMin: e.target.value })}
            />
          </label>
          <label>
            {template === "axis2" ? "横軸の右端" : "軸のおわり"}
            <input
              value={def.xMax}
              maxLength={40}
              onChange={(e) => patch({ xMax: e.target.value })}
            />
          </label>
        </div>
      )}
      {template === "axis2" && (
        <div className="thinking-form-grid">
          <label>
            縦軸の下端
            <input
              value={def.yMin}
              maxLength={40}
              onChange={(e) => patch({ yMin: e.target.value })}
            />
          </label>
          <label>
            縦軸の上端
            <input
              value={def.yMax}
              maxLength={40}
              onChange={(e) => patch({ yMax: e.target.value })}
            />
          </label>
        </div>
      )}
      {template === "ratio" && (
        <div className="thinking-form-grid">
          <label>
            1つめの気持ち・部分
            <input
              value={def.nameA}
              maxLength={40}
              onChange={(e) => patch({ nameA: e.target.value })}
            />
          </label>
          <label>
            2つめの気持ち・部分
            <input
              value={def.nameB}
              maxLength={40}
              onChange={(e) => patch({ nameB: e.target.value })}
            />
          </label>
        </div>
      )}
      {template !== "ratio" && (
        <div className="thinking-form-grid">
          <label>
            目盛り
            <select
              value={def.scale}
              onChange={(e) =>
                patch({ scale: e.target.value as ThinkingDefinition["scale"] })
              }
            >
              <option value="none">なし</option>
              <option value="s5">5段階</option>
              <option value="s10">10段階</option>
            </select>
          </label>
          {(template === "axis1" || template === "emotion") && (
            <label className="thinking-check">
              <input
                type="checkbox"
                checked={def.vertical}
                onChange={(e) => patch({ vertical: e.target.checked })}
              />
              縦に置く（温度計のように）
            </label>
          )}
        </div>
      )}
      <fieldset className="thinking-form-scenes">
        <legend>場面（考えの変化を残す場合）</legend>
        {def.scenes.map((s, i) => (
          <div key={s.id} className="thinking-form-scene">
            <input
              value={s.label}
              maxLength={40}
              aria-label={`場面${i + 1}の名前`}
              onChange={(e) =>
                patch({
                  scenes: def.scenes.map((x) =>
                    x.id === s.id ? { ...x, label: e.target.value } : x,
                  ),
                })
              }
            />
            <button
              type="button"
              onClick={() =>
                patch({ scenes: def.scenes.filter((x) => x.id !== s.id) })
              }
            >
              削除
            </button>
          </div>
        ))}
        {def.scenes.length < 10 && (
          <button
            type="button"
            onClick={() =>
              patch({
                scenes: [
                  ...def.scenes,
                  {
                    id: crypto.randomUUID(),
                    label: `場面${def.scenes.length + 1}`,
                  },
                ],
              })
            }
          >
            場面を追加
          </button>
        )}
        {def.scenes.length > 0 && (
          <label>
            場面の進め方
            <select
              value={def.sceneMode}
              onChange={(e) =>
                patch({
                  sceneMode: e.target
                    .value as ThinkingDefinition["sceneMode"],
                })
              }
            >
              <option value="teacher">先生が切り替える</option>
              <option value="free">生徒が自由に選ぶ</option>
            </select>
          </label>
        )}
      </fieldset>
      <label className="thinking-check">
        <input
          type="checkbox"
          checked={def.reason}
          onChange={(e) => patch({ reason: e.target.checked })}
        />
        点と一緒に「理由」を書けるようにする
      </label>
      <button type="submit" disabled={busy || !def.title.trim()}>
        {editing ? "設定を保存" : "思考ツールを作成"}
      </button>
    </form>
  );
}
