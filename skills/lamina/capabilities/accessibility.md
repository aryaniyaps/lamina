---
id: accessibility
problems:
  - "accessible design fundamentals"
  - "CSS and markup accessibility"
  - "inclusive interaction design"
related:
  - content-design
  - forms
  - navigation
---

# Accessibility

## When to load

- accessible design fundamentals
- CSS and markup accessibility
- inclusive interaction design

## Decision frameworks

- **Three-Second Accessibility Test**: Disable images, turn off CSS, or view grayscale—can you still use the site? - When to use: Quick sanity check on any page. - How: Browser dev tools: disable images/CSS; verify content order and link text make sense.
- **CSS for Accessibility Separation**: Structure in HTML (headings, lists, labels); presentation in CSS. - When to use: All development—especially redesigns. - How: Semantic markup; alt text for images; form labels; don't rely on color alone.
- **Section 508 / WCAG Compliance Path**: Government and best-practice standards for accessible Web content. - When to use: Public sector, enterprise procurement, ethical baseline. - How: Keyboard navigation, screen reader compatibility, sufficient contrast, text equivalents.

## Checklists

1. Accessibility is usability for all—including disabilities.
2. Semantic HTML + CSS separates structure from presentation.
3. Run three-second test: no images, no CSS—still usable?
4. Alt text, labels, keyboard access, and contrast are non-negotiable.
5. Section 508/WCAG provide concrete requirements.
6. Accessible design often improves mobile and SEO.
7. Build in from start—retrofit is expensive.

## Heuristics

- **Alt text**: Text alternative for images—empty for decorative, descriptive for informative.
- **Semantic HTML**: Proper heading hierarchy (h1–h6), lists, labels.
- **Keyboard access**: All functionality without mouse.
- **Color contrast**: Text readable for low vision and color blindness.
- **Screen readers**: Assistive tech depends on structure, not appearance.
- **508**: US Rehabilitation Act amendment specifying accessibility requirements.
- Think of accessibility as**extreme usability**—constraints reveal design clarity.
- Use CSS as**presentation layer**—structure should work naked.
- Treat alt text and labels as**first-class content**, not afterthoughts.

## Anti-patterns

- **Image-only navigation**: No text alternatives—fails screen readers.
- **Color-only state indicators**: Red/green without icons or labels.
- **Layout tables for structure**: Breaks semantic navigation for assistive tech.
- **Skipping heading levels**: Confuses document outline.
- **"We'll add accessibility later"**: Retrofit costs more than building in.

## Examples

- **Accessibility Fundamentals**: Run three-second test: disable CSS on shopping site. Page becomes unstyled but headings still outline structure, links still readable ("Add to cart" not "Click here"), form fields still labeled. Disable images: product names appear in alt text. Fail: navigation is image map with no alt; form fields identified only by adjacent graphics; gray-on-gray text.

## Related capabilities

- [Content Design](content-design.md)
- [Forms](forms.md)
- [Navigation](navigation.md)

## Cross-cutting

For prioritization and evidence triage, see [Decision Making](decision-making.md).
