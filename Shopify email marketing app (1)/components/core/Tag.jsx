import React from 'react';

export function Tag({ tone = 'neutral', children }) {
  const tones = {
    neutral: { background: 'var(--nomi-neutral-200)', color: 'var(--nomi-neutral-900)' },
    cyan: { background: 'var(--nomi-cyan-100)', color: 'var(--nomi-cyan-800)' },
    magenta: { background: 'var(--nomi-magenta-100)', color: 'var(--nomi-magenta-800)' },
  };
  return (
    <span style={{
      fontFamily: 'var(--font-ui)', fontSize: 12, lineHeight: 1.4, padding: '3px 8px',
      borderRadius: 'var(--radius-md)', display: 'inline-block', ...tones[tone],
    }}>{children}</span>
  );
}
