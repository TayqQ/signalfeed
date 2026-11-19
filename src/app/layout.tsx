import type { Metadata, Viewport } from "next";
import { Inter, Inter_Tight } from "next/font/google";
import { pageRobots } from "@/lib/indexing";
import { AppShell } from "@/components/shell/app-shell";
import "./globals.css";

const inter = Inter({
  subsets: ["latin", "latin-ext"],
  variable: "--font-inter",
  display: "swap",
});

const interTight = Inter_Tight({
  subsets: ["latin", "latin-ext"],
  weight: "600",
  variable: "--font-inter-tight",
  display: "swap",
});

// Applies a stored theme choice before first paint, so there is no flash.
const THEME_SCRIPT = `try{var t=localStorage.getItem("theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;

export const metadata: Metadata = {
  title: { default: "Raisory", template: "%s · Raisory" },
  description:
    "Raisory tracks startup funding rounds, acquisitions and launches, extracted from public news feeds and linked back to the original articles.",
  // Off until launch. Set SITE_INDEXING=true to allow indexing.
  robots: pageRobots(process.env),
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F3F5FA" },
    { media: "(prefers-color-scheme: dark)", color: "#0A1222" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en-GB"
      className={`${inter.variable} ${interTight.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="font-sans antialiased">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
