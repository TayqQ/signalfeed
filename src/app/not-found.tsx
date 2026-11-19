import Link from "next/link";

export default function NotFound() {
  return (
    <main>
      <div className="max-w-prose">
        <h1 className="text-3xl font-semibold tracking-tight">
          Page not found
        </h1>
        <p className="mt-3 text-muted">
          This company or investor is not in Raisory, or the link is wrong.
        </p>
        <p className="mt-6">
          <Link href="/" className="text-brand underline underline-offset-4">
            See all funding rounds
          </Link>
        </p>
      </div>
    </main>
  );
}
