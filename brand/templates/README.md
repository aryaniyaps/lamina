# Lamina

> The UX reasoning layer for AI dev tools.

**Design how it works.**

Lamina figures out what to build and how users move through it � before anyone opens a design tool or writes production code. Personas, flows, edge cases. Framework-agnostic. Packaged as a skill for every AI coding tool.

---

## The missing layer

| Layer | Tools | What they do |
|-------|-------|--------------|
| UI generation | Stitch, v0, Galileo | Make things *look* good |
| **UX reasoning** | **Lamina** | Figure out *what to build* and *how it works* |
| Code generation | Cursor, Copilot, Claude Code | Write the *code* |

AI UI tools make things pretty. Coding agents write the code. Nobody goes through user personas, maps the flows, or handles edge cases. Lamina is that layer.

---

## Install

### Cursor

```bash
# Clone into your project's skills directory
git clone https://github.com/lamina-dev/skill.git .cursor/skills/lamina

# Or add to user-level skills
git clone https://github.com/lamina-dev/skill.git ~/.cursor/skills/lamina
```

Then invoke with `/lamina` or ask: *"Use Lamina to spec out the onboarding flow."*

### Claude (Claude Code / Desktop)

```bash
# Project-level
git clone https://github.com/lamina-dev/skill.git .claude/skills/lamina

# User-level
git clone https://github.com/lamina-dev/skill.git ~/.claude/skills/lamina
```

### Windsurf

```bash
git clone https://github.com/lamina-dev/skill.git .windsurf/skills/lamina
```

### Copilot / Generic

Copy `SKILL.md` into your agent's skills directory. Lamina is unopinionated � it outputs structured specs your agent already knows how to consume.

---

## Usage

```
/lamina Build a settings page for a team collaboration app.
```

Lamina will:

1. **Define personas** � who uses this, what they need, what they fear
2. **Map flows** � primary paths, alternate paths, entry/exit points
3. **Write specs** � what to build, acceptance criteria, dependencies
4. **Enumerate edge cases** � empty states, errors, permissions, race conditions

Output is framework-agnostic. Hand it to your coding agent with shadcn, MUI, Tailwind, or whatever you use.

---

## Example output

```markdown
## Personas

### Alex � Team Admin
- Goal: Configure workspace without breaking existing workflows
- Fear: Accidental data loss from bulk changes
- Frequency: Weekly

## Flow: Invite team member

1. Admin opens Settings ? Team
2. Clicks "Invite member"
3. Enters email, selects role
4. System sends invite email
5. Invitee accepts ? appears in member list

### Edge cases
- Email already on team ? inline error, suggest role change
- Invite expires after 7 days ? resend option
- SSO-enforced org ? invite redirects to IdP flow
- Last admin demotion ? blocked with explanation
```

---

## Philosophy

- **Design is how it works** � not how it looks
- **Flows before pixels** � structure before surface
- **Unopinionated** � your stack, your UI library, your agent
- **Edge cases are the product** � happy paths are easy; Lamina lives in the gaps

---

## Links

- Website: [lamina.dev](https://lamina.dev)
- Docs: [lamina.dev/docs](https://lamina.dev/docs)
- Brand: UX layer grey + Highlighter accent · 3D meerkat mascot

---

## License

MIT
