/**
 * "Confirmed" with a tick: an event backed by an official record. The accessible
 * name and title are the full confirmation text. The word is always shown, so
 * the mark never relies on colour, and it needs no JavaScript.
 */
export function ConfirmedMark({ text }: { text: string }) {
  return (
    <span
      role="note"
      aria-label={text}
      title={text}
      className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] bg-up-soft px-1.5 py-0.5 text-xs font-semibold text-up"
    >
      <svg
        viewBox="0 0 16 16"
        width="12"
        height="12"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M3 8.5l3.2 3L13 4.5" />
      </svg>
      Confirmed
    </span>
  );
}
