"use client";

import { useState, type ReactNode } from "react";

export function ProductionDetailTabs({
  sections,
}: {
  sections: { id: string; label: string; content: ReactNode }[];
}) {
  const [active, setActive] = useState(sections[0]?.id ?? "flow");

  return (
    <div>
      <div className="prod-detail-tabs" role="tablist">
        {sections.map((section) => (
          <button
            key={section.id}
            type="button"
            role="tab"
            aria-selected={active === section.id}
            className={active === section.id ? "is-active" : undefined}
            onClick={() => setActive(section.id)}
          >
            {section.label}
          </button>
        ))}
      </div>
      {sections.map((section) =>
        active === section.id ? (
          <div key={section.id} role="tabpanel">
            {section.content}
          </div>
        ) : null,
      )}
    </div>
  );
}
