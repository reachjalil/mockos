# SCIM 2.0 behavior

Status: Target design; inbound and outbound runtimes not started  
Last reviewed: 2026-07-22

M3 targets an inbound RFC 7643/7644 server with Users, Groups, ServiceProviderConfig,
Schemas, and ResourceTypes. Filters must be parsed into a typed AST and rendered as
parameterized SQL. PATCH path expressions, ETags, pagination, uniqueness conflicts,
and SCIM error `scimType` values require fixture-backed tests.

M5 targets an outbound provisioning simulator. Entra and Okta dialect behavior belongs
in provider profiles: Entra-style GET-before-create and PATCH path filters, Okta's
PUT-heavy updates, group ordering, and deprovision semantics.

No SCIM endpoint or outbound request sequence is currently claimed conformant.

