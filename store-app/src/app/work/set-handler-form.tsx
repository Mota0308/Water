"use client";

import { useActionState } from "react";
import {
  setWorkHandlerAction,
  type WorkActionMessage,
} from "@/app/actions/work";
import type { UnitHandlerOption } from "@/app/work/unit-handler-fields";

const empty: WorkActionMessage = {};

export function SetWorkHandlerForm({
  workId,
  currentHandlerId,
  handlers,
}: {
  workId: string;
  currentHandlerId: string | null;
  handlers: UnitHandlerOption[];
}) {
  const [state, action, pending] = useActionState(setWorkHandlerAction, empty);

  return (
    <form action={action} className="form-grid compact">
      <input type="hidden" name="workId" value={workId} />
      <label>
        負責人
        <select
          name="handlerAccountId"
          defaultValue={currentHandlerId ?? ""}
          disabled={pending}
        >
          <option value="">無負責人（地區共享）</option>
          {handlers.map((handler) => (
            <option key={handler.accountId} value={handler.accountId}>
              {handler.displayName}（{handler.department ?? "—"}）
            </option>
          ))}
        </select>
      </label>
      <button type="submit" disabled={pending}>
        {pending ? "更新中…" : "更新負責人"}
      </button>
      {state.error ? <p className="form-error">{state.error}</p> : null}
      {state.success ? <p className="meta">{state.success}</p> : null}
    </form>
  );
}
