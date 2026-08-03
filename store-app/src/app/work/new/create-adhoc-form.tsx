"use client";

import { useActionState } from "react";
import type { FixedUnit } from "@/application/store-work-flow-app";
import {
  createAdhocWorkAction,
  type WorkActionMessage,
} from "@/app/actions/work";
import {
  UnitHandlerFields,
  type UnitHandlerOption,
} from "@/app/work/unit-handler-fields";

const empty: WorkActionMessage = {};

export function CreateAdhocForm({
  units,
  handlersByUnit,
}: {
  units: FixedUnit[];
  handlersByUnit: Partial<Record<FixedUnit, UnitHandlerOption[]>>;
}) {
  const [state, action, pending] = useActionState(createAdhocWorkAction, empty);

  return (
    <form action={action} className="form-grid">
      <label>
        工作名稱
        <input name="title" required disabled={pending} />
      </label>
      <label className="span-2">
        工作內容
        <textarea name="content" rows={3} required disabled={pending} />
      </label>
      <label>
        優先程度
        <select name="priority" defaultValue="normal" disabled={pending}>
          <option value="normal">一般</option>
          <option value="important">重要</option>
          <option value="urgent">緊急</option>
        </select>
      </label>
      <label>
        完成期限（選填）
        <input name="dueAt" type="datetime-local" disabled={pending} />
      </label>
      <label>
        附件規則
        <select
          name="attachmentRequirement"
          defaultValue="none"
          disabled={pending}
        >
          <option value="none">不需附件</option>
          <option value="optional">附件選填</option>
          <option value="required">附件必填</option>
        </select>
      </label>
      <label>
        完成備註規則
        <select name="noteRequirement" defaultValue="optional" disabled={pending}>
          <option value="optional">備註選填</option>
          <option value="required">備註必填</option>
        </select>
      </label>
      <label className="checkbox-row span-2">
        <input type="checkbox" name="sensitive" disabled={pending} />
        標記為敏感（跨單位進度不顯示）
      </label>
      <UnitHandlerFields
        units={units}
        handlersByUnit={handlersByUnit}
        defaultChecked={(unit) => unit !== "國內倉"}
        disabled={pending}
      />
      <button type="submit" disabled={pending}>
        {pending ? "建立中…" : "建立突發工作"}
      </button>
      {state.error ? <p className="form-error span-2">{state.error}</p> : null}
      {state.success ? (
        <p className="form-success span-2">{state.success}</p>
      ) : null}
    </form>
  );
}
