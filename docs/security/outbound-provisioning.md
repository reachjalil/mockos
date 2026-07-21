# Outbound provisioning security

Status: M5 target design; no outbound fetch implementation exists  
Last reviewed: 2026-07-22

Outbound SCIM turns user-controlled configuration into network access. The target
policy is HTTPS only, except for an explicit self-host-only insecure-development flag.
Reject literal private, loopback, link-local, multicast, and other special IPs; reject
localhost, dotless names, and `.local`, `.internal`, and `.test` hosts. Reject the
service's own control hosts.

Validate the target both when saving it and immediately before each request. Use
`redirect: "error"`, a bounded timeout, bounded response bodies, and a restricted
method/header set. Never forward platform API keys, Cloudflare credentials, or inbound
Authorization headers.

Cloudflare Workers cannot provide general DNS pinning. Hostname validation therefore
reduces risk but does not eliminate DNS rebinding. Production acceptance requires
documented residual risk, egress observations, and tests for every rejected hostname
and IP family. Retry transport failures only; every HTTP response, including 429 and
5xx, is an assertable provisioning result.

No URL has been fetched and no control is marked complete at M0.

