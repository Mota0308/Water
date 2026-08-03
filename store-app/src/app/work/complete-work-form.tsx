"use client";

import { useActionState, useState } from "react";
import type {
  AttachmentRequirement,
  NoteRequirement,
} from "@/application/store-work-flow-app";
import {
  completeWorkAction,
  type WorkActionMessage,
} from "@/app/actions/work";

const empty: WorkActionMessage = {};

export function CompleteWorkForm({
  workId,
  attachmentRequirement,
  noteRequirement,
  variant = "form",
}: {
  workId: string;
  attachmentRequirement: AttachmentRequirement;
  noteRequirement: NoteRequirement;
  variant?: "form" | "checkbox";
}) {
  const [state, action, pending] = useActionState(completeWorkAction, empty);
  const [expanded, setExpanded] = useState(false);
  const needsForm =
    attachmentRequirement !== "none" || noteRequirement === "required";
  const attachmentRequired = attachmentRequirement === "required";
  const noteRequired = noteRequirement === "required";
  const showAttachment = attachmentRequirement !== "none";

  if (variant === "checkbox" && !needsForm) {
    return (
      <form action={action} className="complete-checkbox">
        <input type="hidden" name="workId" value={workId} />
        <button
          type="submit"
          className="task-check"
          disabled={pending}
          aria-label="剔選完成"
          title="剔選完成"
        />
        {state.error ? <p className="form-error">{state.error}</p> : null}
      </form>
    );
  }

  if (variant === "checkbox" && !expanded) {
    return (
      <div className="complete-checkbox">
        <button
          type="button"
          className="task-check"
          disabled={pending}
          aria-label="完成此工作（需填寫資料）"
          title="完成此工作"
          onClick={() => setExpanded(true)}
        />
      </div>
    );
  }

  return (
    <form
      action={action}
      className="complete-form"
      encType="multipart/form-data"
    >
      <input type="hidden" name="workId" value={workId} />
      <label>
        完成備註{noteRequired ? "（必填）" : "（選填）"}
        <textarea
          name="note"
          rows={2}
          required={noteRequired}
          disabled={pending}
        />
      </label>
      {showAttachment ? (
        <label>
          附件{attachmentRequired ? "（必填）" : "（選填）"}· 圖片或 PDF
          <input
            type="file"
            name="attachments"
            accept="image/*,application/pdf"
            multiple
            required={attachmentRequired}
            disabled={pending}
          />
        </label>
      ) : null}
      <div className="complete-form-actions">
        {variant === "checkbox" ? (
          <button
            type="button"
            className="secondary"
            disabled={pending}
            onClick={() => setExpanded(false)}
          >
            取消
          </button>
        ) : null}
        <button type="submit" disabled={pending}>
          {pending ? "提交中…" : "確認完成"}
        </button>
      </div>
      {state.error ? <p className="form-error">{state.error}</p> : null}
    </form>
  );
}
