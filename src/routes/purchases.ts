import type { FastifyInstance } from "fastify";
import { getAuthSession } from "../lib/auth.js";
import { CommerceError, createCheckout } from "../lib/commerce.js";

// Exposes the purchase endpoint and keeps HTTP concerns separate from the
// commerce service that applies checkout rules and grants entitlements.

type CheckoutBody = {
	offerId?: string;
};

// Guards against empty values before checkout reaches business logic that
// expects a concrete offer identifier.
function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

// Enforces who is allowed to buy and translates domain failures from checkout
// into stable API responses for the frontend.
export async function purchaseRoutes(fastify: FastifyInstance) {
	// TODO: Remove this once we have a real payment provider
	// DEV-only internal mock for local development: this creates a purchase
	// immediately using the internal payment provider and is not a real checkout.
	fastify.post<{ Body: CheckoutBody }>("/checkout", async (request, reply) => {
		const { offerId } = request.body ?? {};

		if (!isNonEmptyString(offerId)) {
			return reply.status(400).send({
				error: "offerId is required",
				code: "INVALID_CHECKOUT_PAYLOAD",
			});
		}

		const session = await getAuthSession(request.headers);

		if (!session) {
			return reply.status(401).send({
				error: "Unauthorized access",
				code: "UNAUTHORIZED",
			});
		}

		if (session.user.isAnonymous) {
			return reply.status(403).send({
				error: "Anonymous users must register before purchasing",
				code: "ANONYMOUS_PURCHASE_FORBIDDEN",
			});
		}

		if (!session.user.emailVerified) {
			return reply.status(403).send({
				error: "Email verification is required before purchasing",
				code: "EMAIL_NOT_VERIFIED",
			});
		}

		try {
			const result = await createCheckout({
				userId: session.user.id,
				offerId,
			});

			return reply.send(result);
		} catch (error) {
			if (error instanceof CommerceError) {
				return reply.status(error.statusCode).send({
					error: error.message,
					code: error.code,
				});
			}

			throw error;
		}
	});
}
