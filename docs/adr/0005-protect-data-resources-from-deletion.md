# Protect data resources from deletion by default

Renkin blocks deletion of resources holding data unless the consumer explicitly
enables deletion. This differs from Alchemy's default destruction when a resource
declaration is removed. The extra setting prevents a normal code edit from
silently deleting application data; disposable preview environments can enable
deletion so cleanup stays automatic.

An explicit logical-ID rename must preserve the physical resource and its data.
Renkin must not guess renames from similar declarations. Protection differs from
Alchemy's retain-and-forget behavior: blocking a deletion is not permission to
drop the resource's ownership record.

Protection covers data resource types even when currently empty, including D1,
R2, KV, queues, Durable Objects and Workflows, plus Workers whose removal would
lose stored data. Replacing them with new resources is protected too. Reject a
plan that violates protection before making any changes. Follow Alchemy's option
meanings: `--yes` skips confirmation, `--force` reruns unchanged resources, and
explicit resource settings allow deletion. Neither flag bypasses protection;
there is no additional per-operation bypass command in the agreed scope.

The first-release rename operation stays within one stack and environment and
keeps the resource type unchanged. Moving ownership between stacks or environments
is deferred.
