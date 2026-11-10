CREATE TABLE IF NOT EXISTS admins (
    username TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_sessions (
    token_hash TEXT PRIMARY KEY,
    username TEXT NOT NULL REFERENCES admins(username) ON DELETE CASCADE,
    expires_at BIGINT NOT NULL,
    created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS assets (
    kind TEXT PRIMARY KEY,
    object_key TEXT NOT NULL,
    original_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    updated_at BIGINT NOT NULL
);


CREATE TABLE IF NOT EXISTS app_settings (
    setting_key TEXT PRIMARY KEY,
    setting_value TEXT NOT NULL
);

INSERT INTO app_settings(setting_key, setting_value)
VALUES ('game_over_opacity', '65')
ON CONFLICT(setting_key) DO NOTHING;
