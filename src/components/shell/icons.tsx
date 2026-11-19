import type { ReactNode } from "react";

/** A 24 px line icon. Decorative: the label next to it (visible or not) names it. */
function Icon({
  className = "h-5 w-5",
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={`shrink-0 ${className}`}
    >
      {children}
    </svg>
  );
}

type IconProps = { className?: string };

export function FundingIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M5 19v-7M11 19V5M17 19v-9M3 19h18" />
    </Icon>
  );
}

export function InvestorsIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 20a6 6 0 0 1 12 0M16 4.8a3 3 0 0 1 0 6M18 14.5c1.9.8 3 2.8 3 5.5" />
    </Icon>
  );
}

export function ThemesIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M12 3a9 9 0 1 0 9 9h-9z" />
      <path d="M15 3.5A9 9 0 0 1 20.5 9H15z" />
    </Icon>
  );
}

export function TrendsIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M3 17l6-6 4 4 8-8M15 7h6v6" />
    </Icon>
  );
}

export function AcquisitionsIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M6 3v4a5 5 0 0 0 5 5h1M18 3v4a5 5 0 0 1-5 5M12 12v9" />
    </Icon>
  );
}

export function StatusIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M3 12h4l3-7 4 14 3-7h4" />
    </Icon>
  );
}

export function AboutIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6M12 7.6v.2" />
    </Icon>
  );
}

export function SourceIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M8 7l-5 5 5 5M16 7l5 5-5 5M13.5 4l-3 16" />
    </Icon>
  );
}

export function SearchIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-4-4" />
    </Icon>
  );
}

export function MoreIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M5 12h.01M12 12h.01M19 12h.01" strokeWidth="3" />
    </Icon>
  );
}

/**
 * The Raisory mark (ring and dot) without the wordmark, for the icon rail and
 * the phone top bar. Decorative: the link around it carries the name.
 */
export function RaisoryMark({ className = "h-7 w-7" }: IconProps) {
  return (
    <svg
      viewBox="6 6 36 36"
      aria-hidden="true"
      focusable="false"
      className={`shrink-0 ${className}`}
    >
      <path
        d="M35.1 22.65A13 13 0 1 1 25.35 12.9"
        fill="none"
        stroke="var(--logo-ring)"
        strokeWidth="5.5"
        strokeLinecap="round"
      />
      <circle cx="36.57" cy="11.43" r="4.75" fill="var(--logo-dot)" />
    </svg>
  );
}
