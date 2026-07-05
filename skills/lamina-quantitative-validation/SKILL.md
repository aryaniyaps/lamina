---
name: lamina-quantitative-validation
description: "Quantitative Validation UX guidance. Use when A/B testing design variants; post-launch analytics analysis; triangulating qual and quant data."
metadata:
  lamina:
    id: quantitative-validation
    problems:
      - "A/B testing design variants"
      - "post-launch analytics analysis"
      - "triangulating qual and quant data"
      - "two design variants"
      - "sufficient traffic"
      - "conversion debates"
      - "conflicting data sources"
      - "analysis paralysis"
    related:
      - lamina-usability-evaluation
      - lamina-decision-making
---
# Quantitative Validation

## When to load

- A/B testing design variants
- post-launch analytics analysis
- triangulating qual and quant data
- two design variants
- sufficient traffic
- conversion debates
- conflicting data sources
- analysis paralysis

## Decision frameworks

- **Conversion**: Any measurable user action defined as a site goal (sign up, buy now, make a reservation)—success measured by how many people click the button and complete the desired outcome.
- **Analytics**: Collection and analysis of actual usage data to identify where a site or application is less effective than intended; change, then re-check metrics.
- **Google Analytics Starter Metrics**: Total visits, pageviews, pages per visit, bounce rate, average time on site, percentage of new visitors, traffic sources (search, referral, direct), In-Page Analytics for scroll and click behavior.
- **Split Testing Process**(A/B testing, bucket testing, multivariate testing):
- **Statistical Confidence Standard**: 95% probability the winner is real, not chance; run over two-week holiday-free period when possible to control for day-of-week and outlier effects.
- **Local Maximum**(Andrew Chen): Split testing optimizes within the current design system—you can reach the best possible version of what exists without discovering vastly better alternatives (Fig 9.1).
- **Quantitative Goals**: Define targets; benchmark against industry averages for your site type—the numbers to beat.
- **Sharpening Your Thinking Tools (Baloney Detection Kit)**: Sagan-inspired critical thinking—falsifiability, Occam's Razor, independent confirmation, correlation vs. causation. - Use when evaluating project rationale and research claims. - How: Apply ten thinking tools at kickoffs and when reviewing findings.
- **UX Research and Strength of Evidence**: Behavioral observation > stated preference > opinion. - Use when weighing data for decisions. - How: Rank evidence strength; never base launches on weak data alone.
- **Agile Personas**: Lightweight persona sketches updated each sprint from research data. - Use in agile teams needing fast user models. - How: One-page persona; refine iteratively; tie to sprint decisions.
- **How to Prioritize Usability Problems**: Severity × frequency frameworks for fix ordering. - Use after usability testing. - How: Score impact and occurrence; distinguish showstoppers from nitpicks.
- **Creating Insights, Hypotheses and Testable Design Ideas**: Insight = finding + implication; hypothesis = testable prediction. - Use during synthesis workshops. - How: Move from observation → insight → hypothesis → design idea → test plan.
- **How to Manage Design Projects with User Experience Metrics**: Task success, time-on-task, error rate, satisfaction—tracked over iterations. - Use when stakeholders need quantitative progress signals. - How: Define metrics aligned to key tasks; measure before and after redesign.
- **Two Measures that Will Justify Any Design Change**: Conversion rate and support call volume. - Use when business case needed for UX investment. - How: Baseline, redesign, measure delta.
- **Your Web Survey Is a Lot Less Reliable than You Think**: Survey methodology pitfalls—sampling, wording, incentive bias. - Use when stakeholders propose surveys as primary research. - How: Challenge reliability; prefer behavioral methods for design decisions.

## Checklists

1. Define quantitative goals and benchmark against industry averages before tweaking.
2. Start with Google Analytics basics; traffic sources and entry pages often reveal more than on-site metrics alone.
3. Split test with patience, 95% confidence, and awareness of sample size requirements for small changes.
4. Split testing optimizes locally—pair quant with qual to escape the local maximum and ask why.
5. Best teams balance data-driven decisions with strategic design thinking that values the unmeasurable.
1. Apply critical thinking tools early—challenge untestable project mandates.
2. Strength of evidence hierarchy: behavior > stated preference > opinion.
3. Prioritize usability problems by severity and frequency, not volume.
4. Create insights with implications, hypotheses that are testable, and design ideas tied to metrics.
5. Web surveys are less reliable than teams assume—use cautiously for design decisions.

## Heuristics

- **Optimize**: Making something the best it can be—chief aim of quantitative research, but always subjective with trade-offs.
- **The Good problem**: What is good? What are you optimizing for? Optimizing one metric can cause other bad outcomes.
- **Faceless masses**: Individual users studied qualitatively fade into aggregate behavior once traffic scales.
- **Bounce rate**: Percentage leaving after one page—high often signals unmet expectations or unclear next steps; not inherently good or bad in isolation.
- **Multiple conversion types**: Newsletter sign-up, ticket sales, store purchases, membership—each path has its own rate; business decides which matters most.
- **Split testing variables**: Button wording/size/color/placement, copy amount, price/offer, image type—winners often counterintuitive (e.g., brown buttons).
- **Incrementalism risk**: Culture of small positive changes can discourage great leaps with short-term negative effects.
- **Live-site risk**: Experiments run where visitors arrive—design tests to avoid disrupting what already works; global navigation is a poor test target; SEM landing pages are ideal.
- **Knobs and levers**: Design elements become manipulable controls once success is measurable numerically.
- **Clinical trial for a page**: Control vs. variation served randomly; winner determined by specific metric performance.
- **Dr. Frankenstein's laboratory**: Your live site is both lab and storefront—inconsistency from testing can erode trust and habit.
- **Spock-like teams**: Embrace data while looking beyond what can be measured to what might be valued (Doug Bowman / Google lesson).
- **Why before How**: Yahoo! split testing won't turn it into Google; Google's math won't turn Google+ into Facebook.
- **Track race, not rhythmic gymnastics**: Split testing demands specific, quantifiable goals—no room for interpretation.
- **Sturgeon's Law**: 90% of everything is crap—apply skepticism to new product bets.
- **Data first, method second**: Choose method based on evidence needed, not habit.
- **Pay attention to what people do, not what they say.**
- **Falsifiability**: Research questions must be answerable with valid data.
- **Occam's Razor**: Prefer simpler explanations; design for simplicity.
- Analysis is**detective work**—evidence supports claims, not the reverse.
- Weak evidence feels**comfortable**(everyone likes the design!) but misleads.
- Insights without**"so what?"**are just interesting stories.

## Evaluation rubrics

### Ab Variant Comparison
- **When**: Comparing two design variants with sufficient traffic.
- **Process**: Define metric  ->  create variants  ->  split traffic  ->  run until statistical significance  ->  ship winner.
- **Pass**: Statistically significant winner on predefined metric.
- **Failure signals**: Stopping early; testing too many variables; ignoring qualitative why.

### Evidence Prioritization
- **When**: Multiple data sources suggest different actions.
- **Process**: Weight evidence by decision risk  ->  triangulate qual and quant  ->  prioritize actionable insights.
- **Pass**: Clear ranked recommendations with evidence cited.
- **Failure signals**: Analytics-only decisions; ignoring sample size limits.

## Anti-patterns

- **Math cosplay without goals**: Drowning in charts without defined quantitative targets or business-priority conversions.
- **Data rules the roost**: Reducing every design decision to A/B logic removes subjectivity designers need for breakthrough work.
- **Premature test termination**: Stopping before 95% confidence or before outlier events (NYT mention) wash out produces false positives/negatives.
- **Testing global navigation**: Users expect consistency; split testing belongs where variation is expected and one clear behavior is targeted.
- **Optimize everything, still fail**: Optimizing wrong things—incremental button tweaks won't fix a fundamentally wrong product strategy.
- **Ignoring qualitative follow-up**: Analytics shows what; usability testing and interviews explain why—never skip the why.
- **HiPPO over evidence**: Highest paid person's opinion trumping observed struggle.
- **Unfalsifiable hypotheses**: "Users will love it" with no test criteria.
- **Survey as design research**: Attitudinal data driving interaction decisions.

## Examples

- **Quantitative Research**: Fantastic Science Center post-launch: Analytics shows 1,000 homepage visits/day but only five click beyond—high bounce rate suggests unmet expectations or buried paths. Team sets goal: increase "Buy tickets" conversion from 5% to 7%. Split test serves half visitors current homepage (sign-up button right of CTA) vs. variation (button below CTA).
- **Data Analysis**: After five usability sessions, the team lists 47 issues. applies severity × frequency scoring: three showstoppers (can't complete checkout) rank above 20 cosmetic preferences. Insights workshop produces: "Users don't distinguish Save from Submit" → hypothesis: "Combining actions reduces errors" → testable idea: single "Save and Continue" button → A/B test with task success metric.

## Related capabilities

- [Usability Evaluation](../lamina-usability-evaluation/SKILL.md)
- [Decision Making](../lamina-decision-making/SKILL.md)

## Cross-cutting

For prioritization and evidence triage, see [Decision Making](../lamina-decision-making/SKILL.md).
