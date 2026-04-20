# Claude Code Guidelines

> **Coder's Bible:** Read → Plan (always think about how to verify) → Critique with a subagent → Rethink → Implement → Tests → Commit.

## Before Every Commit

- Update `BUGS.md` and/or `ROADMAP.md` before committing. If a bug was fixed, mark it as fixed with a description of the root cause and affected files. If a feature was added or a milestone reached, update the roadmap. The commit and the docs should always be in sync.

## Code Quality

- Write efficient and scalable code. Prefer solutions that hold up under load, avoid unnecessary computation, and don't hardcode limits that will break as data grows.
- Solve for edge cases. Consider null/undefined values, empty arrays, out-of-bounds input, concurrent calls, and failure states. Handle them explicitly rather than assuming happy-path input.

## Documentation & Comments

- Write proper JSDoc/TSDoc comments on all exported functions, classes, and types — include `@param`, `@returns`, and `@throws` where relevant.
- Add inline comments for non-obvious logic. If the reasoning behind a decision isn't immediately clear from the code, explain it. Skip comments that just restate what the code already says.
