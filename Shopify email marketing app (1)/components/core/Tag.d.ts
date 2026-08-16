import * as React from 'react';

/** Small status label — campaign state, list size, delivery result. */
export interface TagProps {
  /** Magenta is the spot color: at most one magenta tag in a view. */
  tone?: 'neutral' | 'cyan' | 'magenta';
  children?: React.ReactNode;
}
export function Tag(props: TagProps): JSX.Element;
