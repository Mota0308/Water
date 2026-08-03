"use client";

import { useActionState } from "react";
import {
  PRODUCT_CATEGORIES,
  stagesForType,
  type ProductionProjectType,
} from "@/application/production-domain";
import {
  createProductionProjectAction,
  type ProductionActionMessage,
} from "@/app/actions/production";

const empty: ProductionActionMessage = {};

export function CreateProjectForm({
  type,
  handlers,
}: {
  type: ProductionProjectType;
  handlers: {
    accountId: string;
    displayName: string;
    department: string | null;
  }[];
}) {
  const [state, action, pending] = useActionState(
    createProductionProjectAction,
    empty,
  );
  const stages = stagesForType(type);

  return (
    <form action={action} className="form-grid">
      <input type="hidden" name="type" value={type} />
      <label>
        產品編號
        <input name="code" required disabled={pending} />
      </label>
      <label>
        產品名稱
        <input name="name" required disabled={pending} />
      </label>
      <label>
        分類
        <select name="category" required disabled={pending} defaultValue="">
          <option value="" disabled>
            請選擇
          </option>
          {PRODUCT_CATEGORIES.map((cat) => (
            <option key={cat} value={cat}>
              {cat}
            </option>
          ))}
        </select>
      </label>
      <label>
        整體期限
        <input name="dueDate" type="date" disabled={pending} />
      </label>
      <label className="span-2">
        說明
        <textarea name="description" rows={2} disabled={pending} />
      </label>

      <fieldset className="span-2 unit-fieldset">
        <legend>各階段經手人</legend>
        <div className="form-grid compact">
          {stages.map((stageName, index) => (
            <label key={stageName}>
              {index + 1}. {stageName}
              <select
                name={`stageHandler_${index}`}
                disabled={pending}
                defaultValue=""
              >
                <option value="">未指定</option>
                {handlers.map((h) => (
                  <option key={h.accountId} value={h.accountId}>
                    {h.displayName}（{h.department ?? "—"}）
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      </fieldset>

      {state.error ? <p className="form-error span-2">{state.error}</p> : null}
      <button type="submit" className="span-2" disabled={pending}>
        {pending ? "建立中…" : "建立項目"}
      </button>
    </form>
  );
}
