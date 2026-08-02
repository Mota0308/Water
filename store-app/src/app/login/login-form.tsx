"use client";

import { useActionState } from "react";
import { loginAction, type LoginFormState } from "@/app/actions/auth";

const initialState: LoginFormState = {};

export function LoginForm() {
  const [state, formAction, pending] = useActionState(loginAction, initialState);

  return (
    <form action={formAction} className="login-form">
      <label>
        登入名稱
        <input
          name="loginName"
          type="text"
          autoComplete="username"
          required
          disabled={pending}
        />
      </label>
      <label>
        密碼
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          disabled={pending}
        />
      </label>
      {state.error ? <p className="form-error" role="alert">{state.error}</p> : null}
      <button type="submit" disabled={pending}>
        {pending ? "登入中…" : "登入"}
      </button>
    </form>
  );
}
