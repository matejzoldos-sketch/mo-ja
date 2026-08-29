import type { ReactNode } from "react";

export type DashboardMetaItem = {
  label: string;
  value: string;
};

export function DashboardMetaBar({ items }: { items: DashboardMetaItem[] }) {
  if (!items.length) return null;

  return (
    <div className="dashboard-meta-bar" role="doc-subtitle">
      {items.map((item) => (
        <span
          className="dashboard-meta-bar__chip"
          key={`${item.label}-${item.value}`}
        >
          <span className="dashboard-meta-bar__label">{item.label}</span>
          <span className="dashboard-meta-bar__value">{item.value}</span>
        </span>
      ))}
    </div>
  );
}

export type DashboardFootnote = string | ReactNode;

export function DashboardFootnotes({
  title = "Vysvetlivky",
  items,
}: {
  title?: string;
  items: DashboardFootnote[];
}) {
  if (!items.length) return null;

  return (
    <aside className="dashboard-footnotes" aria-label={title}>
      <p className="dashboard-footnotes__title">{title}</p>
      <ul className="dashboard-footnotes__list">
        {items.map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </ul>
    </aside>
  );
}
