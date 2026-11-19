/** A country-code badge plus the city. "Place not known" in muted text when neither is known. */
export function PlaceBadge({
  countryCode,
  city,
}: {
  countryCode: string | null;
  city: string | null;
}) {
  const code = countryCode?.trim().toUpperCase() || null;
  const town = city?.trim() || null;
  if (!code && !town) {
    return <span className="text-muted">Place not known</span>;
  }
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1.5">
      {code ? (
        <span className="shrink-0 rounded-[var(--radius-sm)] bg-surface-sunk px-1 py-0.5 text-xs font-semibold tracking-wide text-ink">
          {code}
        </span>
      ) : null}
      {town ? <span className="truncate text-ink">{town}</span> : null}
    </span>
  );
}
