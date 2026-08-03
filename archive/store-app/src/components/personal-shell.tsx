import type { Session } from "@/application/store-work-flow-app";
import { AppShell, type AppTab } from "@/components/app-shell";

export type PersonalTab = "today" | "progress" | "records";

/** @deprecated Prefer AppShell; kept for personal page call sites. */
export function PersonalShell({
  session,
  active,
  children,
}: {
  session: Session;
  active: PersonalTab;
  children: React.ReactNode;
}) {
  return (
    <AppShell session={session} active={active as AppTab}>
      {children}
    </AppShell>
  );
}
