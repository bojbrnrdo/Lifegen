# Account-free regular-attendee check-in — security design

## Existing behavior and risks
- VIPs already have a verified portal session and recovery code.
- Regular public registration matches an existing People row using the submitted email but does NOT verify ownership. Never use that match to issue attendee check-in access.
- A printed service QR identifies the service, not the attendee, and can be shared.

## Required design
1. Introduce a separate, revocable attendee pass/session, linked to People ID. This is not an account or password.
2. Generate a high-entropy pass only for a genuinely new registration. An existing email/person requires verified email possession or staff-assisted recovery before a pass may be issued.
3. Store pass hashes (not plaintext), support revocation and replacement, issue Secure HttpOnly SameSite cookies after verified recovery, and enforce CSRF.
4. Require an eligible service QR, valid attendee session, check-in window, and unique claim per service/person. Keep a reviewable pending status and do not grant direct attendance to unknown users.
5. Permit authorized, audited staff recovery for attendees without access to their original device or email.

## Tests before deployment
- New regular registration then returning phone check-in works without passwords.
- Existing-email impersonation does not issue a pass.
- Revoked/expired pass, wrong-service QR, wrong-day, missing CSRF fail safely.
- Concurrent duplicate check-ins produce exactly one claim.
- VIP and regular check-ins resolve to the same existing People attendance model.
- Mobile browser check and admin validation tested end to end.

## Approval gates
Security-sensitive pass/session design and any database migration require explicit approval before production activation. Do not deploy these documents as a working identity system.