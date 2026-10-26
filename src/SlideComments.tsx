import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { GripHorizontal, Trash2, Palette, Scaling } from "lucide-react";
import type { CloudWorkspace } from "./cloud";
import type { Slide } from "./model";
import type { SlideComment } from "./permissions";

const contents = (note: SlideComment) =>
  JSON.stringify([
    note.text,
    note.x,
    note.y,
    note.color ?? "#fff0a6",
    note.w ?? 0.24,
    note.h ?? 0.3,
  ]);

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
  const staged = cloud.pendingCommentDrafts.filter(
    (n) => n.slide === slide.id && !ids.has(n.id),
  );
  const stagedIds = new Set(staged.map((n) => n.id));
  useEffect(() => {
    setDrafts((old) =>
      old.filter(
        (note) => !cloud.comments.some((saved) => saved.id === note.id),
      ),
    );
  }, [cloud.comments]);
  return (
    <div className="slide-comments" aria-label="このスライドの付箋">
      {[
        ...notes,
        ...staged,
        ...drafts.filter(
          (note) => !ids.has(note.id) && !stagedIds.has(note.id),
        ),
      ].map((note) => (
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
  const [value, setValue] = useState(
    () => cloud.draftComment(cloud.active!.id, note.id) ?? note,
  );
  const [palette, setPalette] = useState(false);
  const [paletteBox, setPaletteBox] = useState({ left: 0, width: 222 });
  const sizing = useRef<
    | {
        id: number;
        x: number;
        y: number;
        w: number;
        h: number;
        pw: number;
        ph: number;
      }
    | undefined
  >(undefined);
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
  const actor = useRef(cloud.user?.id ?? "").current;
  const fill = value.color ?? "#fff0a6";
  const ink =
    [0.2126, 0.7152, 0.0722].reduce(
      (sum, weight, i) =>
        sum + (weight * parseInt(fill.slice(1 + i * 2, 3 + i * 2), 16)) / 255,
      0,
    ) < 0.5
      ? "#ffffff"
      : "#3f432f";

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
    if (!running.current && contents(current.current) === saved.current)
      cloud.markNoteDraft(room, note.id, false, actor, current.current);
    if (deleted.current || running.current) return running.current;
    running.current = (async () => {
      while (!deleted.current && contents(current.current) !== saved.current) {
        const snapshot = { ...current.current };
        cloud.markNoteDraft(
          room,
          note.id,
          !!snapshot.text.trim() || persisted.current,
          actor,
          snapshot,
        );
        if (!snapshot.text.trim()) {
          if (!persisted.current && cloud.hasNoteFailure(room, note.id)) {
            try {
              await cloud.deleteComment(note.id, room);
              deleted.current = true;
              cloud.markNoteDraft(room, note.id, false, actor);
              removeDraft();
            } catch (e) {
              notify("保存できませんでした", (e as Error).message);
            }
            break;
          }
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
          if (contents(current.current) === saved.current)
            cloud.markNoteDraft(room, note.id, false, actor, snapshot);
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
    cloud.markNoteDraft(
      room,
      note.id,
      (contents(current.current) !== saved.current || !!running.current) &&
        (!!current.current.text.trim() ||
          persisted.current ||
          cloud.hasNoteFailure(room, note.id)),
      actor,
      current.current,
    );
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
      !sizing.current &&
      contents(current.current) === saved.current
    ) {
      current.current = note;
      saved.current = contents(note);
      setValue(note);
    }
  }, [note]);
  useEffect(() => {
    mounted.current = true;
    const save = async () => {
      await flushRef.current();
      if (
        !deleted.current &&
        (current.current.text.trim() || persisted.current) &&
        contents(current.current) !== saved.current
      )
        throw new Error(
          "保存できていない付箋があります。付箋の再試行を押してください。",
        );
    };
    const unregister = cloud.registerNoteFlush(save, note.id);
    return () => {
      mounted.current = false;
      clearTimeout(timer.current);
      void save()
        .then(() => cloud.releaseNoteSave(save))
        .catch(() => cloud.retainNoteSave(room, save, actor, note.id))
        .finally(unregister);
    };
  }, []);
  return (
    <article
      ref={card}
      className="sticky-note"
      aria-label={`付箋：${note.name}`}
      style={
        {
          "--note-width": `min(100%, max(120px, ${(value.w ?? 0.24) * 100}%))`,
          "--note-height": `min(100%, max(120px, ${(value.h ?? 0.3) * 100}%))`,
          background: fill,
          color: ink,
          left: `clamp(0px, ${value.x * 100}%, max(0px, calc(100% - var(--note-width))))`,
          top: `clamp(0px, ${value.y * 100}%, max(0px, calc(100% - var(--note-height))))`,
        } as CSSProperties
      }
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") setPalette(false);
      }}
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
        {editable && (
          <button
            className="sticky-appearance"
            aria-label="付箋の色とサイズ"
            aria-expanded={palette}
            onClick={() => {
              const c = card.current!.getBoundingClientRect(),
                p = card.current!.parentElement!.getBoundingClientRect(),
                width = Math.min(222, p.width);
              setPaletteBox({
                left: Math.max(
                  p.left - c.left,
                  Math.min(0, p.right - c.left - width),
                ),
                width,
              });
              setPalette((v) => !v);
            }}
          >
            <Palette size={16} />
          </button>
        )}
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
                  if (persisted.current || cloud.hasNoteFailure(room, note.id))
                    await cloud.deleteComment(note.id, room);
                  cloud.markNoteDraft(room, note.id, false, actor);
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
      {palette && editable && (
        <div
          className="sticky-palette"
          style={{
            left: paletteBox.left,
            width: paletteBox.width,
            right: "auto",
          }}
          role="group"
          aria-label="付箋の色とサイズの設定"
        >
          <div className="sticky-colors">
            {[
              ["黄色", "#fff0a6"],
              ["ピンク", "#ffd9e3"],
              ["水色", "#d2edff"],
              ["緑", "#dff2c5"],
              ["紫", "#e9dcff"],
              ["白", "#ffffff"],
            ].map(([name, color]) => (
              <button
                key={color}
                aria-label={`${name}の付箋`}
                aria-pressed={(value.color ?? "#fff0a6") === color}
                style={{ background: color }}
                onClick={() => change({ color }, true)}
              />
            ))}
            <input
              type="color"
              aria-label="付箋の色を選ぶ"
              value={value.color ?? "#fff0a6"}
              onChange={(e) => change({ color: e.target.value })}
              onBlur={() => void flush()}
            />
          </div>
          <div className="sticky-sizes">
            {[
              ["小", 0.18, 0.24],
              ["中", 0.24, 0.3],
              ["大", 0.36, 0.46],
            ].map(([label, w, h]) => (
              <button
                key={label}
                aria-label={`付箋のサイズ：${label}`}
                onClick={() => {
                  change({ w: Number(w), h: Number(h) }, true);
                  setPalette(false);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <small>右下をドラッグして自由に調整</small>
        </div>
      )}
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
      {editable && (
        <button
          className="sticky-resize"
          aria-label="付箋のサイズを変更"
          title="ドラッグでサイズを変更・矢印キーでも調整"
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            setPalette(false);
            e.preventDefault();
            const r = card.current!.getBoundingClientRect(),
              p = card.current!.parentElement!.getBoundingClientRect();
            sizing.current = {
              id: e.pointerId,
              x: e.clientX,
              y: e.clientY,
              w: r.width,
              h: r.height,
              pw: p.width,
              ph: p.height,
            };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            const d = sizing.current;
            if (!d || d.id !== e.pointerId) return;
            current.current = {
              ...current.current,
              w: Math.max(0.12, Math.min(0.8, (d.w + e.clientX - d.x) / d.pw)),
              h: Math.max(0.16, Math.min(0.8, (d.h + e.clientY - d.y) / d.ph)),
            };
            setValue(current.current);
          }}
          onPointerUp={() => {
            sizing.current = undefined;
            void flush();
          }}
          onPointerCancel={() => {
            sizing.current = undefined;
            void flush();
          }}
          onLostPointerCapture={() => {
            sizing.current = undefined;
            void flush();
          }}
          onKeyDown={(e) => {
            const keys: Record<string, [number, number]> = {
              ArrowRight: [0.02, 0],
              ArrowLeft: [-0.02, 0],
              ArrowDown: [0, 0.02],
              ArrowUp: [0, -0.02],
            };
            const d = keys[e.key];
            if (!d) return;
            e.preventDefault();
            change(
              {
                w: Math.max(0.12, Math.min(0.8, (value.w ?? 0.24) + d[0])),
                h: Math.max(0.16, Math.min(0.8, (value.h ?? 0.3) + d[1])),
              },
              true,
            );
          }}
        >
          <Scaling size={15} />
        </button>
      )}
      {error && (
        <div className="sticky-error" role="alert">
          {error}
          <button onClick={() => void flush()}>再試行</button>
        </div>
      )}
    </article>
  );
}
