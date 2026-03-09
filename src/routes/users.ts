import { fromNodeHeaders } from "better-auth/node";
import type { FastifyInstance } from "fastify";
import { auth } from "../lib/auth.js";

export async function userRoutes(fastify: FastifyInstance) {
	// READ (GET)

	// Endpoint for own profile
	fastify.get("/me", async (request, reply) => {
		// Get session from request
		const session = await auth.api.getSession({
			headers: fromNodeHeaders(request.headers),
		});

		// If the user does not have a valid session, deny access
		if (!session) {
			return reply.status(401).send({ error: "Neautorizovaný přístup" });
		}

	
		return {
			message: "Vlastní profil",
			user: session.user,
		};
	});
}
