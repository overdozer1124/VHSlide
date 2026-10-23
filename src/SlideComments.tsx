import { useEffect, useRef, useState } from "react";
import { GripHorizontal, Trash2 } from "lucide-react";
import type { CloudWorkspace } from "./cloud";
import type { Slide } from "./model";
import type { SlideComment } from "./permissions";

const contents = (note: SlideComment) =>
  JSON.stringify([note.text, note.x, note.y]);

/** The draft lives on the sticky itself; no separate placement or posting step. */
export function SlideComments({
  cloud,
  slide,
  addRequest,
}: {
  cloud: CloudWorkspace;
  slide: Slide;
  addRequest: number;
}) {
  const [drafts, setDrafts] = useState<SlideComment[]>([]);
  const previous = useRef(addRequest);
  const notes = cloud.comments.filter((note) => note.slide === slide.id);
  useEffect(() => {
    if (previous.current === addRequest) return;
    previous.current = addRequest;
    if (!cloud.access.comment) return;
    const occupied = [...notes, ...drafts];
    const spots = [0.22, 0.57].flatMap((y) =>
      [0.35, 0.63, 0.07].map((x) => ({ x, y })),
    );
    const offset = occupied.length % 5;
    const spot = spots.find((p) =>
      occupied.every(
        (n) => Math.abs(p.x - n.x) > 0.26 || Math.abs(p.y - n.y) > 0.33,
      ),
    ) ?? { x: 0.2 + offset * 0.05, y: 0.15 + offset * 0.08 };
    setDrafts((old) => [
      ...old,
      {
        id: crypto.randomUUID(),
        slide: slide.id,
        author: cloud.user!.id,
        name: cloud.user!.name,
        text: "",
        x: spot.x,
        y: spot.y,
        created: Date.now(),
      },
    ]);
  }, [addRequest, cloud, slide.id, notes.length, drafts.length]);
  const ids = new Set(notes.map((note) => note.id));
  useEffect(() => {
    setDrafts((old) =>
      old.filter(
        (note) => !cloud.comments.some((saved) => saved.id === note.id),
      ),
    );
  }, [cloud.comments]);
  return (
    <div className="slide-comments" aria-label="このスライドの付箋">
      {[...notes, ...drafts.filter((note) => !ids.has(note.id))].map((note) => (
        <Sticky
          key={note.id}
          cloud={cloud}
          note={note}
          draft={!ids.has(note.id)}
          removeDraft={() =>
            setDrafts((old) => old.filter((item) => item.id !== note.id))
          }
        />
      ))}
    </div>
  );
}

function Sticky({
  cloud,
  note,
  draft,
  removeDraft,
}: {
  cloud: CloudWorkspace;
  note: SlideComment;
  draft: boolean;
  removeDraft: () => void;
}) {
  const [value, setValue] = useState(note);
  const [status, setStatus] = useState(draft ? "入力すると自動保存" : "");
  const [error, setError] = useState("");
  const current = useRef(value),
    saved = useRef(draft ? "" : contents(note));
  const persisted = useRef(!draft),
    deleted = useRef(false),
    mounted = useRef(true);
  const running = useRef<Promise<void> | undefined>(undefined);
  const composing = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const card = useRef<HTMLElement>(null);
  const room = useRef(cloud.active!.id).current;
  const editable =
    cloud.access.comment && (cloud.isHost || note.author === cloud.user?.id);
  const canDelete = cloud.isHost || note.author === cloud.user?.id;
  const drag = useRef<
    | {
        id: number;
        x: number;
        y: number;
        left: number;
        top: number;
        width: number;
        height: number;
        maxX: number;
        maxY: number;
      }
    | undefined
  >(undefined);
  const notify = (message: string, failure = "") => {
    if (mounted.current) {
      setStatus(message);
      setError(failure);
    }
  };
  const flush = () => {
    clearTimeout(timer.current);
    if (deleted.current || running.current) return running.current;
    running.current = (async () => {
      while (!deleted.current && contents(current.current) !== saved.current) {
        const snapshot = { ...current.current };
        if (!snapshot.text.trim()) {
          notify(
            persisted.current
              ? "文字を入力するか、付箋を削除してください"
              : "入力すると自動保存",
          );
          break;
        }
        notify("保存中…");
        try {
          await cloud.saveComment(room, snapshot);
          persisted.current = true;
          saved.current = contents(snapshot);
          notify("保存済み");
        } catch (e) {
          notify("保存できませんでした", (e as Error).message);
          break;
        }
      }
    })().finally(() => {
      running.current = undefined;
    });
    return running.current;
  };
  const flushRef = useRef(flush);
  flushRef.current = flush;
  const change = (patch: Partial<SlideComment>, immediate = false) => {
    current.current = { ...current.current, ...patch };
    setValue(current.current);
    setStatus("未保存");
    setError("");
    clearTimeout(timer.current);
    if (composing.current) return;
    if (immediate) void flush();
    else timer.current = setTimeout(() => void flushRef.current(), 700);
  };
  useEffect(() => {
    // A remote refresh must not replace unsaved input or an active drag.
    if (
      !running.current &&
      !drag.current &&
      contents(current.current) === saved.current
    ) {
      current.current = note;
      saved.current = contents(note);
      setValue(note);
    }
  }, [note]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimeout(timer.current);
      void flushRef.current();
    };
  }, []);
  return (
    <article
      ref={card}
      className="sticky-note"
      aria-label={`付箋：${note.name}`}
      style={{
        left: `clamp(0px, ${value.x * 100}%, max(0px, calc(100% - var(--note-width))))`,
        top: `clamp(0px, ${value.y * 100}%, max(0px, calc(100% - var(--note-height))))`,
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <header>
        <button
          className="sticky-grip"
          aria-label="付箋を移動"
          title="ドラッグで移動・矢印キーで位置を調整"
          disabled={!editable}
          onPointerDown={(e) => {
            if (!editable || e.button !== 0) return;
            e.preventDefault();
            const rect = card.current!.getBoundingClientRect(),
              parent = card.current!.parentElement!.getBoundingClientRect();
            drag.current = {
              id: e.pointerId,
              x: e.clientX,
              y: e.clientY,
              left: rect.left - parent.left,
              top: rect.top - parent.top,
              width: parent.width,
              height: parent.height,
              maxX: Math.max(0, parent.width - rect.width),
              maxY: Math.max(0, parent.height - rect.height),
            };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (!d || d.id !== e.pointerId) return;
            const x =
              Math.max(0, Math.min(d.maxX, d.left + e.clientX - d.x)) / d.width;
            const y =
              Math.max(0, Math.min(d.maxY, d.top + e.clientY - d.y)) / d.height;
            current.current = { ...current.current, x, y };
            setValue(current.current);
          }}
          onPointerUp={() => {
            if (drag.current) {
              drag.current = undefined;
              void flush();
            }
          }}
          onPointerCancel={() => {
            drag.current = undefined;
            void flush();
          }}
          onLostPointerCapture={() => {
            drag.current = undefined;
            void flush();
          }}
          onKeyDown={(e) => {
            const step = e.shiftKey ? 0.05 : 0.01;
            const directions: Record<string, number[]> = {
              ArrowLeft: [-step, 0],
              ArrowRight: [step, 0],
              ArrowUp: [0, -step],
              ArrowDown: [0, step],
            };
            const d = directions[e.key];
            if (!d) return;
            e.preventDefault();
            change(
              {
                x: Math.max(0, Math.min(1, value.x + d[0])),
                y: Math.max(0, Math.min(1, value.y + d[1])),
              },
              true,
            );
          }}
        >
          <GripHorizontal size={18} />
          <span>移動</span>
        </button>
        {canDelete && (
          <button
            className="sticky-delete"
            aria-label="付箋を削除"
            title="付箋を削除"
            onClick={() => {
              deleted.current = true;
              clearTimeout(timer.current);
              void (async () => {
                try {
                  await running.current;
                  if (persisted.current)
                    await cloud.deleteComment(note.id, room);
                  removeDraft();
                } catch (e) {
                  deleted.current = false;
                  notify("削除できませんでした", (e as Error).message);
                }
              })();
            }}
          >
            <Trash2 size={14} />
          </button>
        )}
      </header>
      <textarea
        aria-label="付箋のコメント"
        placeholder="ここに入力…"
        maxLength={1000}
        value={value.text}
        readOnly={!editable}
        autoFocus={draft}
        onChange={(e) => change({ text: e.target.value })}
        onCompositionStart={() => {
          composing.current = true;
          clearTimeout(timer.current);
        }}
        onCompositionEnd={(e) => {
          composing.current = false;
          change({ text: e.currentTarget.value });
        }}
        onBlur={() => {
          void flush();
          if (
            !current.current.text.trim() &&
            !persisted.current &&
            !running.current
          )
            removeDraft();
        }}
      />
      <footer>
        <span title={note.name}>{note.name}</span>
        <small role="status">{editable ? status : "閲覧のみ"}</small>
      </footer>
      {error && (
        <div className="sticky-error" role="alert">
          {error}
          <button onClick={() => void flush()}>再試行</button>
        </div>
      )}
    </article>
  );
}
