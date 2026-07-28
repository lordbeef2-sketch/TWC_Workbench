from __future__ import annotations

import base64
import hashlib
import json
import threading
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import uuid4

from cryptography.fernet import Fernet
from redis import Redis

from app.models.domain import (
    AuthorizationContext,
    Bookmark,
    OSLCConsumerCredentials,
    OSLCTokenBundle,
    SavedSearch,
    ServerProfile,
    SessionData,
    SessionPreferences,
    SessionSnapshot,
    TokenBundle,
    UserContext,
)
from app.settings.config import Settings


class CredentialCipher:
    def __init__(self, secret: str) -> None:
        digest = hashlib.sha256(secret.encode("utf-8")).digest()
        key = base64.urlsafe_b64encode(digest)
        self._fernet = Fernet(key)

    def encrypt_raw(self, payload: bytes) -> str:
        return self._fernet.encrypt(payload).decode("utf-8")

    def decrypt_raw(self, encrypted_value: str) -> bytes:
        return self._fernet.decrypt(encrypted_value.encode("utf-8"))

    def encrypt(self, credentials: TokenBundle) -> str:
        payload = credentials.model_dump_json().encode("utf-8")
        return self.encrypt_raw(payload)

    def decrypt(self, encrypted_credentials: str) -> TokenBundle:
        raw = self.decrypt_raw(encrypted_credentials)
        return TokenBundle.model_validate_json(raw)


class SessionStore:
    def get(self, session_id: str) -> SessionData | None:
        raise NotImplementedError

    def set(self, session: SessionData) -> None:
        raise NotImplementedError

    def delete(self, session_id: str) -> None:
        raise NotImplementedError


class InMemorySessionStore(SessionStore):
    def __init__(self) -> None:
        self._sessions: dict[str, SessionData] = {}
        self._lock = threading.RLock()

    def get(self, session_id: str) -> SessionData | None:
        with self._lock:
            session = self._sessions.get(session_id)
            if session and session.expires_at > datetime.now(UTC):
                return session
            if session:
                self._sessions.pop(session_id, None)
            return None

    def set(self, session: SessionData) -> None:
        with self._lock:
            self._sessions[session.session_id] = session

    def delete(self, session_id: str) -> None:
        with self._lock:
            self._sessions.pop(session_id, None)


class RedisSessionStore(SessionStore):
    def __init__(self, redis_url: str) -> None:
        self._redis = Redis.from_url(redis_url, decode_responses=True)

    def get(self, session_id: str) -> SessionData | None:
        payload = self._redis.get(f"twc:session:{session_id}")
        if not payload:
            return None
        return SessionData.model_validate_json(payload)

    def set(self, session: SessionData) -> None:
        ttl_seconds = max(int((session.expires_at - datetime.now(UTC)).total_seconds()), 1)
        self._redis.setex(f"twc:session:{session.session_id}", ttl_seconds, session.model_dump_json())

    def delete(self, session_id: str) -> None:
        self._redis.delete(f"twc:session:{session_id}")


class SessionManager:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.cipher = CredentialCipher(settings.session_secret)
        self.store: SessionStore = (
            RedisSessionStore(settings.redis_url) if settings.redis_url else InMemorySessionStore()
        )

    def create_session(
        self,
        server: ServerProfile,
        user: UserContext,
        authorization_context: AuthorizationContext,
        credentials: TokenBundle,
        capabilities: Any,
    ) -> SessionData:
        now = datetime.now(UTC)
        session = SessionData(
            session_id=uuid4().hex,
            server=server,
            user=user,
            authorization_context=authorization_context,
            encrypted_credentials=self.cipher.encrypt(credentials),
            capabilities=capabilities,
            created_at=now,
            expires_at=now + timedelta(minutes=self.settings.session_ttl_minutes),
        )
        self.store.set(session)
        return session

    def get_session(self, session_id: str | None) -> SessionData | None:
        if not session_id:
            return None
        session = self.store.get(session_id)
        if not session:
            return None
        if session.expires_at <= datetime.now(UTC):
            self.store.delete(session_id)
            return None

        session.expires_at = datetime.now(UTC) + timedelta(minutes=self.settings.session_ttl_minutes)
        self.store.set(session)
        return session

    def destroy_session(self, session_id: str) -> None:
        self.store.delete(session_id)

    def get_credentials(self, session: SessionData) -> TokenBundle:
        return self.cipher.decrypt(session.encrypted_credentials)

    def update_credentials(self, session: SessionData, credentials: TokenBundle) -> SessionData:
        session.encrypted_credentials = self.cipher.encrypt(credentials)
        self.store.set(session)
        return session

    def get_oslc_credentials(self, session: SessionData) -> OSLCTokenBundle | None:
        if not session.encrypted_oslc_credentials:
            return None
        raw = self.cipher.decrypt_raw(session.encrypted_oslc_credentials)
        return OSLCTokenBundle.model_validate_json(raw)

    def set_oslc_credentials(self, session: SessionData, credentials: OSLCTokenBundle) -> SessionData:
        session.encrypted_oslc_credentials = self.cipher.encrypt_raw(credentials.model_dump_json().encode("utf-8"))
        self.store.set(session)
        return session

    def clear_oslc_credentials(self, session: SessionData) -> SessionData:
        session.encrypted_oslc_credentials = None
        self.store.set(session)
        return session

    def get_oslc_consumer_credentials(self, session: SessionData) -> OSLCConsumerCredentials | None:
        if not session.encrypted_oslc_consumer_credentials:
            return None
        raw = self.cipher.decrypt_raw(session.encrypted_oslc_consumer_credentials)
        return OSLCConsumerCredentials.model_validate_json(raw)

    def set_oslc_consumer_credentials(self, session: SessionData, credentials: OSLCConsumerCredentials) -> SessionData:
        session.encrypted_oslc_consumer_credentials = self.cipher.encrypt_raw(credentials.model_dump_json().encode("utf-8"))
        self.store.set(session)
        return session

    def clear_oslc_consumer_credentials(self, session: SessionData) -> SessionData:
        session.encrypted_oslc_consumer_credentials = None
        self.store.set(session)
        return session

    def validate_csrf(self, session: SessionData, token: str | None) -> bool:
        return bool(token and token == session.csrf_token)

    def snapshot(self, session: SessionData | None) -> SessionSnapshot:
        if not session:
            return SessionSnapshot(authenticated=False)
        return SessionSnapshot(
            authenticated=True,
            session_id=session.session_id,
            csrf_token=session.csrf_token,
            user=session.user,
            server=session.server,
            can_manage_server_presets=session.authorization_context.can_manage_server_presets,
            can_manage_groups=session.authorization_context.can_manage_groups,
            capabilities=session.capabilities,
            preferences=session.preferences,
            bookmarks=session.bookmarks,
            saved_searches=session.saved_searches,
            recent_items=session.recent_items,
        )

    def update_capabilities(self, session: SessionData, capabilities: Any) -> SessionData:
        session.capabilities = capabilities
        self.store.set(session)
        return session

    def update_preferences(self, session: SessionData, preferences: SessionPreferences) -> SessionData:
        session.preferences = preferences
        self.store.set(session)
        return session

    def add_recent_item(self, session: SessionData, bookmark: Bookmark) -> SessionData:
        without_duplicate = [
            item
            for item in session.recent_items
            if (item.item_id, item.project_id, item.branch_id) != (bookmark.item_id, bookmark.project_id, bookmark.branch_id)
        ]
        session.recent_items = [bookmark, *without_duplicate][:10]
        self.store.set(session)
        return session

    def upsert_bookmark(self, session: SessionData, bookmark: Bookmark) -> SessionData:
        without_duplicate = [
            item
            for item in session.bookmarks
            if (item.item_id, item.project_id, item.branch_id) != (bookmark.item_id, bookmark.project_id, bookmark.branch_id)
        ]
        session.bookmarks = [bookmark, *without_duplicate]
        self.store.set(session)
        return session

    def delete_bookmark(self, session: SessionData, bookmark_id: str) -> SessionData:
        session.bookmarks = [item for item in session.bookmarks if item.id != bookmark_id]
        self.store.set(session)
        return session

    def upsert_saved_search(self, session: SessionData, search: SavedSearch) -> SessionData:
        session.saved_searches = [item for item in session.saved_searches if item.id != search.id] + [search]
        self.store.set(session)
        return session

    def delete_saved_search(self, session: SessionData, search_id: str) -> SessionData:
        session.saved_searches = [item for item in session.saved_searches if item.id != search_id]
        self.store.set(session)
        return session

    def export_state(self) -> dict[str, Any]:
        if isinstance(self.store, InMemorySessionStore):
            return json.loads(
                json.dumps(
                    {
                        "sessions": [json.loads(item.model_dump_json()) for item in self.store._sessions.values()],
                    }
                )
            )
        return {"sessions": "stored-in-redis"}
