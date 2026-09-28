-- CMG Electrical Inventory: initial schema
-- Quantities are NUMERIC (never floating point). Posted ledger and audit rows are immutable.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------------------------
-- Identity and access
-- ---------------------------------------------------------------------------

CREATE TABLE permissions (
  code        text PRIMARY KEY,
  description text NOT NULL
);

CREATE TABLE roles (
  id          bigserial PRIMARY KEY,
  code        text NOT NULL UNIQUE,
  name        text NOT NULL,
  description text NOT NULL DEFAULT '',
  is_system   boolean NOT NULL DEFAULT false
);

CREATE TABLE role_permissions (
  role_id         bigint NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_code text   NOT NULL REFERENCES permissions(code) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_code)
);

CREATE TABLE users (
  id                   bigserial PRIMARY KEY,
  username             text NOT NULL,
  full_name            text NOT NULL,
  email                text,
  phone                text,
  password_hash        text NOT NULL,
  is_active            boolean NOT NULL DEFAULT true,
  org_wide             boolean NOT NULL DEFAULT false,
  must_change_password boolean NOT NULL DEFAULT true,
  failed_login_count   integer NOT NULL DEFAULT 0,
  locked_until         timestamptz,
  password_changed_at  timestamptz NOT NULL DEFAULT now(),
  last_login_at        timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_username_uq ON users (lower(username));

CREATE TABLE user_roles (
  user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id bigint NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE sessions (
  id           text PRIMARY KEY,               -- sha256 of the opaque cookie token
  user_id      bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token   text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz,
  ip           text,
  user_agent   text
);
CREATE INDEX sessions_user_idx ON sessions (user_id) WHERE revoked_at IS NULL;

CREATE TABLE login_history (
  id                 bigserial PRIMARY KEY,
  occurred_at        timestamptz NOT NULL DEFAULT now(),
  username_attempted text NOT NULL,
  user_id            bigint REFERENCES users(id),
  success            boolean NOT NULL,
  reason             text,
  ip                 text,
  user_agent         text
);
CREATE INDEX login_history_user_idx ON login_history (user_id, occurred_at DESC);
CREATE INDEX login_history_time_idx ON login_history (occurred_at DESC);

-- ---------------------------------------------------------------------------
-- Organization
-- ---------------------------------------------------------------------------

CREATE TABLE substations (
  id            bigserial PRIMARY KEY,
  code          text NOT NULL,
  name          text NOT NULL,
  address       text NOT NULL DEFAULT '',
  contact_name  text NOT NULL DEFAULT '',
  contact_phone text NOT NULL DEFAULT '',
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX substations_code_uq ON substations (upper(code));

CREATE TABLE user_substation_assignments (
  user_id       bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  substation_id bigint NOT NULL REFERENCES substations(id) ON DELETE RESTRICT,
  PRIMARY KEY (user_id, substation_id)
);
CREATE INDEX usa_substation_idx ON user_substation_assignments (substation_id);

-- ---------------------------------------------------------------------------
-- Item Master
-- ---------------------------------------------------------------------------

CREATE TABLE units (
  id             bigserial PRIMARY KEY,
  code           text NOT NULL,
  name           text NOT NULL,
  decimal_places smallint NOT NULL DEFAULT 0 CHECK (decimal_places BETWEEN 0 AND 4),
  is_active      boolean NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX units_code_uq ON units (upper(code));

CREATE TABLE item_categories (
  id        bigserial PRIMARY KEY,
  code      text NOT NULL,
  name      text NOT NULL,
  parent_id bigint REFERENCES item_categories(id) ON DELETE RESTRICT,  -- non-null = subcategory
  is_active boolean NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX item_categories_code_uq ON item_categories (upper(code));

CREATE TABLE items (
  id              bigserial PRIMARY KEY,
  code            text NOT NULL,
  name            text NOT NULL,
  normalized_name text NOT NULL,
  description     text NOT NULL DEFAULT '',
  category_id     bigint NOT NULL REFERENCES item_categories(id),
  unit_id         bigint NOT NULL REFERENCES units(id),
  specification   text NOT NULL DEFAULT '',
  rating          text NOT NULL DEFAULT '',
  manufacturer    text NOT NULL DEFAULT '',
  model           text NOT NULL DEFAULT '',
  is_critical     boolean NOT NULL DEFAULT false,
  is_active       boolean NOT NULL DEFAULT true,
  created_by      bigint REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX items_code_uq ON items (upper(code));
CREATE INDEX items_code_prefix_idx ON items (upper(code) text_pattern_ops);
CREATE INDEX items_name_trgm_idx ON items USING gin (normalized_name gin_trgm_ops);
CREATE INDEX items_search_trgm_idx ON items USING gin (
  (lower(code || ' ' || name || ' ' || specification || ' ' || rating || ' ' || manufacturer || ' ' || model)) gin_trgm_ops
);
CREATE INDEX items_category_idx ON items (category_id) WHERE is_active;
CREATE INDEX items_critical_idx ON items (is_critical) WHERE is_active AND is_critical;

CREATE TABLE item_aliases (
  id      bigserial PRIMARY KEY,
  item_id bigint NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  alias   text NOT NULL
);
CREATE UNIQUE INDEX item_aliases_uq ON item_aliases (item_id, lower(alias));
CREATE INDEX item_aliases_trgm_idx ON item_aliases USING gin (lower(alias) gin_trgm_ops);

CREATE TABLE item_substation_settings (
  substation_id bigint NOT NULL REFERENCES substations(id),
  item_id       bigint NOT NULL REFERENCES items(id),
  min_level     numeric(18,4) NOT NULL DEFAULT 0 CHECK (min_level >= 0),
  reorder_level numeric(18,4) NOT NULL DEFAULT 0 CHECK (reorder_level >= 0),
  updated_by    bigint REFERENCES users(id),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (substation_id, item_id)
);

-- ---------------------------------------------------------------------------
-- Inventory
-- ---------------------------------------------------------------------------

CREATE TABLE inventory_balances (
  substation_id bigint NOT NULL REFERENCES substations(id),
  item_id       bigint NOT NULL REFERENCES items(id),
  quantity      numeric(18,4) NOT NULL DEFAULT 0,
  version       integer NOT NULL DEFAULT 0,
  last_txn_at   timestamptz,
  PRIMARY KEY (substation_id, item_id),
  CONSTRAINT inventory_balances_non_negative CHECK (quantity >= 0)
);
CREATE INDEX inventory_balances_item_idx ON inventory_balances (item_id, substation_id);

CREATE TABLE transaction_reasons (
  code               text PRIMARY KEY,
  doc_type           text NOT NULL,
  name               text NOT NULL,
  requires_reference boolean NOT NULL DEFAULT false,
  is_active          boolean NOT NULL DEFAULT true
);

CREATE TABLE number_sequences (
  key        text PRIMARY KEY,
  next_value bigint NOT NULL
);

CREATE TABLE stock_documents (
  id                   bigserial PRIMARY KEY,
  doc_number           text NOT NULL UNIQUE,
  doc_type             text NOT NULL CHECK (doc_type IN
                         ('OPENING','RECEIPT','ISSUE','RETURN','ADJUSTMENT','SCRAP','REVERSAL')),
  status               text NOT NULL CHECK (status IN ('DRAFT','PENDING_APPROVAL','POSTED','REVERSED')),
  substation_id        bigint NOT NULL REFERENCES substations(id),
  doc_date             date NOT NULL,
  reason_code          text REFERENCES transaction_reasons(code),
  reference_no         text NOT NULL DEFAULT '',
  counterparty         text NOT NULL DEFAULT '',   -- supplier / issued-to / returned-by
  remarks              text NOT NULL DEFAULT '',
  idempotency_key      uuid NOT NULL UNIQUE,
  reverses_document_id bigint REFERENCES stock_documents(id),
  reversed_by_document_id bigint REFERENCES stock_documents(id),
  created_by           bigint NOT NULL REFERENCES users(id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  posted_by            bigint REFERENCES users(id),
  posted_at            timestamptz
);
CREATE INDEX stock_documents_sub_idx ON stock_documents (substation_id, created_at DESC);
CREATE INDEX stock_documents_type_idx ON stock_documents (doc_type, created_at DESC);
CREATE INDEX stock_documents_ref_idx ON stock_documents (reference_no) WHERE reference_no <> '';
CREATE UNIQUE INDEX stock_documents_one_reversal_uq ON stock_documents (reverses_document_id)
  WHERE reverses_document_id IS NOT NULL;

CREATE TABLE stock_document_lines (
  id          bigserial PRIMARY KEY,
  document_id bigint NOT NULL REFERENCES stock_documents(id),
  line_no     integer NOT NULL,
  item_id     bigint NOT NULL REFERENCES items(id),
  quantity    numeric(18,4) NOT NULL CHECK (quantity <> 0),  -- signed only for ADJUSTMENT / REVERSAL
  remarks     text NOT NULL DEFAULT '',
  UNIQUE (document_id, line_no),
  UNIQUE (document_id, item_id)
);

CREATE TABLE inventory_transactions (
  id             bigserial PRIMARY KEY,
  document_id    bigint NOT NULL REFERENCES stock_documents(id),
  line_id        bigint NOT NULL UNIQUE REFERENCES stock_document_lines(id),
  substation_id  bigint NOT NULL REFERENCES substations(id),
  item_id        bigint NOT NULL REFERENCES items(id),
  txn_type       text NOT NULL,
  quantity       numeric(18,4) NOT NULL CHECK (quantity <> 0),  -- signed movement: the accounting fact
  balance_before numeric(18,4) NOT NULL,
  balance_after  numeric(18,4) NOT NULL,
  txn_time       timestamptz NOT NULL DEFAULT now(),
  doc_date       date NOT NULL,
  created_by     bigint NOT NULL REFERENCES users(id),
  CHECK (balance_after = balance_before + quantity)
);
CREATE INDEX inv_txn_sub_time_idx  ON inventory_transactions (substation_id, txn_time DESC);
CREATE INDEX inv_txn_item_time_idx ON inventory_transactions (item_id, txn_time DESC);
CREATE INDEX inv_txn_doc_idx       ON inventory_transactions (document_id);
CREATE INDEX inv_txn_type_time_idx ON inventory_transactions (txn_type, txn_time DESC);

-- ---------------------------------------------------------------------------
-- Governance
-- ---------------------------------------------------------------------------

CREATE TABLE audit_logs (
  id            bigserial PRIMARY KEY,
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  user_id       bigint REFERENCES users(id),
  action        text NOT NULL,
  entity_type   text NOT NULL,
  entity_id     text,
  substation_id bigint REFERENCES substations(id),
  details       jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip            text
);
CREATE INDEX audit_logs_time_idx   ON audit_logs (occurred_at DESC);
CREATE INDEX audit_logs_user_idx   ON audit_logs (user_id, occurred_at DESC);
CREATE INDEX audit_logs_entity_idx ON audit_logs (entity_type, entity_id);
CREATE INDEX audit_logs_sub_idx    ON audit_logs (substation_id, occurred_at DESC);

CREATE TABLE application_settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_by bigint REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Immutability guards
-- ---------------------------------------------------------------------------

CREATE FUNCTION forbid_modification() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% rows are immutable (% blocked)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END $$;

CREATE TRIGGER inventory_transactions_immutable
  BEFORE UPDATE OR DELETE ON inventory_transactions
  FOR EACH ROW EXECUTE FUNCTION forbid_modification();

CREATE TRIGGER audit_logs_immutable
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION forbid_modification();

CREATE TRIGGER stock_document_lines_immutable
  BEFORE UPDATE OR DELETE ON stock_document_lines
  FOR EACH ROW EXECUTE FUNCTION forbid_modification();

-- Posted documents: only the POSTED -> REVERSED transition (plus the reversal link) is allowed.
CREATE FUNCTION guard_stock_document_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('POSTED','REVERSED') THEN
      RAISE EXCEPTION 'posted stock documents cannot be deleted' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status IN ('POSTED','REVERSED') THEN
    IF NOT (OLD.status = 'POSTED' AND NEW.status = 'REVERSED'
            AND OLD.reversed_by_document_id IS NULL AND NEW.reversed_by_document_id IS NOT NULL
            AND (to_jsonb(NEW) - 'status' - 'reversed_by_document_id')
              = (to_jsonb(OLD) - 'status' - 'reversed_by_document_id')) THEN
      RAISE EXCEPTION 'posted stock documents are immutable' USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER stock_documents_guard
  BEFORE UPDATE OR DELETE ON stock_documents
  FOR EACH ROW EXECUTE FUNCTION guard_stock_document_update();
