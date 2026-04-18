function Panel({ title, rightLabel, children, className = "" }) {
  return (
    <section className={`panel ${className}`}>
      <header className="panel-header">
        <h2>{title}</h2>
        <p>{rightLabel}</p>
      </header>
      <div className="panel-body">{children}</div>
    </section>
  );
}

export default Panel;
