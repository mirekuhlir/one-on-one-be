import type { FastifyInstance } from "fastify";
import { getActiveStoreOffers } from "../lib/commerce.js";

// Publishes the storefront catalog so the client can discover which offers are
// currently valid to show and buy.

// Registers read-only store routes that expose the curated offer list without
// leaking commerce query details into the server bootstrap.
export async function storeRoutes(fastify: FastifyInstance) {
	// Returns the currently active catalog in one payload for the store screen.
	fastify.get("/offers", async () => {
		const offers = await getActiveStoreOffers();

		return { offers };
	});
}
