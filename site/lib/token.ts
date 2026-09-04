/**
 * The $WARDEN contract address, once it exists. Deliberately null until the
 * real deploy lands — a placeholder-looking hex string on a page people use
 * to verify what to trust would be worse than an honest "not yet".
 *
 * Set this the moment contracts/scripts/deploy-token.ts is actually run
 * against BSC mainnet. Never hand-type a value here.
 */
export const WARDEN_TOKEN_ADDRESS: `0x${string}` | null = null;

export const BSCSCAN_TOKEN_URL = (address: string) => `https://bscscan.com/token/${address}`;
