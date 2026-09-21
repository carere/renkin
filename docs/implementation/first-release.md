# First-release implementation

Tracks [spec #3](https://github.com/carere/renkin/issues/3).

The specification and issue acceptance criteria remain authoritative.

| Ticket | Depends on | Status |
| --- | --- | --- |
| [#4: Run and deploy a Worker safely](https://github.com/carere/renkin/issues/4) | None | Complete; merged and closed |
| [#5: Build a connected application with protected storage](https://github.com/carere/renkin/issues/5) | #4 | Complete; merged and closed |
| [#6: Run database-backed applications with SQL and Drizzle migrations](https://github.com/carere/renkin/issues/6) | #5 | Complete; merged and closed |
| [#7: Upload files and manage isolated preview storage](https://github.com/carere/renkin/issues/7) | #5 | Complete; merged and closed |
| [#8: Process scheduled and durable background jobs](https://github.com/carere/renkin/issues/8) | #5 | Complete; merged and closed |
| [#9: Run persistent stateful services with Durable Objects](https://github.com/carere/renkin/issues/9) | #5 | Complete; merged and closed |
| [#10: Serve a protected application on its domain](https://github.com/carere/renkin/issues/10) | #4 | Complete; merged and closed |
| [#11: Run and deploy TanStack Start Solid applications](https://github.com/carere/renkin/issues/11) | #10, #5 | Complete; merged and closed |
| [#12: Run and deploy Astro sites](https://github.com/carere/renkin/issues/12) | #10, #5 | Complete; merged and closed |
| [#13: Run the complete application graph with reliable build reuse](https://github.com/carere/renkin/issues/13) | #12, #11, #9, #8, #7, #6 | Complete; merged and closed |
| [#14: Deliver and validate the first release artifact](https://github.com/carere/renkin/issues/14) | #13 | In progress in isolated worktree |

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

Ticket #4 is complete and closed after merge `5c5867b`.
[Linux CI](https://github.com/carere/renkin/actions/runs/35587890346) passed all
59 behavioral tests and static checks, including the added recovery workflow.
ADR 0007 records the accepted requirement for explicit operator reconciliation
when a cloud mutation outcome cannot be established. The actual test backend
was updated while preserving its secret, namespace and encrypted state; the new
inspection endpoint was verified. Tickets #5 and #6 are also now complete; later
resource/framework tickets and final release review remain.

An isolated local HTTP probe against published `@distilled.cloud/cloudflare`
1.0.0-rc.12 with Effect 4.0.0-rc.115 verified bearer authentication, distinct
missing-resource/account/authentication/throttling errors, disabled retries and
bounded retries. This is dependency research, not Renkin adapter acceptance.

Real-cloud checks use explicitly authorized temporary-resource scope and limits
from the ignored local environment. Unrun checks will be recorded explicitly.
Registry publication is outside this change.

Tickets #5 and #6 were merged and closed after their acceptance criteria were
validated. [Linux CI](https://github.com/carere/renkin/actions/runs/35592664722)
passed checkpoint `926fc06`: 112 behavioral tests across eight populated suites,
plus all required static checks. Real Cloudflare connected-Worker and D1 suites
passed, including explicit cleanup; earlier failed-run application resources
were also removed. See [connected Worker evidence](../validation/issue-5.md) and
[D1 behavior and evidence](../d1-migrations.md). Ticket #10 is complete and closed after merge `cb4f12a`: all 123 combined
behavioral tests and static checks passed locally. Its real Cloudflare protected-site
suite passed isolation, token recovery, configuration updates and teardown; see
[site validation](../validation/issue-10.md).

Tickets #7, #8 and #9 are complete after integration `7e35c34`: 175 behavioral
tests across eight populated suites and all required static checks passed.
Their separate real Cloudflare suites passed and cleaned their temporary
application resources; the authorized email recipient also confirmed delivery.
See [R2 evidence](../validation/issue-7.md), [background jobs](../background-jobs.md)
and [Durable Objects](../durable-objects.md).
[Linux CI](https://github.com/carere/renkin/actions/runs/35601234872) passed all
175 tests and static checks at `33cb89c`.

Tickets #11 and #12 are complete after integration `31cf6b0`: all 193 behavioral
tests across 13 populated suites and required static checks passed locally.
Real Cloudflare TanStack SPA/SSR and Astro static/SSR suites passed, including
native bindings, assets, custom-domain HTTPS and all Astro session transitions.
Exact temporary application resources and environments were removed. Final
certificate inventories found no matching packs; temporary inspection tokens
were revoked. See [TanStack evidence](../tanstack-sites.md) and
[Astro evidence](../validation/issue-12.md).
[Linux CI](https://github.com/carere/renkin/actions/runs/35610196784) passed all
193 tests and static checks on the combined checkpoint. Ticket #13 is active; release packaging and final
review remain pending.

Ticket #13 is complete after merge `06e117a`: all 210 behavioral tests across
13 populated suites and required static checks passed locally and in
[Linux CI](https://github.com/carere/renkin/actions/runs/35621947210). This includes
OS-enforced provider-free graph startup on macOS and Linux. The separate Cloudflare
graph test passed native service flow, signed uploads, one accepted email and a
provider-observed cron update with all three frontend builds reused. All 17 resources
and the successful environment were removed; both earlier failed scopes were also
fully cleaned. See [graph and build evidence](../validation/issue-13.md).
Release packaging and installed-consumer validation are active in ticket #14.
