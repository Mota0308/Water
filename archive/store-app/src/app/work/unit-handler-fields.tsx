"use client";

import { useMemo, useState } from "react";
import type { FixedUnit } from "@/application/store-work-flow-app";

export type UnitHandlerOption = {
  accountId: string;
  displayName: string;
  department: string | null;
};

export function UnitHandlerFields({
  units,
  handlersByUnit,
  defaultChecked,
  disabled,
}: {
  units: FixedUnit[];
  handlersByUnit: Partial<Record<FixedUnit, UnitHandlerOption[]>>;
  defaultChecked: (unit: FixedUnit) => boolean;
  disabled?: boolean;
}) {
  const [selected, setSelected] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const unit of units) initial[unit] = defaultChecked(unit);
    return initial;
  });

  const activeUnits = useMemo(
    () => units.filter((unit) => selected[unit]),
    [units, selected],
  );

  return (
    <>
      <fieldset className="span-2 unit-fieldset">
        <legend>適用地區</legend>
        {units.map((unit) => (
          <label key={unit} className="checkbox-row">
            <input
              type="checkbox"
              name="units"
              value={unit}
              checked={!!selected[unit]}
              disabled={disabled}
              onChange={(event) =>
                setSelected((prev) => ({
                  ...prev,
                  [unit]: event.target.checked,
                }))
              }
            />
            {unit}
          </label>
        ))}
      </fieldset>

      {activeUnits.length > 0 ? (
        <fieldset className="span-2 unit-fieldset">
          <legend>各地區負責人（選填）</legend>
          <div className="form-grid compact">
            {activeUnits.map((unit) => (
              <label key={unit}>
                {unit}
                <select name={`handler_${unit}`} defaultValue="" disabled={disabled}>
                  <option value="">無負責人（地區共享）</option>
                  {(handlersByUnit[unit] ?? []).map((handler) => (
                    <option key={handler.accountId} value={handler.accountId}>
                      {handler.displayName}
                      （{handler.department ?? "—"}）
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}
    </>
  );
}
