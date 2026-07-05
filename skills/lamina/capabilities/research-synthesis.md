---
id: research-synthesis
problems:
  - "synthesizing interview data"
  - "affinity mapping qualitative data"
  - "turning observations into insights"
  - "synthesizing interviews"
  - "qualitative data overload"
related:
  - interview-documentation
  - user-modeling
  - requirements-definition
---

# Research Synthesis

## When to load

- synthesizing interview data
- affinity mapping qualitative data
- turning observations into insights
- synthesizing interviews
- qualitative data overload

## Decision frameworks

- **Affinity Diagram Process**:
- **Affinity Diagram Layers**(bottom to top): Observations → Insights → Design Mandates.
- **Persona**: Fictional archetype from real data representing a group of needs and behaviors—not marketing targets or imaginary friends.
- **Persona Components**: Photo, name, demographics, role, quote, goals, behaviors/habits, skills, environment, relationships.
- **Scenarios**: Stories of how personas interact with system to meet goals—from user perspective, not system perspective; not use cases or user stories.
- **Mental Models**(two types): (1) User's internal representation of how something works; (2) Designer's diagram of that representation (Indi Young)—"mental model model."
- **Mental Model Creation**: User research → affinity diagram → stack clusters in cognitive space (actions, beliefs, feelings) → group around tasks/goals.
- **Conceptual Modeling/Site Mapping**: Translate mental model to content/functionality framework aligned with user view.
- **Gap Analysis**: Identify mismatches between what you offer and what users need/expect.
- **Task Analysis/Workflow**: Break one task into discrete cognitive and physical steps from contextual inquiry or detailed interviews.
- **Gaining Informed Consent from Your Research Participants**: Ethical duty to explain risks, uses, and voluntary participation clearly. - Use before every session. - How: Separate consent from NDA and incentive; explain how data will be used; ensure genuine choice.
- **What Is Design Ethnography?**: Observational research in users' natural contexts to understand behavior in situ. - Use when you need to understand real-world workflows. - How: Master-apprentice model—observe, ask naive questions, collect artifacts.
- **Structuring the Ethnographic Interview**: Phases—introduction, observe, interpret, summarize. - Use during contextual inquiry sessions. - How: Spend bulk of time observing; use "Tell me about the last time…" and "Show me how you…"
- **Writing Effective Usability Test Tasks**: Scenario-based tasks requiring multiple features—not isolated feature tests. - Use when planning usability tests. - How: Realistic goals, sufficient detail, no leading hints to UI elements.
- **The Five Mistakes You'll Make as a Usability Test Moderator**: Talking too much, helping too much, leading, arguing, and poor note-taking. - Use as self-check during moderation. - How: Stay quiet, observe struggle, probe after not during, debrief immediately.
- **Avoiding Personal Opinions in Usability Expert Reviews**: Heuristic evaluation without "I wouldn't have designed it that way." - Use during expert reviews. - How: Cite heuristics and standards, not personal taste.
- **Toward a Lean UX**: Lightweight research integrated into agile sprints. - Use in fast-moving teams. - How: Small studies, rapid synthesis, shared observation.
- **Controlling Researcher Effects**: Hawthorne, social desirability, and interviewer bias management. - Use in every study design. - How: Neutral facilitation, behavioral focus, triangulate methods.
- **Controlling Researcher Effects**: Manage Hawthorne, social desirability, and sponsor bias through neutral facilitation. - Use in every study design and moderation guide. - How: Avoid revealing sponsor hypotheses; focus on behavior; triangulate with observation.

## Checklists

1. Collaborative affinity diagramming multiplies research value vs solo reports.
2. Personas require real interviews + team pattern identification—keep them vivid and minimal.
3. Mental model diagrams prioritize features, organize information, reveal unserved needs.
4. Task analysis maps real-world steps to interface flows and content placement.
5. Visual models beat lengthy reports for shared understanding and organizational buy-in.
1. Informed consent is ethical foundation—keep it separate from legal and payment docs.
2. Design ethnography observes real behavior in context, not opinions in a lab.
3. Usability tasks are scenarios requiring realistic goal completion.
4. Moderators must stay quiet, avoid helping, and debrief immediately.
5. Control researcher effects—behaviors over opinions, always.

## Heuristics

- **Observation vs interpretation**: Observations are direct quotes/objective descriptions; insights are what patterns mean—keep separate during analysis.
- **Design for less expertise, meet more**: Highest-revenue user type may know too much; design for users with less expertise and you cover both.
- **Fewest personas possible**: Represent all relevant behavior patterns; combine roles (out-of-town visitor who is also a teacher).
- **Personas working = first people you show new ideas**: "Would Dana understand this?" not "Does my boss like this?"
- **Intuitive = matches mental model**: Closer fit = easier learn, use, navigate.
- **Scenarios evolve; personas stay stable**: Personas are the Simpsons; scenarios are the couch gag.
- **Model management**: Diagrams are viscerally appealing for skeptics—don't underestimate visual communication.
- **Party for your brain**: Group analysis leverages social pattern recognition—get hooked.
- **Clarity in data → clarity in navigation**: Organized research translates directly to concept, content, and interaction clarity.
- **Get inside their head out of your head**: Documenting user mental models makes team assumptions visible and debatable.
- **Task path as content map**(Fig 8.5): Ticket purchase workflow reveals where users need specific content at each step.
- **Place mat persona layout**: Enough detail to inspire, not so much team needs a CV lookup per decision.
- **Master-apprentice model**: Researcher as learner, participant as expert of their context.
- **Index card debrief**: Immediate post-session summary with photo and five behavioral bullet points.
- **Tasks not questions**: Usability tests measure can they use it, not do they like it.
- **Good vs. bad data**: Behaviors are evidence; opinions are weak data.
- **Psychological harm**: Usability tests can distress participants—take consent seriously.
- Contextual inquiry should look like**watching**, not**interrogating**.
- Moderator silence is**data collection**—filling gaps is bias injection.
- Post-session index cards prevent participants**blending together**in memory. - **Decision filter**: Ask whether this finding changes a specific design or business decision—if not, dig deeper or stop.

## Evaluation rubrics

### Affinity Clustering
- **When**: Synthesizing qualitative data from interviews or observations.
- **Process**: Write observations on notes  ->  cluster by theme  ->  name clusters  ->  identify patterns  ->  connect to research questions.
- **Pass**: Named themes with supporting evidence; patterns linked to questions.
- **Failure signals**: Single analyst bias; clusters too broad to act on.

## Anti-patterns

- **Imaginary friends as personas**: Made-up characters without firsthand research are useless as design targets.
- **Stock photos / Game of Thrones names**: Use real CC-licensed photos; plausible LinkedIn-style names.
- **Teenage marketing VP who fights crime**: Stereotyped, implausible personas.
- **Scenarios as use cases**: System-perspective interaction lists miss human motivation and context.
- **Team resentment of persona work**: If scenarios feel like homework, you're doing it wrong—whiteboard sketches work.
- **Accommodating outlier Dan**: Sixty-five-year-old non-museum-goer arguing politics—set aside, don't design for.
- **Helping during tests**: Showing users where to click destroys validity.
- **Leading task wording**: "Click the blue Submit button" instead of "Complete your purchase."
- **Consent form as NDA**: Legal intimidation that suppresses open responses.
- **Moderator as notetaker**: One person doing both degrades session quality.

## Examples

- **Analysis And Models**: Parent research affinity diagram: Observations include "see event signs while driving but never remember," "week rushes by, wake Saturday with no plans," "iPhone alarm essential for school pickup." Insights cluster as "short memory/many interruptions," "relies on mobile device," "being a good parent is top priority." Design mandates: multi-device access, low-effort/high-value reminders, collaborative decision-making support. Persona Diane (33, Chicago account manager, 5-year-old) gets quote about giving partner Saturday break. Scenario: Friday evening sees super storm banners, Googles museum on iPhone in driveway, must determine if visit meets family needs.
- **Conducting Ux Research**: Philip runs a contextual interview with a warehouse manager using the master-apprentice model. He spends 40 minutes watching her process returns, asking "Show me how you handle a damaged shipment" and collecting sample forms. He uses only two question stems. Post-session, he writes an index card: photo, name, five bullets on behaviors and goals.

## Related capabilities

- [Interview Documentation](interview-documentation.md)
- [User Modeling](user-modeling.md)
- [Requirements Definition](requirements-definition.md)

## Cross-cutting

For prioritization and evidence triage, see [Decision Making](decision-making.md).
