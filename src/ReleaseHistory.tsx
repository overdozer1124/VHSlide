import { ArrowLeft, History } from "lucide-react";
import { APP_VERSION, releaseHistory } from "./releaseHistory";
export default function ReleaseHistory({ onClose }: { onClose: () => void }) {
  return (
    <section
      className="release-history"
      role="region"
      aria-label="更新履歴"
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") onClose();
      }}
    >
      <header>
        <button className="button outline" onClick={onClose} autoFocus>
          <ArrowLeft size={18} />
          アプリに戻る
        </button>
        <span>VHSlide · v{APP_VERSION}</span>
      </header>
      <main>
        <h1>
          <History size={25} />
          更新履歴
        </h1>
        <p>新しく使える機能や、使いやすくなったところをまとめています。</p>
        <p className="release-note">
          過去の履歴は開発記録からさかのぼって整理し、バージョン番号を付けています。
        </p>
        <ol>
          {releaseHistory.map((release, index) => (
            <li key={release.version} data-version={release.version}>
              <div className="release-meta">
                <strong>v{release.version}</strong>
                <time dateTime={release.date}>
                  {release.date.replaceAll("-", " / ")}
                </time>
                {index === 0 && <span>最新</span>}
              </div>
              <h2>{release.title}</h2>
              <ul>
                {release.changes.map((change) => (
                  <li key={change}>{change}</li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      </main>
    </section>
  );
}
