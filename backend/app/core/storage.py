from __future__ import annotations

import json
import sqlite3
import threading
from contextlib import suppress
from pathlib import Path
from typing import Any, Callable, Iterable, TypeVar

from app.models.domain import (
    BranchAccessRecord,
    BranchWebhookRegistration,
    BranchCacheSummary,
    CacheApiKeyRecord,
    CachedElementQueryResponse,
    CachedElementRecord,
    CachedModelRecord,
    JobRecord,
    ModelPermissionSnapshot,
    PresetServerDefinition,
    ServerProfile,
    UserServerState,
    WorkbenchAuthSettings,
    WorkbenchGroupRecord,
    WorkbenchUserRecord,
    utcnow,
)


TransactionResultT = TypeVar("TransactionResultT")


class SqliteRepository:
    def __init__(self, database_path: Path) -> None:
        self.database_path = database_path
        self._lock = threading.RLock()
        self._ensure_schema()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database_path, check_same_thread=False)
        connection.row_factory = sqlite3.Row
        self._apply_pragmas(connection)
        return connection

    def _apply_pragmas(self, connection: sqlite3.Connection) -> None:
        with suppress(sqlite3.DatabaseError):
            connection.execute("PRAGMA journal_mode=WAL")
        with suppress(sqlite3.DatabaseError):
            connection.execute("PRAGMA synchronous=NORMAL")
        with suppress(sqlite3.DatabaseError):
            connection.execute("PRAGMA temp_store=MEMORY")
        with suppress(sqlite3.DatabaseError):
            connection.execute("PRAGMA foreign_keys=ON")
        with suppress(sqlite3.DatabaseError):
            connection.execute("PRAGMA cache_size=-20000")
        with suppress(sqlite3.DatabaseError):
            connection.execute("PRAGMA mmap_size=268435456")

    def run_in_transaction(self, callback: Callable[[sqlite3.Connection], TransactionResultT]) -> TransactionResultT:
        with self._lock, self._connect() as connection:
            try:
                connection.execute("BEGIN")
                result = callback(connection)
            except Exception:
                connection.rollback()
                raise
            connection.commit()
            return result

    def _cached_element_db_tuple(self, item: CachedElementRecord) -> tuple[object, ...]:
        payload = item.payload if isinstance(item.payload, dict) else {}
        return (
            item.server_id,
            item.project_id,
            item.branch_id,
            item.model_id,
            item.element_id,
            item.name,
            item.item_type,
            item.path,
            str(payload.get("owner_id") or "").strip() or None,
            str(payload.get("qualified_name") or item.path or item.name or "").strip() or None,
            str(payload.get("metaclass") or item.item_type or "element").strip() or None,
            item.synced_at.isoformat(),
            item.model_dump_json(),
        )

    def _cached_element_tree_summary_from_row(self, row: sqlite3.Row) -> dict[str, Any]:
        payload_text = str(row["payload"] or "")
        try:
            payload = json.loads(payload_text) if payload_text else {}
        except json.JSONDecodeError:
            payload = {}
        owned_element_ids = [str(value).strip() for value in payload.get("owned_element_ids") or [] if str(value).strip()]
        applied_stereotype_ids = [str(value).strip() for value in payload.get("applied_stereotype_ids") or [] if str(value).strip()]
        child_count_value = payload.get("child_count")
        try:
            child_count = int(child_count_value) if child_count_value is not None else len(owned_element_ids)
        except (TypeError, ValueError):
            child_count = len(owned_element_ids)
        return {
            "server_id": str(row["server_id"]),
            "project_id": str(row["project_id"]),
            "branch_id": str(row["branch_id"]),
            "model_id": str(row["model_id"]),
            "element_id": str(row["element_id"]),
            "name": str(row["name"] or ""),
            "item_type": str(row["item_type"] or "element"),
            "path": str(row["path"] or ""),
            "owner_id": str(row["owner_id"] or "").strip(),
            "qualified_name": str(row["qualified_name"] or payload.get("qualified_name") or "").strip(),
            "metaclass": str(row["metaclass"] or payload.get("metaclass") or row["item_type"] or "element").strip(),
            "child_count": child_count,
            "owned_element_ids": owned_element_ids,
            "applied_stereotype_ids": applied_stereotype_ids,
            "diagram_type": str(payload.get("diagram_type") or "").strip(),
            "documentation": str(payload.get("documentation") or "").strip(),
        }

    def _ensure_schema(self) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS servers (
                    id TEXT PRIMARY KEY,
                    payload TEXT NOT NULL
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS jobs (
                    id TEXT PRIMARY KEY,
                    job_type TEXT NOT NULL,
                    status TEXT NOT NULL,
                    owner TEXT NOT NULL,
                    server_id TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    payload TEXT NOT NULL
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS user_server_state (
                    user_id TEXT PRIMARY KEY,
                    payload TEXT NOT NULL
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS user_data_cache (
                    user_id TEXT NOT NULL,
                    server_id TEXT NOT NULL,
                    cache_key TEXT NOT NULL,
                    payload TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY (user_id, server_id, cache_key)
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS app_secrets (
                    scope TEXT PRIMARY KEY,
                    payload TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS app_config (
                    key TEXT PRIMARY KEY,
                    payload TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS workbench_users (
                    username TEXT PRIMARY KEY,
                    password_hash TEXT NOT NULL,
                    role TEXT NOT NULL,
                    enabled INTEGER NOT NULL,
                    display_name TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    last_login_at TEXT,
                    payload TEXT NOT NULL
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS workbench_groups (
                    name TEXT PRIMARY KEY,
                    enabled INTEGER NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    payload TEXT NOT NULL
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS cache_api_keys (
                    key_id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    label TEXT NOT NULL,
                    token_hash TEXT NOT NULL UNIQUE,
                    token_hint TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    last_used_at TEXT,
                    payload TEXT NOT NULL
                )
                """
            )
            connection.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_cache_api_keys_user
                ON cache_api_keys (user_id, created_at)
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS twc_branch_cache (
                    server_id TEXT NOT NULL,
                    project_id TEXT NOT NULL,
                    branch_id TEXT NOT NULL,
                    status TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    payload TEXT NOT NULL,
                    PRIMARY KEY (server_id, project_id, branch_id)
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS twc_cached_models (
                    server_id TEXT NOT NULL,
                    project_id TEXT NOT NULL,
                    branch_id TEXT NOT NULL,
                    model_id TEXT NOT NULL,
                    name TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    payload TEXT NOT NULL,
                    PRIMARY KEY (server_id, project_id, branch_id, model_id)
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS twc_cached_model_permissions (
                    user_id TEXT NOT NULL,
                    server_id TEXT NOT NULL,
                    project_id TEXT NOT NULL,
                    branch_id TEXT NOT NULL,
                    model_id TEXT NOT NULL,
                    accessible INTEGER NOT NULL,
                    restricted INTEGER NOT NULL,
                    editable INTEGER NOT NULL,
                    updated_at TEXT NOT NULL,
                    payload TEXT NOT NULL,
                    PRIMARY KEY (user_id, server_id, project_id, branch_id, model_id)
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS twc_branch_access_records (
                    user_id TEXT NOT NULL,
                    server_id TEXT NOT NULL,
                    project_id TEXT NOT NULL,
                    branch_id TEXT NOT NULL,
                    accessible INTEGER NOT NULL,
                    editable INTEGER NOT NULL,
                    admin_access INTEGER NOT NULL,
                    updated_at TEXT NOT NULL,
                    source TEXT NOT NULL,
                    payload TEXT NOT NULL,
                    PRIMARY KEY (user_id, server_id, project_id, branch_id)
                )
                """
            )
            connection.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_twc_branch_access_records_branch
                ON twc_branch_access_records (server_id, project_id, branch_id, user_id)
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS twc_cached_elements (
                    server_id TEXT NOT NULL,
                    project_id TEXT NOT NULL,
                    branch_id TEXT NOT NULL,
                    model_id TEXT NOT NULL,
                    element_id TEXT NOT NULL,
                    name TEXT NOT NULL,
                    item_type TEXT NOT NULL,
                    path TEXT NOT NULL,
                    owner_id TEXT,
                    qualified_name TEXT,
                    metaclass TEXT,
                    updated_at TEXT NOT NULL,
                    payload TEXT NOT NULL,
                    PRIMARY KEY (server_id, project_id, branch_id, model_id, element_id)
                )
                """
            )
            connection.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_twc_cached_elements_branch
                ON twc_cached_elements (server_id, project_id, branch_id, model_id, name)
                """
            )
            connection.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_twc_cached_elements_search
                ON twc_cached_elements (server_id, project_id, branch_id, name, path)
                """
            )
            connection.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_twc_cached_elements_parent
                ON twc_cached_elements (server_id, project_id, branch_id, model_id, owner_id, name)
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS twc_webhook_registrations (
                    registration_id TEXT PRIMARY KEY,
                    server_id TEXT NOT NULL,
                    project_id TEXT NOT NULL,
                    branch_id TEXT NOT NULL,
                    webhook_id TEXT,
                    status TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    payload TEXT NOT NULL,
                    UNIQUE (server_id, project_id, branch_id)
                )
                """
            )
            connection.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_twc_webhook_registrations_server
                ON twc_webhook_registrations (server_id, project_id, branch_id)
                """
            )
            self._ensure_cached_element_columns(connection)
            connection.commit()

    def _ensure_cached_element_columns(self, connection: sqlite3.Connection) -> None:
        column_rows = connection.execute("PRAGMA table_info(twc_cached_elements)").fetchall()
        column_names = {str(row["name"]) for row in column_rows}
        if "owner_id" not in column_names:
            connection.execute("ALTER TABLE twc_cached_elements ADD COLUMN owner_id TEXT")
        if "qualified_name" not in column_names:
            connection.execute("ALTER TABLE twc_cached_elements ADD COLUMN qualified_name TEXT")
        if "metaclass" not in column_names:
            connection.execute("ALTER TABLE twc_cached_elements ADD COLUMN metaclass TEXT")

        rows = connection.execute(
            """
            SELECT rowid, payload, name, path, item_type
            FROM twc_cached_elements
            WHERE owner_id IS NULL OR qualified_name IS NULL OR metaclass IS NULL
            """
        ).fetchall()
        if not rows:
            return

        updates: list[tuple[str | None, str | None, str | None, int]] = []
        for row in rows:
            try:
                payload = json.loads(str(row["payload"]))
            except json.JSONDecodeError:
                payload = {}
            owner_id = str(payload.get("owner_id") or "").strip() or None
            qualified_name = str(payload.get("qualified_name") or row["path"] or row["name"] or "").strip() or None
            metaclass = str(payload.get("metaclass") or row["item_type"] or "element").strip() or None
            updates.append((owner_id, qualified_name, metaclass, int(row["rowid"])))

        if updates:
            connection.executemany(
                """
                UPDATE twc_cached_elements
                SET owner_id = ?, qualified_name = ?, metaclass = ?
                WHERE rowid = ?
                """,
                updates,
            )

    def list_servers(self, *, include_disabled: bool = False) -> list[ServerProfile]:
        with self._lock, self._connect() as connection:
            rows = connection.execute("SELECT payload FROM servers").fetchall()
        servers = [ServerProfile.model_validate_json(row["payload"]) for row in rows]
        if not include_disabled:
            servers = [server for server in servers if server.enabled]
        return sorted(
            servers,
            key=lambda item: (
                item.display_order,
                item.name.lower(),
            ),
        )

    def get_server(self, server_id: str) -> ServerProfile | None:
        with self._lock, self._connect() as connection:
            row = connection.execute("SELECT payload FROM servers WHERE id = ?", (server_id,)).fetchone()
        if not row:
            return None
        return ServerProfile.model_validate_json(row["payload"])

    def upsert_server(self, server: ServerProfile) -> ServerProfile:
        payload = server.model_dump_json()
        with self._lock, self._connect() as connection:
            connection.execute(
                "INSERT OR REPLACE INTO servers (id, payload) VALUES (?, ?)",
                (server.id, payload),
            )
            connection.commit()
        return server

    def bulk_upsert_servers(self, servers: Iterable[ServerProfile]) -> list[ServerProfile]:
        items = list(servers)
        with self._lock, self._connect() as connection:
            connection.executemany(
                "INSERT OR REPLACE INTO servers (id, payload) VALUES (?, ?)",
                [(server.id, server.model_dump_json()) for server in items],
            )
            connection.commit()
        return self.list_servers(include_disabled=True)

    def sync_servers(self, definitions: Iterable[PresetServerDefinition]) -> list[ServerProfile]:
        items = list(definitions)
        valid_server_ids = {item.id for item in items}
        existing_servers = {server.id: server for server in self.list_servers(include_disabled=True)}
        synced_servers: list[ServerProfile] = []

        for definition in items:
            current = existing_servers.get(definition.id)
            synced_servers.append(
                ServerProfile(
                    id=definition.id,
                    name=definition.name,
                    base_url=definition.base_url,
                    version=definition.version,
                    verify_tls=definition.verify_tls,
                    ca_bundle_path=definition.ca_bundle_path,
                    enabled=definition.enabled,
                    display_order=definition.display_order,
                    created_at=current.created_at if current else utcnow(),
                    updated_at=current.updated_at if current else utcnow(),
                )
            )

        with self._lock, self._connect() as connection:
            connection.execute("DELETE FROM servers")
            if synced_servers:
                connection.executemany(
                    "INSERT OR REPLACE INTO servers (id, payload) VALUES (?, ?)",
                    [(server.id, server.model_dump_json()) for server in synced_servers],
                )
            self._prune_invalid_user_server_state(connection, valid_server_ids)
            self._prune_invalid_user_cache(connection, valid_server_ids)
            self._prune_invalid_app_secrets(connection, valid_server_ids)
            connection.commit()

        return self.list_servers(include_disabled=True)

    def next_server_display_order(self) -> int:
        servers = self.list_servers(include_disabled=True)
        if not servers:
            return 0
        return max(server.display_order for server in servers) + 1

    def delete_server(self, server_id: str) -> bool:
        with self._lock, self._connect() as connection:
            cursor = connection.execute("DELETE FROM servers WHERE id = ?", (server_id,))
            if cursor.rowcount > 0:
                self._remove_server_from_user_state(connection, server_id)
                connection.execute("DELETE FROM user_data_cache WHERE server_id = ?", (server_id,))
                connection.execute("DELETE FROM app_secrets WHERE scope = ?", (self._oslc_shared_scope(server_id),))
                self._delete_materialized_cache_for_server(connection, server_id)
            connection.commit()
        return cursor.rowcount > 0

    def get_user_server_state(self, user_id: str) -> UserServerState | None:
        with self._lock, self._connect() as connection:
            row = connection.execute("SELECT payload FROM user_server_state WHERE user_id = ?", (user_id,)).fetchone()
        if not row:
            return None
        return UserServerState.model_validate_json(row["payload"])

    def upsert_user_server_state(self, state: UserServerState) -> UserServerState:
        with self._lock, self._connect() as connection:
            connection.execute(
                "INSERT OR REPLACE INTO user_server_state (user_id, payload) VALUES (?, ?)",
                (state.user_id, state.model_dump_json()),
            )
            connection.commit()
        return state

    def _remove_server_from_user_state(self, connection: sqlite3.Connection, server_id: str) -> None:
        rows = connection.execute("SELECT user_id, payload FROM user_server_state").fetchall()
        updates: list[tuple[str, str]] = []
        for row in rows:
            state = UserServerState.model_validate_json(row["payload"])
            changed = False
            if state.selected_server_id == server_id:
                state.selected_server_id = None
                changed = True
            if state.last_used_server_id == server_id:
                state.last_used_server_id = None
                changed = True
            favorite_ids = [value for value in state.favorite_server_ids if value != server_id]
            if favorite_ids != state.favorite_server_ids:
                state.favorite_server_ids = favorite_ids
                changed = True
            if changed:
                state.updated_at = utcnow()
                updates.append((state.user_id, state.model_dump_json()))

        if updates:
            connection.executemany(
                "INSERT OR REPLACE INTO user_server_state (user_id, payload) VALUES (?, ?)",
                updates,
            )

    def get_user_cache(self, user_id: str, server_id: str, cache_key: str):
        with self._lock, self._connect() as connection:
            row = connection.execute(
                "SELECT payload FROM user_data_cache WHERE user_id = ? AND server_id = ? AND cache_key = ?",
                (user_id, server_id, cache_key),
            ).fetchone()
        if not row:
            return None
        return json.loads(row["payload"])

    def upsert_user_cache(self, user_id: str, server_id: str, cache_key: str, payload: object) -> None:
        with self._lock, self._connect() as connection:
            connection.execute(
                """
                INSERT OR REPLACE INTO user_data_cache (user_id, server_id, cache_key, payload, updated_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (user_id, server_id, cache_key, json.dumps(payload), utcnow().isoformat()),
            )
            connection.commit()

    def delete_user_cache(self, user_id: str, server_id: str, cache_key: str) -> None:
        with self._lock, self._connect() as connection:
            connection.execute(
                "DELETE FROM user_data_cache WHERE user_id = ? AND server_id = ? AND cache_key = ?",
                (user_id, server_id, cache_key),
            )
            connection.commit()

    def delete_user_cache_prefix(self, user_id: str, server_id: str, cache_key_prefix: str) -> None:
        with self._lock, self._connect() as connection:
            connection.execute(
                "DELETE FROM user_data_cache WHERE user_id = ? AND server_id = ? AND cache_key LIKE ?",
                (user_id, server_id, f"{cache_key_prefix}%"),
            )
            connection.commit()

    def delete_user_cache_prefix_for_server(self, server_id: str, cache_key_prefix: str) -> None:
        with self._lock, self._connect() as connection:
            connection.execute(
                "DELETE FROM user_data_cache WHERE server_id = ? AND cache_key LIKE ?",
                (server_id, f"{cache_key_prefix}%"),
            )
            connection.commit()

    def get_app_secret(self, scope: str) -> tuple[str, str] | None:
        with self._lock, self._connect() as connection:
            row = connection.execute("SELECT payload, updated_at FROM app_secrets WHERE scope = ?", (scope,)).fetchone()
        if not row:
            return None
        return str(row["payload"]), str(row["updated_at"])

    def upsert_app_secret(self, scope: str, payload: str) -> str:
        updated_at = utcnow().isoformat()
        with self._lock, self._connect() as connection:
            connection.execute(
                "INSERT OR REPLACE INTO app_secrets (scope, payload, updated_at) VALUES (?, ?, ?)",
                (scope, payload, updated_at),
            )
            connection.commit()
        return updated_at

    def delete_app_secret(self, scope: str) -> None:
        with self._lock, self._connect() as connection:
            connection.execute("DELETE FROM app_secrets WHERE scope = ?", (scope,))
            connection.commit()

    def list_cache_api_keys(self, user_id: str) -> list[CacheApiKeyRecord]:
        with self._lock, self._connect() as connection:
            rows = connection.execute(
                "SELECT payload FROM cache_api_keys WHERE user_id = ? ORDER BY created_at DESC",
                (user_id,),
            ).fetchall()
        return [CacheApiKeyRecord.model_validate_json(row["payload"]) for row in rows]

    def get_cache_api_key_by_hash(self, token_hash: str) -> CacheApiKeyRecord | None:
        with self._lock, self._connect() as connection:
            row = connection.execute(
                "SELECT payload FROM cache_api_keys WHERE token_hash = ?",
                (token_hash,),
            ).fetchone()
        if not row:
            return None
        return CacheApiKeyRecord.model_validate_json(row["payload"])

    def upsert_cache_api_key(self, record: CacheApiKeyRecord) -> CacheApiKeyRecord:
        with self._lock, self._connect() as connection:
            connection.execute(
                """
                INSERT OR REPLACE INTO cache_api_keys (
                    key_id, user_id, label, token_hash, token_hint,
                    created_at, updated_at, last_used_at, payload
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    record.key_id,
                    record.user_id,
                    record.label,
                    record.token_hash,
                    record.token_hint,
                    record.created_at.isoformat(),
                    record.updated_at.isoformat(),
                    record.last_used_at.isoformat() if record.last_used_at else None,
                    record.model_dump_json(),
                ),
            )
            connection.commit()
        return record

    def delete_cache_api_key(self, user_id: str, key_id: str) -> bool:
        with self._lock, self._connect() as connection:
            cursor = connection.execute(
                "DELETE FROM cache_api_keys WHERE user_id = ? AND key_id = ?",
                (user_id, key_id),
            )
            connection.commit()
        return cursor.rowcount > 0

    def touch_cache_api_key_last_used(self, key_id: str, last_used_at) -> CacheApiKeyRecord | None:
        with self._lock, self._connect() as connection:
            row = connection.execute(
                "SELECT payload FROM cache_api_keys WHERE key_id = ?",
                (key_id,),
            ).fetchone()
            if not row:
                return None
            record = CacheApiKeyRecord.model_validate_json(row["payload"])
            record.last_used_at = last_used_at
            connection.execute(
                """
                UPDATE cache_api_keys
                SET last_used_at = ?, payload = ?
                WHERE key_id = ?
                """,
                (
                    last_used_at.isoformat(),
                    record.model_dump_json(),
                    key_id,
                ),
            )
            connection.commit()
        return record

    def get_branch_webhook_registration(
        self,
        server_id: str,
        project_id: str,
        branch_id: str,
    ) -> BranchWebhookRegistration | None:
        with self._lock, self._connect() as connection:
            row = connection.execute(
                """
                SELECT payload FROM twc_webhook_registrations
                WHERE server_id = ? AND project_id = ? AND branch_id = ?
                """,
                (server_id, project_id, branch_id),
            ).fetchone()
        if not row:
            return None
        return BranchWebhookRegistration.model_validate_json(row["payload"])

    def get_branch_webhook_registration_by_id(self, registration_id: str) -> BranchWebhookRegistration | None:
        with self._lock, self._connect() as connection:
            row = connection.execute(
                "SELECT payload FROM twc_webhook_registrations WHERE registration_id = ?",
                (registration_id,),
            ).fetchone()
        if not row:
            return None
        return BranchWebhookRegistration.model_validate_json(row["payload"])

    def upsert_branch_webhook_registration(self, registration: BranchWebhookRegistration) -> BranchWebhookRegistration:
        with self._lock, self._connect() as connection:
            connection.execute(
                """
                INSERT OR REPLACE INTO twc_webhook_registrations (
                    registration_id, server_id, project_id, branch_id, webhook_id, status, updated_at, payload
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    registration.registration_id,
                    registration.server_id,
                    registration.project_id,
                    registration.branch_id,
                    registration.webhook_id,
                    registration.status.value,
                    registration.updated_at.isoformat(),
                    registration.model_dump_json(),
                ),
            )
            connection.commit()
        return registration

    def delete_branch_webhook_registration(self, server_id: str, project_id: str, branch_id: str) -> None:
        with self._lock, self._connect() as connection:
            connection.execute(
                "DELETE FROM twc_webhook_registrations WHERE server_id = ? AND project_id = ? AND branch_id = ?",
                (server_id, project_id, branch_id),
            )
            connection.commit()

    def get_branch_cache_summary(self, server_id: str, project_id: str, branch_id: str) -> BranchCacheSummary | None:
        with self._lock, self._connect() as connection:
            row = connection.execute(
                """
                SELECT payload FROM twc_branch_cache
                WHERE server_id = ? AND project_id = ? AND branch_id = ?
                """,
                (server_id, project_id, branch_id),
            ).fetchone()
        if not row:
            return None
        return BranchCacheSummary.model_validate_json(row["payload"])

    def upsert_branch_cache_summary(
        self,
        summary: BranchCacheSummary,
        *,
        connection: sqlite3.Connection | None = None,
    ) -> BranchCacheSummary:
        if connection is not None:
            connection.execute(
                """
                INSERT OR REPLACE INTO twc_branch_cache (server_id, project_id, branch_id, status, updated_at, payload)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    summary.server_id,
                    summary.project_id,
                    summary.branch_id,
                    summary.status.value,
                    summary.updated_at.isoformat(),
                    summary.model_dump_json(),
                ),
            )
            return summary
        with self._lock, self._connect() as managed_connection:
            self.upsert_branch_cache_summary(summary, connection=managed_connection)
            managed_connection.commit()
        return summary

    def delete_branch_cache(self, server_id: str, project_id: str, branch_id: str) -> None:
        with self._lock, self._connect() as connection:
            connection.execute(
                "DELETE FROM twc_branch_cache WHERE server_id = ? AND project_id = ? AND branch_id = ?",
                (server_id, project_id, branch_id),
            )
            connection.execute(
                "DELETE FROM twc_webhook_registrations WHERE server_id = ? AND project_id = ? AND branch_id = ?",
                (server_id, project_id, branch_id),
            )
            connection.execute(
                "DELETE FROM twc_cached_models WHERE server_id = ? AND project_id = ? AND branch_id = ?",
                (server_id, project_id, branch_id),
            )
            connection.execute(
                "DELETE FROM twc_cached_model_permissions WHERE server_id = ? AND project_id = ? AND branch_id = ?",
                (server_id, project_id, branch_id),
            )
            connection.execute(
                "DELETE FROM twc_cached_elements WHERE server_id = ? AND project_id = ? AND branch_id = ?",
                (server_id, project_id, branch_id),
            )
            connection.commit()

    def list_cached_models(
        self,
        server_id: str,
        project_id: str,
        branch_id: str,
        *,
        connection: sqlite3.Connection | None = None,
    ) -> list[CachedModelRecord]:
        if connection is not None:
            rows = connection.execute(
                """
                SELECT payload FROM twc_cached_models
                WHERE server_id = ? AND project_id = ? AND branch_id = ?
                ORDER BY LOWER(name), model_id
                """,
                (server_id, project_id, branch_id),
            ).fetchall()
            return [CachedModelRecord.model_validate_json(row["payload"]) for row in rows]
        with self._lock, self._connect() as managed_connection:
            return self.list_cached_models(server_id, project_id, branch_id, connection=managed_connection)

    def get_cached_model(self, server_id: str, project_id: str, branch_id: str, model_id: str) -> CachedModelRecord | None:
        with self._lock, self._connect() as connection:
            row = connection.execute(
                """
                SELECT payload FROM twc_cached_models
                WHERE server_id = ? AND project_id = ? AND branch_id = ? AND model_id = ?
                """,
                (server_id, project_id, branch_id, model_id),
            ).fetchone()
        if not row:
            return None
        return CachedModelRecord.model_validate_json(row["payload"])

    def upsert_cached_models(
        self,
        records: Iterable[CachedModelRecord],
        *,
        connection: sqlite3.Connection | None = None,
    ) -> None:
        items = list(records)
        if not items:
            return
        if connection is not None:
            connection.executemany(
                """
                INSERT OR REPLACE INTO twc_cached_models (server_id, project_id, branch_id, model_id, name, updated_at, payload)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        item.server_id,
                        item.project_id,
                        item.branch_id,
                        item.model_id,
                        item.name,
                        item.synced_at.isoformat(),
                        item.model_dump_json(),
                    )
                    for item in items
                ],
            )
            return
        with self._lock, self._connect() as managed_connection:
            self.upsert_cached_models(items, connection=managed_connection)
            managed_connection.commit()

    def get_model_permission(
        self,
        user_id: str,
        server_id: str,
        project_id: str,
        branch_id: str,
        model_id: str,
    ) -> ModelPermissionSnapshot | None:
        with self._lock, self._connect() as connection:
            row = connection.execute(
                """
                SELECT payload FROM twc_cached_model_permissions
                WHERE user_id = ? AND server_id = ? AND project_id = ? AND branch_id = ? AND model_id = ?
                """,
                (user_id, server_id, project_id, branch_id, model_id),
            ).fetchone()
        if not row:
            return None
        return ModelPermissionSnapshot.model_validate_json(row["payload"])

    def get_branch_access_record(
        self,
        user_id: str,
        server_id: str,
        project_id: str,
        branch_id: str,
    ) -> BranchAccessRecord | None:
        with self._lock, self._connect() as connection:
            row = connection.execute(
                """
                SELECT payload FROM twc_branch_access_records
                WHERE user_id = ? AND server_id = ? AND project_id = ? AND branch_id = ?
                """,
                (user_id, server_id, project_id, branch_id),
            ).fetchone()
        if not row:
            return None
        return BranchAccessRecord.model_validate_json(row["payload"])

    def list_branch_access_records(
        self,
        server_id: str,
        project_id: str,
        branch_id: str,
    ) -> list[BranchAccessRecord]:
        with self._lock, self._connect() as connection:
            rows = connection.execute(
                """
                SELECT payload FROM twc_branch_access_records
                WHERE server_id = ? AND project_id = ? AND branch_id = ?
                ORDER BY user_id
                """,
                (server_id, project_id, branch_id),
            ).fetchall()
        return [BranchAccessRecord.model_validate_json(row["payload"]) for row in rows]

    def list_model_permissions(
        self,
        user_id: str,
        server_id: str,
        project_id: str,
        branch_id: str,
    ) -> list[ModelPermissionSnapshot]:
        with self._lock, self._connect() as connection:
            rows = connection.execute(
                """
                SELECT payload FROM twc_cached_model_permissions
                WHERE user_id = ? AND server_id = ? AND project_id = ? AND branch_id = ?
                ORDER BY model_id
                """,
                (user_id, server_id, project_id, branch_id),
            ).fetchall()
        return [ModelPermissionSnapshot.model_validate_json(row["payload"]) for row in rows]

    def upsert_model_permissions(self, records: Iterable[ModelPermissionSnapshot]) -> None:
        items = list(records)
        if not items:
            return
        with self._lock, self._connect() as connection:
            connection.executemany(
                """
                INSERT OR REPLACE INTO twc_cached_model_permissions (
                    user_id, server_id, project_id, branch_id, model_id,
                    accessible, restricted, editable, updated_at, payload
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        item.user_id,
                        item.server_id,
                        item.project_id,
                        item.branch_id,
                        item.model_id,
                        int(item.accessible),
                        int(item.restricted),
                        int(item.editable),
                        item.updated_at.isoformat(),
                        item.model_dump_json(),
                    )
                    for item in items
                ],
            )
            connection.commit()

    def replace_model_permissions_for_user_branch(
        self,
        user_id: str,
        server_id: str,
        project_id: str,
        branch_id: str,
        records: Iterable[ModelPermissionSnapshot],
        *,
        connection: sqlite3.Connection | None = None,
    ) -> None:
        items = list(records)
        if connection is not None:
            connection.execute(
                """
                DELETE FROM twc_cached_model_permissions
                WHERE user_id = ? AND server_id = ? AND project_id = ? AND branch_id = ?
                """,
                (user_id, server_id, project_id, branch_id),
            )
            if items:
                connection.executemany(
                    """
                    INSERT OR REPLACE INTO twc_cached_model_permissions (
                        user_id, server_id, project_id, branch_id, model_id,
                        accessible, restricted, editable, updated_at, payload
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    [
                        (
                            item.user_id,
                            item.server_id,
                            item.project_id,
                            item.branch_id,
                            item.model_id,
                            int(item.accessible),
                            int(item.restricted),
                            int(item.editable),
                            item.updated_at.isoformat(),
                            item.model_dump_json(),
                        )
                        for item in items
                    ],
                )
            return
        with self._lock, self._connect() as managed_connection:
            self.replace_model_permissions_for_user_branch(
                user_id,
                server_id,
                project_id,
                branch_id,
                items,
                connection=managed_connection,
            )
            managed_connection.commit()

    def upsert_branch_access_records(
        self,
        records: Iterable[BranchAccessRecord],
        *,
        connection: sqlite3.Connection | None = None,
    ) -> None:
        items = list(records)
        if not items:
            return
        if connection is not None:
            connection.executemany(
                """
                INSERT OR REPLACE INTO twc_branch_access_records (
                    user_id, server_id, project_id, branch_id,
                    accessible, editable, admin_access, updated_at, source, payload
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        item.user_id,
                        item.server_id,
                        item.project_id,
                        item.branch_id,
                        int(item.accessible),
                        int(item.editable),
                        int(item.admin_access),
                        item.updated_at.isoformat(),
                        item.source,
                        item.model_dump_json(),
                    )
                    for item in items
                ],
            )
            return
        with self._lock, self._connect() as managed_connection:
            self.upsert_branch_access_records(items, connection=managed_connection)
            managed_connection.commit()

    def replace_branch_access_records_for_branch(
        self,
        server_id: str,
        project_id: str,
        branch_id: str,
        records: Iterable[BranchAccessRecord],
    ) -> None:
        items = list(records)
        with self._lock, self._connect() as connection:
            connection.execute(
                """
                DELETE FROM twc_branch_access_records
                WHERE server_id = ? AND project_id = ? AND branch_id = ?
                """,
                (server_id, project_id, branch_id),
            )
            if items:
                connection.executemany(
                    """
                    INSERT OR REPLACE INTO twc_branch_access_records (
                        user_id, server_id, project_id, branch_id,
                        accessible, editable, admin_access, updated_at, source, payload
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    [
                        (
                            item.user_id,
                            item.server_id,
                            item.project_id,
                            item.branch_id,
                            int(item.accessible),
                            int(item.editable),
                            int(item.admin_access),
                            item.updated_at.isoformat(),
                            item.source,
                            item.model_dump_json(),
                        )
                        for item in items
                    ],
                )
            connection.commit()

    def replace_cached_elements(
        self,
        server_id: str,
        project_id: str,
        branch_id: str,
        model_id: str,
        records: Iterable[CachedElementRecord],
        *,
        connection: sqlite3.Connection | None = None,
    ) -> int:
        items = list(records)
        if connection is not None:
            connection.execute(
                "DELETE FROM twc_cached_elements WHERE server_id = ? AND project_id = ? AND branch_id = ? AND model_id = ?",
                (server_id, project_id, branch_id, model_id),
            )
            if items:
                connection.executemany(
                    """
                    INSERT OR REPLACE INTO twc_cached_elements (
                        server_id, project_id, branch_id, model_id, element_id,
                        name, item_type, path, owner_id, qualified_name, metaclass, updated_at, payload
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    [self._cached_element_db_tuple(item) for item in items],
                )
            return len(items)
        with self._lock, self._connect() as managed_connection:
            count = self.replace_cached_elements(
                server_id,
                project_id,
                branch_id,
                model_id,
                items,
                connection=managed_connection,
            )
            managed_connection.commit()
            return count

    def upsert_cached_elements(
        self,
        records: Iterable[CachedElementRecord],
        *,
        connection: sqlite3.Connection | None = None,
    ) -> int:
        items = list(records)
        if not items:
            return 0
        if connection is not None:
            connection.executemany(
                """
                INSERT OR REPLACE INTO twc_cached_elements (
                    server_id, project_id, branch_id, model_id, element_id,
                    name, item_type, path, owner_id, qualified_name, metaclass, updated_at, payload
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [self._cached_element_db_tuple(item) for item in items],
            )
            return len(items)
        with self._lock, self._connect() as managed_connection:
            count = self.upsert_cached_elements(items, connection=managed_connection)
            managed_connection.commit()
            return count

    def delete_cached_elements_by_ids(
        self,
        server_id: str,
        project_id: str,
        branch_id: str,
        element_ids: Iterable[str],
        *,
        connection: sqlite3.Connection | None = None,
    ) -> None:
        ids = [element_id for element_id in dict.fromkeys(element_ids) if element_id]
        if not ids:
            return
        placeholders = ", ".join("?" for _ in ids)
        if connection is not None:
            connection.execute(
                f"""
                DELETE FROM twc_cached_elements
                WHERE server_id = ? AND project_id = ? AND branch_id = ? AND element_id IN ({placeholders})
                """,
                (server_id, project_id, branch_id, *ids),
            )
            return
        with self._lock, self._connect() as managed_connection:
            self.delete_cached_elements_by_ids(
                server_id,
                project_id,
                branch_id,
                ids,
                connection=managed_connection,
            )
            managed_connection.commit()

    def delete_cached_models_by_ids(
        self,
        server_id: str,
        project_id: str,
        branch_id: str,
        model_ids: Iterable[str],
        *,
        connection: sqlite3.Connection | None = None,
    ) -> None:
        ids = [model_id for model_id in dict.fromkeys(model_ids) if model_id]
        if not ids:
            return
        placeholders = ", ".join("?" for _ in ids)
        if connection is not None:
            connection.execute(
                f"""
                DELETE FROM twc_cached_models
                WHERE server_id = ? AND project_id = ? AND branch_id = ? AND model_id IN ({placeholders})
                """,
                (server_id, project_id, branch_id, *ids),
            )
            connection.execute(
                f"""
                DELETE FROM twc_cached_model_permissions
                WHERE server_id = ? AND project_id = ? AND branch_id = ? AND model_id IN ({placeholders})
                """,
                (server_id, project_id, branch_id, *ids),
            )
            connection.execute(
                f"""
                DELETE FROM twc_cached_elements
                WHERE server_id = ? AND project_id = ? AND branch_id = ? AND model_id IN ({placeholders})
                """,
                (server_id, project_id, branch_id, *ids),
            )
            return
        with self._lock, self._connect() as managed_connection:
            self.delete_cached_models_by_ids(
                server_id,
                project_id,
                branch_id,
                ids,
                connection=managed_connection,
            )
            managed_connection.commit()

    def count_cached_elements_for_model(
        self,
        server_id: str,
        project_id: str,
        branch_id: str,
        model_id: str,
        *,
        connection: sqlite3.Connection | None = None,
    ) -> int:
        if connection is not None:
            row = connection.execute(
                """
                SELECT COUNT(*) AS total FROM twc_cached_elements
                WHERE server_id = ? AND project_id = ? AND branch_id = ? AND model_id = ?
                """,
                (server_id, project_id, branch_id, model_id),
            ).fetchone()
            return int(row["total"]) if row else 0
        with self._lock, self._connect() as managed_connection:
            return self.count_cached_elements_for_model(
                server_id,
                project_id,
                branch_id,
                model_id,
                connection=managed_connection,
            )

    def count_cached_elements_for_branch(
        self,
        server_id: str,
        project_id: str,
        branch_id: str,
        *,
        connection: sqlite3.Connection | None = None,
    ) -> int:
        if connection is not None:
            row = connection.execute(
                """
                SELECT COUNT(*) AS total FROM twc_cached_elements
                WHERE server_id = ? AND project_id = ? AND branch_id = ?
                """,
                (server_id, project_id, branch_id),
            ).fetchone()
            return int(row["total"]) if row else 0
        with self._lock, self._connect() as managed_connection:
            return self.count_cached_elements_for_branch(
                server_id,
                project_id,
                branch_id,
                connection=managed_connection,
            )

    def list_branch_cache_summaries(self, server_id: str | None = None) -> list[BranchCacheSummary]:
        query = "SELECT payload FROM twc_branch_cache"
        params: tuple[object, ...] = ()
        if server_id is not None:
            query += " WHERE server_id = ?"
            params = (server_id,)
        query += " ORDER BY project_id, branch_id"
        with self._lock, self._connect() as connection:
            rows = connection.execute(query, params).fetchall()
        return [BranchCacheSummary.model_validate_json(row["payload"]) for row in rows]

    def delete_branch_models_except(
        self,
        server_id: str,
        project_id: str,
        branch_id: str,
        model_ids: Iterable[str],
        *,
        connection: sqlite3.Connection | None = None,
    ) -> None:
        kept_ids = [model_id for model_id in dict.fromkeys(model_ids) if model_id]
        if connection is not None:
            if not kept_ids:
                connection.execute(
                    "DELETE FROM twc_cached_models WHERE server_id = ? AND project_id = ? AND branch_id = ?",
                    (server_id, project_id, branch_id),
                )
                connection.execute(
                    "DELETE FROM twc_cached_model_permissions WHERE server_id = ? AND project_id = ? AND branch_id = ?",
                    (server_id, project_id, branch_id),
                )
                connection.execute(
                    "DELETE FROM twc_cached_elements WHERE server_id = ? AND project_id = ? AND branch_id = ?",
                    (server_id, project_id, branch_id),
                )
                return

            placeholders = ", ".join("?" for _ in kept_ids)
            params = (server_id, project_id, branch_id, *kept_ids)
            connection.execute(
                f"DELETE FROM twc_cached_models WHERE server_id = ? AND project_id = ? AND branch_id = ? AND model_id NOT IN ({placeholders})",
                params,
            )
            connection.execute(
                f"DELETE FROM twc_cached_model_permissions WHERE server_id = ? AND project_id = ? AND branch_id = ? AND model_id NOT IN ({placeholders})",
                params,
            )
            connection.execute(
                f"DELETE FROM twc_cached_elements WHERE server_id = ? AND project_id = ? AND branch_id = ? AND model_id NOT IN ({placeholders})",
                params,
            )
            return
        with self._lock, self._connect() as managed_connection:
            self.delete_branch_models_except(
                server_id,
                project_id,
                branch_id,
                kept_ids,
                connection=managed_connection,
            )
            managed_connection.commit()

    def list_cached_elements(
        self,
        server_id: str,
        project_id: str,
        branch_id: str,
        *,
        model_id: str | None = None,
        search: str | None = None,
        limit: int = 200,
        offset: int = 0,
        connection: sqlite3.Connection | None = None,
    ) -> CachedElementQueryResponse:
        clauses = ["server_id = ?", "project_id = ?", "branch_id = ?"]
        params: list[object] = [server_id, project_id, branch_id]
        if model_id:
            clauses.append("model_id = ?")
            params.append(model_id)
        if search:
            query = f"%{search.lower()}%"
            clauses.append("(LOWER(name) LIKE ? OR LOWER(path) LIKE ? OR LOWER(item_type) LIKE ? OR LOWER(element_id) LIKE ?)")
            params.extend([query, query, query, query])

        where = " AND ".join(clauses)
        if connection is not None:
            total = int(
                connection.execute(
                    f"SELECT COUNT(*) AS total FROM twc_cached_elements WHERE {where}",
                    tuple(params),
                ).fetchone()["total"]
            )
            rows = connection.execute(
                f"""
                SELECT payload FROM twc_cached_elements
                WHERE {where}
                ORDER BY LOWER(name), element_id
                LIMIT ? OFFSET ?
                """,
                (*params, limit, offset),
            ).fetchall()
            return CachedElementQueryResponse(
                total=total,
                items=[CachedElementRecord.model_validate_json(row["payload"]) for row in rows],
            )
        with self._lock, self._connect() as managed_connection:
            return self.list_cached_elements(
                server_id,
                project_id,
                branch_id,
                model_id=model_id,
                search=search,
                limit=limit,
                offset=offset,
                connection=managed_connection,
            )

    def list_cached_elements_by_ids(
        self,
        server_id: str,
        project_id: str,
        branch_id: str,
        element_ids: Iterable[str],
        *,
        model_id: str | None = None,
        connection: sqlite3.Connection | None = None,
    ) -> list[CachedElementRecord]:
        ids = [element_id for element_id in dict.fromkeys(element_ids) if element_id]
        if not ids:
            return []
        placeholders = ", ".join("?" for _ in ids)
        clauses = ["server_id = ?", "project_id = ?", "branch_id = ?", f"element_id IN ({placeholders})"]
        params: list[object] = [server_id, project_id, branch_id, *ids]
        if model_id:
            clauses.append("model_id = ?")
            params.append(model_id)
        where = " AND ".join(clauses)
        if connection is not None:
            rows = connection.execute(
                f"SELECT payload FROM twc_cached_elements WHERE {where}",
                tuple(params),
            ).fetchall()
            return [CachedElementRecord.model_validate_json(row["payload"]) for row in rows]
        with self._lock, self._connect() as managed_connection:
            return self.list_cached_elements_by_ids(
                server_id,
                project_id,
                branch_id,
                ids,
                model_id=model_id,
                connection=managed_connection,
            )

    def list_cached_elements_by_owner(
        self,
        server_id: str,
        project_id: str,
        branch_id: str,
        model_id: str,
        owner_id: str,
        *,
        connection: sqlite3.Connection | None = None,
    ) -> list[CachedElementRecord]:
        if connection is not None:
            rows = connection.execute(
                """
                SELECT payload FROM twc_cached_elements
                WHERE server_id = ? AND project_id = ? AND branch_id = ? AND model_id = ? AND owner_id = ?
                ORDER BY LOWER(name), element_id
                """,
                (server_id, project_id, branch_id, model_id, owner_id),
            ).fetchall()
            return [CachedElementRecord.model_validate_json(row["payload"]) for row in rows]
        with self._lock, self._connect() as managed_connection:
            return self.list_cached_elements_by_owner(
                server_id,
                project_id,
                branch_id,
                model_id,
                owner_id,
                connection=managed_connection,
            )

    def list_cached_element_tree_summaries_by_ids(
        self,
        server_id: str,
        project_id: str,
        branch_id: str,
        element_ids: Iterable[str],
        *,
        model_id: str | None = None,
        connection: sqlite3.Connection | None = None,
    ) -> list[dict[str, Any]]:
        ids = [element_id for element_id in dict.fromkeys(element_ids) if element_id]
        if not ids:
            return []
        placeholders = ", ".join("?" for _ in ids)
        clauses = ["server_id = ?", "project_id = ?", "branch_id = ?", f"element_id IN ({placeholders})"]
        params: list[object] = [server_id, project_id, branch_id, *ids]
        if model_id:
            clauses.append("model_id = ?")
            params.append(model_id)
        where = " AND ".join(clauses)
        if connection is not None:
            rows = connection.execute(
                f"""
                SELECT server_id, project_id, branch_id, model_id, element_id, name, item_type, path, owner_id, qualified_name, metaclass, payload
                FROM twc_cached_elements
                WHERE {where}
                """,
                tuple(params),
            ).fetchall()
            return [self._cached_element_tree_summary_from_row(row) for row in rows]
        with self._lock, self._connect() as managed_connection:
            return self.list_cached_element_tree_summaries_by_ids(
                server_id,
                project_id,
                branch_id,
                ids,
                model_id=model_id,
                connection=managed_connection,
            )

    def list_cached_element_tree_summaries_by_owner(
        self,
        server_id: str,
        project_id: str,
        branch_id: str,
        model_id: str,
        owner_id: str,
        *,
        connection: sqlite3.Connection | None = None,
    ) -> list[dict[str, Any]]:
        if connection is not None:
            rows = connection.execute(
                """
                SELECT server_id, project_id, branch_id, model_id, element_id, name, item_type, path, owner_id, qualified_name, metaclass, payload
                FROM twc_cached_elements
                WHERE server_id = ? AND project_id = ? AND branch_id = ? AND model_id = ? AND owner_id = ?
                ORDER BY LOWER(name), element_id
                """,
                (server_id, project_id, branch_id, model_id, owner_id),
            ).fetchall()
            return [self._cached_element_tree_summary_from_row(row) for row in rows]
        with self._lock, self._connect() as managed_connection:
            return self.list_cached_element_tree_summaries_by_owner(
                server_id,
                project_id,
                branch_id,
                model_id,
                owner_id,
                connection=managed_connection,
            )

    def get_cached_element_tree_summary(
        self,
        server_id: str,
        project_id: str,
        branch_id: str,
        element_id: str,
        *,
        model_id: str | None = None,
        connection: sqlite3.Connection | None = None,
    ) -> dict[str, Any] | None:
        clauses = ["server_id = ?", "project_id = ?", "branch_id = ?", "element_id = ?"]
        params: list[object] = [server_id, project_id, branch_id, element_id]
        if model_id:
            clauses.append("model_id = ?")
            params.append(model_id)
        where = " AND ".join(clauses)
        if connection is not None:
            row = connection.execute(
                f"""
                SELECT server_id, project_id, branch_id, model_id, element_id, name, item_type, path, owner_id, qualified_name, metaclass, payload
                FROM twc_cached_elements
                WHERE {where}
                ORDER BY model_id
                LIMIT 1
                """,
                tuple(params),
            ).fetchone()
            return self._cached_element_tree_summary_from_row(row) if row else None
        with self._lock, self._connect() as managed_connection:
            return self.get_cached_element_tree_summary(
                server_id,
                project_id,
                branch_id,
                element_id,
                model_id=model_id,
                connection=managed_connection,
            )

    def get_cached_element(
        self,
        server_id: str,
        project_id: str,
        branch_id: str,
        element_id: str,
        *,
        model_id: str | None = None,
    ) -> CachedElementRecord | None:
        clauses = ["server_id = ?", "project_id = ?", "branch_id = ?", "element_id = ?"]
        params: list[object] = [server_id, project_id, branch_id, element_id]
        if model_id:
            clauses.append("model_id = ?")
            params.append(model_id)
        where = " AND ".join(clauses)
        with self._lock, self._connect() as connection:
            row = connection.execute(
                f"SELECT payload FROM twc_cached_elements WHERE {where} ORDER BY model_id LIMIT 1",
                tuple(params),
            ).fetchone()
        if not row:
            return None
        return CachedElementRecord.model_validate_json(row["payload"])

    def get_auth_settings(self) -> WorkbenchAuthSettings:
        with self._lock, self._connect() as connection:
            row = connection.execute("SELECT payload FROM app_config WHERE key = ?", ("auth-settings",)).fetchone()
        if not row:
            return WorkbenchAuthSettings()
        return WorkbenchAuthSettings.model_validate_json(row["payload"])

    def has_auth_settings(self) -> bool:
        with self._lock, self._connect() as connection:
            row = connection.execute("SELECT 1 FROM app_config WHERE key = ?", ("auth-settings",)).fetchone()
        return bool(row)

    def set_auth_settings(self, settings: WorkbenchAuthSettings) -> WorkbenchAuthSettings:
        stored = settings.model_copy()
        with self._lock, self._connect() as connection:
            connection.execute(
                """
                INSERT OR REPLACE INTO app_config (key, payload, updated_at)
                VALUES (?, ?, ?)
                """,
                ("auth-settings", stored.model_dump_json(), utcnow().isoformat()),
            )
            connection.commit()
        return stored

    def list_workbench_users(self) -> list[WorkbenchUserRecord]:
        with self._lock, self._connect() as connection:
            rows = connection.execute(
                "SELECT payload FROM workbench_users ORDER BY LOWER(username)"
            ).fetchall()
        return [WorkbenchUserRecord.model_validate_json(row["payload"]) for row in rows]

    def get_workbench_user(self, username: str) -> WorkbenchUserRecord | None:
        with self._lock, self._connect() as connection:
            row = connection.execute(
                "SELECT payload FROM workbench_users WHERE username = ?",
                (username.strip().lower(),),
            ).fetchone()
        if not row:
            return None
        return WorkbenchUserRecord.model_validate_json(row["payload"])

    def upsert_workbench_user(self, user: WorkbenchUserRecord) -> WorkbenchUserRecord:
        stored = user.model_copy(update={"username": user.username.strip().lower(), "updated_at": utcnow()})
        with self._lock, self._connect() as connection:
            connection.execute(
                """
                INSERT OR REPLACE INTO workbench_users (
                    username, password_hash, role, enabled, display_name,
                    created_at, updated_at, last_login_at, payload
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    stored.username,
                    stored.password_hash,
                    stored.role.value,
                    1 if stored.enabled else 0,
                    stored.display_name,
                    stored.created_at.isoformat(),
                    stored.updated_at.isoformat(),
                    stored.last_login_at.isoformat() if stored.last_login_at else None,
                    stored.model_dump_json(),
                ),
            )
            connection.commit()
        return stored

    def delete_workbench_user(self, username: str) -> bool:
        with self._lock, self._connect() as connection:
            cursor = connection.execute(
                "DELETE FROM workbench_users WHERE username = ?",
                (username.strip().lower(),),
            )
            connection.commit()
        return cursor.rowcount > 0

    def list_workbench_groups(self) -> list[WorkbenchGroupRecord]:
        with self._lock, self._connect() as connection:
            rows = connection.execute(
                "SELECT payload FROM workbench_groups ORDER BY LOWER(name)"
            ).fetchall()
        return [WorkbenchGroupRecord.model_validate_json(row["payload"]) for row in rows]

    def get_workbench_group(self, name: str) -> WorkbenchGroupRecord | None:
        with self._lock, self._connect() as connection:
            row = connection.execute(
                "SELECT payload FROM workbench_groups WHERE name = ?",
                (name.strip().lower(),),
            ).fetchone()
        if not row:
            return None
        return WorkbenchGroupRecord.model_validate_json(row["payload"])

    def upsert_workbench_group(self, group: WorkbenchGroupRecord) -> WorkbenchGroupRecord:
        normalized_users = sorted({item.strip().lower() for item in group.users if item.strip()})
        stored = group.model_copy(update={"name": group.name.strip().lower(), "users": normalized_users, "updated_at": utcnow()})
        with self._lock, self._connect() as connection:
            connection.execute(
                """
                INSERT OR REPLACE INTO workbench_groups (
                    name, enabled, created_at, updated_at, payload
                )
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    stored.name,
                    1 if stored.enabled else 0,
                    stored.created_at.isoformat(),
                    stored.updated_at.isoformat(),
                    stored.model_dump_json(),
                ),
            )
            connection.commit()
        return stored

    def delete_workbench_group(self, name: str) -> bool:
        with self._lock, self._connect() as connection:
            cursor = connection.execute(
                "DELETE FROM workbench_groups WHERE name = ?",
                (name.strip().lower(),),
            )
            connection.commit()
        return cursor.rowcount > 0

    def _prune_invalid_user_server_state(self, connection: sqlite3.Connection, valid_server_ids: set[str]) -> None:
        rows = connection.execute("SELECT user_id, payload FROM user_server_state").fetchall()
        updates: list[tuple[str, str]] = []
        for row in rows:
            state = UserServerState.model_validate_json(row["payload"])
            changed = False
            if state.selected_server_id and state.selected_server_id not in valid_server_ids:
                state.selected_server_id = None
                changed = True
            if state.last_used_server_id and state.last_used_server_id not in valid_server_ids:
                state.last_used_server_id = None
                changed = True
            favorite_ids = [value for value in state.favorite_server_ids if value in valid_server_ids]
            if favorite_ids != state.favorite_server_ids:
                state.favorite_server_ids = favorite_ids
                changed = True
            if changed:
                state.updated_at = utcnow()
                updates.append((state.user_id, state.model_dump_json()))

        if updates:
            connection.executemany(
                "INSERT OR REPLACE INTO user_server_state (user_id, payload) VALUES (?, ?)",
                updates,
            )

    def _prune_invalid_user_cache(self, connection: sqlite3.Connection, valid_server_ids: set[str]) -> None:
        if not valid_server_ids:
            connection.execute("DELETE FROM user_data_cache")
            self._delete_materialized_cache_for_all_servers(connection)
            return
        placeholders = ", ".join("?" for _ in valid_server_ids)
        connection.execute(
            f"DELETE FROM user_data_cache WHERE server_id NOT IN ({placeholders})",
            tuple(valid_server_ids),
        )
        self._prune_invalid_materialized_cache(connection, valid_server_ids)

    def _prune_invalid_app_secrets(self, connection: sqlite3.Connection, valid_server_ids: set[str]) -> None:
        valid_scopes = {self._oslc_shared_scope(server_id) for server_id in valid_server_ids}
        valid_scopes.add(self._cache_ingest_scope())
        rows = connection.execute("SELECT scope FROM app_secrets").fetchall()
        invalid_scopes = [str(row["scope"]) for row in rows if str(row["scope"]) not in valid_scopes]
        if invalid_scopes:
            connection.executemany("DELETE FROM app_secrets WHERE scope = ?", [(scope,) for scope in invalid_scopes])

    def _prune_invalid_materialized_cache(self, connection: sqlite3.Connection, valid_server_ids: set[str]) -> None:
        if not valid_server_ids:
            self._delete_materialized_cache_for_all_servers(connection)
            return
        placeholders = ", ".join("?" for _ in valid_server_ids)
        for table in (
            "twc_branch_cache",
            "twc_branch_access_records",
            "twc_cached_models",
            "twc_cached_model_permissions",
            "twc_cached_elements",
            "twc_webhook_registrations",
        ):
            connection.execute(
                f"DELETE FROM {table} WHERE server_id NOT IN ({placeholders})",
                tuple(valid_server_ids),
            )

    def _delete_materialized_cache_for_server(self, connection: sqlite3.Connection, server_id: str) -> None:
        for table in (
            "twc_branch_cache",
            "twc_branch_access_records",
            "twc_cached_models",
            "twc_cached_model_permissions",
            "twc_cached_elements",
            "twc_webhook_registrations",
        ):
            connection.execute(f"DELETE FROM {table} WHERE server_id = ?", (server_id,))

    def _delete_materialized_cache_for_all_servers(self, connection: sqlite3.Connection) -> None:
        for table in (
            "twc_branch_cache",
            "twc_branch_access_records",
            "twc_cached_models",
            "twc_cached_model_permissions",
            "twc_cached_elements",
            "twc_webhook_registrations",
        ):
            connection.execute(f"DELETE FROM {table}")

    def _oslc_shared_scope(self, server_id: str) -> str:
        return f"oslc-shared:{server_id}"

    def _cache_ingest_scope(self) -> str:
        return "cache-ingest-shared"

    def list_jobs(self, owner: str | None = None) -> list[JobRecord]:
        query = "SELECT payload FROM jobs"
        params: tuple[str, ...] = ()
        if owner:
            query += " WHERE owner = ?"
            params = (owner,)

        with self._lock, self._connect() as connection:
            rows = connection.execute(query, params).fetchall()

        jobs = [JobRecord.model_validate_json(row["payload"]) for row in rows]
        return sorted(jobs, key=lambda item: item.created_at, reverse=True)

    def get_job(self, job_id: str) -> JobRecord | None:
        with self._lock, self._connect() as connection:
            row = connection.execute("SELECT payload FROM jobs WHERE id = ?", (job_id,)).fetchone()
        if not row:
            return None
        return JobRecord.model_validate_json(row["payload"])

    def upsert_job(self, job: JobRecord) -> JobRecord:
        payload = job.model_dump_json()
        with self._lock, self._connect() as connection:
            connection.execute(
                """
                INSERT OR REPLACE INTO jobs (id, job_type, status, owner, server_id, created_at, updated_at, payload)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    job.id,
                    job.job_type.value,
                    job.status.value,
                    job.owner,
                    job.server_id,
                    job.created_at.isoformat(),
                    job.updated_at.isoformat(),
                    payload,
                ),
            )
            connection.commit()
        return job

    def bulk_upsert_jobs(self, jobs: Iterable[JobRecord]) -> None:
        with self._lock, self._connect() as connection:
            connection.executemany(
                """
                INSERT OR REPLACE INTO jobs (id, job_type, status, owner, server_id, created_at, updated_at, payload)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        job.id,
                        job.job_type.value,
                        job.status.value,
                        job.owner,
                        job.server_id,
                        job.created_at.isoformat(),
                        job.updated_at.isoformat(),
                        job.model_dump_json(),
                    )
                    for job in jobs
                ],
            )
            connection.commit()

    def dump_state(self) -> dict[str, list[dict[str, object]]]:
        with self._connect() as connection:
            user_server_state = [json.loads(item["payload"]) for item in connection.execute("SELECT payload FROM user_server_state").fetchall()]
            user_data_cache = [
                {
                    "user_id": item["user_id"],
                    "server_id": item["server_id"],
                    "cache_key": item["cache_key"],
                    "updated_at": item["updated_at"],
                }
                for item in connection.execute("SELECT user_id, server_id, cache_key, updated_at FROM user_data_cache").fetchall()
            ]
        return {
            "servers": [json.loads(item.model_dump_json()) for item in self.list_servers(include_disabled=True)],
            "user_server_state": user_server_state,
            "user_data_cache": user_data_cache,
            "jobs": [json.loads(item.model_dump_json()) for item in self.list_jobs()],
        }
