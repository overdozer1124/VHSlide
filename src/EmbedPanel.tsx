import { useState } from "react";
import { useActivityPanel } from "./ActivitiesPanel";
import { embedHostName, normalizeEmbedUrl } from "./embedBinding";

/** 自分のアプリのプリセット（選ぶだけでURLが入る）。 */
const PRESETS: { name: string; url: string; note: string }[] = [
  {
    name: "テキストマイニング",
    url: "https://vhslide-textmine.overdozer1124.workers.dev/",
    note: "文章を貼ると、よく出る言葉を分析するアプリ",
  },
];

/**
 * スライドにWebアプリを埋め込むためのパネル。
 * URLを入れる汎用の埋め込みと、自分のアプリのプリセットの両方を受ける。
 */
export function EmbedPanel({
  onEmbed,
}: {
  onEmbed: (url: string) => void;
}) {
  const activity = useActivityPanel();
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const place = () => {
    try {
      const normalized = normalizeEmbedUrl(url);
      onEmbed(normalized);
      activity.close();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <div className="embed-panel">
      <p className="embed-panel-note">
        スライドの中にWebアプリを埋め込めます。生徒は自分の端末でそのまま操作できます（先生の操作が生徒の画面に同期するものではありません）。
      </p>
      {error && (
        <p role="alert" className="embed-panel-error">
          {error}
        </p>
      )}
      <div className="embed-presets">
        <strong>自分のアプリから選ぶ</strong>
        {PRESETS.map((preset) => (
          <button
            key={preset.url}
            type="button"
            className="button outline"
            onClick={() => {
              setUrl(preset.url);
              setError("");
            }}
          >
            {preset.name}
            <span className="embed-preset-note">{preset.note}</span>
          </button>
        ))}
      </div>
      <label className="embed-url-label">
        埋め込むアプリのURL
        <input
          type="url"
          value={url}
          placeholder="https://…"
          onChange={(event) => setUrl(event.target.value)}
        />
      </label>
      {url.trim() && (
        <p className="embed-url-host">
          埋め込み先：{embedHostName(url.trim()) || "（URLを確認してください）"}
        </p>
      )}
      <button
        type="button"
        className="button"
        disabled={!url.trim()}
        onClick={place}
      >
        このアプリをスライドに配置
      </button>
      <p className="embed-panel-note">
        埋め込みを禁止しているサイトは、枠だけ表示されて中身が出ません。Scratch（TurboWarp）のプレイヤーのように、埋め込み用のURLが用意されているアプリが向いています。
      </p>
    </div>
  );
}
