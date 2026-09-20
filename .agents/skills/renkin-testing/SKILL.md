---
name: renkin-testing
description: Use when adding or changing Renkin tests, selecting test ownership, or validating an extracted capability.
---

# Renkin testing

1. Read `CODING_STANDARD.md` and the owning workspace's architecture entry.
2. Identify the observable behavior and its public interface from the task. Use
   accepted requirements to select the seam; clarify only unresolved behavior
   that would change the test contract.
3. Put the test under the owner's `tests/unit/` or `tests/integration/`. Read
   `vitest.config.ts` for discovery and use `@effect/vitest` for Effect behavior.
4. For implementation work, run one behavior test red, make that behavior pass,
   then repeat. Derive expected results from the specification or a verified
   upstream example, never by repeating the implementation in the assertion.
5. Mock external boundaries, not internal functions. Integration tests use real
   adapters and local emulation where available. Shared helpers belong in
   `packages/testing`; owner-specific fixtures remain in `tests/support/`.
6. Run the selected suite and relevant type/lint checks. Report tests actually
   discovered. An empty-suite allowance is not behavioral evidence; replace the
   scaffold check with the strict task when the first tests land.

Adapted from Delimoov's TDD skill and testing conventions. Product tests are not
required merely to satisfy a tool's discovery command.
