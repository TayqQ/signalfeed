const PATHS = {
  globe:
    "M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Zm-6.5 6.5h13M8 1.5c1.8 1.9 2.6 4 2.6 6.5S9.8 12.6 8 14.5C6.2 12.6 5.4 10.5 5.4 8S6.2 3.4 8 1.5Z",
  building: "M3 14.5V2.5h7v12M10 6.5h3v8M1.5 14.5h13M5.5 5h2M5.5 8h2M5.5 11h2",
  copy: "M5.5 5.5V3a1 1 0 0 1 1-1H13a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1h-2.5M3 5.5h6.5a1 1 0 0 1 1 1V13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6.5a1 1 0 0 1 1-1Z",
  share: "M8 10V2M5 4.5 8 1.5l3 3M3.5 7.5v6h9v-6",
  external: "M9.5 2.5h4v4M13.5 2.5 7.5 8.5M12 9.5v4h-9.5V4h4",
  check: "M3 8.5l3.2 3L13 4.5",
  clock: "M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM8 4.5V8l2.5 1.5",
  flag: "M3.5 14.5V2M3.5 2.5h8l-1.5 3 1.5 3h-8",
  repeat:
    "M2.5 6.5a5.5 5.5 0 0 1 10-2.5M13.5 9.5a5.5 5.5 0 0 1-10 2.5M12.5 1.5v2.5H10M3.5 14.5V12H6",
  doc: "M4 1.5h5l3 3v10H4zM9 1.5v3h3M6 8h4M6 10.5h4",
} as const;

export type IconName = keyof typeof PATHS;

/** A 16 px line icon. Always decorative: the text beside it carries the meaning. */
export function Icon({
  name,
  size = 14,
  className,
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`shrink-0 ${className ?? ""}`}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
