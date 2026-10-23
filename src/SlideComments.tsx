import { useEffect, useState } from "react";
import { MessageSquare, Plus, X } from "lucide-react";
import type { CloudWorkspace } from "./cloud";
import type { Slide } from "./model";
export function SlideComments({
  cloud,
  slide,
}: {
  cloud: CloudWorkspace;
  slide: Slide;
}) {
  const [open, setOpen] = useState(false),
    [placing, setPlacing] = useState(false);
  const [point, setPoint] = useState<{ x: number; y: number }>(),
    [text, setText] = useState("");
  const notes = cloud.comments.filter((c) => c.slide === slide.id);
  useEffect(() => {
    setPoint(undefined);
    setPlacing(false);
    setText("");
  }, [slide.id]);
  return (
    <div
      className={`slide-comments ${placing ? "placing" : ""}`}
      onPointerDown={(event) => {
        if (!placing) return;
        event.stopPropagation();
        event.preventDefault();
        const rect = event.currentTarget.getBoundingClientRect();
        setPoint({
          x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
          y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
        });
        setPlacing(false);
        setOpen(true);
      }}
    >
      <button
        className="comment-toggle"
        aria-label="付箋コメント"
        aria-expanded={open}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => {
          setOpen(!open);
          setPlacing(false);
        }}
      >
        <MessageSquare size={15} />
        付箋 {notes.length || ""}
      </button>
      {open && (
        <>
          {notes.map((note, index) => (
            <button
              key={note.id}
              className="comment-pin"
              style={{
                left: `${Math.min(94, note.x * 100)}%`,
                top: `${Math.min(90, note.y * 100)}%`,
              }}
              aria-label={`付箋${index + 1}：${note.name} ${note.text}`}
              title={`${note.name}：${note.text}`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() =>
                document
                  .getElementById(`comment-${note.id}`)
                  ?.scrollIntoView({ block: "nearest" })
              }
            >
              {index + 1}
            </button>
          ))}
          <section
            className="comment-panel"
            aria-label="このスライドの付箋"
            onPointerDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Escape") {
                setPoint(undefined);
                setPlacing(false);
                setOpen(false);
              }
            }}
          >
            <header>
              <strong>付箋コメント</strong>
              <button
                className="icon-button"
                aria-label="付箋を閉じる"
                onClick={() => {
                  setOpen(false);
                  setPlacing(false);
                }}
              >
                <X size={15} />
              </button>
            </header>
            {cloud.access.comment && !point && (
              <button
                className="button outline"
                disabled={cloud.busy}
                onClick={() => {
                  setPlacing(true);
                  setOpen(false);
                }}
              >
                <Plus size={14} />
                付箋を貼る場所を選ぶ
              </button>
            )}
            {!cloud.access.comment && (
              <small>コメントの投稿は許可されていません。</small>
            )}
            {point && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void cloud
                    .addComment(slide.id, text, point.x, point.y)
                    .then(() => {
                      if (!cloud.error) {
                        setPoint(undefined);
                        setText("");
                      }
                    });
                }}
              >
                <textarea
                  aria-label="付箋のコメント"
                  maxLength={1000}
                  value={text}
                  autoFocus
                  onChange={(e) => setText(e.target.value)}
                  placeholder="気づいたことや感想を書こう"
                />
                <button
                  className="button primary"
                  disabled={cloud.busy || !text.trim()}
                >
                  付箋を投稿
                </button>
                <button
                  type="button"
                  className="quiet"
                  onClick={() => setPoint(undefined)}
                >
                  取り消す
                </button>
              </form>
            )}
            {notes.length ? (
              <ol>
                {notes.map((note, index) => (
                  <li key={note.id} id={`comment-${note.id}`}>
                    <strong>
                      {index + 1}. {note.name}
                    </strong>
                    <p>{note.text}</p>
                    {(cloud.isHost || note.author === cloud.user?.id) && (
                      <button
                        className="quiet"
                        aria-label={`付箋${index + 1}を削除`}
                        disabled={cloud.busy}
                        onClick={() => void cloud.deleteComment(note.id)}
                      >
                        削除
                      </button>
                    )}
                  </li>
                ))}
              </ol>
            ) : (
              <p>このスライドにはまだ付箋がありません。</p>
            )}
            {cloud.error && <p role="alert">{cloud.error}</p>}
          </section>
        </>
      )}
      {placing && (
        <div className="comment-place-hint">
          付箋を貼りたい場所をタップ
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setPlacing(false)}
          >
            取り消す
          </button>
        </div>
      )}
    </div>
  );
}
