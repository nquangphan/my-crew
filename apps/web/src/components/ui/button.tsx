import { type ButtonHTMLAttributes, forwardRef } from 'react';
import { cn } from '../../lib/cn';

export type ButtonVariant = 'default' | 'primary' | 'ghost' | 'danger' | 'subtle';

const VARIANTS: Record<ButtonVariant, string> = {
  default: 'border-line bg-panel hover:bg-soft',
  primary: 'border-accent bg-accent text-white font-semibold hover:bg-accent-ink',
  ghost: 'border-transparent bg-transparent hover:bg-soft',
  danger: 'border-bad bg-bad text-white font-semibold hover:opacity-90',
  subtle: 'border-accent bg-accent-bg text-accent-ink font-semibold hover:bg-soft',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** `icon` is a square 44 px touch target. */
  size?: 'md' | 'sm' | 'icon';
}

/** shadcn-style button; every size keeps a 44 px touch target below the desktop breakpoint. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'default', size = 'md', className, type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded border text-sm whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        size === 'md' && 'min-h-11 px-3 xl:min-h-8',
        size === 'sm' && 'min-h-11 px-2.5 text-[13px] xl:min-h-7',
        size === 'icon' && 'size-11 shrink-0 p-0',
        VARIANTS[variant],
        className,
      )}
      {...props}
    />
  );
});
