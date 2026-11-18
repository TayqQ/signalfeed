import Link from "next/link";
import { RaisoryLogo } from "@/components/raisory-logo";
import { ThemeToggle } from "@/components/theme-toggle";

const NAV = [
  { href: "/", label: "Funding" },
  { href: "/trends", label: "Trends" },
  { href: "/acquisitions", label: "Acquisitions" },
  { href: "/investors", label: "Investors" },
  { href: "/about", label: "About" },
  { href: "/status", label: "Status" },
];

export function SiteHeader() {
  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-8 gap-y-2 px-4 py-4">
        <Link href="/" aria-label="Raisory home" className="flex items-center">
          <RaisoryLogo className="h-[22px] w-auto" />
        </Link>
        <div className="flex items-center gap-x-4">
          <nav aria-label="Main">
            <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
              {NAV.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="text-muted underline-offset-4 hover:text-ink hover:underline"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
