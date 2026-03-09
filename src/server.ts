import "dotenv/config";
import fastifyCors from "@fastify/cors";
import Fastify from "fastify";
import cron from "node-cron";
import { auth, dbPool } from "./lib/auth.js";
import { healthRoutes } from "./routes/health.js";
import { turnRoutes } from "./routes/turn.js";
import { userRoutes } from "./routes/users.js";

const fastify = Fastify({ logger: true });

// CORS
await fastify.register(fastifyCors, {
	origin: process.env.CLIENT_ORIGIN
		? process.env.CLIENT_ORIGIN.split(",").map((origin) => origin.trim())
		: false,
	methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
	allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
	credentials: true,
	maxAge: 86400,
});

// Better Auth catch-all route
fastify.route({
	method: ["GET", "POST"],
	url: "/api/auth/*",
	async handler(request, reply) {
		try {
			const protocol = request.protocol || "https";
			const url = new URL(request.url, `${protocol}://${request.headers.host}`);

			const headers = new Headers();
			Object.entries(request.headers).forEach(([key, value]) => {
				if (value) headers.append(key, value.toString());
			});

			const req = new Request(url.toString(), {
				method: request.method,
				headers,
				...(request.body ? { body: JSON.stringify(request.body) } : {}),
			});

			const response = await auth.handler(req);

			reply.status(response.status);
			// biome-ignore lint/suspicious/useIterableCallbackReturn: Map headers correctly
			response.headers.forEach((value, key) => reply.header(key, value));

			const text = await response.text();
			reply.send(text || null);
		} catch (error) {
			fastify.log.error(error, "Authentication Error");
			reply.status(500).send({
				error: "Internal authentication error",
				code: "AUTH_FAILURE",
			});
		}
	},
});

// Health check
await fastify.register(healthRoutes, { prefix: "/health" });

// User routes - Example
await fastify.register(userRoutes, { prefix: "/api/users" });

// Public TURN credentials for FE
await fastify.register(turnRoutes, { prefix: "/api/turn" });

// Runs every day at midnight
cron.schedule("0 0 * * *", async () => {
	try {
		fastify.log.info("Cleaning up old anonymous users...");

		const result = await dbPool.query(`
			DELETE FROM public."user"
			WHERE "isAnonymous" = true 
			  AND "createdAt" < NOW() - INTERVAL '24 hours';
		`);

		fastify.log.info(
			`Cleanup complete. Number of users deleted: ${result.rowCount}`,
		);
	} catch (error) {
		fastify.log.error(error, "Error during anonymous users cleanup");
	}
});

// Start
const start = async () => {
	try {
		await fastify.listen({ port: 4000, host: "0.0.0.0" });
		console.log("Server running on http://localhost:4000");
	} catch (err) {
		fastify.log.error(err);
		process.exit(1);
	}
};

start();
