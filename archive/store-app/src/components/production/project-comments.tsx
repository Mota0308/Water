"use client";

import { useActionState } from "react";
import {
  highlightMentions,
  type ProductionCommentView,
  type ProductionProjectType,
} from "@/application/production-domain";
import {
  addProductionCommentAction,
  removeProductionCommentAction,
  type ProductionActionMessage,
} from "@/app/actions/production";

const empty: ProductionActionMessage = {};

export function ProjectComments({
  projectId,
  type,
  comments,
  isAdmin,
}: {
  projectId: string;
  type: ProductionProjectType;
  comments: ProductionCommentView[];
  isAdmin: boolean;
}) {
  const [addState, addAction, addPending] = useActionState(
    addProductionCommentAction,
    empty,
  );
  const [removeState, removeAction, removePending] = useActionState(
    removeProductionCommentAction,
    empty,
  );

  const roots = comments.filter((c) => !c.parentId);
  const replies = (parentId: string) =>
    comments.filter((c) => c.parentId === parentId);

  return (
    <section className="personal-card stack">
      <h2 className="personal-card-title">留言板</h2>
      <p className="meta">
        可用 @姓名 提及同事。留言不代表階段完成。
      </p>

      {roots.length === 0 ? (
        <p className="meta">暫無留言。</p>
      ) : (
        <ul className="prod-comment-list">
          {roots.map((comment) => (
            <li key={comment.id} className="prod-comment">
              <CommentBody
                comment={comment}
                isAdmin={isAdmin}
                projectId={projectId}
                type={type}
                removeAction={removeAction}
                removePending={removePending}
              />
              <ul className="prod-comment-replies">
                {replies(comment.id).map((reply) => (
                  <li key={reply.id} className="prod-comment">
                    <CommentBody
                      comment={reply}
                      isAdmin={isAdmin}
                      projectId={projectId}
                      type={type}
                      removeAction={removeAction}
                      removePending={removePending}
                    />
                  </li>
                ))}
              </ul>
              <form action={addAction} className="form-grid compact">
                <input type="hidden" name="projectId" value={projectId} />
                <input type="hidden" name="type" value={type} />
                <input type="hidden" name="parentId" value={comment.id} />
                <label className="span-2">
                  回覆
                  <input name="text" required disabled={addPending} />
                </label>
                <button type="submit" disabled={addPending}>
                  回覆
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}

      <form action={addAction} className="form-grid">
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="type" value={type} />
        <label className="span-2">
          發表新留言
          <textarea
            name="text"
            rows={3}
            required
            disabled={addPending}
            placeholder="例如：@Ann 請跟進樣本…"
          />
        </label>
        <button type="submit" disabled={addPending}>
          發表留言
        </button>
        {addState.error ? <p className="form-error">{addState.error}</p> : null}
        {addState.success ? <p className="meta">{addState.success}</p> : null}
        {removeState.error ? <p className="form-error">{removeState.error}</p> : null}
      </form>
    </section>
  );
}

function CommentBody({
  comment,
  isAdmin,
  projectId,
  type,
  removeAction,
  removePending,
}: {
  comment: ProductionCommentView;
  isAdmin: boolean;
  projectId: string;
  type: ProductionProjectType;
  removeAction: (payload: FormData) => void;
  removePending: boolean;
}) {
  return (
    <div>
      <p className="meta">
        {comment.authorDisplayName} ·{" "}
        {comment.createdAt.toLocaleString("zh-HK", {
          timeZone: "Asia/Hong_Kong",
        })}
        {comment.removed ? " · 已移除" : ""}
      </p>
      {comment.removed ? (
        <p className="meta">此留言已由管理層移除。</p>
      ) : (
        <p
          dangerouslySetInnerHTML={{
            __html: highlightMentions(comment.text),
          }}
        />
      )}
      {isAdmin && !comment.removed ? (
        <form action={removeAction}>
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="type" value={type} />
          <input type="hidden" name="commentId" value={comment.id} />
          <button type="submit" className="text-btn" disabled={removePending}>
            移除留言
          </button>
        </form>
      ) : null}
    </div>
  );
}
