-- 0001_initial.sql
--
-- Minimal durable schema for the local-first desktop mail client.
--
-- IMPORTANT CONNECTION PRECONDITIONS:
--
--   1. Rust has already opened the database through SQLCipher.
--   2. The SQLCipher key has already been applied.
--   3. The key has been verified by forcing a schema read.
--   4. PRAGMA foreign_keys = ON has already been set for this connection.
--   5. The migration runner executes this migration atomically.
--
-- DO NOT put key material, authentication tokens, or SQLCipher PRAGMA key
-- statements in migration files.
--
-- This migration intentionally avoids SQLite STRICT tables while the
-- development policy accepts SQLCipher 4.x without specifying a minimum
-- underlying SQLite version.

-------------------------------------------------------------------------------
-- Accounts
-------------------------------------------------------------------------------

CREATE TABLE accounts (
    id              INTEGER PRIMARY KEY,
    session_url     TEXT NOT NULL,
    jmap_account_id TEXT NOT NULL,

    -- Prevent accidental duplication of the same remote account endpoint.
    UNIQUE (session_url, jmap_account_id),

    -- JMAP Id: 1..255 ASCII octets.
    CHECK (length(jmap_account_id) BETWEEN 1 AND 255)
);

-------------------------------------------------------------------------------
-- Mailboxes
-------------------------------------------------------------------------------

CREATE TABLE mailboxes (
    id         INTEGER PRIMARY KEY,
    account_id INTEGER NOT NULL,
    jmap_id    TEXT,
    parent_id  INTEGER,
    name       TEXT NOT NULL,
    role       TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,

    FOREIGN KEY (account_id)
        REFERENCES accounts(id)
        ON DELETE CASCADE,

    -- Deferred so a complete mailbox hierarchy can be inserted in one
    -- transaction without requiring parent-first insertion order.
    FOREIGN KEY (parent_id)
        REFERENCES mailboxes(id)
        ON DELETE SET NULL
        DEFERRABLE INITIALLY DEFERRED,

    CHECK (jmap_id IS NULL OR length(jmap_id) BETWEEN 1 AND 255),
    CHECK (length(name) > 0),
    CHECK (sort_order >= 0 AND sort_order < 2147483648)
);

-- JMAP ids are unique only within their account/type.
CREATE UNIQUE INDEX ux_mailboxes_account_jmap_id
    ON mailboxes(account_id, jmap_id)
    WHERE jmap_id IS NOT NULL;

-- JMAP permits at most one mailbox with a given role per account.
CREATE UNIQUE INDEX ux_mailboxes_account_role
    ON mailboxes(account_id, role)
    WHERE role IS NOT NULL;

-- Supports account mailbox listing and hierarchy traversal.
CREATE INDEX ix_mailboxes_account_parent_sort
    ON mailboxes(account_id, parent_id, sort_order, id);

-------------------------------------------------------------------------------
-- Emails
-------------------------------------------------------------------------------

CREATE TABLE emails (
    id                INTEGER PRIMARY KEY,
    account_id        INTEGER NOT NULL,

    -- Remote identifiers. jmap_id may be NULL before a local object has
    -- acquired its server identity.
    jmap_id            TEXT,
    blob_id            TEXT,
    thread_id          TEXT,

    -- Convenience lookup value for the first/canonical RFC Message-ID.
    -- This is NOT the JMAP Email id and is intentionally NOT UNIQUE.
    message_id         TEXT,

    -- Lightweight message-list metadata.
    subject            TEXT,
    preview            TEXT,

    -- Local normalized representation used for ordering/filtering.
    -- Unix epoch milliseconds.
    received_at_ms     INTEGER NOT NULL,

    size_bytes         INTEGER NOT NULL,
    keywords_json      TEXT NOT NULL DEFAULT '{}',
    has_attachment     INTEGER NOT NULL DEFAULT 0,

    FOREIGN KEY (account_id)
        REFERENCES accounts(id)
        ON DELETE CASCADE,

    CHECK (jmap_id IS NULL OR length(jmap_id) BETWEEN 1 AND 255),
    CHECK (blob_id IS NULL OR length(blob_id) BETWEEN 1 AND 255),
    CHECK (thread_id IS NULL OR length(thread_id) BETWEEN 1 AND 255),
    CHECK (size_bytes >= 0),
    CHECK (has_attachment IN (0, 1))
);

CREATE UNIQUE INDEX ux_emails_account_jmap_id
    ON emails(account_id, jmap_id)
    WHERE jmap_id IS NOT NULL;

-- Primary metadata ordering path.
CREATE INDEX ix_emails_account_received
    ON emails(account_id, received_at_ms DESC, id DESC);

-- RFC Message-ID is not unique; this index is for lookup only.
CREATE INDEX ix_emails_account_message_id
    ON emails(account_id, message_id)
    WHERE message_id IS NOT NULL;

-------------------------------------------------------------------------------
-- Email ↔ Mailbox membership
-------------------------------------------------------------------------------

CREATE TABLE email_mailboxes (
    email_id   INTEGER NOT NULL,
    mailbox_id INTEGER NOT NULL,

    PRIMARY KEY (email_id, mailbox_id),

    FOREIGN KEY (email_id)
        REFERENCES emails(id)
        ON DELETE CASCADE,

    FOREIGN KEY (mailbox_id)
        REFERENCES mailboxes(id)
        ON DELETE CASCADE
);

-- The PRIMARY KEY starts with email_id; the reverse index is required for
-- efficient "list all emails in this mailbox" lookups.
CREATE INDEX ix_email_mailboxes_mailbox_email
    ON email_mailboxes(mailbox_id, email_id);

-------------------------------------------------------------------------------
-- Cached Email bodies
-------------------------------------------------------------------------------

CREATE TABLE email_bodies (
    email_id  INTEGER PRIMARY KEY,
    text_body TEXT,
    html_body TEXT,

    FOREIGN KEY (email_id)
        REFERENCES emails(id)
        ON DELETE CASCADE
);

-------------------------------------------------------------------------------
-- Attachment references
-------------------------------------------------------------------------------

CREATE TABLE attachment_refs (
    id         INTEGER PRIMARY KEY,
    email_id   INTEGER NOT NULL,
    part_id    TEXT,
    blob_id    TEXT,
    name       TEXT,
    media_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,

    FOREIGN KEY (email_id)
        REFERENCES emails(id)
        ON DELETE CASCADE,

    CHECK (blob_id IS NULL OR length(blob_id) BETWEEN 1 AND 255),
    CHECK (length(media_type) > 0),
    CHECK (size_bytes >= 0)
);

CREATE UNIQUE INDEX ux_attachment_refs_email_part
    ON attachment_refs(email_id, part_id)
    WHERE part_id IS NOT NULL;

CREATE INDEX ix_attachment_refs_email
    ON attachment_refs(email_id);

-------------------------------------------------------------------------------
-- Durable local mutation / Outbox queue
-------------------------------------------------------------------------------

CREATE TABLE pending_mutations (
    id                  INTEGER PRIMARY KEY,
    account_id          INTEGER NOT NULL,

    -- Project-owned operation identifiers.
    -- Examples are intentionally not frozen by this migration.
    kind                TEXT NOT NULL,
    target_type         TEXT,
    target_local_id     INTEGER,

    -- Opaque, versioned mutation representation.
    payload             BLOB NOT NULL,
    payload_version     INTEGER NOT NULL DEFAULT 1,

    -- Queue lifecycle.
    status              TEXT NOT NULL DEFAULT 'pending',
    created_at_ms       INTEGER NOT NULL,
    next_attempt_at_ms  INTEGER NOT NULL,
    attempt_count       INTEGER NOT NULL DEFAULT 0,
    last_error          TEXT,

    FOREIGN KEY (account_id)
        REFERENCES accounts(id)
        ON DELETE CASCADE,

    CHECK (length(kind) > 0),
    CHECK (payload_version > 0),
    CHECK (attempt_count >= 0)
);

-- Main Outbox dequeue path:
--
-- SELECT ...
-- FROM pending_mutations
-- WHERE account_id = ?
--   AND status = 'pending'
--   AND next_attempt_at_ms <= ?
-- ORDER BY next_attempt_at_ms, id;
CREATE INDEX ix_pending_mutations_queue
    ON pending_mutations(account_id, next_attempt_at_ms, id)
    WHERE status = 'pending';

-------------------------------------------------------------------------------
-- JMAP synchronization cursors
-------------------------------------------------------------------------------

CREATE TABLE sync_cursors (
    account_id    INTEGER NOT NULL,
    data_type     TEXT NOT NULL,
    state         TEXT NOT NULL,
    updated_at_ms INTEGER NOT NULL,

    PRIMARY KEY (account_id, data_type),

    FOREIGN KEY (account_id)
        REFERENCES accounts(id)
        ON DELETE CASCADE,

    CHECK (length(data_type) > 0),
    CHECK (length(state) > 0)
);

-------------------------------------------------------------------------------
-- Application-owned schema version
-------------------------------------------------------------------------------

PRAGMA user_version = 1;
