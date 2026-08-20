export function Card({ title, meta, children, elevated = false }) {
  return (
    <div style={{
      background: 'var(--surface-card)', borderRadius: 'var(--radius-md)',
      padding: 'var(--space-4)', boxShadow: elevated ? 'var(--shadow-md)' : 'var(--shadow-sm)',
      fontFamily: 'var(--font-ui)',
    }}>
      {title && <p style={{ font: '600 17px/1.3 var(--font-ui)', margin: '0 0 4px' }}>{title}</p>}
      {meta && <p style={{ font: '13px var(--font-ui)', color: 'var(--text-muted)', margin: '0 0 10px' }}>{meta}</p>}
      <div style={{ fontSize: 14, lineHeight: 1.5 }}>{children}</div>
    </div>
  );
}
