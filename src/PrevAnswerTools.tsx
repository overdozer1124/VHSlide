import { useContext, useMemo, useState } from "react";
import type { Element } from "./model";
import { parsePrevAnswerBinding } from "./prevAnswer";
import type { PrevAnswerBinding, PrevAnswerSource } from "./prevAnswer";
import { useWorksheets } from "./WorksheetContext";
import { SurveySlideContext } from "./SurveySlideContext";
import { useThinking } from "./ThinkingContext";
import { useActivityPanel } from "./ActivitiesPanel";

export function makePrevAnswerElement(binding: PrevAnswerBinding): Element {
  return {
    id: crypto.randomUUID(),
    type: "shape",
    shape: "rounded",
    x: 60,
    y: 150,
    w: 420,
    h: 180,
    fill: "#ffffff",
    stroke: "#5b7fa6",
    strokeWidth: 1,
    text: `前の回答：${binding.title}${binding.label ? `（${binding.label}）` : ""}`,
    fontSize: 20,
    color: "#24425e",
    prevAnswer: parsePrevAnswerBinding(binding),
  };
}

/**
 * Stage 3b: the host-side picker for a 「前の自分の回答」 part. Pick
 * the source (a worksheet field, a survey, or one scene of a
 * point-type thinking tool) and place it on the current slide; each
 * student then sees their own earlier answer there. Drafts cannot
 * be picked (they have no answers yet), and board-type tools are
 * left out — the plan covers points.
 */
export function PrevAnswerCreator({
  onPlace,
}: {
  onPlace: (elements: Element[]) => void;
}) {
  const worksheets = useWorksheets();
  const surveys = useContext(SurveySlideContext);
  const thinking = useThinking();
  const activity = useActivityPanel();
  const [source, setSource] = useState<PrevAnswerSource>("worksheet");
  const [refId, setRefId] = useState("");
  const [fieldId, setFieldId] = useState("");
  const [sceneId, setSceneId] = useState("");
  const [error, setError] = useState("");

  const sheetList = useMemo(
    () => worksheets.sheets.filter((s) => s.status !== "draft"),
    [worksheets.sheets],
  );
  const surveyList = useMemo(
    () => surveys.surveys.filter((s) => s.status !== "draft"),
    [surveys.surveys],
  );
  const toolList = useMemo(
    () =>
      thinking.tools.filter(
        (t) => t.kind === "point" && t.status !== "draft",
      ),
    [thinking.tools],
  );
  const sheet = sheetList.find((s) => s.id === refId) ?? sheetList[0];
  const survey = surveyList.find((s) => s.id === refId) ?? surveyList[0];
  const tool = toolList.find((t) => t.id === refId) ?? toolList[0];
  const field =
    sheet?.fields.find((f) => f.id === fieldId) ?? sheet?.fields[0];
  const scene =
    tool?.definition.scenes.find((s) => s.id === sceneId) ??
    tool?.definition.scenes[0];
  const deckId = worksheets.deckId ?? thinking.deckId;
  const empty =
    (source === "worksheet" && (!sheet || !field)) ||
    (source === "survey" && !survey) ||
    (source === "thinking" && (!tool || !scene));

  function place() {
    setError("");
    if (!deckId || empty) return;
    try {
      const binding: PrevAnswerBinding =
        source === "worksheet"
          ? {
              deckId,
              source,
              refId: sheet!.id,
              fieldId: field!.id,
              title: sheet!.title,
              label: field!.label,
            }
          : source === "survey"
            ? {
                deckId,
                source,
                refId: survey!.id,
                title: survey!.question,
                label: "",
              }
            : {
                deckId,
                source,
                refId: tool!.id,
                sceneId: scene!.id,
                title: tool!.definition.title,
                label: scene!.label,
              };
      onPlace([makePrevAnswerElement(binding)]);
      activity.close(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "配置できませんでした。");
    }
  }

  return (
    <section className="prev-answer-tools">
      <h3>スライドに「前の自分の回答」を追加</h3>
      <p>
        元の回答を選んで配置すると、生徒の画面に本人の前の回答が表示されます。先生の画面には、元の項目名だけが表示されます。
      </p>
      <div className="prev-answer-source-tabs" role="tablist" aria-label="元の種類">
        {(
          [
            ["worksheet", "ワークシート"],
            ["survey", "アンケート"],
            ["thinking", "思考ツール"],
          ] as [PrevAnswerSource, string][]
        ).map(([kind, label]) => (
          <button
            key={kind}
            role="tab"
            aria-selected={source === kind}
            className={source === kind ? "active" : ""}
            onClick={() => {
              setSource(kind);
              setRefId("");
              setFieldId("");
              setSceneId("");
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {source === "worksheet" && (
        <>
          <label>
            ワークシート
            <select
              aria-label="元のワークシート"
              value={sheet?.id ?? ""}
              onChange={(e) => {
                setRefId(e.target.value);
                setFieldId("");
              }}
            >
              {sheetList.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            項目
            <select
              aria-label="元の項目"
              value={field?.id ?? ""}
              onChange={(e) => setFieldId(e.target.value)}
            >
              {(sheet?.fields ?? []).map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
      {source === "survey" && (
        <label>
          アンケート
          <select
            aria-label="元のアンケート"
            value={survey?.id ?? ""}
            onChange={(e) => setRefId(e.target.value)}
          >
            {surveyList.map((s) => (
              <option key={s.id} value={s.id}>
                {s.question}
              </option>
            ))}
          </select>
        </label>
      )}
      {source === "thinking" && (
        <>
          <label>
            思考ツール
            <select
              aria-label="元の思考ツール"
              value={tool?.id ?? ""}
              onChange={(e) => {
                setRefId(e.target.value);
                setSceneId("");
              }}
            >
              {toolList.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.definition.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            場面
            <select
              aria-label="元の場面"
              value={scene?.id ?? ""}
              onChange={(e) => setSceneId(e.target.value)}
            >
              {(tool?.definition.scenes ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <p className="prev-answer-tools-note">
            点を置く思考ツールだけが選べます（カード型は対象外です）。
          </p>
        </>
      )}
      {empty && (
        <p className="prev-answer-tools-note">
          選べる元の回答がまだありません。先にフォームや思考ツールの受付を始めてください。
        </p>
      )}
      {error && <p className="prev-answer-tools-error">{error}</p>}
      <button
        className="button primary"
        disabled={empty}
        onClick={place}
      >
        スライドに配置
      </button>
    </section>
  );
}
