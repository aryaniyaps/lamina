---
id: trust
problems:
  - "goodwill reservoir depletion"
  - "digital etiquette failures"
  - "usability as common courtesy"
related:
  - content-design
  - error-handling
  - persuasion-and-groups
---

# Trust

## When to load

- goodwill reservoir depletion
- digital etiquette failures
- usability as common courtesy

## Decision frameworks

- **Goodwill Reservoir**: Every interaction deposits or withdraws user patience; design should maintain positive balance. - When to use: Evaluating flows, error messages, marketing intrusions. - How: Ask "does this respect user's time and intelligence?"
- **Courtesy Checklist**(sample principles): - Know main things users want to do; make them obvious and easy. - Tell users what they need to know; don't puzzle them. - Save steps wherever possible. - Make it easy to recover from errors. - Apologize when you can't do what they want. - When to use: Design reviews beyond task success. - How: Walk through as tired, impatient user.
- **Designing Considerate Products**: Emulate qualities of sensitive, caring people—deferential, forthcoming, conscientious, perceptive. - Use when evaluating any user-facing interaction. - How: Audit flows against considerate characteristics checklist.
- **Designing Smart Products**: Software that works hard during idle cycles—proactive search, context-aware help, smart defaults. - Use when users waste effort on tasks computers could handle. - How: Put idle CPU cycles to work; anticipate likely next actions.
- **Designing Social Products**: Software respecting social vs. market norms—identity, collaboration, network growth, polite interruption control. - Use when products involve multiple users or social graphs. - How: Distinguish market transactions from social reciprocity; support organic network growth.
- **Considerate Product Characteristics**: Take an interest, be deferential, forthcoming, anticipate needs, fail gracefully, take responsibility. - Use as audit checklist for any flow. - How: Walk through each characteristic asking "does our product exhibit this?"

## Checklists

1. Usability includes courtesy—not just efficiency.
2. Monitor goodwill deposits and withdrawals.
3. Make primary tasks obvious; hide nothing users need.
4. Save steps; don't waste time with happy talk or extra clicks.
5. Error messages should help, not blame.
6. Update Home for crises and major changes immediately.
7. Respect beats cleverness in long-term retention.
1. Software should behave like a considerate human being.
2. Smart products work proactively during idle cycles—don't make users wait to ask.
3. Social products must distinguish social norms from market transactions.
4. Remember user preferences; forgetting feels disrespectful.
5. Help users avoid awkward mistakes with modeless feedback, not modal scolding.

## Heuristics

- **Goodwill**: User's willingness to persist with your site.
- **Happy talk**(as discourtesy): Wasting user time with fluff.
- **Hidden information**: Strike on airline site not mentioned on Home—goodwill killer.
- **Punitive registration**: Asking for data before delivering value.
- **Format surprises**: Unexpected PDF downloads, new windows without warning.
- Think of goodwill as**bank account**—annoyances compound; courtesy compounds patience.
- Use**wife's heuristic**: "If something is hard to use, I just don't use it as much."
- Treat courtesy as**competitive advantage**when products are otherwise similar.
- **Considerate vs. polite**: Politeness is manners; consideration is caring about user needs.
- **The computer does the work**: Users think; software manages information.
- **Memory as respect**: Forgetting user preferences feels inconsiderate.
- **Social vs. market norms**: Mixing them is rude—or illegal.
- **Ask forgiveness, not permission**: Prefer undo over pre-action confirmation when safe.
- Users**anthropomorphize**software—design the personality deliberately.
- Idle CPU cycles are**wasted empathy**—use them to anticipate needs.
- Social software is a**host at a party**—know when to introduce, when to leave alone.
- **Decision filter**: Ask whether this finding changes a specific design or business decision—if not, dig deeper or stop.

## Anti-patterns

- **Hiding critical news**: Operational failures (strikes) absent from Home page.
- **Unnecessary registration walls**: Demanding data before showing value.
- **Squirrelly formats**: Surprise PDFs, pop-ups, auto-play media.
- **Blaming users in errors**: "You entered invalid data" vs. helpful recovery.
- **Format punishment**: CAPTCHA abuse, aggressive upsells mid-task.
- **Blaming users in error messages**: Scolding for system or validation failures.
- **Forgetting everything between sessions**: Re-asking known information.
- **Social features that overwhelm primary tasks**: Blinking notifications during focused work.
- **Market norms in social contexts**: Treating friends like customers.

## Examples

- **Usability Common Courtesy**: Airline strike day: user checks site for flight status. Home page well-organized but zero mention of strike. News section buried; no link from Home. Goodwill drops—user feels site hides bad news.
- **Digital Etiquette**: A user prints a 200-page document but the printer jams after two pages. Considerate software detects the jam via the driver, cancels the remaining job, and notifies the user modelessly—instead of blindly sending all pages and blaming the user when toner runs out. Smart products use idle time to index files so search feels instantaneous when the user finally queries.

## Related capabilities

- [Content Design](content-design.md)
- [Error Handling](error-handling.md)
- [Persuasion And Groups](persuasion-and-groups.md)

## Cross-cutting

For prioritization and evidence triage, see [Decision Making](decision-making.md).
