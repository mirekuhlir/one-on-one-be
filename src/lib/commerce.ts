import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { dbPool } from "./auth.js";

// Centralizes store reads and checkout writes so routes can expose commerce
// features without re-implementing offer validation, purchase recording, or
// ownership scheduling rules.

type OfferKind = "premium" | "skin";
type DurationKind = "days" | "lifetime";
type PurchaseOrderStatus =
	| "pending"
	| "paid"
	| "failed"
	| "refunded"
	| "cancelled";
type PaymentProvider = "internal";
const UNIQUE_VIOLATION_ERROR_CODE = "23505";
const ACTIVE_SKIN_OWNERSHIP_INDEX =
	"user_ownership_active_skin_per_user_key";
const ACTIVE_LIFETIME_PREMIUM_OWNERSHIP_INDEX =
	"user_ownership_active_lifetime_premium_plan_per_user_key";

type StoreOfferRow = {
	id: string;
	code: string;
	name: string;
	kind: OfferKind;
	premiumPlanId: string | null;
	premiumPlanCode: string | null;
	premiumPlanName: string | null;
	premiumPlanRank: number | null;
	skinCode: string | null;
	durationKind: DurationKind;
	durationDays: number | null;
	priceAmount: number;
	currency: string;
};

type CheckoutOfferRow = StoreOfferRow & {
	isActive: boolean;
};

type PurchaseOrderRow = {
	id: string;
	status: PurchaseOrderStatus;
	paymentProvider: PaymentProvider;
	totalAmount: number;
	currency: string;
	paidAt: Date;
};

type OwnershipRow = {
	id: string;
	kind: OfferKind;
	premiumPlanCode: string | null;
	skinCode: string | null;
	startsAt: Date;
	expiresAt: Date | null;
};

type ScheduledPremiumRow = {
	startsAt: Date;
	expiresAt: Date | null;
	premiumPlanRank: number;
};

export type CommerceOffer = {
	id: string;
	code: string;
	name: string;
	kind: OfferKind;
	durationKind: DurationKind;
	durationDays: number | null;
	priceAmount: number;
	currency: string;
	premiumPlan:
		| {
				id: string;
				code: string;
				name: string;
				rank: number;
		  }
		| null;
	skinCode: string | null;
};

export type CommerceState = {
	hasAnyPurchase: boolean;
	hasPremium: boolean;
	premiumTier: string | null;
	premiumExpiresAt: Date | null;
	ownedSkins: string[];
};

export type CheckoutResult = {
	order: {
		id: string;
		status: string;
		paymentProvider: string;
		totalAmount: number;
		currency: string;
		paidAt: Date;
	};
	item: {
		offerId: string;
		offerCode: string;
		offerName: string;
		kind: OfferKind;
		unitPriceAmount: number;
		currency: string;
	};
	ownership: {
		id: string;
		kind: OfferKind;
		premiumTier: string | null;
		skinCode: string | null;
		startsAt: Date;
		expiresAt: Date | null;
	};
};

// Carries domain-specific checkout failures with HTTP metadata so route
// handlers can return meaningful errors without hard-coding commerce rules.
export class CommerceError extends Error {
	statusCode: number;
	code: string;

	// Stores the API status and machine-readable code alongside the human message
	// that explains why checkout was rejected.
	constructor(statusCode: number, code: string, message: string) {
		super(message);
		this.name = "CommerceError";
		this.statusCode = statusCode;
		this.code = code;
	}
}

type DatabaseErrorLike = {
	code?: string;
	constraint?: string;
};

// Translates low-level unique violations back into stable checkout responses so
// callers still receive the same 409 errors even when the database wins the
// race instead of the optimistic pre-check query.
function mapCheckoutWriteConflict(error: unknown) {
	if (!error || typeof error !== "object") {
		return null;
	}

	const databaseError = error as DatabaseErrorLike;

	if (databaseError.code !== UNIQUE_VIOLATION_ERROR_CODE) {
		return null;
	}

	if (databaseError.constraint === ACTIVE_SKIN_OWNERSHIP_INDEX) {
		return new CommerceError(
			409,
			"SKIN_ALREADY_OWNED",
			"User already owns this skin",
		);
	}

	if (databaseError.constraint === ACTIVE_LIFETIME_PREMIUM_OWNERSHIP_INDEX) {
		return new CommerceError(
			409,
			"PREMIUM_LIFETIME_ALREADY_OWNED",
			"User already owns lifetime premium",
		);
	}

	return null;
}

// Maps joined database rows into the API shape used by store and profile
// endpoints, hiding nullable join details from the rest of the code.
function mapOffer(row: StoreOfferRow): CommerceOffer {
	return {
		id: row.id,
		code: row.code,
		name: row.name,
		kind: row.kind,
		durationKind: row.durationKind,
		durationDays: row.durationDays,
		priceAmount: row.priceAmount,
		currency: row.currency,
		premiumPlan:
			row.premiumPlanId && row.premiumPlanCode && row.premiumPlanName
				? {
						id: row.premiumPlanId,
						code: row.premiumPlanCode,
						name: row.premiumPlanName,
						rank: row.premiumPlanRank ?? 0,
				  }
				: null,
		skinCode: row.skinCode,
	};
}

// Wraps checkout writes in a transaction so orders, order items, and ownership
// records either succeed together or fail together.
async function withTransaction<T>(callback: (client: PoolClient) => Promise<T>) {
	const client = await dbPool.connect();

	try {
		await client.query("BEGIN");
		const result = await callback(client);
		await client.query("COMMIT");
		return result;
	} catch (error) {
		await client.query("ROLLBACK");
		throw error;
	} finally {
		client.release();
	}
}

// Serializes checkouts for the same user inside the current transaction so two
// concurrent requests cannot both compute entitlement state from the same
// starting snapshot.
async function lockUserForCheckout(client: PoolClient, userId: string) {
	const result = await client.query<{ id: string }>(
		`
			SELECT id
			FROM public."user"
			WHERE id = $1
			FOR UPDATE
		`,
		[userId],
	);

	if ((result.rowCount ?? 0) === 0) {
		throw new CommerceError(404, "USER_NOT_FOUND", "User was not found");
	}
}

// Loads one currently sellable offer together with premium metadata so checkout
// cannot bypass the same active-plan rules used by the public catalog.
async function getOfferById(client: PoolClient, offerId: string) {
	const result = await client.query<CheckoutOfferRow>(
		`
			SELECT
				offer.id,
				offer.code,
				offer.name,
				offer.kind,
				offer."isActive" AS "isActive",
				offer."premiumPlanId" AS "premiumPlanId",
				plan.code AS "premiumPlanCode",
				plan.name AS "premiumPlanName",
				plan.rank AS "premiumPlanRank",
				offer."skinCode" AS "skinCode",
				offer."durationKind" AS "durationKind",
				offer."durationDays" AS "durationDays",
				offer."priceAmount" AS "priceAmount",
				offer.currency
			FROM public.store_offer AS offer
			LEFT JOIN public.premium_plan AS plan
				ON plan.id = offer."premiumPlanId"
			WHERE
				offer.id = $1
				AND offer."isActive" = true
				AND (offer.kind <> 'premium' OR plan."isActive" = true)
			LIMIT 1
		`,
		[offerId],
	);

	return result.rows[0] ?? null;
}

// Converts plan durations into expiry timestamps so premium purchases can be
// scheduled without duplicating date math in checkout code.
function addDays(baseDate: Date, days: number) {
	const millisecondsPerDay = 24 * 60 * 60 * 1000;
	return new Date(baseDate.getTime() + days * millisecondsPerDay);
}

// Computes when a premium purchase should take effect by only treating
// same-rank or higher premium rows as blockers for the newly purchased tier.
async function getPremiumScheduleForCheckout(input: {
	client: PoolClient;
	userId: string;
	targetRank: number;
	now: Date;
}) {
	const premiumRows = await input.client.query<ScheduledPremiumRow>(
		`
			SELECT
				ownership."startsAt" AS "startsAt",
				ownership."expiresAt" AS "expiresAt",
				plan.rank AS "premiumPlanRank"
			FROM public.user_ownership AS ownership
			JOIN public.premium_plan AS plan
				ON plan.id = ownership."premiumPlanId"
			WHERE
				ownership."userId" = $1
				AND ownership.kind = 'premium'
				AND ownership."revokedAt" IS NULL
				AND (
					ownership."expiresAt" IS NULL
					OR ownership."expiresAt" > $2
					OR ownership."startsAt" > $2
				)
		`,
		[input.userId, input.now],
	);

	const blockingPremium = premiumRows.rows.filter(
		(row) => row.premiumPlanRank >= input.targetRank,
	);

	if (blockingPremium.some((row) => row.expiresAt === null)) {
		throw new CommerceError(
			409,
			"PREMIUM_LIFETIME_ALREADY_OWNED",
			"User already owns lifetime premium",
		);
	}

	const latestBlockingExpiry = blockingPremium.reduce<Date | null>(
		(latestExpiry, row) => {
			if (!row.expiresAt) {
				return latestExpiry;
			}

			if (!latestExpiry || row.expiresAt > latestExpiry) {
				return row.expiresAt;
			}

			return latestExpiry;
		},
		null,
	);

	return latestBlockingExpiry && latestBlockingExpiry > input.now
		? latestBlockingExpiry
		: input.now;
}

// Returns only offers that are safe to sell to clients, filtering out disabled
// entries and premium plans that should no longer be exposed.
export async function getActiveStoreOffers() {
	const result = await dbPool.query<StoreOfferRow>(
		`
			SELECT
				offer.id,
				offer.code,
				offer.name,
				offer.kind,
				offer."premiumPlanId" AS "premiumPlanId",
				plan.code AS "premiumPlanCode",
				plan.name AS "premiumPlanName",
				plan.rank AS "premiumPlanRank",
				offer."skinCode" AS "skinCode",
				offer."durationKind" AS "durationKind",
				offer."durationDays" AS "durationDays",
				offer."priceAmount" AS "priceAmount",
				offer.currency
			FROM public.store_offer AS offer
			LEFT JOIN public.premium_plan AS plan
				ON plan.id = offer."premiumPlanId"
			WHERE
				offer."isActive" = true
				AND (offer.kind <> 'premium' OR plan."isActive" = true)
			ORDER BY
				CASE WHEN offer.kind = 'premium' THEN 0 ELSE 1 END,
				plan.rank DESC NULLS LAST,
				offer."priceAmount" ASC,
				offer.code ASC
		`,
	);

	return result.rows.map(mapOffer);
}

// Builds the commerce section of `/users/me` so the client can render purchase
// history, active premium state, and owned cosmetics from one response.
export async function getUserCommerceState(userId: string): Promise<CommerceState> {
	const [paidOrdersResult, premiumResult, skinResult] = await Promise.all([
		dbPool.query<{ hasAnyPurchase: boolean }>(
			`
				SELECT EXISTS (
					SELECT 1
					FROM public.purchase_order
					WHERE "userId" = $1 AND status = 'paid'
				) AS "hasAnyPurchase"
			`,
			[userId],
		),
		dbPool.query<{ premiumTier: string; expiresAt: Date | null }>(
			`
				SELECT
					plan.code AS "premiumTier",
					ownership."expiresAt" AS "expiresAt"
				FROM public.user_ownership AS ownership
				JOIN public.premium_plan AS plan
					ON plan.id = ownership."premiumPlanId"
				WHERE
					ownership."userId" = $1
					AND ownership.kind = 'premium'
					AND ownership."revokedAt" IS NULL
					AND ownership."startsAt" <= NOW()
					AND (ownership."expiresAt" IS NULL OR ownership."expiresAt" > NOW())
				ORDER BY plan.rank DESC, ownership."expiresAt" DESC NULLS FIRST
				LIMIT 1
			`,
			[userId],
		),
		dbPool.query<{ skinCode: string }>(
			`
				SELECT DISTINCT ownership."skinCode" AS "skinCode"
				FROM public.user_ownership AS ownership
				WHERE
					ownership."userId" = $1
					AND ownership.kind = 'skin'
					AND ownership."skinCode" IS NOT NULL
					AND ownership."revokedAt" IS NULL
					AND ownership."startsAt" <= NOW()
					AND (ownership."expiresAt" IS NULL OR ownership."expiresAt" > NOW())
				ORDER BY ownership."skinCode" ASC
			`,
			[userId],
		),
	]);

	const activePremium = premiumResult.rows[0] ?? null;

	return {
		hasAnyPurchase: paidOrdersResult.rows[0]?.hasAnyPurchase ?? false,
		hasPremium: Boolean(activePremium),
		premiumTier: activePremium?.premiumTier ?? null,
		premiumExpiresAt: activePremium?.expiresAt ?? null,
		ownedSkins: skinResult.rows.map((row) => row.skinCode),
	};
}

// Performs the full internal checkout flow: validate the offer, prevent
// duplicate ownership, create accounting records, and grant the purchased
// entitlement in one transaction.
export async function createCheckout(input: {
	userId: string;
	offerId: string;
}) {
	return withTransaction(async (client) => {
		try {
			const offer = await getOfferById(client, input.offerId);

			if (!offer) {
				throw new CommerceError(404, "OFFER_NOT_FOUND", "Offer was not found");
			}

			if (offer.kind === "premium" && !offer.premiumPlanCode) {
				throw new CommerceError(
					500,
					"INVALID_PREMIUM_OFFER",
					"Premium offer is missing a premium plan",
				);
			}

			if (offer.kind === "skin" && !offer.skinCode) {
				throw new CommerceError(
					500,
					"INVALID_SKIN_OFFER",
					"Skin offer is missing a skin code",
				);
			}

			await lockUserForCheckout(client, input.userId);

			if (offer.kind === "skin") {
				const existingSkin = await client.query(
					`
						SELECT 1
						FROM public.user_ownership
						WHERE
							"userId" = $1
							AND kind = 'skin'
							AND "skinCode" = $2
							AND "revokedAt" IS NULL
							AND "startsAt" <= NOW()
							AND ("expiresAt" IS NULL OR "expiresAt" > NOW())
						LIMIT 1
					`,
					[input.userId, offer.skinCode],
				);

				if ((existingSkin.rowCount ?? 0) > 0) {
					throw new CommerceError(
						409,
						"SKIN_ALREADY_OWNED",
						"User already owns this skin",
					);
				}
			}

			const now = new Date();
			let startsAt = now;
			let expiresAt: Date | null = null;

			if (offer.kind === "premium") {
				const targetPremiumRank = offer.premiumPlanRank;

				if (targetPremiumRank == null) {
					throw new CommerceError(
						500,
						"INVALID_PREMIUM_OFFER",
						"Premium offer is missing a premium plan rank",
					);
				}

				startsAt = await getPremiumScheduleForCheckout({
					client,
					userId: input.userId,
					targetRank: targetPremiumRank,
					now,
				});

				if (offer.durationKind === "days" && offer.durationDays) {
					expiresAt = addDays(startsAt, offer.durationDays);
				}
			}

			const orderId = randomUUID();
			const orderItemId = randomUUID();
			const ownershipId = randomUUID();
			const orderStatus: PurchaseOrderStatus = "paid";
			const paymentProvider: PaymentProvider = "internal";
			const providerPaymentId = orderId;

			const orderResult = await client.query<PurchaseOrderRow>(
				`
					INSERT INTO public.purchase_order (
						id,
						"userId",
						status,
						"paymentProvider",
						"providerPaymentId",
						"totalAmount",
						currency,
						"paidAt"
					)
					VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
					RETURNING
						id,
						status,
						"paymentProvider" AS "paymentProvider",
						"totalAmount" AS "totalAmount",
						currency,
						"paidAt" AS "paidAt"
				`,
				[
					orderId,
					input.userId,
					orderStatus,
					paymentProvider,
					providerPaymentId,
					offer.priceAmount,
					offer.currency,
					now,
				],
			);

			await client.query(
				`
					INSERT INTO public.purchase_order_item (
						id,
						"orderId",
						"offerId",
						kind,
						"offerCodeSnapshot",
						"offerNameSnapshot",
						"premiumPlanCodeSnapshot",
						"skinCodeSnapshot",
						"durationKindSnapshot",
						"durationDaysSnapshot",
						"unitPriceAmount",
						currency
					)
					VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
				`,
				[
					orderItemId,
					orderId,
					offer.id,
					offer.kind,
					offer.code,
					offer.name,
					offer.premiumPlanCode,
					offer.skinCode,
					offer.durationKind,
					offer.durationDays,
					offer.priceAmount,
					offer.currency,
				],
			);

			const ownershipResult = await client.query<OwnershipRow>(
				`
					INSERT INTO public.user_ownership (
						id,
						"userId",
						kind,
						"premiumPlanId",
						"skinCode",
						"sourceOrderItemId",
						"startsAt",
						"expiresAt"
					)
					VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
					RETURNING
						id,
						kind,
						"skinCode" AS "skinCode",
						"startsAt" AS "startsAt",
						"expiresAt" AS "expiresAt",
						(
							SELECT code
							FROM public.premium_plan
							WHERE id = "premiumPlanId"
						) AS "premiumPlanCode"
				`,
				[
					ownershipId,
					input.userId,
					offer.kind,
					offer.premiumPlanId,
					offer.skinCode,
					orderItemId,
					startsAt,
					expiresAt,
				],
			);

			const order = orderResult.rows[0];
			const ownership = ownershipResult.rows[0];

			return {
				order: {
					id: order.id,
					status: order.status,
					paymentProvider: order.paymentProvider,
					totalAmount: order.totalAmount,
					currency: order.currency,
					paidAt: order.paidAt,
				},
				item: {
					offerId: offer.id,
					offerCode: offer.code,
					offerName: offer.name,
					kind: offer.kind,
					unitPriceAmount: offer.priceAmount,
					currency: offer.currency,
				},
				ownership: {
					id: ownership.id,
					kind: ownership.kind,
					premiumTier: ownership.premiumPlanCode,
					skinCode: ownership.skinCode,
					startsAt: ownership.startsAt,
					expiresAt: ownership.expiresAt,
				},
			} satisfies CheckoutResult;
		} catch (error) {
			if (error instanceof CommerceError) {
				throw error;
			}

			const mappedConflict = mapCheckoutWriteConflict(error);

			if (mappedConflict) {
				throw mappedConflict;
			}

			throw error;
		}
	});
}
