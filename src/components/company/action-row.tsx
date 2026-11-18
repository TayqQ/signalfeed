"use client";

import { useEffect, useId, useRef, useState } from "react";
import { buttonClasses } from "@/components/ui/button";
import { Icon } from "./icons";

const CONFIRM_MS = 2000;

type CopyState = "idle" | "done" | "failed";

async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Shows a short confirmation for two seconds, then goes back to idle. */
function useConfirmation(): [CopyState, (state: CopyState) => void] {
  const [state, setState] = useState<CopyState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  function show(next: CopyState) {
    setState(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), CONFIRM_MS);
  }
  return [state, show];
}

/**
 * The company page actions: Visit website (shown but inactive, with a note,
 * when no domain is known), Companies House and Copy company number (only for
 * a linked record), and Share (the system share sheet, else the link is
 * copied). Confirmations are announced through a polite live region.
 */
export function ActionRow({
  companyName,
  websiteDomain,
  companiesHouse,
}: {
  companyName: string;
  websiteDomain: string | null;
  companiesHouse: { companyNumber: string; url: string } | null;
}) {
  const noteId = useId();
  const [copyState, showCopy] = useConfirmation();
  const [shareState, showShare] = useConfirmation();
  const [message, setMessage] = useState("");

  async function copyNumber() {
    if (!companiesHouse) return;
    const ok = await writeClipboard(companiesHouse.companyNumber);
    showCopy(ok ? "done" : "failed");
    setMessage(
      ok
        ? `Company number ${companiesHouse.companyNumber} copied`
        : `Could not copy. The company number is ${companiesHouse.companyNumber}`,
    );
  }

  async function share() {
    const url = window.location.href;
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: companyName, url });
        return;
      } catch (error) {
        // The visitor closed the share sheet: nothing to report.
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
      }
    }
    const ok = await writeClipboard(url);
    showShare(ok ? "done" : "failed");
    setMessage(ok ? "Link copied" : "Could not copy the link");
  }

  const button = buttonClasses("secondary", "sm");
  const domain = websiteDomain?.trim() || null;

  return (
    <div className="mt-3 sm:mt-5">
      <div className="flex flex-wrap gap-2">
        {domain ? (
          <a
            href={`https://${domain}`}
            target="_blank"
            rel="noopener"
            className={`${buttonClasses("primary", "sm")} shrink-0`}
          >
            <Icon name="globe" />
            Visit website
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        ) : (
          <button
            type="button"
            aria-disabled="true"
            aria-describedby={noteId}
            className={`${button} shrink-0 cursor-not-allowed text-muted opacity-60`}
          >
            <Icon name="globe" />
            Visit website
          </button>
        )}
        {companiesHouse ? (
          <>
            <a
              href={companiesHouse.url}
              target="_blank"
              rel="noopener"
              className={`${button} shrink-0`}
            >
              <Icon name="building" />
              Companies House
              <Icon name="external" size={12} className="text-muted" />
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
            <button
              type="button"
              onClick={() => void copyNumber()}
              className={`${button} shrink-0`}
            >
              <Icon name={copyState === "done" ? "check" : "copy"} />
              {copyState === "done"
                ? "Copied"
                : copyState === "failed"
                  ? "Copy failed"
                  : "Copy company number"}
            </button>
          </>
        ) : null}
        <button
          type="button"
          onClick={() => void share()}
          className={`${button} shrink-0`}
        >
          <Icon name={shareState === "done" ? "check" : "share"} />
          {shareState === "done" ? "Link copied" : "Share"}
        </button>
      </div>
      {domain ? null : (
        <p id={noteId} className="mt-1.5 text-xs text-muted">
          Website not found yet
        </p>
      )}
      <p aria-live="polite" className="sr-only">
        {message}
      </p>
    </div>
  );
}
