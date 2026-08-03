"use client";

import { useActionState } from "react";
import {
  HANDLER_STAGE_STATUSES,
  type ProductionProjectType,
  type ProductionStageView,
  type StageStatus,
} from "@/application/production-domain";
import {
  adminResolveStageAction,
  setProductionStageHandlerAction,
  updateProductionStageAction,
  type ProductionActionMessage,
} from "@/app/actions/production";

const empty: ProductionActionMessage = {};

function HandlerLabel({ stage }: { stage: ProductionStageView }) {
  if (!stage.handlerDisplayName) return <span className="meta">未指定</span>;
  return (
    <span>
      {stage.handlerDisplayName}
      <span className="meta">（{stage.handlerDepartment ?? "—"}）</span>
    </span>
  );
}

export function StagePanel({
  projectId,
  type,
  stage,
  isCurrent,
  canUpdate,
  isAdmin,
  handlers,
}: {
  projectId: string;
  type: ProductionProjectType;
  stage: ProductionStageView;
  isCurrent: boolean;
  canUpdate: boolean;
  isAdmin: boolean;
  handlers: {
    accountId: string;
    displayName: string;
    department: string | null;
  }[];
}) {
  const [updateState, updateAction, updatePending] = useActionState(
    updateProductionStageAction,
    empty,
  );
  const [resolveState, resolveAction, resolvePending] = useActionState(
    adminResolveStageAction,
    empty,
  );
  const [handlerState, handlerAction, handlerPending] = useActionState(
    setProductionStageHandlerAction,
    empty,
  );

  const message =
    updateState.error ||
    updateState.success ||
    resolveState.error ||
    resolveState.success ||
    handlerState.error ||
    handlerState.success;

  return (
    <li className={`prod-stage${isCurrent ? " is-current" : ""}`}>
      <div className="prod-stage-head">
        <strong>
          {stage.index + 1}. {stage.name}
        </strong>
        <span className={`pill status-open`}>{stage.status}</span>
      </div>
      <p className="meta">
        經手人：
        <HandlerLabel stage={stage} />
        {stage.deadline ? `｜期限 ${stage.deadline}` : null}
      </p>
      {stage.content ? <p className="meta">說明：{stage.content}</p> : null}

      {canUpdate ? (
        <form action={updateAction} className="form-grid compact">
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="type" value={type} />
          <input type="hidden" name="stageIndex" value={stage.index} />
          <label>
            更新狀態
            <select
              name="status"
              defaultValue={
                HANDLER_STAGE_STATUSES.includes(stage.status as StageStatus)
                  ? stage.status
                  : "進行中"
              }
              disabled={updatePending}
            >
              {HANDLER_STAGE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="span-2">
            簡短說明
            <input
              name="content"
              defaultValue={stage.content}
              disabled={updatePending}
            />
          </label>
          <button type="submit" disabled={updatePending}>
            {updatePending ? "儲存中…" : "儲存階段"}
          </button>
        </form>
      ) : null}

      {isAdmin && stage.status === "待確認" ? (
        <form action={resolveAction} className="form-grid compact">
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="type" value={type} />
          <input type="hidden" name="stageIndex" value={stage.index} />
          <label className="span-2">
            確認備註（選填）
            <input name="note" disabled={resolvePending} />
          </label>
          <button
            type="submit"
            name="decision"
            value="confirm"
            disabled={resolvePending}
          >
            確認通過
          </button>
          <button
            type="submit"
            name="decision"
            value="return"
            className="btn-secondary"
            disabled={resolvePending}
          >
            退回修改
          </button>
        </form>
      ) : null}

      {isAdmin ? (
        <form action={handlerAction} className="form-grid compact">
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="type" value={type} />
          <input type="hidden" name="stageIndex" value={stage.index} />
          <label>
            更改經手人
            <select
              name="handlerAccountId"
              defaultValue={stage.handlerAccountId ?? ""}
              required
              disabled={handlerPending}
            >
              <option value="" disabled>
                請選擇
              </option>
              {handlers.map((h) => (
                <option key={h.accountId} value={h.accountId}>
                  {h.displayName}（{h.department ?? "—"}）
                </option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={handlerPending}>
            更新經手人
          </button>
        </form>
      ) : null}

      {isAdmin && !canUpdate ? (
        <form action={updateAction} className="form-grid compact">
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="type" value={type} />
          <input type="hidden" name="stageIndex" value={stage.index} />
          <label>
            代為推進狀態
            <select
              name="status"
              defaultValue={
                HANDLER_STAGE_STATUSES.includes(stage.status as StageStatus)
                  ? stage.status
                  : "進行中"
              }
              disabled={updatePending}
            >
              {HANDLER_STAGE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="span-2">
            說明
            <input name="content" defaultValue={stage.content} disabled={updatePending} />
          </label>
          <button type="submit" disabled={updatePending}>
            管理員儲存
          </button>
        </form>
      ) : null}

      {message ? (
        <p className={updateState.error || resolveState.error || handlerState.error ? "form-error" : "meta"}>
          {message}
        </p>
      ) : null}
    </li>
  );
}
