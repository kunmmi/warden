/**
 * Where the hosted AI gateway lives — the ONE place this is written.
 *
 * The gateway fronts the LLM and Bitquery so a user can try the "Warden AI"
 * LLM provider option and hosted data access without their own keys. Its
 * hostname was previously duplicated across the provider registry, the CLI's
 * provider table, and the Bitquery client, which meant moving it was several
 * edits and a test, and missing one left some paths pointing at a host that
 * wasn't serving.
 *
 * TODO(BSC): this still points at merrymen's own hosted Railway gateway
 * (merrymen-gateway-production.up.railway.app) — infrastructure Warden has
 * no access to and no equivalent for yet. The "Warden AI" hosted LLM provider
 * option and hosted Bitquery access are effectively non-functional until this
 * points at a real Warden-operated gateway (or the feature is removed if no
 * hosted gateway is ever stood up — self-hosting a proxy is a real decision,
 * not a rename). Do not point this at a real URL without verifying it first,
 * per docs/VERIFICATION.md.
 */
export const WARDEN_GATEWAY_ORIGIN = "https://merrymen-gateway-production.up.railway.app";
