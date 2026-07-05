---
id: navigation
problems:
  - "users feel lost in the app"
  - "deep-page orientation failures"
  - "persistent nav and breadcrumbs"
  - "navigation review"
  - "users feel lost"
  - "deep pages"
related:
  - information-architecture
  - content-design
---

# Navigation

## When to load

- users feel lost in the app
- deep-page orientation failures
- persistent nav and breadcrumbs
- navigation review
- users feel lost
- deep pages

## Decision frameworks

- **deep-page navigation orientation audit**: If users were knocked unconscious and woke on any random page, could they tell what site they're on, what page they're on, major sections, local navigation, search, and utilities? - When to use: Evaluating navigation consistency across site. - How: Pick random deep pages; verify Site ID, page name, section nav, search, and way home.
- **Persistent Navigation (Global Nav)**: Same elements on every page except Home—Sections, Utilities, Home button, Search. - When to use: All interior pages. - How: Keep placement, labels, and styling consistent; Site ID clickable to Home.
- **Breadcrumbs**: Horizontal trail showing path from Home to current page (e.g., Home > Electronics > Cameras > Digital). - When to use: Deep hierarchical sites. - How: Show hierarchy, not user's exact click path; current page bold; use ">" separators.
- **Persistent Navigation Elements**:
- **Site ID**(clickable Home) - **Sections**(primary categories) - **Utilities**(Help, Cart, Account) - **Search**(box + button or magnifier) - **Home**(if Site ID doesn't serve this) - When to use: Every page except possibly Home. - How: Same position, order, and styling site-wide.
- **Search Design**: Simple box, no unnecessary options, results ranked usefully, spelling correction. - When to use: Any site with more than a few dozen pages. - How: Search entire site by default; avoid forcing search type selection first.
- **Section Landing Pages**: Orient users within a major category before drilling down. - When to use: Each top-level section. - How: Clear section name, local subnav, featured subcategories.

## Checklists

1. Run deep-page navigation orientation audit on random deep pages.
2. Persistent navigation: same on all pages except Home nuances.
3. Page names must match the link that brought users there.
4. Breadcrumbs show hierarchy, not history.
5. Tabs need tab affordance—physically connected, selected state obvious.
6. Street signs must be big enough to read "across the intersection."
7. Always provide obvious way Home.
1. Implement complete persistent navigation on interior pages.
2. Keep navigation clear, simple, and consistent.
3. Search must be simple—one box, whole site, smart results.
4. Section landing pages orient before depth.
5. Local navigation supports within-section browsing.
6. Tabs work when they look and behave like real tabs.
7. Test findability with deep-page navigation orientation audit and real user tasks.

## Heuristics

- **Site ID**: Logo/name identifying which site you're on.
- **Page name**: Must match clicked link text; prominent and visible.
- **Sections**: Top-level categories in persistent nav.
- **Local navigation**: Subsections for current section.
- **You are here**indicators: Highlight current location in nav.
- **Tabs**: Physical metaphor for sections—must look like tabs, not just styled boxes.
- Think of Web navigation as**mall signage**—department signs, aisle signs, product labels.
- Use deep-page navigation orientation audit as**navigation physical exam**—random page spot checks.
- Treat breadcrumbs as**hierarchy disclosure**, not browser history.
- **Findability**: Can users locate what they seek?
- **Hierarchy**: Parent/child relationships among sections and pages.
- **Local navigation**: Subsection links for current area.
- **Search as escape hatch**: When nav fails, search must work.
- **Tabs for sections**: Amazon-style selected tab on Home and sections.
- Think of navigation as**insurance policy**—users scan first, navigate when scent is strong.
- Use search as**safety net**, not primary IA excuse.
- Treat section pages as**department entrances**in the mall metaphor.

## Evaluation rubrics

### Navigation Orientation Audit
- **When**: Evaluating navigation on any multi-page site.
- **Process**: Land on deep page  ->  within 5 seconds answer: what site ->  what page ->  major sections ->  local options ->  hierarchy position ->  search available -> 
- **Pass**: All five questions answerable without hunting.
- **Failure signals**: Missing persistent nav; page name mismatch; no breadcrumbs on deep pages.

## Diagnostic questions

On any deep page, answer within 5 seconds:

- What site is this?
- What page am I on?
- What are the major sections?
- What are my local options?
- Where am I in the hierarchy?
- Is search available?

## Anti-patterns

- **Page name mismatch**: Link says "Jobs," page title says "Career opportunities."
- **Missing Site ID on interior pages**: User lost if they arrive via search.
- **Breadcrumbs showing click path**: Misleading when user jumped via search.
- **Tabs that don't look like tabs**: Breaks convention; looks like decoration.
- **Inconsistent persistent nav**: Different labels or positions per section.
- **Search type pre-selection**: "Search by ISBN/Title/Author" before query—violates cognitive effort minimization principle.
- **Missing search on large sites**: Forces nav-only paths that fail.
- **Utility clutter in primary nav**: Too many equal-weight links.
- **Orphan pages**: No local nav, no breadcrumb, no section context.
- **Changing nav per section**: Breaks persistent navigation promise.

## Examples

- **Navigation Orientation**: Sears chainsaw path: Enter store ? read department signs ? If knocked out in aisle 7, big TOOLS sign, aisle sign POWER TOOLS, and store logo orient you. Web equivalent: Amazon page shows Site ID, breadcrumb "Home > Electronics > Cameras," persistent nav with same sections, page title matching the link you clicked.
- **Designing Navigation**: Bookstore sites often force users to choose search type (ISBN, title, author) before searching—adding question marks criticizes. Better: single search box, smart backend. Persistent nav on interior page: logo (Home), top sections (Books, Music, Video), Search box upper-right, Cart/Help utilities. User searching for a chainsaw-equivalent product always sees same nav skeleton—deep-page navigation orientation audit passes.

## Related capabilities

- [Information Architecture](information-architecture.md)
- [Content Design](content-design.md)

## Cross-cutting

For prioritization and evidence triage, see [Decision Making](decision-making.md).
