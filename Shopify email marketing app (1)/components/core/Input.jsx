import React from 'react';

export function Input({ label, hint, id, ...rest }) {
  return (
    <label htmlFor={id} style={{ display: 'flex', flexDirection: 'column', gap: 6, fontFamily: 'var(--font-ui)' }}>
      {label && <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{label}</span>}
      <input id={id} style={{
        fontFamily: 'var(--font-ui)', fontSize: 14, padding: '9px 12px',
        border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)',
        background: 'var(--surface-card)', color: 'var(--text-body)',
      }} {...rest} />
      {hint && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{hint}</span>}
    </label>
  );
}
