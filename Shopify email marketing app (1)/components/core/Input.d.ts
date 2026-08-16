import * as React from 'react';

/** Labelled text field for the admin UI. */
export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
}
export function Input(props: InputProps): JSX.Element;
