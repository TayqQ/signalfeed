/**
 * A small "Confirmed" label for an event backed by an official record. The
 * accessible name and title are the full confirmation text. Plain text, so it
 * does not rely on colour and needs no JavaScript.
 */
export function ConfirmedMarker({ text }: { text: string }) {
  return (
    <span
      role="note"
      aria-label={text}
      title={text}
      className="border border-ink px-1.5 py-0.5 text-xs font-semibold"
    >
      Confirmed
    </span>
  );
}
