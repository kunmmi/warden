import { bscChain } from "@merrymen/core";

/**
 * Explorer + RPC endpoints, taken from the shared chain definition.
 *
 * Read from packages/core rather than typed here so the phone cannot end up
 * pointing at a different chain — or a stale explorer — than the worker and the
 * dashboard. The site had exactly that bug: every receipt link 404'd because the
 * explorer host had been written from memory instead of read from the source.
 */
export const EXPLORER = bscChain.blockExplorers.default.url;
export const RPC_URL = bscChain.rpcUrls.default.http[0];
export const CHAIN_ID = bscChain.id;
