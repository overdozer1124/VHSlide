import { useEffect, useState } from "react";
import { useActivityPanel } from "./ActivitiesPanel";
import { embedHostName, normalizeEmbedUrl } from "./embedBinding";
import { formatBytes } from "./deckSize";
import type { UserApp } from "./userApps";

/** 最初から入っているアプリ（選ぶだけでURLが入る）。 */
const PRESETS: { name: string; url: string; note: string }[] = [
  {
    name: "テキストマイニング",
    url: "https://vhslide-textmine.overdozer1124.workers.dev/",
    note: "文章を貼ると、よく出る言葉を分析するアプリ",
  },
];

/**
 * スライドにWebアプリを埋め込むためのパネル。
 * URLを入れる汎用の埋め込みと、アカウントに登録した「自分のアプリ」
 * （URL登録・HTMLアップロード）からの配置の両方を受ける。
 */
export function EmbedPanel({
  onEmbed,
  signedIn,
}: {
  onEmbed: (url: string, label?: string) => void;
  signedIn: boolean;
}) {
  const activity = useActivityPanel();
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [apps, setApps] = useState<UserApp[] | null>(null);
  const [appsError, setAppsError] = useState("");
  const [busy, setBusy] = useState(false);
  const [linkName, setLinkName] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [uploadName, setUploadName] = useState("");
  const [file, setFile] = useState<File | null>(null);

  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    fetch("/api/user-apps")
      .then(async (response) => {
        if (!response.ok) throw new Error("load");
        return response.json();
      })
      .then((data) => {
        if (live) setApps(data.apps as UserApp[]);
      })
      .catch(() => {
        if (live) setAppsError("自分のアプリを読み込めませんでした。");
      });
    return () => {
      live = false;
    };
  }, [signedIn]);

  const place = (target: string, label?: string) => {
    try {
      onEmbed(normalizeEmbedUrl(target), label);
      activity.close();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const appUrl = (app: UserApp) =>
    app.kind === "upload"
      ? `${location.origin}/pub/apps/${app.id}`
      : app.url;

  const mutate = async (init: RequestInit) => {
    setBusy(true);
    setAppsError("");
    try {
      const response = await fetch("/api/user-apps", init);
      const data = (await response.json().catch(() => ({}))) as {
        apps?: UserApp[];
        error?: string;
      };
      if (!response.ok)
        throw new Error(data.error || "操作できませんでした。");
      if (data.apps) setApps(data.apps);
    } catch (e) {
      setAppsError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const post = (payload: unknown) =>
    mutate({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  const addLink = async () => {
    await post({ kind: "url", name: linkName, url: linkUrl });
    setLinkName("");
    setLinkUrl("");
  };
  const addUpload = async () => {
    if (!file) return;
    if (file.size > 10_000_000) {
      setAppsError("HTMLファイルは10MBまでです。");
      return;
    }
    const html = await file.text();
    await post({
      kind: "upload",
      name: uploadName || file.name.replace(/\.html?$/i, ""),
      html,
    });
    setUploadName("");
    setFile(null);
  };
  const removeApp = async (app: UserApp) => {
    setBusy(true);
    setAppsError("");
    try {
      const response = await fetch(`/api/user-apps/${app.id}`, {
        method: "DELETE",
      });
      const data = (await response.json().catch(() => ({}))) as {
        apps?: UserApp[];
        error?: string;
      };
      if (!response.ok)
        throw new Error(data.error || "削除できませんでした。");
      if (data.apps) setApps(data.apps);
    } catch (e) {
      setAppsError((e as Error).message);
    } finally {
      setBusy(false);
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
        <strong>用意されているアプリ</strong>
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
      {signedIn ? (
        <div className="embed-myapps">
          <strong>自分のアプリ</strong>
          {appsError && (
            <p role="alert" className="embed-panel-error">
              {appsError}
            </p>
          )}
          {apps === null && !appsError && (
            <p className="embed-panel-note">読み込み中…</p>
          )}
          {apps?.map((app) => (
            <div key={app.id} className="embed-myapp-row">
              <span className="embed-myapp-name">{app.name}</span>
              <span className="embed-myapp-meta">
                {app.kind === "upload"
                  ? `アップロード（${formatBytes(app.sizeBytes)}）`
                  : embedHostName(app.url)}
              </span>
              <button
                type="button"
                className="button outline"
                disabled={busy}
                onClick={() => place(appUrl(app), app.name)}
              >
                配置
              </button>
              <button
                type="button"
                className="button outline"
                disabled={busy}
                onClick={() => void removeApp(app)}
              >
                削除
              </button>
            </div>
          ))}
          {apps?.length === 0 && (
            <p className="embed-panel-note">
              まだ登録がありません。下のどちらかで追加できます。
            </p>
          )}
          <div className="embed-myapp-add">
            <span>HTMLファイルで追加（単体で動くもの・10MBまで）</span>
            <input
              type="text"
              value={uploadName}
              placeholder="アプリの名前"
              onChange={(event) => setUploadName(event.target.value)}
            />
            <input
              type="file"
              accept=".html,.htm,text/html"
              onChange={(event) => {
                const picked = event.target.files?.[0] ?? null;
                setFile(picked);
                if (picked && !uploadName)
                  setUploadName(picked.name.replace(/\.html?$/i, ""));
              }}
            />
            <button
              type="button"
              className="button outline"
              disabled={busy || !file}
              onClick={() => void addUpload()}
            >
              アップロードして追加
            </button>
          </div>
          <div className="embed-myapp-add">
            <span>URLで追加</span>
            <input
              type="text"
              value={linkName}
              placeholder="アプリの名前"
              onChange={(event) => setLinkName(event.target.value)}
            />
            <input
              type="url"
              value={linkUrl}
              placeholder="https://…"
              onChange={(event) => setLinkUrl(event.target.value)}
            />
            <button
              type="button"
              className="button outline"
              disabled={busy || !linkName.trim() || !linkUrl.trim()}
              onClick={() => void addLink()}
            >
              URLを追加
            </button>
          </div>
        </div>
      ) : (
        <p className="embed-panel-note">
          サインインすると、自分のアプリ（HTMLファイルのアップロードやURL登録）をここに保存して、どの作品からでも選べるようになります。
        </p>
      )}
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
        onClick={() => place(url)}
      >
        このアプリをスライドに配置
      </button>
      <p className="embed-panel-note">
        埋め込みを禁止しているサイトは、枠だけ表示されて中身が出ません。Scratch（TurboWarp）のプレイヤーのように、埋め込み用のURLが用意されているアプリが向いています。
      </p>
      <details className="embed-bridge-help">
        <summary>自分のアプリのサムネイルを出すには</summary>
        <p>
          自作アプリに次の1行を入れると、配置したときにアプリが自分の画面を撮影して渡し、全体マップのサムネイルにその画像が出るようになります（サムネイル表示でアプリ本体は読み込まれません）。アップロードするHTMLにも入れられます。
        </p>
        <code>
          {
            '<script src="https://vhslide-textmine.overdozer1124.workers.dev/v1/embed-bridge.js"></script>'
          }
        </code>
      </details>
    </div>
  );
}
