import "dotenv/config";
import fastifyCors from "@fastify/cors";
import Fastify from "fastify";
import cron from "node-cron";
import {
	dbPool,
	getConfiguredAuthProviders,
	proxyAuthRequest,
	sendAuthResponse,
} from "./lib/auth.js";
import { assertAuthRuntimeConfig, authEnv } from "./lib/env.js";
import { initSocketServer } from "./lib/socket.js";
import { healthRoutes } from "./routes/health.js";
import { turnRoutes } from "./routes/turn.js";
import { userRoutes } from "./routes/users.js";

assertAuthRuntimeConfig();

const fastify = Fastify({ logger: true, trustProxy: true });

// CORS
await fastify.register(fastifyCors, {
	origin: authEnv.clientOrigins.length > 0 ? authEnv.clientOrigins : false,
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
			const response = await proxyAuthRequest({
				method: request.method,
				path: request.url,
				headers: request.headers,
				body: request.body,
			});

			return sendAuthResponse(reply, response);
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
			-- Match auth session expiry so anonymous accounts live for at most 24 hours.
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
		initSocketServer(fastify.server);
		await fastify.listen({ port: 4000, host: "0.0.0.0" });
		fastify.log.info(
			{
				enabledSocialProviders: getConfiguredAuthProviders()
					.filter((provider) => provider.enabled)
					.map((provider) => provider.id),
			},
			"Server running on http://localhost:4000",
		);
	} catch (err) {
		fastify.log.error(err);
		process.exit(1);
	}
};

start();
