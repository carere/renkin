# Use Distilled as a dependency

Renkin uses Distilled directly as an external dependency through
`packages/cloudflare-sdk`. This avoids owning the SDK's shared request, schema, retry and
pagination code while keeping a clear place to handle compatibility and errors.

Distilled is separate from Alchemy. Renkin still must not depend on Alchemy
packages, including fork-scoped aliases. Check the chosen Distilled release
against required behavior and Effect compatibility; do not assume it matches the
local submodule used by the fork.
