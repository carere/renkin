# Renkin

Renkin provides infrastructure management and local development for applications
on Cloudflare.

## Language

**Behavior compatibility**:
Preservation of the agreed application, deployment and local-development outcomes
when replacing the Alchemy fork with Renkin; it does not require identical
consumer declarations or imports.
_Avoid_: Drop-in compatibility, identical API

**Binding**:
A connection that lets a Worker use a resource or call another Worker.

**Retention**:
A rule that keeps the physical resource when removal would otherwise delete it.
It is separate from blocking a removal operation through deletion protection.
_Avoid_: Backup

**State**:
Renkin's records of the resources it manages and its progress changing them.
These records are separate from application data such as database rows or files.

**Preview environment**:
A temporary application environment for reviewing a change before it is released.

**Deletion protection**:
A rule that blocks removal of a managed resource until deletion is explicitly
allowed. Blocking removal does not make the resource unmanaged.
_Avoid_: Retention, backup

**Logical ID**:
The identity used to track a declared resource in Renkin. It is separate from
the resource's Cloudflare name and from the variable used in client code.
