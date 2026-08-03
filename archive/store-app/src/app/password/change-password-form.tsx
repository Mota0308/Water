"use client";

import { useActionState } from "react";
import {
  changeOwnPasswordAction,
  type ActionMessage,
} from "@/app/actions/accounts";

const empty: ActionMessage = {};

export function ChangePasswordForm() {
  const [state, action, pending] = useActionState(changeOwnPasswordAction, empty);

  return (
    <form action={action} className="form-grid">
      <label>
        舊密碼
        <input
          name="oldPassword"
          type="password"
          required
          disabled={pending}
        />
      </label>
      <label>
        新密碼
        <input
          name="newPassword"
          type="password"
          required
          disabled={pending}
        />
      </label>
      <button type="submit" disabled={pending}>
        {pending ? "更新中…" : "更新密碼"}
      </button>
      {state.error ? <p className="form-error">{state.error}</p> : null}
      {state.success ? <p className="form-success">{state.success}</p> : null}
    </form>
  );
}
