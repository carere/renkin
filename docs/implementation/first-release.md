# First-release implementation

Tracks [spec #3](https://github.com/carere/renkin/issues/3).

The specification and issue acceptance criteria remain authoritative.

| Ticket | Depends on | Status |
| --- | --- | --- |
| [#4: Run and deploy a Worker safely](https://github.com/carere/renkin/issues/4) | None | Pending |
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

No behavioral implementation or validation has been completed yet. Cloud checks
require an authorized test account and temporary-resource scope; unrun checks
will be recorded explicitly. Registry publication is outside this change.
