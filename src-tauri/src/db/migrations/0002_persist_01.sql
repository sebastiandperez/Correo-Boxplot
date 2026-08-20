-- PERSIST-01 canonical durable schema.
-- The migration runner refuses to execute this rebuild while legacy outbox
-- rows exist; cache-only 0001 data is otherwise deliberately reconstructible.

DROP TABLE IF EXISTS sync_cursors;
DROP TABLE IF EXISTS pending_mutations;
DROP TABLE IF EXISTS attachment_refs;
DROP TABLE IF EXISTS email_bodies;
DROP TABLE IF EXISTS email_mailboxes;
DROP TABLE IF EXISTS emails;
DROP TABLE IF EXISTS mailboxes;
DROP TABLE IF EXISTS accounts;

CREATE TABLE accounts (
    account_key TEXT PRIMARY KEY NOT NULL CHECK (length(account_key) > 0),
    service_key TEXT NOT NULL CHECK (length(service_key) > 0),
    jmap_account_id TEXT NOT NULL CHECK (length(jmap_account_id) > 0)
);

CREATE TABLE mailboxes (
    account_key TEXT NOT NULL,
    jmap_id TEXT NOT NULL CHECK (length(jmap_id) > 0),
    name TEXT NOT NULL CHECK (length(name) > 0),
    parent_jmap_id TEXT,
    role TEXT CHECK (role IS NULL OR length(role) > 0),
    sort_order INTEGER NOT NULL CHECK (sort_order >= 0 AND sort_order < 2147483648),
    total_emails INTEGER NOT NULL CHECK (total_emails >= 0),
    unread_emails INTEGER NOT NULL CHECK (unread_emails >= 0 AND unread_emails <= total_emails),
    may_read_items INTEGER NOT NULL CHECK (may_read_items IN (0, 1)),
    may_add_items INTEGER NOT NULL CHECK (may_add_items IN (0, 1)),
    may_remove_items INTEGER NOT NULL CHECK (may_remove_items IN (0, 1)),
    may_set_seen INTEGER NOT NULL CHECK (may_set_seen IN (0, 1)),
    may_set_keywords INTEGER NOT NULL CHECK (may_set_keywords IN (0, 1)),
    may_submit INTEGER NOT NULL CHECK (may_submit IN (0, 1)),
    PRIMARY KEY (account_key, jmap_id),
    FOREIGN KEY (account_key) REFERENCES accounts(account_key) ON DELETE CASCADE,
    CHECK (parent_jmap_id IS NULL OR parent_jmap_id <> jmap_id)
);
CREATE INDEX ix_mailboxes_account ON mailboxes(account_key);

CREATE TABLE identities (
    account_key TEXT NOT NULL,
    jmap_id TEXT NOT NULL CHECK (length(jmap_id) > 0),
    name TEXT NOT NULL,
    email TEXT NOT NULL CHECK (length(email) > 0),
    reply_to_json TEXT NOT NULL,
    bcc_json TEXT NOT NULL,
    PRIMARY KEY (account_key, jmap_id),
    FOREIGN KEY (account_key) REFERENCES accounts(account_key) ON DELETE CASCADE
);
CREATE INDEX ix_identities_account ON identities(account_key);

CREATE TABLE emails (
    account_key TEXT NOT NULL,
    jmap_id TEXT NOT NULL CHECK (length(jmap_id) > 0),
    blob_id TEXT NOT NULL CHECK (length(blob_id) > 0),
    thread_id TEXT NOT NULL CHECK (length(thread_id) > 0),
    sender_json TEXT NOT NULL,
    from_json TEXT NOT NULL,
    reply_to_json TEXT NOT NULL,
    to_json TEXT NOT NULL,
    cc_json TEXT NOT NULL,
    bcc_json TEXT NOT NULL,
    subject TEXT,
    sent_at TEXT CHECK (sent_at IS NULL OR length(sent_at) > 0),
    received_at TEXT NOT NULL CHECK (length(received_at) > 0),
    size INTEGER NOT NULL CHECK (size >= 0),
    preview TEXT NOT NULL,
    has_attachment INTEGER NOT NULL CHECK (has_attachment IN (0, 1)),
    keywords_json TEXT NOT NULL,
    PRIMARY KEY (account_key, jmap_id),
    FOREIGN KEY (account_key) REFERENCES accounts(account_key) ON DELETE CASCADE
);
CREATE INDEX ix_emails_account ON emails(account_key);

CREATE TABLE email_mailboxes (
    account_key TEXT NOT NULL,
    email_jmap_id TEXT NOT NULL,
    mailbox_jmap_id TEXT NOT NULL CHECK (length(mailbox_jmap_id) > 0),
    PRIMARY KEY (account_key, email_jmap_id, mailbox_jmap_id),
    FOREIGN KEY (account_key, email_jmap_id) REFERENCES emails(account_key, jmap_id) ON DELETE CASCADE
);
CREATE INDEX ix_email_mailboxes_mailbox ON email_mailboxes(account_key, mailbox_jmap_id);

CREATE TABLE email_bodies (
    account_key TEXT NOT NULL,
    email_jmap_id TEXT NOT NULL,
    text_body TEXT,
    html_body TEXT,
    PRIMARY KEY (account_key, email_jmap_id),
    FOREIGN KEY (account_key, email_jmap_id) REFERENCES emails(account_key, jmap_id) ON DELETE CASCADE
);

CREATE TABLE attachment_caches (
    account_key TEXT NOT NULL,
    email_jmap_id TEXT NOT NULL,
    PRIMARY KEY (account_key, email_jmap_id),
    FOREIGN KEY (account_key, email_jmap_id) REFERENCES emails(account_key, jmap_id) ON DELETE CASCADE
);

CREATE TABLE attachment_refs (
    account_key TEXT NOT NULL,
    email_jmap_id TEXT NOT NULL,
    part_id TEXT NOT NULL,
    blob_id TEXT NOT NULL CHECK (length(blob_id) > 0),
    name TEXT,
    media_type TEXT NOT NULL CHECK (length(media_type) > 0 AND lower(media_type) NOT LIKE 'multipart/%'),
    size INTEGER NOT NULL CHECK (size >= 0),
    disposition TEXT,
    cid TEXT,
    PRIMARY KEY (account_key, email_jmap_id, part_id),
    FOREIGN KEY (account_key, email_jmap_id) REFERENCES attachment_caches(account_key, email_jmap_id) ON DELETE CASCADE
);

CREATE TABLE mailbox_views (
    account_key TEXT NOT NULL,
    mailbox_jmap_id TEXT NOT NULL,
    filter_kind TEXT NOT NULL CHECK (filter_kind = 'all'),
    sort_property TEXT NOT NULL CHECK (sort_property = 'receivedAt'),
    sort_direction TEXT NOT NULL CHECK (sort_direction IN ('ascending', 'descending')),
    query_state TEXT NOT NULL CHECK (length(query_state) > 0),
    total INTEGER NOT NULL CHECK (total >= 0),
    PRIMARY KEY (account_key, mailbox_jmap_id, filter_kind, sort_property, sort_direction),
    FOREIGN KEY (account_key, mailbox_jmap_id) REFERENCES mailboxes(account_key, jmap_id) ON DELETE CASCADE
);

CREATE TABLE mailbox_view_coverage (
    account_key TEXT NOT NULL,
    mailbox_jmap_id TEXT NOT NULL,
    filter_kind TEXT NOT NULL,
    sort_property TEXT NOT NULL,
    sort_direction TEXT NOT NULL,
    ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
    start INTEGER NOT NULL CHECK (start >= 0),
    end_exclusive INTEGER NOT NULL CHECK (end_exclusive > start),
    PRIMARY KEY (account_key, mailbox_jmap_id, filter_kind, sort_property, sort_direction, ordinal),
    FOREIGN KEY (account_key, mailbox_jmap_id, filter_kind, sort_property, sort_direction)
      REFERENCES mailbox_views(account_key, mailbox_jmap_id, filter_kind, sort_property, sort_direction) ON DELETE CASCADE
);

CREATE TABLE mailbox_view_items (
    account_key TEXT NOT NULL,
    mailbox_jmap_id TEXT NOT NULL,
    filter_kind TEXT NOT NULL,
    sort_property TEXT NOT NULL,
    sort_direction TEXT NOT NULL,
    position INTEGER NOT NULL CHECK (position >= 0),
    email_jmap_id TEXT NOT NULL CHECK (length(email_jmap_id) > 0),
    PRIMARY KEY (account_key, mailbox_jmap_id, filter_kind, sort_property, sort_direction, position),
    UNIQUE (account_key, mailbox_jmap_id, filter_kind, sort_property, sort_direction, email_jmap_id),
    FOREIGN KEY (account_key, mailbox_jmap_id, filter_kind, sort_property, sort_direction)
      REFERENCES mailbox_views(account_key, mailbox_jmap_id, filter_kind, sort_property, sort_direction) ON DELETE CASCADE
);

CREATE TABLE sync_cursors (
    account_key TEXT NOT NULL,
    data_type TEXT NOT NULL CHECK (data_type IN ('email', 'mailbox', 'identity')),
    state TEXT NOT NULL,
    PRIMARY KEY (account_key, data_type),
    FOREIGN KEY (account_key) REFERENCES accounts(account_key) ON DELETE CASCADE
);

CREATE TABLE pending_mutations (
    account_key TEXT NOT NULL,
    mutation_id TEXT NOT NULL CHECK (length(mutation_id) > 0),
    kind TEXT NOT NULL CHECK (kind IN ('send', 'keyword', 'mailboxMembership')),
    created_at TEXT NOT NULL CHECK (length(created_at) > 0),
    target_email_jmap_id TEXT,
    send_intent_json TEXT,
    keyword_change_json TEXT,
    membership_change_json TEXT,
    lifecycle_json TEXT NOT NULL,
    PRIMARY KEY (account_key, mutation_id),
    FOREIGN KEY (account_key) REFERENCES accounts(account_key) ON DELETE CASCADE,
    CHECK (
      (kind = 'send' AND target_email_jmap_id IS NULL AND send_intent_json IS NOT NULL AND keyword_change_json IS NULL AND membership_change_json IS NULL) OR
      (kind = 'keyword' AND target_email_jmap_id IS NOT NULL AND send_intent_json IS NULL AND keyword_change_json IS NOT NULL AND membership_change_json IS NULL) OR
      (kind = 'mailboxMembership' AND target_email_jmap_id IS NOT NULL AND send_intent_json IS NULL AND keyword_change_json IS NULL AND membership_change_json IS NOT NULL)
    )
);
CREATE INDEX ix_pending_mutations_account ON pending_mutations(account_key);

PRAGMA user_version = 2;
