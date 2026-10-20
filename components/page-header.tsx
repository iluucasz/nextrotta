interface PageHeaderProps {
  title: string;
  description?: string;
  eyebrow?: string;
  children?: React.ReactNode;
}

export function PageHeader({ title, description, eyebrow, children }: PageHeaderProps) {
  return (
    <div className="app-page-header">
      <div className="min-w-0 max-w-3xl">
        {eyebrow ? <p className="app-eyebrow">{eyebrow}</p> : null}
        <h1>{title}<span aria-hidden="true" className="app-title-dot">.</span></h1>
        {description ? <p className="app-page-description">{description}</p> : null}
      </div>
      {children ? <div className="app-page-actions flex flex-wrap items-center gap-2">{children}</div> : null}
    </div>
  );
}
