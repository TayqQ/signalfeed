import Link from "next/link";

const NAV = [
  { href: "/", label: "Funding" },
  { href: "/about", label: "About" },
  { href: "/status", label: "Status" },
];

export function SiteHeader() {
  return (
    <header className="border-b border-rule">
      <div className="mx-auto flex max-w-7xl flex-wrap items-baseline justify-between gap-x-8 gap-y-2 px-4 py-4">
        <Link href="/" className="text-xl font-bold tracking-tight text-ink">
          SignalFeed
        </Link>
        <nav aria-label="Main">
          <ul className="flex gap-5 text-sm">
            {NAV.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="text-quiet underline-offset-4 hover:text-ink hover:underline"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </header>
  );
}
