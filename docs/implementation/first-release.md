# First-release implementation

Tracks [spec #3](https://github.com/carere/renkin/issues/3).

The specification and issue acceptance criteria remain authoritative.

| Ticket | Depends on | Status |
| --- | --- | --- |
| [#4: Run and deploy a Worker safely](https://github.com/carere/renkin/issues/4) | None | In progress in isolated worktree |
| [#5: Build a connected application with protected storage](https://github.com/carere/renkin/issues/5) | #4 | Pending |
| [#6: Run database-backed applications with SQL and Drizzle migrations](https://github.com/carere/renkin/issues/6) | #5 | Pending |
| [#7: Upload files and manage isolated preview storage](https://github.com/carere/renkin/issues/7) | #5 | Pending |
| [#8: Process scheduled and durable background jobs](https://github.com/carere/renkin/issues/8) | #5 | Pending |
| [#9: Run persistent stateful services with Durable Objects](https://github.com/carere/renkin/issues/9) | #5 | Pending |
| [#10: Serve a protected application on its domain](https://github.com/carere/renkin/issues/10) | #4 | Pending |
| [#11: Run and deploy TanStack Start Solid applications](https://github.com/carere/renkin/issues/11) | #10, #5 | Pending |
| [#12: Run and deploy Astro sites](https://github.com/carere/renkin/issues/12) | #10, #5 | Pending |
| [#13: Run the complete application graph with reliable build reuse](https://github.com/carere/renkin/issues/13) | #12, #11, #9, #8, #7, #6 | Pending |
| [#14: Deliver and validate the first release artifact](https://github.com/carere/renkin/issues/14) | #13 | Pending |

## Validation

Ticket #4 has a working foundation checkpoint. Credential-free local tests cover
the public Worker API, HTTP reload, ownership, lifecycle recovery, process locks,
encrypted state and provider adapters. Real Cloudflare validation passed Worker
create/update/HTTP reads, shared redacted outputs, independent CLI reads and removal.
Separate restricted-token checks passed and revoked both temporary tokens.

The secured test state service remains account infrastructure. The superseded
test service was removed after verifying ownership and the absence of temporary
application Workers. [Linux CI](https://github.com/carere/renkin/actions/runs/35556343974)
passed all 55 behavioral tests and static checks on checkpoint `d6a0819`.

Ticket #4 is not yet complete: a cloud coordinator crash during an unobservable
provider mutation can leave an ambiguous outcome. The implementation stops safely;
the user accepted explicit reconciliation in ADR 0007, and its operator workflow
is being implemented. No other ticket is
claimed complete, and the PR remains a draft.

An isolated local HTTP probe against published `@distilled.cloud/cloudflare`
1.0.0-rc.12 with Effect 4.0.0-rc.115 verified bearer authentication, distinct
missing-resource/account/authentication/throttling errors, disabled retries and
bounded retries. This is dependency research, not Renkin adapter acceptance.

Real-cloud checks use explicitly authorized temporary-resource scope and limits
from the ignored local environment. Unrun checks will be recorded explicitly.
Registry publication is outside this change.
