# Test Entra SSO

Status: Implemented M1 flow; automated end-to-end evidence is linked below  
Last reviewed: 2026-07-22

1. Start the self-host Worker locally and create a deterministic environment through
   the authenticated control API documented in the [curl walkthrough](./curl.md).
2. Seed a user and register an application with one exact callback URI.
3. Read discovery from the environment's tenant authority.
4. Configure the application under test with that explicit issuer, client ID, secret
   when confidential, and the same callback URI.
5. Begin authorization code flow with `openid profile`, `state`, `nonce`, and an
   S256 PKCE challenge.
6. Submit the mock hosted sign-in form, redeem the code once, and verify the ID-token
   signature through the discovered JWKS.
7. Assert `iss`, `aud`, `nonce`, `oid`, `tid`, and expiry.

Do not use real passwords, tenants, or tokens. The repository
[integration test](../../apps/worker/test/oidc.integration.test.ts) demonstrates these
steps under the Cloudflare Workers test runtime. A deployed workers.dev run is still an
M2 gate.
