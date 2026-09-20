# Issue tracker: GitHub

Issues and specs live in GitHub Issues in `carere/renkin`.
Use the `gh` CLI from this checkout, or specify `--repo carere/renkin`.

## Operations

- Create: `gh issue create --title "..." --body-file <path>`.
- Read: `gh issue view <number> --comments`; include labels when needed.
- List: `gh issue list --state open --json number,title,body,labels,comments`.
- Comment: `gh issue comment <number> --body-file <path>`.
- Label: `gh issue edit <number> --add-label "..."` or `--remove-label "..."`.
- Close: `gh issue close <number> --comment "..."`.

Write multiline bodies to a file and pass it with `--body-file`.
When a skill says "publish to the issue tracker", create a GitHub issue.
When it says "fetch the relevant ticket", read the issue and its comments.

## Pull requests as a triage surface

**PRs as a request surface: no.**

GitHub shares issue and PR numbers. When the resource type is uncertain,
resolve it before choosing issue or PR commands.

## Wayfinding operations

The map is one issue labeled `wayfinder:map`, containing Notes,
Decisions-so-far and Fog. Tickets are child issues linked as sub-issues.
If sub-issues are unavailable, use a task list in the map and a
`Part of #<map>` reference in each child.

Use `wayfinder:research`, `wayfinder:prototype`, `wayfinder:grilling`
or `wayfinder:task` for child ticket types.

Represent blockers with GitHub's native issue dependencies, using issue
database IDs rather than issue numbers. If unavailable, use a
`Blocked by: #<number>` line in the child body.

The frontier is the first open, unassigned child in map order with no
open blockers. Claim it with `gh issue edit <number> --add-assignee @me`.
Resolve it by commenting with the result, closing it, and adding a short
summary and link to the map's Decisions-so-far.
