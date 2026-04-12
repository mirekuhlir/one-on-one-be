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
import { getUserCommerceState } from "../lib/commerce.js";

// Groups user-facing auth and profile endpoints so the client can register,
// recover accounts, and load one consolidated view of account capabilities.

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

// Stops empty strings from slipping into auth calls that expect real user
// input and should fail with a clear validation error instead.
function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

// Normalizes email addresses before they hit auth flows so duplicate accounts
// are not created due to casing or surrounding whitespace.
function normalizeEmail(email: string) {
	return email.trim().toLowerCase();
}

// Registers user account routes and keeps HTTP validation close to the auth and
// commerce services they orchestrate.
export async function userRoutes(fastify: FastifyInstance) {
	// Lists only the auth providers that are configured so the client can render
	// the correct sign-in options.
	fastify.get("/providers", async () => {
		return {
			providers: getConfiguredAuthProviders(),
		};
	});

	// Starts email/password registration after normalizing input to match auth
	// provider expectations.
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

	// Initiates the password reset email flow while validating the minimum input
	// required to identify the account.
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

	// Completes a password reset once the client provides the reset token and the
	// replacement password.
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

	// Lets passwordless or social-only accounts attach a password exactly once
	// without forcing the client to infer auth state itself.
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

	// Returns the authenticated user's profile together with auth and commerce
	// capabilities so the frontend can bootstrap account state from one request.
	fastify.get("/me", async (request, reply) => {
		const session = await getAuthSession(request.headers);

		if (!session) {
			return reply.status(401).send({ error: "Unauthorized access" });
		}

		const authState = await getUserAuthState(session.user.id);
		const commerceState = await getUserCommerceState(session.user.id);
		const isAnonymous = Boolean(session.user.isAnonymous);
		const isEmailVerified = Boolean(session.user.emailVerified);

		return {
			user: session.user,
			auth: {
				isAnonymous,
				isRegistered: !isAnonymous,
				isEmailVerified,
				canPurchase: !isAnonymous && isEmailVerified,
				hasPassword: authState.hasPassword,
				providers: authState.providers,
			},
			commerce: commerceState,
		};
	});
}
