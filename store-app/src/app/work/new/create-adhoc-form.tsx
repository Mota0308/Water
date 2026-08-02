"use client";

import { useActionState } from "react";
import type { FixedUnit } from "@/application/store-work-flow-app";
import {
  createAdhocWorkAction,
  type WorkActionMessage,
} from "@/app/actions/work";

const empty: WorkActionMessage = {};

export function CreateAdhocForm({ units }: { units: FixedUnit[] }) {
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
      <fieldset className="span-2 unit-fieldset">
        <legend>適用單位</legend>
        {units.map((unit) => (
          <label key={unit} className="checkbox-row">
            <input
              type="checkbox"
              name="units"
              value={unit}
              defaultChecked={unit !== "國內倉"}
              disabled={pending}
            />
            {unit}
          </label>
        ))}
      </fieldset>
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
