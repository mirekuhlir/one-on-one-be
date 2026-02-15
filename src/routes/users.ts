import type { FastifyInstance } from "fastify";

export async function userRoutes(fastify: FastifyInstance) {
	// READ (GET)
	fastify.get("/", async (request, reply) => {
		return { message: "List of users" }; // Placeholder
	});

	fastify.get("/:id", async (request, reply) => {
		return { message: "User details" }; // Placeholder
	});

	// WRITE (POST, PUT, DELETE)
	fastify.post("/", async (request, reply) => {
		return { message: "User created" }; // Placeholder
	});

	fastify.put("/:id", async (request, reply) => {
		return { message: "User updated" }; // Placeholder
	});
}
