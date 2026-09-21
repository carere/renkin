# Use Distilled as a dependency

Renkin will use Distilled directly as an external dependency through
`packages/cloudflare-sdk`. The user corrected the earlier choice to copy and
maintain SDK code. This avoids owning the SDK's shared request, schema, retry and
pagination code while keeping a clear place to handle compatibility and errors.

Distilled is separate from Alchemy. Renkin still must not depend on Alchemy
packages, including fork-scoped aliases. Check the chosen Distilled release
against required behavior and Effect compatibility; do not assume it matches the
local submodule used by the fork. This supersedes
[ADR 0003](0003-maintain-selected-sdk-code.md).
