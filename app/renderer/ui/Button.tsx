import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cx } from './cx.ts';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-ink border-transparent hover:opacity-90',
  secondary: 'bg-panel text-ink border-line hover:bg-raised',
  ghost: 'bg-transparent text-ink border-transparent hover:bg-raised',
  danger: 'bg-down text-status-ink border-transparent hover:opacity-90',
};

const sizes: Record<ButtonSize, string> = {
  sm: 'h-7 px-2.5 text-xs gap-1.5',
  md: 'h-9 px-3.5 text-sm gap-2',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** A lucide icon element shown before the label. */
  icon?: ReactNode;
}

export const Button = ({ variant = 'secondary', size = 'md', icon, className, children, type = 'button', ...rest }: ButtonProps) => (
  <button
    type={type}
    className={cx(
      'inline-flex shrink-0 items-center justify-center rounded-md border font-medium whitespace-nowrap',
      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
      'disabled:pointer-events-none disabled:opacity-40',
      variants[variant], sizes[size], className,
    )}
    {...rest}
  >
    {icon}
    {children}
  </button>
);
