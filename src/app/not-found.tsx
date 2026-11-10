import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-16">
      <h1 className="text-3xl font-bold tracking-tight">Page not found</h1>
      <p className="mt-3 text-quiet">
        This company or investor is not in SignalFeed, or the link is wrong.
      </p>
      <p className="mt-6">
        <Link href="/" className="text-signal underline underline-offset-4">
          See all funding rounds
        </Link>
      </p>
    </main>
  );
}
