import type { FastifyInstance } from "fastify";
import {
	auth,
	buildAuthHeaders,
	getAuthSession,
	getConfiguredAuthProviders,
	getUserAuthState,
	proxyAuthRequest,
	sendAuthResponse,
} from "../lib/auth.js";

type RegisterBody = {
	email?: string;
	password?: string;
	callbackURL?: string;
};

type ForgotPasswordBody = {
	email?: string;
	redirectTo?: string;
};

type ResetPasswordBody = {
	token?: string;
	newPassword?: string;
};

type SetPasswordBody = {
	newPassword?: string;
};

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

function normalizeEmail(email: string) {
	return email.trim().toLowerCase();
}

export async function userRoutes(fastify: FastifyInstance) {
	fastify.get("/providers", async () => {
		return {
			providers: getConfiguredAuthProviders(),
		};
	});

	fastify.post<{ Body: RegisterBody }>("/register", async (request, reply) => {
		const { email, password, callbackURL } = request.body ?? {};

		if (!isNonEmptyString(email) || !isNonEmptyString(password)) {
			return reply.status(400).send({
				error: "Email and password are required",
				code: "INVALID_REGISTER_PAYLOAD",
			});
		}

		const normalizedEmail = normalizeEmail(email);

		const response = await proxyAuthRequest({
			method: "POST",
			path: "/api/auth/sign-up/email",
			headers: request.headers,
			body: {
				email: normalizedEmail,
				password,
				name: "",
				callbackURL,
			},
		});

		return sendAuthResponse(reply, response);
	});

	fastify.post<{ Body: ForgotPasswordBody }>(
		"/password/forgot",
		async (request, reply) => {
			const { email, redirectTo } = request.body ?? {};

			if (!isNonEmptyString(email)) {
				return reply.status(400).send({
					error: "Email is required",
					code: "INVALID_FORGOT_PASSWORD_PAYLOAD",
				});
			}

			const normalizedEmail = normalizeEmail(email);

			const response = await proxyAuthRequest({
				method: "POST",
				path: "/api/auth/request-password-reset",
				headers: request.headers,
				body: {
					email: normalizedEmail,
					redirectTo,
				},
			});

			return sendAuthResponse(reply, response);
		},
	);

	fastify.post<{ Body: ResetPasswordBody }>(
		"/password/reset",
		async (request, reply) => {
			const { token, newPassword } = request.body ?? {};

			if (!isNonEmptyString(token) || !isNonEmptyString(newPassword)) {
				return reply.status(400).send({
					error: "Token and newPassword are required",
					code: "INVALID_RESET_PASSWORD_PAYLOAD",
				});
			}

			const response = await proxyAuthRequest({
				method: "POST",
				path: "/api/auth/reset-password",
				headers: request.headers,
				body: {
					token,
					newPassword,
				},
			});

			return sendAuthResponse(reply, response);
		},
	);

	fastify.post<{ Body: SetPasswordBody }>(
		"/password/set",
		async (request, reply) => {
			const { newPassword } = request.body ?? {};

			if (!isNonEmptyString(newPassword)) {
				return reply.status(400).send({
					error: "newPassword is required",
					code: "INVALID_SET_PASSWORD_PAYLOAD",
				});
			}

			const session = await getAuthSession(request.headers);

			if (!session) {
				return reply.status(401).send({
					error: "Unauthorized access",
					code: "UNAUTHORIZED",
				});
			}

			const authState = await getUserAuthState(session.user.id);

			if (authState.hasPassword) {
				return reply.status(409).send({
					error: "Password is already set for this account",
					code: "PASSWORD_ALREADY_SET",
				});
			}

			const result = await auth.api.setPassword({
				body: { newPassword },
				headers: buildAuthHeaders(request.headers),
			});

			return reply.send(result);
		},
	);

	// READ (GET)

	// Endpoint for own profile
	fastify.get("/me", async (request, reply) => {
		// Get session from request
		const session = await getAuthSession(request.headers);

		// If the user does not have a valid session, deny access
		if (!session) {
			return reply.status(401).send({ error: "Unauthorized access" });
		}

		const authState = await getUserAuthState(session.user.id);

		return {
			user: session.user,
			auth: {
				isAnonymous: Boolean(session.user.isAnonymous),
				hasPassword: authState.hasPassword,
				providers: authState.providers,
			},
		};
	});
}
