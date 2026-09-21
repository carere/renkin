# Reconcile ambiguous provider operations explicitly

A coordinator crash during a provider mutation can leave Renkin unable to prove
whether the mutation completed or could still complete. On 2026-09-21 the user
chose explicit operator reconciliation over a timeout retry that risks a delayed
write overlapping later deployment work.

Renkin keeps the affected environment blocked until the recorded operation is
reconciled. Inspection and reconciliation must identify that exact operation,
preserve ownership and recovery progress, and record the operator's decision.
Elapsed time, `--yes`, and `--force` do not establish a safe outcome. Any operator
assertion that the provider operation is settled must be explicit; Renkin must
not present it as a guarantee supplied by Cloudflare.

Ordinary deployment-process crashes still recover through expired leases and
observable provider outcomes. This decision qualifies the architecture's
automatic crash-recovery requirement only for unresolved provider outcomes; it
does not permit automatic retries of ambiguous mutations or overlapping writes.
