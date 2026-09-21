---
status: superseded by ADR-0004
---

# Maintain selected Cloudflare SDK code in Renkin

Superseded by [using Distilled as a dependency](0004-use-distilled-as-a-dependency.md)
after the user corrected this choice in round 4. The text below is historical.

Renkin will copy and maintain the Cloudflare SDK code it needs, including required
shared support code, inside `packages/cloudflare-sdk`. The user chose ownership
over an external Distilled dependency to keep the project independent of the
source project's packages and releases. Distilled is separate from Alchemy;
this choice excludes both Alchemy packages and an external Distilled dependency.

This adds responsibility for SDK fixes and updates. Record source revisions,
review licenses and retain notices before copying, and test the error behavior
that resource management relies on. This does not imply a dependency-free Renkin:
Effect remains required, and other runtime/build dependencies are a separate choice.
