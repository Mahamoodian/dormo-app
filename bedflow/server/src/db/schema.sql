-- BedFlow schema (PostgreSQL 13+)
-- Tenant isolation is enforced at the DATABASE level: every operational table
-- carries owner_id, and every parent/child relation uses a composite foreign
-- key (child.parent_id, child.owner_id) -> parent(id, owner_id). A row can
-- therefore never reference another owner's building / flat / bed / client,
-- even if application code has a bug.

CREATE TABLE IF NOT EXISTS users (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role                  TEXT NOT NULL CHECK (role IN ('super_admin','owner')),
  full_name             TEXT NOT NULL,
  business_name         TEXT,
  email                 TEXT NOT NULL,
  phone                 TEXT,
  currency              TEXT NOT NULL DEFAULT 'AED',
  password_hash         TEXT NOT NULL,
  must_change_password  BOOLEAN NOT NULL DEFAULT TRUE,
  is_active             BOOLEAN NOT NULL DEFAULT TRUE,
  token_version         INTEGER NOT NULL DEFAULT 0,
  last_login_at         TIMESTAMPTZ,
  password_changed_at   TIMESTAMPTZ,
  created_by            UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_uq ON users (lower(email));

CREATE TABLE IF NOT EXISTS admin_audit (
  id              BIGSERIAL PRIMARY KEY,
  admin_id        UUID REFERENCES users(id) ON DELETE SET NULL,
  action          TEXT NOT NULL,
  target_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  meta            JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- Property hierarchy
CREATE TABLE IF NOT EXISTS buildings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  address     TEXT,
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, owner_id)
);
CREATE INDEX IF NOT EXISTS buildings_owner_idx ON buildings (owner_id);

CREATE TABLE IF NOT EXISTS flats (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  building_id  UUID NOT NULL,
  name         TEXT NOT NULL,
  kind         TEXT NOT NULL DEFAULT 'flat' CHECK (kind IN ('flat','dormitory')),
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, owner_id),
  FOREIGN KEY (building_id, owner_id) REFERENCES buildings (id, owner_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS flats_owner_idx ON flats (owner_id, building_id);

CREATE TABLE IF NOT EXISTS areas (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  flat_id     UUID NOT NULL,
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, owner_id),
  FOREIGN KEY (flat_id, owner_id) REFERENCES flats (id, owner_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS areas_owner_idx ON areas (owner_id, flat_id);

CREATE TABLE IF NOT EXISTS beds (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  area_id       UUID NOT NULL,
  label         TEXT NOT NULL,
  default_rent  NUMERIC(12,2),
  in_service    BOOLEAN NOT NULL DEFAULT TRUE,   -- false = under maintenance
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, owner_id),
  FOREIGN KEY (area_id, owner_id) REFERENCES areas (id, owner_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS beds_owner_idx ON beds (owner_id, area_id);

-- ---------------------------------------------------------------- Clients
CREATE TABLE IF NOT EXISTS clients (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  full_name          TEXT NOT NULL,
  phone              TEXT,
  email              TEXT,
  id_type            TEXT,
  id_number          TEXT,
  nationality        TEXT,
  emergency_contact  TEXT,
  notes              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, owner_id)
);
CREATE INDEX IF NOT EXISTS clients_owner_idx ON clients (owner_id, lower(full_name));

-- ---------------------------------------------------------------- Assignments (tenancies)
CREATE TABLE IF NOT EXISTS assignments (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id              UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id             UUID NOT NULL,
  bed_id                UUID NOT NULL,
  start_date            DATE NOT NULL,
  rent_amount           NUMERIC(12,2) NOT NULL CHECK (rent_amount >= 0),
  frequency_unit        TEXT NOT NULL CHECK (frequency_unit IN ('day','week','month')),
  frequency_count       INTEGER NOT NULL DEFAULT 1 CHECK (frequency_count BETWEEN 1 AND 365),
  deposit_amount        NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (deposit_amount >= 0),
  current_period_start  DATE NOT NULL,
  current_period_end    DATE NOT NULL,     -- the "expiry date" of the latest billed period
  status                TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','vacated')),
  vacate_date           DATE,
  vacate_summary        JSONB,
  notes                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, owner_id),
  FOREIGN KEY (client_id, owner_id) REFERENCES clients (id, owner_id) ON DELETE RESTRICT,
  FOREIGN KEY (bed_id, owner_id)    REFERENCES beds (id, owner_id)    ON DELETE RESTRICT,
  CHECK (current_period_end >= current_period_start)
);
-- a bed can only have one active tenancy; a client can only occupy one bed at a time
CREATE UNIQUE INDEX IF NOT EXISTS assignments_bed_active_uq    ON assignments (bed_id)    WHERE status = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS assignments_client_active_uq ON assignments (client_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS assignments_owner_idx ON assignments (owner_id, status, current_period_end);

-- ---------------------------------------------------------------- Receivables register
CREATE TABLE IF NOT EXISTS receivables (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assignment_id       UUID NOT NULL,
  client_id           UUID NOT NULL,
  kind                TEXT NOT NULL CHECK (kind IN ('rent','deposit','settlement')),
  period_start        DATE,
  period_end          DATE,
  due_date            DATE NOT NULL,
  amount_due          NUMERIC(12,2) NOT NULL CHECK (amount_due >= 0),
  amount_paid         NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
  amount_written_off  NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (amount_written_off >= 0),
  status              TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','paid','written_off','void')),
  description         TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, owner_id),
  FOREIGN KEY (assignment_id, owner_id) REFERENCES assignments (id, owner_id) ON DELETE CASCADE,
  FOREIGN KEY (client_id, owner_id)     REFERENCES clients (id, owner_id)     ON DELETE RESTRICT,
  CHECK (amount_paid + amount_written_off <= amount_due)
);
CREATE UNIQUE INDEX IF NOT EXISTS receivables_rent_period_uq ON receivables (assignment_id, period_start) WHERE kind = 'rent';
CREATE INDEX IF NOT EXISTS receivables_owner_open_idx ON receivables (owner_id, status, due_date);
CREATE INDEX IF NOT EXISTS receivables_assignment_idx ON receivables (assignment_id);

CREATE TABLE IF NOT EXISTS payments (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  receivable_id  UUID NOT NULL,
  assignment_id  UUID NOT NULL,
  client_id      UUID NOT NULL,
  amount         NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  method         TEXT NOT NULL DEFAULT 'cash'
                 CHECK (method IN ('cash','card','bank_transfer','cheque','online','deposit_adjustment','other')),
  paid_on        DATE NOT NULL,
  note           TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (receivable_id, owner_id) REFERENCES receivables (id, owner_id) ON DELETE CASCADE,
  FOREIGN KEY (assignment_id, owner_id) REFERENCES assignments (id, owner_id) ON DELETE CASCADE,
  FOREIGN KEY (client_id, owner_id)     REFERENCES clients (id, owner_id)     ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS payments_owner_date_idx ON payments (owner_id, paid_on);

CREATE TABLE IF NOT EXISTS write_offs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  receivable_id   UUID NOT NULL,
  amount          NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  reason          TEXT,
  written_off_on  DATE NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (receivable_id, owner_id) REFERENCES receivables (id, owner_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS write_offs_owner_idx ON write_offs (owner_id, written_off_on);

-- Security-deposit ledger (deposits are a liability until refunded or converted)
CREATE TABLE IF NOT EXISTS deposit_ledger (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assignment_id  UUID NOT NULL,
  payment_id     UUID REFERENCES payments(id) ON DELETE CASCADE,
  entry_type     TEXT NOT NULL CHECK (entry_type IN ('collected','refunded','converted_to_revenue','applied_to_dues')),
  amount         NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  reason         TEXT,
  method         TEXT,
  entry_date     DATE NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (assignment_id, owner_id) REFERENCES assignments (id, owner_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS deposit_ledger_owner_idx ON deposit_ledger (owner_id, entry_type, entry_date);

-- ---------------------------------------------------------------- Expenses
CREATE TABLE IF NOT EXISTS expense_categories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    UUID REFERENCES users(id) ON DELETE CASCADE,   -- NULL = system (pre-defined) category
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS expense_categories_uq
  ON expense_categories (COALESCE(owner_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));

CREATE TABLE IF NOT EXISTS expenses (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  flat_id         UUID NOT NULL,
  category_id     UUID NOT NULL REFERENCES expense_categories(id) ON DELETE RESTRICT,
  description     TEXT,
  amount          NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  expense_date    DATE NOT NULL,
  payment_method  TEXT,
  vendor          TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (flat_id, owner_id) REFERENCES flats (id, owner_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS expenses_owner_date_idx ON expenses (owner_id, expense_date);

-- Pre-defined expense categories
INSERT INTO expense_categories (owner_id, name)
SELECT NULL, n FROM unnest(ARRAY['Utilities','Electricity','Water','Maintenance','Cleaning','Wi-Fi / Internet',
  'Supplies','Repairs','Pest Control','Security','Rent to Landlord','Salaries','Other']) AS n
ON CONFLICT DO NOTHING;
