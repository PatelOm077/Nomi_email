import * as React from 'react';

/**
 * Nomi's action button. Interface chrome, so it sets in the system sans, never the serif.
 * @startingPoint section="Core" subtitle="Primary, secondary and ghost actions" viewport="700x150"
 */
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual weight. Primary is the solid cyan fill; only one per view. */
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md';
  disabled?: boolean;
  children?: React.ReactNode;
}
export function Button(props: ButtonProps): JSX.Element;
