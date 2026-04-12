-- Creates the persistence layer for the in-app store so offers, orders, and
-- granted ownership can be tracked explicitly instead of being inferred from
-- ad-hoc user flags.

-- Defines premium tiers that store offers can reference and user entitlements
-- can resolve back to later.
CREATE TABLE IF NOT EXISTS public.premium_plan (
    id text NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    rank integer NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT premium_plan_pkey PRIMARY KEY (id),
    CONSTRAINT premium_plan_code_key UNIQUE (code),
    CONSTRAINT premium_plan_rank_check CHECK (rank > 0)
);

-- Stores the sellable catalog entries and enforces that each row matches the
-- expected shape for either premium access or a cosmetic unlock.
CREATE TABLE IF NOT EXISTS public.store_offer (
    id text NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    kind text NOT NULL,
    "premiumPlanId" text,
    "skinCode" text,
    "durationKind" text NOT NULL,
    "durationDays" integer,
    "priceAmount" integer NOT NULL,
    currency text NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT store_offer_pkey PRIMARY KEY (id),
    CONSTRAINT store_offer_code_key UNIQUE (code),
    CONSTRAINT store_offer_kind_check CHECK (kind = ANY (ARRAY['premium'::text, 'skin'::text])),
    CONSTRAINT store_offer_duration_kind_check CHECK ("durationKind" = ANY (ARRAY['days'::text, 'lifetime'::text])),
    CONSTRAINT store_offer_price_amount_check CHECK ("priceAmount" >= 0),
    CONSTRAINT store_offer_currency_length_check CHECK (char_length(currency) = 3),
    CONSTRAINT store_offer_shape_check CHECK (
        (
            kind = 'premium'::text
            AND "premiumPlanId" IS NOT NULL
            AND "skinCode" IS NULL
            AND (
                ("durationKind" = 'days'::text AND "durationDays" IS NOT NULL AND "durationDays" > 0)
                OR ("durationKind" = 'lifetime'::text AND "durationDays" IS NULL)
            )
        )
        OR (
            kind = 'skin'::text
            AND "premiumPlanId" IS NULL
            AND "skinCode" IS NOT NULL
            AND "durationKind" = 'lifetime'::text
            AND "durationDays" IS NULL
        )
    )
);

-- Records purchase status and payment metadata so checkout remains auditable
-- even if the catalog changes after the transaction.
CREATE TABLE IF NOT EXISTS public.purchase_order (
    id text NOT NULL,
    "userId" text NOT NULL,
    status text NOT NULL,
    "paymentProvider" text NOT NULL,
    "providerPaymentId" text,
    "totalAmount" integer NOT NULL,
    currency text NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "paidAt" timestamp with time zone,
    CONSTRAINT purchase_order_pkey PRIMARY KEY (id),
    CONSTRAINT purchase_order_status_check CHECK (status = ANY (ARRAY['pending'::text, 'paid'::text, 'failed'::text, 'refunded'::text, 'cancelled'::text])),
    CONSTRAINT purchase_order_total_amount_check CHECK ("totalAmount" >= 0),
    CONSTRAINT purchase_order_currency_length_check CHECK (char_length(currency) = 3)
);

-- Snapshots what was bought at checkout time so order history does not drift
-- when offer names, durations, or linked plans are edited later.
CREATE TABLE IF NOT EXISTS public.purchase_order_item (
    id text NOT NULL,
    "orderId" text NOT NULL,
    "offerId" text NOT NULL,
    kind text NOT NULL,
    "offerCodeSnapshot" text NOT NULL,
    "offerNameSnapshot" text NOT NULL,
    "premiumPlanCodeSnapshot" text,
    "skinCodeSnapshot" text,
    "durationKindSnapshot" text NOT NULL,
    "durationDaysSnapshot" integer,
    "unitPriceAmount" integer NOT NULL,
    currency text NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT purchase_order_item_pkey PRIMARY KEY (id),
    CONSTRAINT purchase_order_item_kind_check CHECK (kind = ANY (ARRAY['premium'::text, 'skin'::text])),
    CONSTRAINT purchase_order_item_duration_kind_check CHECK ("durationKindSnapshot" = ANY (ARRAY['days'::text, 'lifetime'::text])),
    CONSTRAINT purchase_order_item_price_amount_check CHECK ("unitPriceAmount" >= 0),
    CONSTRAINT purchase_order_item_currency_length_check CHECK (char_length(currency) = 3),
    CONSTRAINT purchase_order_item_shape_check CHECK (
        (
            kind = 'premium'::text
            AND "premiumPlanCodeSnapshot" IS NOT NULL
            AND "skinCodeSnapshot" IS NULL
            AND (
                ("durationKindSnapshot" = 'days'::text AND "durationDaysSnapshot" IS NOT NULL AND "durationDaysSnapshot" > 0)
                OR ("durationKindSnapshot" = 'lifetime'::text AND "durationDaysSnapshot" IS NULL)
            )
        )
        OR (
            kind = 'skin'::text
            AND "premiumPlanCodeSnapshot" IS NULL
            AND "skinCodeSnapshot" IS NOT NULL
            AND "durationKindSnapshot" = 'lifetime'::text
            AND "durationDaysSnapshot" IS NULL
        )
    )
);

-- Grants the actual premium or skin ownership to a user and keeps its validity
-- window separate from the raw payment record.
CREATE TABLE IF NOT EXISTS public.user_ownership (
    id text NOT NULL,
    "userId" text NOT NULL,
    kind text NOT NULL,
    "premiumPlanId" text,
    "skinCode" text,
    "sourceOrderItemId" text NOT NULL,
    "startsAt" timestamp with time zone NOT NULL,
    "expiresAt" timestamp with time zone,
    "revokedAt" timestamp with time zone,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT user_ownership_pkey PRIMARY KEY (id),
    CONSTRAINT user_ownership_source_order_item_id_key UNIQUE ("sourceOrderItemId"),
    CONSTRAINT user_ownership_kind_check CHECK (kind = ANY (ARRAY['premium'::text, 'skin'::text])),
    CONSTRAINT user_ownership_shape_check CHECK (
        (
            kind = 'premium'::text
            AND "premiumPlanId" IS NOT NULL
            AND "skinCode" IS NULL
        )
        OR (
            kind = 'skin'::text
            AND "premiumPlanId" IS NULL
            AND "skinCode" IS NOT NULL
        )
    )
);

-- Connects premium offers to the tier they unlock.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'store_offer_premiumPlanId_fkey'
          AND conrelid = 'public.store_offer'::regclass
    ) THEN
        ALTER TABLE ONLY public.store_offer
            ADD CONSTRAINT "store_offer_premiumPlanId_fkey" FOREIGN KEY ("premiumPlanId") REFERENCES public.premium_plan(id) ON DELETE RESTRICT;
    END IF;
END
$$;

-- Deletes purchase records automatically when the owning user is removed.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'purchase_order_userId_fkey'
          AND conrelid = 'public.purchase_order'::regclass
    ) THEN
        ALTER TABLE ONLY public.purchase_order
            ADD CONSTRAINT "purchase_order_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."user"(id) ON DELETE CASCADE;
    END IF;
END
$$;

-- Deletes order items together with their parent order.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'purchase_order_item_orderId_fkey'
          AND conrelid = 'public.purchase_order_item'::regclass
    ) THEN
        ALTER TABLE ONLY public.purchase_order_item
            ADD CONSTRAINT "purchase_order_item_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES public.purchase_order(id) ON DELETE CASCADE;
    END IF;
END
$$;

-- Prevents historical order items from referencing missing offers.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'purchase_order_item_offerId_fkey'
          AND conrelid = 'public.purchase_order_item'::regclass
    ) THEN
        ALTER TABLE ONLY public.purchase_order_item
            ADD CONSTRAINT "purchase_order_item_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES public.store_offer(id) ON DELETE RESTRICT;
    END IF;
END
$$;

-- Removes granted ownership when the user account is deleted.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'user_ownership_userId_fkey'
          AND conrelid = 'public.user_ownership'::regclass
    ) THEN
        ALTER TABLE ONLY public.user_ownership
            ADD CONSTRAINT "user_ownership_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."user"(id) ON DELETE CASCADE;
    END IF;
END
$$;

-- Ensures premium entitlements always point at a valid tier definition.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'user_ownership_premiumPlanId_fkey'
          AND conrelid = 'public.user_ownership'::regclass
    ) THEN
        ALTER TABLE ONLY public.user_ownership
            ADD CONSTRAINT "user_ownership_premiumPlanId_fkey" FOREIGN KEY ("premiumPlanId") REFERENCES public.premium_plan(id) ON DELETE RESTRICT;
    END IF;
END
$$;

-- Keeps each entitlement traceable back to the order item that granted it.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'user_ownership_sourceOrderItemId_fkey'
          AND conrelid = 'public.user_ownership'::regclass
    ) THEN
        ALTER TABLE ONLY public.user_ownership
            ADD CONSTRAINT "user_ownership_sourceOrderItemId_fkey" FOREIGN KEY ("sourceOrderItemId") REFERENCES public.purchase_order_item(id) ON DELETE RESTRICT;
    END IF;
END
$$;

-- Supports the catalog, purchase history, and ownership lookups used by the
-- store and `/users/me` endpoints.
CREATE INDEX IF NOT EXISTS "store_offer_isActive_idx" ON public.store_offer USING btree ("isActive");
CREATE INDEX IF NOT EXISTS "store_offer_kind_idx" ON public.store_offer USING btree (kind);
CREATE INDEX IF NOT EXISTS "purchase_order_userId_idx" ON public.purchase_order USING btree ("userId");
CREATE INDEX IF NOT EXISTS "purchase_order_status_idx" ON public.purchase_order USING btree (status);
CREATE INDEX IF NOT EXISTS "purchase_order_item_orderId_idx" ON public.purchase_order_item USING btree ("orderId");
CREATE INDEX IF NOT EXISTS "user_ownership_userId_idx" ON public.user_ownership USING btree ("userId");
CREATE INDEX IF NOT EXISTS "user_ownership_userId_kind_idx" ON public.user_ownership USING btree ("userId", kind);

-- Fails fast when existing entitlement data would violate the unique ownership
-- guarantees used to protect checkout from concurrent duplicate grants.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM public.user_ownership
        WHERE kind = 'skin' AND "revokedAt" IS NULL
        GROUP BY "userId", "skinCode"
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION 'Cannot enforce unique active skin ownership per user while duplicate non-revoked skin ownership rows exist.'
            USING ERRCODE = '23505',
                  DETAIL = 'At least one user currently has the same non-revoked skin granted more than once.';
    END IF;
END
$$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM public.user_ownership
        WHERE
            kind = 'premium'
            AND "expiresAt" IS NULL
            AND "revokedAt" IS NULL
        GROUP BY "userId", "premiumPlanId"
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION 'Cannot enforce unique lifetime premium ownership per user and tier while duplicate non-revoked lifetime premium rows exist.'
            USING ERRCODE = '23505',
                  DETAIL = 'At least one user currently has the same non-revoked lifetime premium ownership row more than once.';
    END IF;
END
$$;

-- Drops the old per-user lifetime premium uniqueness rule, if present, and
-- replaces it with the final tier-aware safeguard.
DROP INDEX IF EXISTS "user_ownership_active_lifetime_premium_per_user_key";

CREATE UNIQUE INDEX IF NOT EXISTS "user_ownership_active_skin_per_user_key"
    ON public.user_ownership USING btree ("userId", "skinCode")
    WHERE kind = 'skin' AND "revokedAt" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "user_ownership_active_lifetime_premium_plan_per_user_key"
    ON public.user_ownership USING btree ("userId", "premiumPlanId")
    WHERE
        kind = 'premium'
        AND "expiresAt" IS NULL
        AND "revokedAt" IS NULL;
