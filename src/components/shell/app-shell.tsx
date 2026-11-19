import type { ReactNode } from "react";
import { BottomTabs } from "./bottom-tabs";
import { Sidebar } from "./sidebar";
import { TopBar } from "./top-bar";

/**
 * The frame around every page: a full-height grid with the sidebar column
 * (64 px rail from 768 px, 240 px from 1280 px), then a column holding the top
 * bar, the content and, on phones, the bottom tab bar. The window scrolls;
 * the sidebar and top bar are sticky. The content has no max-width.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <>
      <a
        href="#content"
        className="fixed top-2 left-2 z-[60] -translate-y-24 rounded-[var(--radius-sm)] bg-surface px-3 py-2 text-[15px] font-medium text-ink shadow-[var(--shadow-2)] focus:translate-y-0"
      >
        Skip to content
      </a>
      <div className="min-h-dvh md:grid md:grid-cols-[64px_minmax(0,1fr)] xl:grid-cols-[240px_minmax(0,1fr)]">
        <Sidebar />
        <div className="flex min-h-dvh min-w-0 flex-col">
          <TopBar />
          <main
            id="content"
            tabIndex={-1}
            className="min-w-0 flex-1 p-4 outline-none md:p-6"
          >
            {children}
          </main>
          <BottomTabs />
        </div>
      </div>
    </>
  );
}
