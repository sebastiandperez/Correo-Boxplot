-- 0003_fts5.sql
--
-- Adds FTS5 full-text search index for emails.

CREATE VIRTUAL TABLE emails_fts USING fts5(
    account_key UNINDEXED,
    email_jmap_id UNINDEXED,
    subject,
    preview,
    text_body,
    html_body,
    tokenize="unicode61 remove_diacritics 1"
);

-- Triggers for 'emails' table
CREATE TRIGGER emails_ai AFTER INSERT ON emails BEGIN
    INSERT INTO emails_fts(rowid, account_key, email_jmap_id, subject, preview, text_body, html_body)
    VALUES (new.rowid, new.account_key, new.jmap_id, new.subject, new.preview, NULL, NULL);
END;

CREATE TRIGGER emails_au AFTER UPDATE ON emails BEGIN
    UPDATE emails_fts
    SET subject = new.subject,
        preview = new.preview
    WHERE account_key = new.account_key AND email_jmap_id = new.jmap_id;
END;

CREATE TRIGGER emails_ad AFTER DELETE ON emails BEGIN
    DELETE FROM emails_fts WHERE account_key = old.account_key AND email_jmap_id = old.jmap_id;
END;

-- Triggers for 'email_bodies' table
CREATE TRIGGER email_bodies_ai AFTER INSERT ON email_bodies BEGIN
    UPDATE emails_fts
    SET text_body = new.text_body,
        html_body = new.html_body
    WHERE account_key = new.account_key AND email_jmap_id = new.email_jmap_id;
END;

CREATE TRIGGER email_bodies_au AFTER UPDATE ON email_bodies BEGIN
    UPDATE emails_fts
    SET text_body = new.text_body,
        html_body = new.html_body
    WHERE account_key = new.account_key AND email_jmap_id = new.email_jmap_id;
END;

CREATE TRIGGER email_bodies_ad AFTER DELETE ON email_bodies BEGIN
    UPDATE emails_fts
    SET text_body = NULL,
        html_body = NULL
    WHERE account_key = old.account_key AND email_jmap_id = old.email_jmap_id;
END;

-- Backfill existing data
INSERT INTO emails_fts(rowid, account_key, email_jmap_id, subject, preview, text_body, html_body)
SELECT e.rowid, e.account_key, e.jmap_id, e.subject, e.preview, b.text_body, b.html_body
FROM emails e
LEFT JOIN email_bodies b ON e.account_key = b.account_key AND e.jmap_id = b.email_jmap_id;

PRAGMA user_version = 3;
