import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "primary" | "accent" | "secondary" | "ghost";
export type ButtonSize = "sm" | "md";

const VARIANTS: Readonly<Record<ButtonVariant, string>> = {
  primary: "bg-brand text-on-brand hover:bg-brand-hover border-transparent",
  accent: "bg-accent text-on-accent hover:bg-accent-hover border-transparent",
  secondary: "bg-surface text-ink border-line-strong hover:bg-surface-sunk",
  ghost: "bg-transparent text-ink border-transparent hover:bg-surface-sunk",
};

const SIZES: Readonly<Record<ButtonSize, string>> = {
  sm: "h-8 px-3 text-[13px]",
  md: "h-10 px-4 text-[15px]",
};

export function buttonClasses(
  variant: ButtonVariant = "secondary",
  size: ButtonSize = "md",
): string {
  return `inline-flex items-center justify-center gap-2 rounded-[var(--radius-sm)] border font-medium transition-colors duration-[120ms] ease-out motion-reduce:transition-none disabled:pointer-events-none disabled:opacity-50 ${VARIANTS[variant]} ${SIZES[size]}`;
}

type ButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "className"
> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Renders a link styled as a button. */
  href?: string;
  children: ReactNode;
};

/**
 * At most one `primary` per view. `accent` is only for the top bar's main
 * action and a page's single most important action.
 */
export function Button({
  variant = "secondary",
  size = "md",
  href,
  children,
  ...rest
}: ButtonProps) {
  const className = buttonClasses(variant, size);
  if (href !== undefined) {
    return (
      <Link href={href} className={className}>
        {children}
      </Link>
    );
  }
  return (
    <button type="button" className={className} {...rest}>
      {children}
    </button>
  );
}
