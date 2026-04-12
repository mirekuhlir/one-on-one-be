--
-- PostgreSQL database dump
--

\restrict D0HMpuD6HbbD3vax3uZO6wdFNhx80oydNWD70Lk7qzBLyOt6U3Ev0hPufpvG8jo

-- Dumped from database version 17.7 (Debian 17.7-3.pgdg13+1)
-- Dumped by pg_dump version 18.3 (Homebrew)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: account; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.account (
    id text NOT NULL,
    "accountId" text NOT NULL,
    "providerId" text NOT NULL,
    "userId" text NOT NULL,
    "accessToken" text,
    "refreshToken" text,
    "idToken" text,
    "accessTokenExpiresAt" timestamp with time zone,
    "refreshTokenExpiresAt" timestamp with time zone,
    scope text,
    password text,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);


ALTER TABLE public.account OWNER TO postgres;

--
-- Name: premium_plan; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.premium_plan (
    id text NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    rank integer NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT premium_plan_rank_check CHECK ((rank > 0))
);


ALTER TABLE public.premium_plan OWNER TO postgres;

--
-- Name: purchase_order; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.purchase_order (
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
    CONSTRAINT purchase_order_currency_length_check CHECK ((char_length(currency) = 3)),
    CONSTRAINT purchase_order_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'paid'::text, 'failed'::text, 'refunded'::text, 'cancelled'::text]))),
    CONSTRAINT purchase_order_total_amount_check CHECK (("totalAmount" >= 0))
);


ALTER TABLE public.purchase_order OWNER TO postgres;

--
-- Name: purchase_order_item; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.purchase_order_item (
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
    CONSTRAINT purchase_order_item_currency_length_check CHECK ((char_length(currency) = 3)),
    CONSTRAINT purchase_order_item_duration_kind_check CHECK (("durationKindSnapshot" = ANY (ARRAY['days'::text, 'lifetime'::text]))),
    CONSTRAINT purchase_order_item_kind_check CHECK ((kind = ANY (ARRAY['premium'::text, 'skin'::text]))),
    CONSTRAINT purchase_order_item_price_amount_check CHECK (("unitPriceAmount" >= 0)),
    CONSTRAINT purchase_order_item_shape_check CHECK ((((kind = 'premium'::text) AND ("premiumPlanCodeSnapshot" IS NOT NULL) AND ("skinCodeSnapshot" IS NULL) AND ((("durationKindSnapshot" = 'days'::text) AND ("durationDaysSnapshot" IS NOT NULL) AND ("durationDaysSnapshot" > 0)) OR (("durationKindSnapshot" = 'lifetime'::text) AND ("durationDaysSnapshot" IS NULL)))) OR ((kind = 'skin'::text) AND ("premiumPlanCodeSnapshot" IS NULL) AND ("skinCodeSnapshot" IS NOT NULL) AND ("durationKindSnapshot" = 'lifetime'::text) AND ("durationDaysSnapshot" IS NULL))))
);


ALTER TABLE public.purchase_order_item OWNER TO postgres;

--
-- Name: session; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.session (
    id text NOT NULL,
    "expiresAt" timestamp with time zone NOT NULL,
    token text NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL,
    "ipAddress" text,
    "userAgent" text,
    "userId" text NOT NULL
);


ALTER TABLE public.session OWNER TO postgres;

--
-- Name: store_offer; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.store_offer (
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
    CONSTRAINT store_offer_currency_length_check CHECK ((char_length(currency) = 3)),
    CONSTRAINT store_offer_duration_kind_check CHECK (("durationKind" = ANY (ARRAY['days'::text, 'lifetime'::text]))),
    CONSTRAINT store_offer_kind_check CHECK ((kind = ANY (ARRAY['premium'::text, 'skin'::text]))),
    CONSTRAINT store_offer_price_amount_check CHECK (("priceAmount" >= 0)),
    CONSTRAINT store_offer_shape_check CHECK ((((kind = 'premium'::text) AND ("premiumPlanId" IS NOT NULL) AND ("skinCode" IS NULL) AND ((("durationKind" = 'days'::text) AND ("durationDays" IS NOT NULL) AND ("durationDays" > 0)) OR (("durationKind" = 'lifetime'::text) AND ("durationDays" IS NULL)))) OR ((kind = 'skin'::text) AND ("premiumPlanId" IS NULL) AND ("skinCode" IS NOT NULL) AND ("durationKind" = 'lifetime'::text) AND ("durationDays" IS NULL))))
);


ALTER TABLE public.store_offer OWNER TO postgres;

--
-- Name: user; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."user" (
    id text NOT NULL,
    name text NOT NULL,
    email text NOT NULL,
    "emailVerified" boolean NOT NULL,
    image text,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "isAnonymous" boolean
);


ALTER TABLE public."user" OWNER TO postgres;

--
-- Name: user_ownership; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.user_ownership (
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
    CONSTRAINT user_ownership_kind_check CHECK ((kind = ANY (ARRAY['premium'::text, 'skin'::text]))),
    CONSTRAINT user_ownership_shape_check CHECK ((((kind = 'premium'::text) AND ("premiumPlanId" IS NOT NULL) AND ("skinCode" IS NULL)) OR ((kind = 'skin'::text) AND ("premiumPlanId" IS NULL) AND ("skinCode" IS NOT NULL))))
);


ALTER TABLE public.user_ownership OWNER TO postgres;

--
-- Name: verification; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.verification (
    id text NOT NULL,
    identifier text NOT NULL,
    value text NOT NULL,
    "expiresAt" timestamp with time zone NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.verification OWNER TO postgres;

--
-- Name: account account_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.account
    ADD CONSTRAINT account_pkey PRIMARY KEY (id);


--
-- Name: premium_plan premium_plan_code_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.premium_plan
    ADD CONSTRAINT premium_plan_code_key UNIQUE (code);


--
-- Name: premium_plan premium_plan_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.premium_plan
    ADD CONSTRAINT premium_plan_pkey PRIMARY KEY (id);


--
-- Name: purchase_order_item purchase_order_item_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.purchase_order_item
    ADD CONSTRAINT purchase_order_item_pkey PRIMARY KEY (id);


--
-- Name: purchase_order purchase_order_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.purchase_order
    ADD CONSTRAINT purchase_order_pkey PRIMARY KEY (id);


--
-- Name: session session_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.session
    ADD CONSTRAINT session_pkey PRIMARY KEY (id);


--
-- Name: session session_token_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.session
    ADD CONSTRAINT session_token_key UNIQUE (token);


--
-- Name: store_offer store_offer_code_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.store_offer
    ADD CONSTRAINT store_offer_code_key UNIQUE (code);


--
-- Name: store_offer store_offer_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.store_offer
    ADD CONSTRAINT store_offer_pkey PRIMARY KEY (id);


--
-- Name: user user_email_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."user"
    ADD CONSTRAINT user_email_key UNIQUE (email);


--
-- Name: user_ownership user_ownership_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_ownership
    ADD CONSTRAINT user_ownership_pkey PRIMARY KEY (id);


--
-- Name: user_ownership user_ownership_source_order_item_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_ownership
    ADD CONSTRAINT user_ownership_source_order_item_id_key UNIQUE ("sourceOrderItemId");


--
-- Name: user user_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."user"
    ADD CONSTRAINT user_pkey PRIMARY KEY (id);


--
-- Name: verification verification_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.verification
    ADD CONSTRAINT verification_pkey PRIMARY KEY (id);


--
-- Name: account_userId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "account_userId_idx" ON public.account USING btree ("userId");


--
-- Name: purchase_order_item_orderId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "purchase_order_item_orderId_idx" ON public.purchase_order_item USING btree ("orderId");


--
-- Name: purchase_order_status_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX purchase_order_status_idx ON public.purchase_order USING btree (status);


--
-- Name: purchase_order_userId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "purchase_order_userId_idx" ON public.purchase_order USING btree ("userId");


--
-- Name: session_userId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "session_userId_idx" ON public.session USING btree ("userId");


--
-- Name: store_offer_isActive_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "store_offer_isActive_idx" ON public.store_offer USING btree ("isActive");


--
-- Name: store_offer_kind_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX store_offer_kind_idx ON public.store_offer USING btree (kind);


--
-- Name: user_ownership_active_lifetime_premium_plan_per_user_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX user_ownership_active_lifetime_premium_plan_per_user_key ON public.user_ownership USING btree ("userId", "premiumPlanId") WHERE ((kind = 'premium'::text) AND ("expiresAt" IS NULL) AND ("revokedAt" IS NULL));


--
-- Name: user_ownership_active_skin_per_user_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX user_ownership_active_skin_per_user_key ON public.user_ownership USING btree ("userId", "skinCode") WHERE ((kind = 'skin'::text) AND ("revokedAt" IS NULL));


--
-- Name: user_ownership_userId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "user_ownership_userId_idx" ON public.user_ownership USING btree ("userId");


--
-- Name: user_ownership_userId_kind_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "user_ownership_userId_kind_idx" ON public.user_ownership USING btree ("userId", kind);


--
-- Name: verification_identifier_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX verification_identifier_idx ON public.verification USING btree (identifier);


--
-- Name: account account_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.account
    ADD CONSTRAINT "account_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."user"(id) ON DELETE CASCADE;


--
-- Name: purchase_order_item purchase_order_item_offerId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.purchase_order_item
    ADD CONSTRAINT "purchase_order_item_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES public.store_offer(id) ON DELETE RESTRICT;


--
-- Name: purchase_order_item purchase_order_item_orderId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.purchase_order_item
    ADD CONSTRAINT "purchase_order_item_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES public.purchase_order(id) ON DELETE CASCADE;


--
-- Name: purchase_order purchase_order_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.purchase_order
    ADD CONSTRAINT "purchase_order_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."user"(id) ON DELETE CASCADE;


--
-- Name: session session_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.session
    ADD CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."user"(id) ON DELETE CASCADE;


--
-- Name: store_offer store_offer_premiumPlanId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.store_offer
    ADD CONSTRAINT "store_offer_premiumPlanId_fkey" FOREIGN KEY ("premiumPlanId") REFERENCES public.premium_plan(id) ON DELETE RESTRICT;


--
-- Name: user_ownership user_ownership_premiumPlanId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_ownership
    ADD CONSTRAINT "user_ownership_premiumPlanId_fkey" FOREIGN KEY ("premiumPlanId") REFERENCES public.premium_plan(id) ON DELETE RESTRICT;


--
-- Name: user_ownership user_ownership_sourceOrderItemId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_ownership
    ADD CONSTRAINT "user_ownership_sourceOrderItemId_fkey" FOREIGN KEY ("sourceOrderItemId") REFERENCES public.purchase_order_item(id) ON DELETE RESTRICT;


--
-- Name: user_ownership user_ownership_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_ownership
    ADD CONSTRAINT "user_ownership_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."user"(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict D0HMpuD6HbbD3vax3uZO6wdFNhx80oydNWD70Lk7qzBLyOt6U3Ev0hPufpvG8jo

