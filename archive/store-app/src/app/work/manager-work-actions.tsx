"use client";

import { useActionState } from "react";
import type { WorkPriority, WorkType } from "@/application/store-work-flow-app";
import {
  cancelAdhocWorkAction,
  reopenWorkAction,
  updateWorkAction,
  type WorkActionMessage,
} from "@/app/actions/work";

const empty: WorkActionMessage = {};

/** Row actions: reopen / cancel only. */
export function ManagerWorkActions({
  workId,
  status,
  type,
}: {
  workId: string;
  status: string;
  type: WorkType;
}) {
  const [reopenState, reopenAction, reopenPending] = useActionState(
    reopenWorkAction,
    empty,
  );
  const [cancelState, cancelAction, cancelPending] = useActionState(
    cancelAdhocWorkAction,
    empty,
  );

  return (
    <div className="manager-actions slim">
      {status === "completed" ? (
        <form action={reopenAction} className="inline-form wrap">
          <input type="hidden" name="workId" value={workId} />
          <input
            name="reason"
            placeholder="重新開啟原因"
            required
            disabled={reopenPending}
          />
          <button type="submit" disabled={reopenPending}>
            重新開啟
          </button>
          {reopenState.error ? (
            <p className="form-error">{reopenState.error}</p>
          ) : null}
        </form>
      ) : null}

      {status === "pending" && type === "adhoc" ? (
        <form action={cancelAction}>
          <input type="hidden" name="workId" value={workId} />
          <button type="submit" className="secondary" disabled={cancelPending}>
            取消此突發工作
          </button>
          {cancelState.error ? (
            <p className="form-error">{cancelState.error}</p>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}

/** Full edit form for work detail page. */
export function ManagerEditWorkForm({
  workId,
  title,
  content,
  priority,
}: {
  workId: string;
  title: string;
  content: string;
  priority: WorkPriority;
}) {
  const [editState, editAction, editPending] = useActionState(
    updateWorkAction,
    empty,
  );

  return (
    <form action={editAction} className="form-grid compact">
      <input type="hidden" name="workId" value={workId} />
      <label>
        名稱
        <input
          name="title"
          defaultValue={title}
          required
          disabled={editPending}
        />
      </label>
      <label className="span-2">
        內容
        <textarea
          name="content"
          rows={3}
          defaultValue={content}
          required
          disabled={editPending}
        />
      </label>
      <label>
        優先程度
        <select name="priority" defaultValue={priority} disabled={editPending}>
          <option value="normal">一般</option>
          <option value="important">重要</option>
          <option value="urgent">緊急</option>
        </select>
      </label>
      <button type="submit" disabled={editPending}>
        儲存變更
      </button>
      {editState.error ? (
        <p className="form-error span-2">{editState.error}</p>
      ) : null}
      {editState.success ? (
        <p className="form-success span-2">{editState.success}</p>
      ) : null}
    </form>
  );
}
