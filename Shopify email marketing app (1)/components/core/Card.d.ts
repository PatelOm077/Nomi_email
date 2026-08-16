import * as React from 'react';

/** A discrete listing item — a campaign, a segment, a template. Not a layout container. */
export interface CardProps {
  title?: string;
  meta?: string;
  elevated?: boolean;
  children?: React.ReactNode;
}
export function Card(props: CardProps): JSX.Element;
