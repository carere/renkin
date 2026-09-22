# Domain docs

Renkin uses a single-context layout:

- Domain context and glossary: `docs/context/root.md`.
- Architecture decisions: `docs/adr/<number>-<decision>.md`.

## Before exploring

Read `docs/context/root.md` and applicable ADRs when they exist.
Read `docs/agents/architecture.md` for agreed package ownership and constraints.

If context files or ADRs do not exist, proceed silently. Domain-modeling
creates them lazily when terminology or decisions are resolved.

## Vocabulary

Use the glossary's terms in issues, proposals, hypotheses and tests.
If a term is missing, reconsider the wording or note the gap for
domain-modeling.

## Decisions

Surface conflicts with existing ADRs explicitly, naming the document
and explaining why the decision should be reconsidered.
