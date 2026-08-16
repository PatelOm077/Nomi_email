import React from 'react';

export function Button({ variant = 'primary', size = 'md', disabled = false, children, onClick, ...rest }) {
  const pad = size === 'sm' ? '6px 12px' : '10px 18px';
  const font = size === 'sm' ? 13 : 14;
  const base = {
    fontFamily: 'var(--font-ui)', fontSize: font, fontWeight: 600, lineHeight: 1.2,
    padding: pad, borderRadius: 'var(--radius-md)', cursor: disabled ? 'default' : 'pointer',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
    whiteSpace: 'nowrap', opacity: disabled ? 0.45 : 1, transition: 'background 120ms, color 120ms',
  };
  const variants = {
    primary: { background: 'var(--accent-action)', color: '#fff', border: '1px solid transparent' },
    secondary: { background: 'transparent', color: 'var(--nomi-cyan-text)', border: '1px solid var(--border-subtle)' },
    ghost: { background: 'transparent', color: 'var(--nomi-cyan-text)', border: '1px solid transparent' },
  };
  return (
    <button type="button" disabled={disabled} onClick={onClick} style={{ ...base, ...variants[variant] }} {...rest}>
      {children}
    </button>
  );
}
