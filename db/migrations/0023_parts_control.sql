-- Controle de Peças: parts sold by technicians under consignment. The organization keeps a central
-- stock and hands parts to each technician (their "car" works like a branch). The technician sells
-- to the end customer at any price, keeps the money (in their own Mercado Pago account) and owes the
-- organization the technician price of what they sold. Kept apart from payroll on purpose: it is a
-- sale of parts to the technician, never a commission.
--
-- Stock is never stored as a number: it is the sum of part_movements (append-only), so every unit
-- has a trail. What a technician owes is the sum of part_account_entries (append-only too).

INSERT INTO features (key, name, description, scope, builtin) VALUES
  ('parts', 'Controle de Peças', 'Estoque de peças em consignação com os técnicos, venda pelo celular com Mercado Pago, inventário e acerto mensal.', 'general', TRUE)
ON CONFLICT (key) DO NOTHING;

CREATE TABLE parts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations (id),
  name              TEXT NOT NULL,
  -- The manufacturer's barcode (EAN/GTIN), read by the phone's camera or a USB reader.
  barcode           TEXT,
  sku               TEXT,
  category          TEXT,
  brand             TEXT,
  unit              TEXT NOT NULL DEFAULT 'un',
  description       TEXT,
  image_id          UUID,
  -- What the organization paid, what the technician owes per unit sold, and the price suggested to
  -- the end customer. Prices of past sales are copied into the sale, so editing them only affects
  -- what happens next.
  cost_price        NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (cost_price >= 0),
  technician_price  NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (technician_price >= 0),
  suggested_price   NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (suggested_price >= 0),
  -- Central stock at or below this shows as "repor".
  min_stock         INTEGER CHECK (min_stock >= 0),
  active            BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by        UUID,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at        TIMESTAMPTZ,
  deleted_by        UUID
);

CREATE INDEX parts_organization_idx ON parts (organization_id, name);
CREATE UNIQUE INDEX parts_barcode_idx ON parts (organization_id, barcode) WHERE barcode IS NOT NULL AND deleted_at IS NULL;

-- Every image ever uploaded is kept (replacing one only marks it replaced), so storage usage counts them all.
CREATE TABLE part_images (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES organizations (id),
  part_id          UUID NOT NULL REFERENCES parts (id),
  url              TEXT NOT NULL,
  content_type     TEXT NOT NULL,
  file_size        INTEGER NOT NULL CHECK (file_size >= 0),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by       UUID,
  replaced_at      TIMESTAMPTZ
);

CREATE INDEX part_images_part_idx ON part_images (part_id, created_at DESC);
ALTER TABLE parts ADD CONSTRAINT parts_image_fk FOREIGN KEY (image_id) REFERENCES part_images (id);

-- Remittances to a technician ('out') and returns from one ('return'), with the receipt the
-- technician confirms in the app: the trail that backs the consignment.
CREATE TABLE part_transfers (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id          UUID NOT NULL REFERENCES organizations (id),
  number                   INTEGER NOT NULL,
  technician_id            UUID NOT NULL REFERENCES technicians (id),
  direction                TEXT NOT NULL CHECK (direction IN ('out', 'return')),
  total_technician_price   NUMERIC(12, 2) NOT NULL DEFAULT 0,
  total_cost               NUMERIC(12, 2) NOT NULL DEFAULT 0,
  note                     TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by               UUID,
  acknowledged_at          TIMESTAMPTZ,
  acknowledged_by          UUID,
  acknowledged_ip          TEXT
);

CREATE UNIQUE INDEX part_transfers_number_idx ON part_transfers (organization_id, number);
CREATE INDEX part_transfers_technician_idx ON part_transfers (organization_id, technician_id, created_at DESC);

CREATE TABLE part_sales (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id          UUID NOT NULL REFERENCES organizations (id),
  number                   INTEGER NOT NULL,
  technician_id            UUID NOT NULL REFERENCES technicians (id),
  customer_name            TEXT,
  customer_phone           TEXT,
  -- Optional: the service order the sale happened in.
  order_code               TEXT,
  status                   TEXT NOT NULL DEFAULT 'awaiting_payment' CHECK (status IN ('awaiting_payment', 'paid', 'canceled')),
  payment_method           TEXT NOT NULL CHECK (payment_method IN ('pix', 'card_link', 'card_present', 'cash')),
  total_amount             NUMERIC(12, 2) NOT NULL CHECK (total_amount >= 0),
  total_technician_price   NUMERIC(12, 2) NOT NULL,
  total_cost               NUMERIC(12, 2) NOT NULL,
  -- Mercado Pago (in the technician's own account).
  mp_order_id              TEXT,
  mp_preference_id         TEXT,
  mp_payment_id            TEXT,
  mp_status                TEXT,
  payment_url              TEXT,
  pix_qr_code              TEXT,
  pix_qr_base64            TEXT,
  payment_expires_at       TIMESTAMPTZ,
  -- Each new charge (retry or change of method) is a new attempt, so its idempotency key differs.
  payment_attempts         INTEGER NOT NULL DEFAULT 0,
  payment_error            TEXT,
  paid_at                  TIMESTAMPTZ,
  -- 'mercadopago' (confirmed by the API) or 'technician' (marked as received by hand).
  payment_confirmed_by     TEXT CHECK (payment_confirmed_by IN ('mercadopago', 'technician')),
  payment_link_sent_at     TIMESTAMPTZ,
  receipt_sent_at          TIMESTAMPTZ,
  note                     TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by               UUID,
  canceled_at              TIMESTAMPTZ,
  canceled_by              UUID,
  cancel_reason            TEXT
);

CREATE UNIQUE INDEX part_sales_number_idx ON part_sales (organization_id, number);
CREATE INDEX part_sales_technician_idx ON part_sales (organization_id, technician_id, created_at DESC);
CREATE INDEX part_sales_status_idx ON part_sales (organization_id, status, created_at DESC);
CREATE UNIQUE INDEX part_sales_mp_payment_idx ON part_sales (mp_payment_id) WHERE mp_payment_id IS NOT NULL;
CREATE INDEX part_sales_mp_order_idx ON part_sales (mp_order_id) WHERE mp_order_id IS NOT NULL;

CREATE TABLE part_sale_items (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id        UUID NOT NULL REFERENCES organizations (id),
  sale_id                UUID NOT NULL REFERENCES part_sales (id),
  part_id                UUID NOT NULL REFERENCES parts (id),
  part_name              TEXT NOT NULL,
  quantity               INTEGER NOT NULL CHECK (quantity > 0),
  unit_price             NUMERIC(12, 2) NOT NULL CHECK (unit_price >= 0),
  unit_technician_price  NUMERIC(12, 2) NOT NULL,
  unit_cost              NUMERIC(12, 2) NOT NULL
);

CREATE INDEX part_sale_items_sale_idx ON part_sale_items (sale_id);

-- Stock counts (inventário) of one technician's stock or of the central stock (technician_id NULL).
CREATE TABLE part_inventories (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES organizations (id),
  number           INTEGER NOT NULL,
  technician_id    UUID REFERENCES technicians (id),
  status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'canceled')),
  note             TEXT,
  started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_by       UUID,
  closed_at        TIMESTAMPTZ,
  closed_by        UUID,
  shortage_value   NUMERIC(12, 2),
  surplus_units    INTEGER
);

CREATE UNIQUE INDEX part_inventories_number_idx ON part_inventories (organization_id, number);
CREATE UNIQUE INDEX part_inventories_open_idx ON part_inventories (organization_id, COALESCE(technician_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE status = 'open';

CREATE TABLE part_inventory_items (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES organizations (id),
  inventory_id     UUID NOT NULL REFERENCES part_inventories (id),
  part_id          UUID NOT NULL REFERENCES parts (id),
  counted          INTEGER NOT NULL DEFAULT 0 CHECK (counted >= 0),
  -- Filled when the count is closed (stock at that moment).
  expected         INTEGER,
  unit_technician_price NUMERIC(12, 2),
  -- What to do with a shortage: charge the technician or absorb it (e.g. theft with a police report).
  resolution       TEXT CHECK (resolution IN ('charge', 'absorb')),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by       UUID,
  UNIQUE (inventory_id, part_id)
);

-- Debts of a technician for missing parts (or set by hand), paid in installments under a contract.
CREATE TABLE part_debts (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    UUID NOT NULL REFERENCES organizations (id),
  number             INTEGER NOT NULL,
  technician_id      UUID NOT NULL REFERENCES technicians (id),
  inventory_id       UUID REFERENCES part_inventories (id),
  description        TEXT NOT NULL,
  total_amount       NUMERIC(12, 2) NOT NULL CHECK (total_amount > 0),
  installments       INTEGER NOT NULL CHECK (installments BETWEEN 1 AND 48),
  first_due_month    VARCHAR(7) NOT NULL,
  status             TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'canceled')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by         UUID,
  acknowledged_at    TIMESTAMPTZ,
  acknowledged_by    UUID,
  acknowledged_ip    TEXT,
  canceled_at        TIMESTAMPTZ,
  canceled_by        UUID,
  cancel_reason      TEXT
);

CREATE UNIQUE INDEX part_debts_number_idx ON part_debts (organization_id, number);

-- Every unit that enters or leaves a stock. technician_id NULL = the central stock.
CREATE TABLE part_movements (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id        UUID NOT NULL REFERENCES organizations (id),
  part_id                UUID NOT NULL REFERENCES parts (id),
  technician_id          UUID REFERENCES technicians (id),
  quantity               INTEGER NOT NULL CHECK (quantity <> 0),
  kind                   TEXT NOT NULL CHECK (kind IN (
    'purchase', 'adjustment', 'transfer', 'sale', 'sale_canceled', 'inventory_shortage', 'inventory_surplus'
  )),
  unit_cost              NUMERIC(12, 2),
  unit_technician_price  NUMERIC(12, 2),
  transfer_id            UUID REFERENCES part_transfers (id),
  sale_id                UUID REFERENCES part_sales (id),
  inventory_id           UUID REFERENCES part_inventories (id),
  note                   TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by             UUID
);

CREATE INDEX part_movements_stock_idx ON part_movements (organization_id, technician_id, part_id);
CREATE INDEX part_movements_part_idx ON part_movements (part_id, created_at DESC);

-- The technician's account with the organization. amount > 0: the technician owes; < 0: paid or credited.
CREATE TABLE part_account_entries (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES organizations (id),
  technician_id    UUID NOT NULL REFERENCES technicians (id),
  kind             TEXT NOT NULL CHECK (kind IN ('sale', 'sale_canceled', 'debt_installment', 'debt_canceled', 'payment', 'adjustment')),
  amount           NUMERIC(12, 2) NOT NULL CHECK (amount <> 0),
  -- YYYY-MM the amount is due (sales: the month of the sale; installments: their month).
  due_month        VARCHAR(7) NOT NULL,
  sale_id          UUID REFERENCES part_sales (id),
  debt_id          UUID REFERENCES part_debts (id),
  installment      INTEGER,
  payment_method   TEXT CHECK (payment_method IN ('pix', 'cash', 'transfer', 'deduction', 'other')),
  description      TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by       UUID
);

CREATE INDEX part_account_entries_technician_idx ON part_account_entries (organization_id, technician_id, due_month);

CREATE TABLE parts_settings (
  organization_id   UUID PRIMARY KEY REFERENCES organizations (id),
  payment_methods   TEXT[] NOT NULL DEFAULT ARRAY['pix', 'card_link', 'card_present', 'cash'],
  -- Last line of the receipt sent to the customer (warranty, contact...).
  receipt_footer    TEXT,
  -- Day of the month the technician settles the previous month.
  settlement_day    INTEGER NOT NULL DEFAULT 10 CHECK (settlement_day BETWEEN 1 AND 28),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by        UUID
);

-- Each technician's own Mercado Pago account, authorized through OAuth on the platform's
-- application. Tokens are encrypted (MERCADOPAGO_TOKEN_KEY) and never leave the server.
CREATE TABLE mercadopago_accounts (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    UUID NOT NULL REFERENCES organizations (id),
  technician_id      UUID NOT NULL REFERENCES technicians (id),
  mp_user_id         TEXT NOT NULL,
  nickname           TEXT,
  email              TEXT,
  access_token_enc   TEXT NOT NULL,
  refresh_token_enc  TEXT,
  public_key         TEXT,
  live_mode          BOOLEAN,
  expires_at         TIMESTAMPTZ,
  -- The Point device (in PDV mode) charges go to, when the technician has one.
  terminal_id        TEXT,
  connected_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  refreshed_at       TIMESTAMPTZ,
  last_error         TEXT,
  disconnected_at    TIMESTAMPTZ,
  disconnected_by    UUID
);

CREATE UNIQUE INDEX mercadopago_accounts_active_idx ON mercadopago_accounts (organization_id, technician_id) WHERE disconnected_at IS NULL;
CREATE INDEX mercadopago_accounts_user_idx ON mercadopago_accounts (mp_user_id) WHERE disconnected_at IS NULL;

-- OAuth in flight: the callback lands on the root domain (one fixed redirect URI), without the
-- subdomain session, so the state carries who started it. Single use, valid for 15 minutes.
CREATE TABLE mercadopago_oauth_states (
  state            TEXT PRIMARY KEY,
  organization_id  UUID NOT NULL REFERENCES organizations (id),
  technician_id    UUID NOT NULL REFERENCES technicians (id),
  user_id          UUID NOT NULL,
  code_verifier    TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  used_at          TIMESTAMPTZ
);

CREATE TABLE mercadopago_webhook_events (
  id            BIGSERIAL PRIMARY KEY,
  received_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  topic         TEXT,
  action        TEXT,
  resource_id   TEXT,
  mp_user_id    TEXT,
  live_mode     BOOLEAN,
  payload       JSONB NOT NULL,
  sale_id       UUID,
  processed_at  TIMESTAMPTZ,
  error         TEXT
);

CREATE INDEX mercadopago_webhook_events_received_idx ON mercadopago_webhook_events (received_at DESC);

-- Files an organization stores, for the storage limit and the owner's capacity screens.
CREATE VIEW organization_files AS
  SELECT organization_id, file_size::bigint AS bytes FROM library_documents
  UNION ALL
  SELECT organization_id, file_size::bigint AS bytes FROM part_images;
