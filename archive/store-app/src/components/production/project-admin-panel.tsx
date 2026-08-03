"use client";

import { useActionState } from "react";
import {
  PRODUCT_CATEGORIES,
  type ProductionProjectType,
  type ProductionProjectView,
} from "@/application/production-domain";
import {
  editProductionProjectAction,
  setProductionLifecycleAction,
  type ProductionActionMessage,
} from "@/app/actions/production";

const empty: ProductionActionMessage = {};

export function ProjectAdminPanel({
  project,
  type,
}: {
  project: ProductionProjectView;
  type: ProductionProjectType;
}) {
  const [editState, editAction, editPending] = useActionState(
    editProductionProjectAction,
    empty,
  );
  const [lifeState, lifeAction, lifePending] = useActionState(
    setProductionLifecycleAction,
    empty,
  );

  return (
    <section className="personal-card stack">
      <h2 className="personal-card-title">管理：編輯／暫停／取消</h2>
      <p className="meta">
        目前狀態：{project.status}
        {project.statusReason ? `（${project.statusReason}）` : ""}
      </p>

      <form action={editAction} className="form-grid">
        <input type="hidden" name="projectId" value={project.id} />
        <input type="hidden" name="type" value={type} />
        <label>
          產品編號
          <input name="code" defaultValue={project.code} required disabled={editPending} />
        </label>
        <label>
          產品名稱
          <input name="name" defaultValue={project.name} required disabled={editPending} />
        </label>
        <label>
          分類
          <select name="category" defaultValue={project.category} disabled={editPending}>
            {PRODUCT_CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
        </label>
        <label>
          整體期限
          <input
            name="dueDate"
            type="date"
            defaultValue={project.dueDate ?? ""}
            disabled={editPending}
          />
        </label>
        <label className="span-2">
          說明
          <textarea
            name="description"
            rows={2}
            defaultValue={project.description}
            disabled={editPending}
          />
        </label>
        <button type="submit" disabled={editPending}>
          儲存項目資料
        </button>
        {editState.error ? <p className="form-error">{editState.error}</p> : null}
        {editState.success ? <p className="meta">{editState.success}</p> : null}
      </form>

      <form action={lifeAction} className="form-grid compact">
        <input type="hidden" name="projectId" value={project.id} />
        <input type="hidden" name="type" value={type} />
        <label className="span-2">
          原因（必填）
          <input name="reason" required disabled={lifePending} placeholder="例如：等布料／需求取消" />
        </label>
        <button type="submit" name="status" value="暫停" disabled={lifePending}>
          暫停
        </button>
        <button
          type="submit"
          name="status"
          value="已取消"
          className="btn-secondary"
          disabled={lifePending}
        >
          取消項目
        </button>
        <button
          type="submit"
          name="status"
          value="進行中"
          className="btn-secondary"
          disabled={lifePending}
        >
          恢復進行
        </button>
        {lifeState.error ? <p className="form-error span-2">{lifeState.error}</p> : null}
        {lifeState.success ? <p className="meta span-2">{lifeState.success}</p> : null}
      </form>
    </section>
  );
}
