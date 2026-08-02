"use client";

import { useActionState } from "react";
import type { AccountView, FixedUnit } from "@/application/store-work-flow-app";
import {
  changeUnitAction,
  createAccountAction,
  resetPasswordAction,
  setStatusAction,
  type ActionMessage,
} from "@/app/actions/accounts";

const empty: ActionMessage = {};

export function AccountAdminForms({
  units,
  accounts,
}: {
  units: FixedUnit[];
  accounts: AccountView[];
}) {
  const [createState, createAction, createPending] = useActionState(
    createAccountAction,
    empty,
  );

  return (
    <div className="stack">
      <section className="card">
        <h2>建立賬號</h2>
        <form action={createAction} className="form-grid">
          <label>
            姓名
            <input name="displayName" required disabled={createPending} />
          </label>
          <label>
            登入名稱
            <input name="loginName" required disabled={createPending} />
          </label>
          <label>
            初始密碼
            <input
              name="password"
              type="password"
              required
              disabled={createPending}
            />
          </label>
          <label>
            賬號級別
            <select name="role" defaultValue="personal" disabled={createPending}>
              <option value="personal">個人賬號</option>
              <option value="manager">一般管理層</option>
              <option value="system_admin">系統管理員</option>
            </select>
          </label>
          <label>
            固定單位（個人賬號必填）
            <select name="fixedUnit" defaultValue="觀塘" disabled={createPending}>
              {units.map((unit) => (
                <option key={unit} value={unit}>
                  {unit}
                </option>
              ))}
            </select>
          </label>
          <label>
            職位（選填）
            <input name="jobTitle" disabled={createPending} />
          </label>
          <label>
            部門（選填）
            <input name="department" disabled={createPending} />
          </label>
          <button type="submit" disabled={createPending}>
            {createPending ? "建立中…" : "建立賬號"}
          </button>
        </form>
        {createState.error ? <p className="form-error">{createState.error}</p> : null}
        {createState.success ? (
          <p className="form-success">{createState.success}</p>
        ) : null}
      </section>

      <section className="card">
        <h2>現有賬號</h2>
        <div className="account-list">
          {accounts.map((account) => (
            <article key={account.id} className="account-item">
              <div>
                <strong>
                  {account.displayName}（{account.loginName}）
                </strong>
                <p>
                  {roleLabel(account.role)}
                  {account.fixedUnit ? ` · ${account.fixedUnit}` : ""}
                  {` · ${account.status === "active" ? "啟用中" : "已暫停"}`}
                </p>
              </div>

              <AccountRowActions account={account} units={units} />
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function AccountRowActions({
  account,
  units,
}: {
  account: AccountView;
  units: FixedUnit[];
}) {
  const [resetState, resetAction, resetPending] = useActionState(
    resetPasswordAction,
    empty,
  );
  const [statusState, statusAction, statusPending] = useActionState(
    setStatusAction,
    empty,
  );
  const [unitState, unitAction, unitPending] = useActionState(
    changeUnitAction,
    empty,
  );

  return (
    <div className="account-actions">
      <form action={resetAction} className="inline-form">
        <input type="hidden" name="accountId" value={account.id} />
        <input
          name="newPassword"
          type="password"
          placeholder="新密碼"
          required
          disabled={resetPending}
        />
        <button type="submit" disabled={resetPending}>
          重設密碼
        </button>
      </form>

      <form action={statusAction}>
        <input type="hidden" name="accountId" value={account.id} />
        <input
          type="hidden"
          name="status"
          value={account.status === "active" ? "suspended" : "active"}
        />
        <button type="submit" disabled={statusPending}>
          {account.status === "active" ? "暫停" : "重新啟用"}
        </button>
      </form>

      {account.role === "personal" ? (
        <form action={unitAction} className="inline-form">
          <input type="hidden" name="accountId" value={account.id} />
          <select
            name="fixedUnit"
            defaultValue={account.fixedUnit ?? "觀塘"}
            disabled={unitPending}
          >
            {units.map((unit) => (
              <option key={unit} value={unit}>
                {unit}
              </option>
            ))}
          </select>
          <input
            name="reason"
            placeholder="調職原因（選填）"
            disabled={unitPending}
          />
          <button type="submit" disabled={unitPending}>
            更改單位
          </button>
        </form>
      ) : null}

      {resetState.error || statusState.error || unitState.error ? (
        <p className="form-error">
          {resetState.error || statusState.error || unitState.error}
        </p>
      ) : null}
      {resetState.success || statusState.success || unitState.success ? (
        <p className="form-success">
          {resetState.success || statusState.success || unitState.success}
        </p>
      ) : null}
    </div>
  );
}

function roleLabel(role: string): string {
  switch (role) {
    case "system_admin":
      return "系統管理員";
    case "manager":
      return "一般管理層";
    default:
      return "個人賬號";
  }
}
