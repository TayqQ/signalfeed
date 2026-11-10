"use client";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-16">
      <h1 className="text-3xl font-bold tracking-tight">
        This page could not load
      </h1>
      <p className="mt-3 text-quiet">
        The database did not answer. It may be waking up, which takes a few
        seconds.
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-6 bg-signal px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
      >
        Try again
      </button>
    </main>
  );
}
