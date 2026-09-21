# Start with fresh infrastructure

Delimoov is early in development and, according to its owner, has not been
deployed. Renkin may create fresh resources and state. The first release therefore
does not need to import Alchemy state, take over existing deployments, or preserve
old migration records. This avoids building a migration path with no current
user. It does not remove the need to protect data and recover failed deployments
once Renkin manages an environment.
