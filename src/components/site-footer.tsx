const REPO_URL = "https://github.com/TayqQ/signalfeed";

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-rule">
      <div className="mx-auto flex max-w-7xl flex-wrap justify-between gap-x-8 gap-y-2 px-4 py-6 text-sm text-quiet">
        <p>
          Data from public news feeds. Headlines link to the original articles.
        </p>
        <p className="flex gap-4">
          <a
            className="underline underline-offset-4 hover:text-ink"
            href={`${REPO_URL}/blob/main/LICENSE`}
          >
            AGPL-3.0
          </a>
          <a
            className="underline underline-offset-4 hover:text-ink"
            href={REPO_URL}
          >
            Source on GitHub
          </a>
        </p>
      </div>
    </footer>
  );
}
