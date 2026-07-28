from __future__ import annotations

import json
import re
from collections.abc import Mapping
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.models.domain import PresetServerDefinition


LEGACY_TWC_AUTH_PATHS = {
    "/osmc/authen/login",
    "/osmc/login.html",
    "/authentication/saml2/sso/tssd-twc2022x",
    "/authentication/saml2/sso/tssd-twc2024x",
}


class TWCAuthServerOverride(BaseModel):
    authorize_url: str | None = None
    token_url: str | None = None
    login_path: str | None = None
    login_port: int | None = None
    token_path: str | None = None
    client_id: str | None = None
    client_secret: str | None = None
    scope: str | None = None
    return_url_parameter: str | None = None
    oslc_rootservices_url: str | None = None
    oslc_port: int | None = None
    oslc_base_path: str | None = None
    oslc_consumer_key: str | None = None
    oslc_consumer_secret: str | None = None

    @model_validator(mode="before")
    @classmethod
    def normalize_authserver_property_names(cls, raw: object) -> object:
        if not isinstance(raw, dict):
            return raw
        payload = dict(raw)
        alias_groups = {
            "authorize_url": ("authorization_endpoint", "authentication_authorize_url"),
            "token_url": ("token_endpoint", "authentication_token_url"),
            "client_id": (
                "authentication.client.id",
                "authentication.client.ids",
                "authentication_client_id",
                "authentication_client_ids",
                "client_ids",
            ),
            "client_secret": (
                "authentication.client.secret",
                "authentication_client_secret",
            ),
            "oslc_consumer_key": (
                "oauth_consumer_key",
                "oauth.consumer.key",
                "consumer_key",
            ),
            "oslc_consumer_secret": (
                "oauth_consumer_secret",
                "oauth.consumer.secret",
                "consumer_secret",
            ),
        }
        for target, aliases in alias_groups.items():
            if payload.get(target):
                continue
            for alias in aliases:
                if alias not in payload:
                    continue
                payload[target] = _first_config_value(payload[alias])
                break
        return payload

    @field_validator(
        "authorize_url",
        "token_url",
        "login_path",
        "token_path",
        "client_id",
        "client_secret",
        "scope",
        "return_url_parameter",
        "oslc_rootservices_url",
        "oslc_base_path",
        "oslc_consumer_key",
        "oslc_consumer_secret",
        mode="before",
    )
    @classmethod
    def blank_strings_to_none(cls, value: object) -> object:
        if isinstance(value, str):
            text = value.strip()
            if not text:
                return None
            if text.lower() in LEGACY_TWC_AUTH_PATHS:
                return "/authentication/authorize"
            return text
        return value

    @field_validator("login_port", mode="before")
    @classmethod
    def blank_login_port_to_none(cls, value: object) -> object:
        if isinstance(value, str) and not value.strip():
            return None
        return value

    @field_validator("oslc_port", mode="before")
    @classmethod
    def blank_oslc_port_to_none(cls, value: object) -> object:
        if isinstance(value, str) and not value.strip():
            return None
        return value


class PluginOnlyCacheTargetRule(BaseModel):
    project_ids: list[str] = Field(default_factory=list)
    branch_ids: dict[str, list[str]] = Field(default_factory=dict)

    @field_validator("project_ids", mode="before")
    @classmethod
    def normalize_project_ids(cls, value: object) -> object:
        if value is None:
            return []
        if isinstance(value, str):
            return [item.strip() for item in value.split(",") if item.strip()]
        return value

    @field_validator("branch_ids", mode="before")
    @classmethod
    def normalize_branch_ids(cls, value: object) -> object:
        if value is None:
            return {}
        return value


class Settings(BaseSettings):
    app_name: str = "TWC Workbench"
    environment: str = "development"
    app_origin: str | None = None
    host: str = "0.0.0.0"
    port: int = 8000
    api_prefix: str = "/api"
    frontend_origin: str = "http://localhost:5173"
    allowed_origins: list[str] = Field(default_factory=lambda: ["http://localhost:5173", "http://localhost:8000"])
    data_dir: Path = Path("./data")
    database_path: Path | None = None
    export_dir: Path | None = None
    session_secret: str = "replace-this-in-production-with-32-random-bytes"
    session_cookie_name: str = "twc_session"
    pending_server_cookie_name: str = "twc_pending_server"
    auth_state_cookie_name: str = "twc_auth_state"
    twc_preset_servers: list[PresetServerDefinition] = Field(default_factory=list)
    twc_auth_client_id: str | None = None
    twc_auth_client_secret: str | None = None
    twc_authentication_client_id: str | None = None
    twc_authentication_client_ids: str | None = None
    twc_authentication_client_secret: str | None = None
    twc_auth_callback_path: str | None = None
    twc_webhook_callback_path: str | None = None
    twc_auth_scope: str = "openid"
    twc_auth_state_ttl_minutes: int = 15
    twc_auth_server_overrides: dict[str, TWCAuthServerOverride] = Field(default_factory=dict)
    twc_saml_authorize_url: str | None = None
    twc_saml_login_path: str = "/authentication/authorize"
    twc_saml_login_port: int | None = 8443
    twc_saml_token_url: str | None = None
    twc_saml_token_path: str = "/authentication/api/token"
    twc_saml_return_url_parameter: str = "redirect_uri"
    oslc_auth_state_cookie_name: str = "twc_oslc_auth_state"
    twc_oslc_rootservices_url: str | None = None
    twc_oslc_port: int | None = 8443
    twc_oslc_base_path: str = "/oslc/api"
    twc_oslc_consumer_key: str | None = None
    twc_oslc_consumer_secret: str | None = None
    twc_oslc_callback_path: str | None = None
    workbench_user_management_mode: Literal["local", "twc"] = "local"
    workbench_default_admin_username: str = "admin"
    workbench_default_admin_password: str = "admin"
    session_ttl_minutes: int = 480
    secure_cookies: bool = False
    csrf_header_name: str = "X-CSRF-Token"
    upstream_auth_cookie_names: list[str] = Field(default_factory=list)
    upstream_user_headers: list[str] = Field(
        default_factory=lambda: [
            "X-Forwarded-User",
            "Remote-User",
            "X-MS-CLIENT-PRINCIPAL-NAME",
            "X-Authenticated-User",
        ]
    )
    upstream_access_token_headers: list[str] = Field(
        default_factory=lambda: [
            "X-Forwarded-Access-Token",
            "X-Access-Token",
            "Authorization",
        ]
    )
    upstream_group_headers: list[str] = Field(
        default_factory=lambda: [
            "X-Forwarded-Groups",
            "X-Groups",
            "X-MS-CLIENT-PRINCIPAL-GROUPS",
            "X-Authenticated-Groups",
        ]
    )
    upstream_role_headers: list[str] = Field(
        default_factory=lambda: [
            "X-Forwarded-Roles",
            "X-Roles",
            "X-MS-CLIENT-PRINCIPAL-ROLES",
            "X-Authenticated-Roles",
        ]
    )
    admin_users: list[str] = Field(default_factory=list)
    log_level: str = "INFO"
    redis_url: str | None = None
    publisher_mode: str = "local"
    publisher_command: str | None = None
    publisher_webhook_url: str | None = None
    cache_ingest_tokens: list[str] = Field(default_factory=list)
    cache_api_tokens: dict[str, str] = Field(default_factory=dict)
    twc_plugin_only_cache_targets: dict[str, PluginOnlyCacheTargetRule] = Field(default_factory=dict)
    root_path: str = ""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    @field_validator(
        "database_path",
        "export_dir",
        "app_origin",
        "twc_auth_client_id",
        "twc_auth_client_secret",
        "twc_authentication_client_id",
        "twc_authentication_client_ids",
        "twc_authentication_client_secret",
        "twc_auth_callback_path",
        "twc_webhook_callback_path",
        "twc_saml_authorize_url",
        "twc_saml_token_url",
        "twc_oslc_rootservices_url",
        "twc_oslc_consumer_key",
        "twc_oslc_consumer_secret",
        "twc_oslc_callback_path",
        mode="before",
    )
    @classmethod
    def blank_paths_to_none(cls, value: object) -> object:
        if isinstance(value, str) and not value.strip():
            return None
        return value

    @field_validator("twc_saml_login_path", mode="before")
    @classmethod
    def blank_login_path_to_default(cls, value: object) -> object:
        if isinstance(value, str) and not value.strip():
            return "/authentication/authorize"
        if isinstance(value, str) and value.strip().lower() in LEGACY_TWC_AUTH_PATHS:
            return "/authentication/authorize"
        return value

    @field_validator("twc_auth_scope", mode="before")
    @classmethod
    def blank_auth_scope_to_default(cls, value: object) -> object:
        if isinstance(value, str) and not value.strip():
            return "openid"
        return value

    @field_validator("twc_saml_token_path", mode="before")
    @classmethod
    def blank_token_path_to_default(cls, value: object) -> object:
        if isinstance(value, str) and not value.strip():
            return "/authentication/api/token"
        return value

    @field_validator("twc_saml_login_port", mode="before")
    @classmethod
    def blank_login_port_to_none(cls, value: object) -> object:
        if isinstance(value, str) and not value.strip():
            return None
        return value

    @field_validator("twc_oslc_port", mode="before")
    @classmethod
    def blank_oslc_port_to_none(cls, value: object) -> object:
        if isinstance(value, str) and not value.strip():
            return None
        return value

    @field_validator("workbench_user_management_mode", mode="before")
    @classmethod
    def normalize_workbench_user_management_mode(cls, value: object) -> str:
        if value is None:
            return "local"
        text = str(value).strip().lower().replace("-", "_")
        if not text:
            return "local"
        aliases = {
            "local": "local",
            "workbench": "local",
            "local_users": "local",
            "local_user_management": "local",
            "twc": "twc",
            "teamwork_cloud": "twc",
            "twc_users": "twc",
            "twc_user_management": "twc",
        }
        if text not in aliases:
            raise ValueError("WORKBENCH_USER_MANAGEMENT_MODE must be either 'local' or 'twc'")
        return aliases[text]

    @field_validator("workbench_default_admin_username", "workbench_default_admin_password", mode="before")
    @classmethod
    def normalize_workbench_default_admin(cls, value: object) -> str:
        if value is None:
            return ""
        return str(value).strip()

    @field_validator("twc_saml_return_url_parameter", mode="before")
    @classmethod
    def blank_return_parameter_to_default(cls, value: object) -> object:
        if isinstance(value, str) and not value.strip():
            return "redirect_uri"
        return value

    @field_validator("twc_preset_servers", mode="before")
    @classmethod
    def parse_twc_preset_servers(cls, value: object) -> object:
        if value is None:
            return []
        if isinstance(value, str):
            text = value.strip()
            if not text:
                return []
            try:
                payload = json.loads(text)
            except json.JSONDecodeError as exc:
                raise ValueError("TWC_PRESET_SERVERS must be a JSON array of preset server objects") from exc
            if not isinstance(payload, list):
                raise ValueError("TWC_PRESET_SERVERS must be a JSON array of preset server objects")
            return payload
        return value

    @field_validator("twc_auth_server_overrides", mode="before")
    @classmethod
    def parse_twc_auth_server_overrides(cls, value: object) -> object:
        if value is None:
            return {}
        if isinstance(value, str):
            text = value.strip()
            if not text:
                return {}
            try:
                payload = json.loads(text)
            except json.JSONDecodeError as exc:
                raise ValueError("TWC_AUTH_SERVER_OVERRIDES must be a JSON object keyed by preset server id") from exc
            if not isinstance(payload, dict):
                raise ValueError("TWC_AUTH_SERVER_OVERRIDES must be a JSON object keyed by preset server id")
            return payload
        return value

    @field_validator("admin_users", mode="before")
    @classmethod
    def parse_admin_users(cls, value: object) -> object:
        if value is None:
            return []
        if isinstance(value, str):
            text = value.strip()
            if not text:
                return []
            if text.startswith("["):
                try:
                    payload = json.loads(text)
                except json.JSONDecodeError as exc:
                    raise ValueError("ADMIN_USERS must be a JSON array or comma-separated list") from exc
                if not isinstance(payload, list):
                    raise ValueError("ADMIN_USERS must be a JSON array or comma-separated list")
                return payload
            return [item.strip() for item in text.split(",") if item.strip()]
        return value

    @field_validator("cache_ingest_tokens", mode="before")
    @classmethod
    def parse_cache_ingest_tokens(cls, value: object) -> object:
        if value is None:
            return []
        if isinstance(value, str):
            text = value.strip()
            if not text:
                return []
            if text.startswith("["):
                try:
                    payload = json.loads(text)
                except json.JSONDecodeError as exc:
                    raise ValueError("CACHE_INGEST_TOKENS must be a JSON array or comma-separated list") from exc
                if not isinstance(payload, list):
                    raise ValueError("CACHE_INGEST_TOKENS must be a JSON array or comma-separated list")
                return payload
            return [item.strip() for item in text.split(",") if item.strip()]
        return value

    @field_validator("cache_api_tokens", mode="before")
    @classmethod
    def parse_cache_api_tokens(cls, value: object) -> object:
        if value is None:
            return {}
        if isinstance(value, str):
            text = value.strip()
            if not text:
                return {}
            try:
                payload = json.loads(text)
            except json.JSONDecodeError as exc:
                raise ValueError("CACHE_API_TOKENS must be a JSON object mapping bearer token to username") from exc
            if not isinstance(payload, dict):
                raise ValueError("CACHE_API_TOKENS must be a JSON object mapping bearer token to username")
            return payload
        return value

    @field_validator("twc_plugin_only_cache_targets", mode="before")
    @classmethod
    def parse_twc_plugin_only_cache_targets(cls, value: object) -> object:
        if value is None:
            return {}
        if isinstance(value, str):
            text = value.strip()
            if not text:
                return {}
            try:
                payload = json.loads(text)
            except json.JSONDecodeError as exc:
                raise ValueError("TWC_PLUGIN_ONLY_CACHE_TARGETS must be a JSON object keyed by server id") from exc
            if not isinstance(payload, dict):
                raise ValueError("TWC_PLUGIN_ONLY_CACHE_TARGETS must be a JSON object keyed by server id")
            return payload
        return value

    @field_validator("twc_preset_servers")
    @classmethod
    def validate_unique_twc_preset_server_ids(
        cls,
        value: list[PresetServerDefinition],
    ) -> list[PresetServerDefinition]:
        ids: set[str] = set()
        for item in value:
            if item.id in ids:
                raise ValueError(f"TWC_PRESET_SERVERS contains a duplicate id: {item.id}")
            ids.add(item.id)
        return value

    @property
    def resolved_data_dir(self) -> Path:
        return self.data_dir.resolve()

    @property
    def resolved_database_path(self) -> Path:
        return (self.database_path or self.resolved_data_dir / "twc_workbench.sqlite3").resolve()

    @property
    def resolved_export_dir(self) -> Path:
        return (self.export_dir or self.resolved_data_dir / "exports").resolve()

    @property
    def resolved_app_origin(self) -> str:
        origin = (self.app_origin or self.frontend_origin).strip().rstrip("/")
        return origin

    @property
    def resolved_twc_auth_callback_path(self) -> str:
        path = self.twc_auth_callback_path or f"{self.api_prefix.rstrip('/')}/auth/callback"
        normalized = path.strip()
        if not normalized.startswith("/"):
            normalized = f"/{normalized}"
        return normalized

    @property
    def resolved_twc_auth_callback_url(self) -> str:
        return f"{self.resolved_app_origin}{self.resolved_twc_auth_callback_path}"

    @property
    def resolved_twc_webhook_callback_path(self) -> str:
        path = self.twc_webhook_callback_path or f"{self.api_prefix.rstrip('/')}/workspace/model-cache/webhooks"
        normalized = path.strip()
        if not normalized.startswith("/"):
            normalized = f"/{normalized}"
        return normalized

    @property
    def resolved_twc_webhook_callback_url(self) -> str:
        return f"{self.resolved_app_origin}{self.resolved_twc_webhook_callback_path}"

    @property
    def resolved_twc_oslc_callback_path(self) -> str:
        path = self.twc_oslc_callback_path or f"{self.api_prefix.rstrip('/')}/auth/oslc/callback"
        normalized = path.strip()
        if not normalized.startswith("/"):
            normalized = f"/{normalized}"
        return normalized

    @property
    def resolved_twc_oslc_callback_url(self) -> str:
        return f"{self.resolved_app_origin}{self.resolved_twc_oslc_callback_path}"

    @property
    def resolved_twc_auth_client_id(self) -> str | None:
        return _first_config_value(
            self.twc_auth_client_id,
            self.twc_authentication_client_id,
            self.twc_authentication_client_ids,
        )

    @property
    def resolved_twc_auth_client_secret(self) -> str | None:
        return _first_config_value(self.twc_auth_client_secret, self.twc_authentication_client_secret)

    @property
    def resolved_twc_oslc_consumer_key(self) -> str | None:
        return _first_config_value(self.twc_oslc_consumer_key)

    @property
    def resolved_twc_oslc_consumer_secret(self) -> str | None:
        return _first_config_value(self.twc_oslc_consumer_secret)

    def twc_auth_override_for_server(self, server_id: str) -> TWCAuthServerOverride | None:
        return self.twc_auth_server_overrides.get(server_id) or self.twc_auth_server_overrides.get("*")

    def plugin_only_cache_rule_for_server(self, server_id: str) -> PluginOnlyCacheTargetRule | None:
        return self.twc_plugin_only_cache_targets.get(server_id) or self.twc_plugin_only_cache_targets.get("*")

    def extract_upstream_auth_cookies(self, cookies: Mapping[str, str]) -> dict[str, str]:
        allowed = {name.strip() for name in self.upstream_auth_cookie_names if name.strip()}
        if allowed:
            return {name: value for name, value in cookies.items() if name in allowed}
        excluded = {self.session_cookie_name, self.pending_server_cookie_name, self.auth_state_cookie_name}
        return {name: value for name, value in cookies.items() if name not in excluded}

    def extract_upstream_username(self, headers: Mapping[str, str]) -> str | None:
        for header_name in self.upstream_user_headers:
            value = headers.get(header_name)
            if value:
                return value.strip()
        return None

    def extract_upstream_access_token(self, headers: Mapping[str, str]) -> str | None:
        for header_name in self.upstream_access_token_headers:
            value = headers.get(header_name)
            if not value:
                continue
            token = value.strip()
            if not token:
                continue
            if header_name.lower() == "authorization":
                lower_token = token.lower()
                if lower_token.startswith("token "):
                    token = token[6:].strip()
                elif lower_token.startswith("bearer "):
                    token = token[7:].strip()
            return token or None
        return None

    def extract_upstream_groups(self, headers: Mapping[str, str]) -> list[str]:
        return self._extract_claim_values(headers, self.upstream_group_headers)

    def extract_upstream_roles(self, headers: Mapping[str, str]) -> list[str]:
        return self._extract_claim_values(headers, self.upstream_role_headers)

    def _extract_claim_values(self, headers: Mapping[str, str], configured_headers: list[str]) -> list[str]:
        values: list[str] = []
        for header_name in configured_headers:
            raw_value = headers.get(header_name)
            if not raw_value:
                continue
            values.extend(self._split_claim_values(raw_value))
        return list(dict.fromkeys(values))

    def _split_claim_values(self, raw_value: str) -> list[str]:
        text = raw_value.strip()
        if not text:
            return []

        if text.startswith("["):
            try:
                payload = json.loads(text)
            except json.JSONDecodeError:
                payload = None
            if isinstance(payload, list):
                return [item.strip() for item in payload if isinstance(item, str) and item.strip()]

        return [item.strip() for item in re.split(r"[;,|]", text) if item.strip()]


def _first_config_value(*values: object) -> str | None:
    for value in values:
        if isinstance(value, str):
            for item in re.split(r"[;,]", value):
                candidate = item.strip()
                if candidate:
                    return candidate
        elif isinstance(value, list):
            for item in value:
                if isinstance(item, str) and item.strip():
                    return item.strip()
        elif value is not None:
            candidate = str(value).strip()
            if candidate:
                return candidate
    return None


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    settings = Settings()
    settings.resolved_data_dir.mkdir(parents=True, exist_ok=True)
    settings.resolved_export_dir.mkdir(parents=True, exist_ok=True)
    settings.resolved_database_path.parent.mkdir(parents=True, exist_ok=True)
    return settings
