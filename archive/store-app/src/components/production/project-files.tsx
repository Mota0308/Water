"use client";

import { useActionState } from "react";
import type {
  ProductionFileVersionView,
  ProductionProjectType,
} from "@/application/production-domain";
import {
  uploadProductionFileAction,
  type ProductionActionMessage,
} from "@/app/actions/production";

const empty: ProductionActionMessage = {};

export function ProjectFiles({
  projectId,
  type,
  files,
  canUpload,
}: {
  projectId: string;
  type: ProductionProjectType;
  files: ProductionFileVersionView[];
  canUpload: boolean;
}) {
  const [state, action, pending] = useActionState(
    uploadProductionFileAction,
    empty,
  );

  return (
    <section className="personal-card stack">
      <h2 className="personal-card-title">檔案版本</h2>
      <p className="meta">同一文件名可上傳多版本；系統保留舊版並標示最新。</p>

      {files.length === 0 ? (
        <p className="meta">尚無檔案。</p>
      ) : (
        <ul className="task-list">
          {files.map((file) => (
            <li key={file.id} className="task-item">
              <strong>
                {file.logicalName} · v{file.version}
                {file.isLatest ? " · 最新" : ""}
              </strong>
              <span className="meta">
                {file.fileName}｜{file.uploadedByDisplayName}｜
                {file.uploadedAt.toLocaleString("zh-HK", {
                  timeZone: "Asia/Hong_Kong",
                })}
              </span>
              <a href={`/api/production/files/${file.id}`}>下載</a>
            </li>
          ))}
        </ul>
      )}

      {canUpload ? (
        <form action={action} className="form-grid" encType="multipart/form-data">
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="type" value={type} />
          <label>
            文件邏輯名稱
            <input
              name="logicalName"
              placeholder="例如：技術規格單"
              disabled={pending}
            />
          </label>
          <label>
            檔案
            <input name="file" type="file" required disabled={pending} />
          </label>
          <button type="submit" disabled={pending}>
            {pending ? "上傳中…" : "上傳／新版本"}
          </button>
          {state.error ? <p className="form-error">{state.error}</p> : null}
          {state.success ? <p className="meta">{state.success}</p> : null}
        </form>
      ) : (
        <p className="meta">僅系統管理員或本項目經手人可上傳。</p>
      )}
    </section>
  );
}
