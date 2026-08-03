"use client";

import { useActionState } from "react";
import {
  FIXED_UNITS,
  type FixedUnit,
} from "@/application/store-work-flow-app";
import {
  updateWatchedUnitsAction,
  type SettingsActionMessage,
} from "@/app/actions/settings";

const empty: SettingsActionMessage = {};

export function WatchedUnitsForm({
  watchedUnits,
  fixedUnit,
}: {
  watchedUnits: FixedUnit[];
  fixedUnit: FixedUnit | null;
}) {
  const [state, action, pending] = useActionState(
    updateWatchedUnitsAction,
    empty,
  );
  const selected = new Set(watchedUnits);

  return (
    <form action={action} className="form-grid">
      <p className="meta span-2">
        所屬單位：{fixedUnit ?? "—"}（由管理員設定，不可在此更改）
      </p>
      <fieldset className="span-2 unit-fieldset">
        <legend>關注地區（至少選 1 個）</legend>
        {FIXED_UNITS.map((unit) => (
          <label key={unit} className="checkbox-row">
            <input
              type="checkbox"
              name="watchedUnits"
              value={unit}
              defaultChecked={selected.has(unit)}
              disabled={pending}
            />
            {unit}
          </label>
        ))}
      </fieldset>
      <button type="submit" className="span-2" disabled={pending}>
        {pending ? "儲存中…" : "儲存關注地區"}
      </button>
      {state.error ? <p className="form-error span-2">{state.error}</p> : null}
      {state.success ? (
        <p className="form-success span-2">{state.success}</p>
      ) : null}
    </form>
  );
}
