# Design brief: UX/UI overhaul and rebrand

From Taylor's answers on 17 November 2026. This is the input for research, naming, visual directions and the design system.

## Goal
Make the product **useful**, at a glance and in a few clicks, for two audiences at once:
- **Market readers** (founders, investors, curious operators): see what is happening in startup funding now. Which sectors are hot, where money is going, who is raising. Clear, visual and easy to take in.
- **Service providers** (agencies, freelancers, recruiters, B2B sellers): find the kind of startups they can sell to, quickly. Filter to a short list, scan it, and open a company with everything they need to act.

The home page balances both. Neither audience gets buried.

## What is wrong today
1. **The filters don't fit their data.** Some filters nobody would search by. The useful ones use the wrong controls, such as long checkbox lists where a searchable dropdown, a range or a segmented control fits. Each filter's control should match its type: single choice, many choices, range, date window or search.
2. **Categories are too fragmented.** There are 73 themes from 121 tags. They are too specific to browse. People need a small set of broad sectors, with themes as an optional second level.
3. **Rows don't show what matters.** When scanning companies, the important facts (amount, stage, sector, place, when, confirmed or not) don't stand out. Use hierarchy, size, colour and arrangement so that a scan works.
4. **Company pages lack what people look for.** Website, what the company does, location, stage, total raised, investors, registry facts, and the latest news. Clear, in a predictable order.
5. **The whole thing doesn't feel built for its goal.** It reads as a data dump, not a tool.

## References Taylor likes, and why
- **Crowdcube investments:** visual cards with a short bio, and country flags. Idea: a list or card view switch, flags, and colour accents that mean something.
- **Republic Europe:** coloured progress bars, key facts set clearly below them, and company logos that give each company an identity.
- **Mixpanel, Notion, Stripe:** premium, clean and intentional. Craft quality to aim for. Figma too, but without the illustration budget.

## Feel
**Clean, premium, simple.** Avoid the "cheap AI" look: generic gradients, glassy cards, heavy shadows, emoji, rounded SaaS cards done lazily. Any of these is fine only when done with real craft. Research must say what makes the difference, with examples.

## Requirements
- Light and dark mode, with a toggle and the system default.
- Works well at 375 px. Tables become something scannable on mobile, not just a squeezed table.
- Accessible colour use: colour is never the only signal.
- Company identity: favicons or logos once Phase 3.5 lands, with a monogram fallback until then.
- Data and presentation stay separate. Pages take data from `src/db/queries`. The overhaul changes `src/app`, `src/components` and styles, plus small query additions where a page needs a field.
- Keep noindex until the redesign launches.

## Brand
"SignalFeed" is being replaced, because the name is widely used. **New name: Raisory** (chosen 17 November 2026): "raise" plus "-ory", as in directory or advisory. Said "RAY-zor-ee". raisory.com and raisory.co.uk are free (not yet registered). There is no Companies House or trade mark conflict (TMview, 17 November 2026). See `names.md`. **Brand chosen the same day: the "Ledger" direction** (logo kept). **19 November 2026: colours changed to v2 "Harbour+", navy and orange, and the site becomes a full-width app shell** (`design-system.md` section 8). It pairs the breakout mark (an open ring with a brass dot breaking out) with an outlined Inter Tight SemiBold wordmark, and uses forest green, paper and brass in light and dark. Headings are in Inter Tight, and UI and data in Inter. See `brand/brand.md`, `brand/tokens.css`, `brand/logo/` and the sheet `brand/brand.html`. Next: apply it across the product.
- The name should suit both audiences, read as a credible UK-made product, be short and easy to say, and have a usable domain.

## Process
1. Research (UX patterns, references, filter audit) and naming run in parallel.
2. Taylor picks a name. Then the brand: wordmark, colours and type.
3. 2-3 visual directions on the same real pages (funding table with filters, and a company page), using the new brand.
4. A design system: tokens, type, components and states.
5. Page-by-page rebuild, each page checked in the browser at 375 px and on desktop.
