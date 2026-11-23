-- Tab Forge 埋点表（Cloudflare D1）
-- 部署前执行一次；已存在时不会重建。
-- 旧的 visits 表不再写入，确认无用后可手动 DROP。

CREATE TABLE IF NOT EXISTS analytics_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  schema_version INTEGER NOT NULL DEFAULT 1,
  type TEXT NOT NULL,              -- page_view / app_open / improv_generate / playback_start / playback_stop
  ts INTEGER NOT NULL,
  received_at INTEGER NOT NULL,

  -- 身份与会话
  install_id TEXT,
  session_id TEXT,
  platform TEXT,
  app_version TEXT,
  locale TEXT,

  -- 扩展属性（JSON 文本；SQLite 没有原生 JSON 类型）
  params TEXT NOT NULL DEFAULT '{}',

  -- 服务端补充
  ip_hash TEXT,
  visitor_hash TEXT,
  country TEXT,
  region TEXT,
  city TEXT,
  asn INTEGER,
  colo TEXT,
  ua TEXT,
  device TEXT,
  browser TEXT,
  os TEXT,
  accept_language TEXT,
  is_bot INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_analytics_type_ts
  ON analytics_events(type, ts);

CREATE INDEX IF NOT EXISTS idx_analytics_install_ts
  ON analytics_events(install_id, ts);
