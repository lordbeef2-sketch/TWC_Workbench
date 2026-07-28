from __future__ import annotations

from datetime import UTC, datetime
from enum import Enum
from typing import Any, Literal
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


def utcnow() -> datetime:
    return datetime.now(UTC)


class TWCVersion(str, Enum):
    AUTO = "auto"
    V2022X = "2022x"
    V2024X = "2024x"


class CapabilityState(str, Enum):
    READY = "ready"
    RESTRICTED = "restricted"
    NOT_AVAILABLE = "not_available"
    UNKNOWN = "unknown"


class JobType(str, Enum):
    SIMULATION = "simulation"
    PUBLISH = "publish"
    EXPORT = "export"
    MODEL_CACHE = "model_cache"


class JobStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELLED = "cancelled"


class ThemeMode(str, Enum):
    LIGHT = "light"
    DARK = "dark"
    SYSTEM = "system"


class ServerProfileBase(BaseModel):
    name: str
    base_url: str
    version: TWCVersion = TWCVersion.V2022X
    verify_tls: bool = True
    ca_bundle_path: str | None = None
    enabled: bool = True
    display_order: int = Field(default=0, ge=0)

    @model_validator(mode="before")
    @classmethod
    def normalize_legacy_auth_fields(cls, raw: object) -> object:
        if not isinstance(raw, dict):
            return raw
        payload = dict(raw)
        payload.pop("auth_mode", None)
        payload.pop("auth_url", None)
        payload.pop("client_id", None)
        payload.pop("callback_url", None)
        return payload

    @field_validator("name", "base_url", "ca_bundle_path", mode="before")
    @classmethod
    def empty_string_to_none(cls, value: object) -> object:
        if isinstance(value, str):
            value = value.strip()
            return value or None
        return value


class ServerProfileCreate(ServerProfileBase):
    pass


class ServerProfileUpdate(BaseModel):
    name: str | None = None
    base_url: str | None = None
    version: TWCVersion | None = None
    verify_tls: bool | None = None
    ca_bundle_path: str | None = None
    enabled: bool | None = None
    display_order: int | None = Field(default=None, ge=0)

    @model_validator(mode="before")
    @classmethod
    def normalize_legacy_auth_fields(cls, raw: object) -> object:
        if not isinstance(raw, dict):
            return raw
        payload = dict(raw)
        payload.pop("auth_mode", None)
        payload.pop("auth_url", None)
        payload.pop("client_id", None)
        payload.pop("callback_url", None)
        return payload

    @field_validator("name", "base_url", "ca_bundle_path", mode="before")
    @classmethod
    def empty_string_to_none_update(cls, value: object) -> object:
        if isinstance(value, str):
            value = value.strip()
            return value or None
        return value


class ServerProfile(ServerProfileBase):
    id: str = Field(default_factory=lambda: uuid4().hex)
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


class PresetServerDefinition(ServerProfileBase):
    id: str


class ServerProfileReorderRequest(BaseModel):
    server_ids: list[str] = Field(default_factory=list)


class UserServerState(BaseModel):
    user_id: str
    selected_server_id: str | None = None
    last_used_server_id: str | None = None
    favorite_server_ids: list[str] = Field(default_factory=list)
    updated_at: datetime = Field(default_factory=utcnow)


class AuthorizationContext(BaseModel):
    roles: list[str] = Field(default_factory=list)
    groups: list[str] = Field(default_factory=list)
    source: str = "authenticated-user-default"
    can_manage_server_presets: bool = False
    can_manage_groups: bool = False


class ServerHealth(BaseModel):
    server_id: str
    status: Literal["healthy", "degraded", "unreachable"]
    version_hint: str | None = None
    response_time_ms: int | None = None
    checks: dict[str, bool] = Field(default_factory=dict)
    message: str = ""


class UserContext(BaseModel):
    preferred_username: str
    server_id: str
    server_name: str
    auth_source: Literal["twc", "workbench-local"] = "twc"


class Capability(BaseModel):
    name: str
    state: CapabilityState
    reason: str = ""
    source: str = "probe"
    detected_at: datetime = Field(default_factory=utcnow)


class CapabilitySummary(BaseModel):
    detected_version: str
    reachable_endpoints: dict[str, bool] = Field(default_factory=dict)
    capabilities: dict[str, Capability] = Field(default_factory=dict)
    detected_at: datetime = Field(default_factory=utcnow)


class SessionPreferences(BaseModel):
    theme_mode: ThemeMode = ThemeMode.SYSTEM
    font_scale: float = 1.0
    request_timeout_seconds: int = 30
    live_log_poll_interval_ms: int = 2500
    presentation_font_scale: float = 1.2
    compact_ui: bool = True
    show_hidden_packages_in_tree: bool = False
    item_detail_view_mode: Literal["standard", "expert", "all"] = "standard"


class Bookmark(BaseModel):
    id: str = Field(default_factory=lambda: uuid4().hex)
    title: str
    item_id: str
    item_type: str
    path: str = ""
    project_id: str | None = None
    branch_id: str | None = None


class SavedSearch(BaseModel):
    id: str = Field(default_factory=lambda: uuid4().hex)
    name: str
    query: str
    filters: dict[str, Any] = Field(default_factory=dict)


class TokenBundle(BaseModel):
    access_token: str | None = None
    refresh_token: str | None = None
    id_token: str | None = None
    token_type: str = "Token"
    scope: str | None = None
    expires_at: datetime | None = None
    session_cookies: dict[str, str] = Field(default_factory=dict)
    upstream_user: str | None = None


class OSLCTokenBundle(BaseModel):
    access_token: str
    access_token_secret: str
    consumer_key: str
    consumer_secret: str | None = None
    rootservices_url: str
    request_token_url: str
    authorize_url: str
    access_token_url: str
    service_provider_catalog_url: str | None = None
    request_consumer_key_url: str | None = None
    configuration_management_service_providers_url: str | None = None
    acquired_at: datetime = Field(default_factory=utcnow)


class OSLCConsumerCredentials(BaseModel):
    consumer_key: str
    consumer_secret: str
    source: Literal["config", "session"] = "session"
    acquired_at: datetime = Field(default_factory=utcnow)


class TokenLoginRequest(BaseModel):
    server_id: str
    token: str


class WorkbenchLocalLoginRequest(BaseModel):
    server_id: str
    username: str
    password: str

    @field_validator("server_id", "username", "password", mode="before")
    @classmethod
    def normalize_login_fields(cls, value: object) -> str:
        if value is None:
            return ""
        if isinstance(value, str):
            return value.strip()
        return str(value).strip()


class WorkbenchAuthSettings(BaseModel):
    user_management_mode: Literal["local", "twc"] = "local"
    local_users_enabled: bool = True
    twc_redirect_enabled: bool = True
    twc_token_enabled: bool = True


class WorkbenchAuthSettingsUpdate(BaseModel):
    user_management_mode: Literal["local", "twc"] | None = None
    local_users_enabled: bool | None = None
    twc_redirect_enabled: bool | None = None
    twc_token_enabled: bool | None = None


class WorkbenchUserRole(str, Enum):
    USER = "user"
    GROUP_MANAGER = "group_manager"
    ADMIN = "admin"


class WorkbenchUserRecord(BaseModel):
    username: str
    password_hash: str
    role: WorkbenchUserRole = WorkbenchUserRole.USER
    enabled: bool = True
    display_name: str = ""
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)
    last_login_at: datetime | None = None
    password_change_required: bool = False


class WorkbenchUserSummary(BaseModel):
    username: str
    role: WorkbenchUserRole
    enabled: bool
    display_name: str = ""
    created_at: datetime
    updated_at: datetime
    last_login_at: datetime | None = None
    accessible_project_count: int = 0
    accessible_branch_count: int = 0
    password_change_required: bool = False


class WorkbenchUserCreateRequest(BaseModel):
    username: str
    password: str
    role: WorkbenchUserRole = WorkbenchUserRole.USER
    enabled: bool = True
    display_name: str = ""

    @field_validator("username", "password", "display_name", mode="before")
    @classmethod
    def normalize_user_create_fields(cls, value: object) -> str:
        if value is None:
            return ""
        if isinstance(value, str):
            return value.strip()
        return str(value).strip()


class WorkbenchUserUpdateRequest(BaseModel):
    password: str | None = None
    role: WorkbenchUserRole | None = None
    enabled: bool | None = None
    display_name: str | None = None

    @field_validator("password", "display_name", mode="before")
    @classmethod
    def normalize_user_update_fields(cls, value: object) -> object:
        if value is None:
            return None
        if isinstance(value, str):
            return value.strip()
        return str(value).strip()


class WorkbenchGroupRecord(BaseModel):
    name: str
    description: str = ""
    users: list[str] = Field(default_factory=list)
    enabled: bool = True
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


class WorkbenchGroupSummary(BaseModel):
    name: str
    description: str = ""
    users: list[str] = Field(default_factory=list)
    enabled: bool = True
    created_at: datetime
    updated_at: datetime


class WorkbenchGroupCreateRequest(BaseModel):
    name: str
    description: str = ""
    users: list[str] = Field(default_factory=list)
    enabled: bool = True

    @field_validator("name", "description", mode="before")
    @classmethod
    def normalize_group_create_fields(cls, value: object) -> str:
        if value is None:
            return ""
        if isinstance(value, str):
            return value.strip()
        return str(value).strip()

    @field_validator("users", mode="before")
    @classmethod
    def normalize_group_users(cls, value: object) -> list[str]:
        if value is None:
            return []
        if isinstance(value, str):
            return [item.strip().lower() for item in value.split(",") if item.strip()]
        if isinstance(value, list):
            return [str(item).strip().lower() for item in value if str(item).strip()]
        return []


class WorkbenchGroupUpdateRequest(BaseModel):
    description: str | None = None
    users: list[str] | None = None
    enabled: bool | None = None

    @field_validator("description", mode="before")
    @classmethod
    def normalize_group_update_description(cls, value: object) -> object:
        if value is None:
            return None
        if isinstance(value, str):
            return value.strip()
        return str(value).strip()

    @field_validator("users", mode="before")
    @classmethod
    def normalize_group_update_users(cls, value: object) -> list[str] | None:
        if value is None:
            return None
        return WorkbenchGroupCreateRequest.normalize_group_users(value)


class WorkbenchProjectAccessAssignmentRequest(BaseModel):
    principal_type: Literal["user", "group"]
    principal_name: str
    project_id: str
    branch_id: str | None = None
    accessible: bool = True
    editable: bool = False
    admin_access: bool = False

    @field_validator("principal_name", "project_id", "branch_id", mode="before")
    @classmethod
    def normalize_assignment_fields(cls, value: object) -> object:
        if value is None:
            return None
        if isinstance(value, str):
            return value.strip()
        return str(value).strip()


class WorkbenchProjectAccessAssignmentResponse(BaseModel):
    principal_type: Literal["user", "group"]
    principal_name: str
    project_id: str
    branch_ids: list[str] = Field(default_factory=list)
    assigned_usernames: list[str] = Field(default_factory=list)
    accessible: bool
    editable: bool
    admin_access: bool
    message: str


class WorkbenchAuthAdminStatus(BaseModel):
    settings: WorkbenchAuthSettings
    local_user_count: int = 0
    first_admin_setup_required: bool = False
    can_manage_users: bool = False


class SessionData(BaseModel):
    session_id: str = Field(default_factory=lambda: uuid4().hex)
    server: ServerProfile
    user: UserContext
    authorization_context: AuthorizationContext = Field(default_factory=AuthorizationContext)
    encrypted_credentials: str
    encrypted_oslc_credentials: str | None = None
    encrypted_oslc_consumer_credentials: str | None = None
    csrf_token: str = Field(default_factory=lambda: uuid4().hex)
    capabilities: CapabilitySummary
    preferences: SessionPreferences = Field(default_factory=SessionPreferences)
    bookmarks: list[Bookmark] = Field(default_factory=list)
    saved_searches: list[SavedSearch] = Field(default_factory=list)
    recent_items: list[Bookmark] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=utcnow)
    expires_at: datetime = Field(default_factory=utcnow)


class SessionSnapshot(BaseModel):
    authenticated: bool
    session_id: str | None = None
    csrf_token: str | None = None
    user: UserContext | None = None
    server: ServerProfile | None = None
    pending_server: ServerProfile | None = None
    server_state: UserServerState | None = None
    can_manage_server_presets: bool = False
    can_manage_groups: bool = False
    capabilities: CapabilitySummary | None = None
    preferences: SessionPreferences = Field(default_factory=SessionPreferences)
    bookmarks: list[Bookmark] = Field(default_factory=list)
    saved_searches: list[SavedSearch] = Field(default_factory=list)
    recent_items: list[Bookmark] = Field(default_factory=list)


class BranchSummary(BaseModel):
    id: str
    name: str
    description: str = ""


class BranchUpdateRequest(BaseModel):
    name: str | None = None
    description: str | None = None


class ProjectSummary(BaseModel):
    id: str
    name: str
    description: str = ""
    favorite: bool = False
    branches: list[BranchSummary] = Field(default_factory=list)
    workspace_id: str | None = None
    resource_id: str | None = None
    categories: Any | None = None


class TreeNode(BaseModel):
    id: str
    label: str
    node_type: str
    path: str
    children: list["TreeNode"] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


class ItemReference(BaseModel):
    id: str
    name: str = ""
    item_type: str = "item"
    relationship_type: str = ""
    path: str = ""


class ItemDetails(BaseModel):
    id: str
    name: str
    item_type: str
    path: str
    project_id: str
    branch_id: str
    description: str = ""
    documentation_markdown: str = ""
    raw_types: list[str] = Field(default_factory=list)
    stereotypes: list[str] = Field(default_factory=list)
    owner: ItemReference | None = None
    type_references: list[ItemReference] = Field(default_factory=list)
    contained_elements: list[ItemReference] = Field(default_factory=list)
    related_items: list[ItemReference] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)
    relationships: list[dict[str, Any]] = Field(default_factory=list)
    version: str = "1.0"
    editable: bool = False
    attachment_supported: bool = False
    collaborators: list[str] = Field(default_factory=list)
    source_payload: dict[str, Any] = Field(default_factory=dict)


class ElementDiscoveryEntry(BaseModel):
    id: str
    name: str = ""
    item_type: str = "element"
    child_count: int = 0


class ElementDiscoveryResult(BaseModel):
    project_id: str
    branch_id: str
    workspace_id: str | None = None
    latest_revision: str | None = None
    seed_source: str = ""
    seed_ids: list[str] = Field(default_factory=list)
    ids: list[str] = Field(default_factory=list)
    entries: list[ElementDiscoveryEntry] = Field(default_factory=list)
    total_ids: int = 0
    traversed_elements: int = 0
    hydrated_elements: int = 0
    batch_count: int = 0
    batch_size: int = 200
    cache_status: Literal["full-refresh", "incremental-refresh", "cache-hit"] = "full-refresh"
    warnings: list[str] = Field(default_factory=list)
    discovered_at: datetime = Field(default_factory=utcnow)


class SearchResult(BaseModel):
    id: str
    title: str
    item_type: str
    path: str
    excerpt: str
    score: float
    project_id: str | None = None
    branch_id: str | None = None
    document_id: str | None = None
    target_tab: Literal["details", "collaborator"] = "details"


class SearchResponse(BaseModel):
    query: str
    total: int
    results: list[SearchResult] = Field(default_factory=list)


class SimulationParameter(BaseModel):
    name: str
    label: str
    kind: Literal["string", "integer", "number", "boolean", "choice"]
    description: str = ""
    required: bool = False
    default_value: Any = None
    options: list[str] = Field(default_factory=list)


class SimulationConfig(BaseModel):
    id: str
    name: str
    description: str
    project_id: str
    editable_parameters: list[SimulationParameter] = Field(default_factory=list)
    supports_cancel: bool = True


class SimulationRunRequest(BaseModel):
    config_id: str
    project_id: str
    branch_id: str = "main"
    parameters: dict[str, Any] = Field(default_factory=dict)


class PublishRequest(BaseModel):
    project_id: str
    branch_id: str
    scope: str
    template: str
    category: str
    republish: bool = False
    open_result: bool = True
    presets: dict[str, Any] = Field(default_factory=dict)


class PublishPreset(BaseModel):
    id: str
    name: str
    template: str
    category: str
    description: str


class DocumentVersion(BaseModel):
    id: str
    label: str
    created_at: datetime
    summary: str = ""


class AttachmentInfo(BaseModel):
    id: str
    document_id: str
    file_name: str
    content_type: str
    size_bytes: int
    uploaded_at: datetime = Field(default_factory=utcnow)
    source: str = "remote"


class CommentEntry(BaseModel):
    id: str = Field(default_factory=lambda: uuid4().hex)
    document_id: str
    author: str
    content: str
    created_at: datetime = Field(default_factory=utcnow)


class CollaboratorDocument(BaseModel):
    id: str
    title: str
    item_id: str
    project_id: str
    branch_id: str
    body_markdown: str
    breadcrumbs: list[str] = Field(default_factory=list)
    toc: list[str] = Field(default_factory=list)
    editable: bool = False
    attachments_supported: bool = False
    versions: list[DocumentVersion] = Field(default_factory=list)


class CompareDifference(BaseModel):
    field_path: str
    left_value: Any = None
    right_value: Any = None
    summary: str


class CompareResult(BaseModel):
    compare_type: str
    left_id: str
    right_id: str
    summary: str
    differences: list[CompareDifference] = Field(default_factory=list)


class ExportRequest(BaseModel):
    export_type: Literal["item", "compare", "search", "simulation"]
    export_format: Literal["json", "csv", "markdown", "html", "pdf"]
    reference_id: str | None = None
    project_id: str | None = None
    branch_id: str | None = None
    payload: dict[str, Any] = Field(default_factory=dict)


class JobRecord(BaseModel):
    id: str = Field(default_factory=lambda: uuid4().hex)
    job_type: JobType
    status: JobStatus = JobStatus.PENDING
    title: str
    owner: str
    server_id: str
    progress: int = 0
    message: str = "Queued"
    logs: list[str] = Field(default_factory=list)
    payload: dict[str, Any] = Field(default_factory=dict)
    result: dict[str, Any] | None = None
    artifact_path: str | None = None
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)
    started_at: datetime | None = None
    finished_at: datetime | None = None
    cancel_requested: bool = False


class MaterializedCacheStatus(str, Enum):
    EMPTY = "empty"
    SYNCING = "syncing"
    READY = "ready"
    FAILED = "failed"


class WebhookRegistrationStatus(str, Enum):
    PENDING = "pending"
    READY = "ready"
    FAILED = "failed"


class BranchCacheSyncRequest(BaseModel):
    project_id: str
    branch_id: str
    workspace_id: str | None = None
    force_full_refresh: bool = False


class BranchCacheSummary(BaseModel):
    server_id: str
    project_id: str
    branch_id: str
    workspace_id: str | None = None
    project_name: str = ""
    branch_name: str = ""
    latest_revision: str | None = None
    status: MaterializedCacheStatus = MaterializedCacheStatus.EMPTY
    message: str = ""
    model_count: int = 0
    element_count: int = 0
    last_job_id: str | None = None
    snapshot_hash: str | None = None
    source_kind: str = "twc-rest"
    source_user: str | None = None
    updated_at: datetime = Field(default_factory=utcnow)


class BranchAccessRecord(BaseModel):
    user_id: str
    server_id: str
    project_id: str
    branch_id: str
    workspace_id: str | None = None
    branch_name: str = ""
    latest_revision: str | None = None
    accessible: bool = False
    editable: bool = False
    admin_access: bool = False
    roles: list[str] = Field(default_factory=list)
    via_groups: list[str] = Field(default_factory=list)
    source: str = "twc-session-probe"
    payload: dict[str, Any] = Field(default_factory=dict)
    updated_at: datetime = Field(default_factory=utcnow)


class BranchAccessManifestStatus(BaseModel):
    server_id: str
    project_id: str
    branch_id: str
    workspace_id: str | None = None
    branch_name: str = ""
    latest_revision: str | None = None
    accessible_user_count: int = 0
    editable_user_count: int = 0
    admin_user_count: int = 0
    updated_at: datetime | None = None
    source: str = "none"
    file_path: str | None = None
    message: str = ""


class BranchWebhookRegistration(BaseModel):
    registration_id: str = Field(default_factory=lambda: uuid4().hex)
    server_id: str
    project_id: str
    branch_id: str
    workspace_id: str | None = None
    webhook_id: str | None = None
    endpoint_url: str = ""
    auth_username: str = ""
    auth_password: str = ""
    encrypted_service_credentials: str | None = None
    status: WebhookRegistrationStatus = WebhookRegistrationStatus.PENDING
    enabled: bool = False
    status_message: str = ""
    last_event_at: datetime | None = None
    last_event_summary: str = ""
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


class CachedModelRecord(BaseModel):
    server_id: str
    project_id: str
    branch_id: str
    model_id: str
    workspace_id: str | None = None
    latest_revision: str | None = None
    name: str = ""
    root_ids: list[str] = Field(default_factory=list)
    payload: dict[str, Any] = Field(default_factory=dict)
    element_count: int = 0
    source_user: str | None = None
    synced_at: datetime = Field(default_factory=utcnow)


class ModelPermissionSnapshot(BaseModel):
    user_id: str
    server_id: str
    project_id: str
    branch_id: str
    model_id: str
    workspace_id: str | None = None
    latest_revision: str | None = None
    accessible: bool = False
    restricted: bool = False
    editable: bool = False
    source: str = "twc-session-probe"
    payload: dict[str, Any] = Field(default_factory=dict)
    updated_at: datetime = Field(default_factory=utcnow)


class CachedModelView(BaseModel):
    model: CachedModelRecord
    permissions: ModelPermissionSnapshot | None = None


class CachedElementRecord(BaseModel):
    server_id: str
    project_id: str
    branch_id: str
    model_id: str
    element_id: str
    workspace_id: str | None = None
    latest_revision: str | None = None
    name: str = ""
    item_type: str = "element"
    path: str = ""
    child_count: int = 0
    payload: dict[str, Any] = Field(default_factory=dict)
    source_user: str | None = None
    synced_at: datetime = Field(default_factory=utcnow)


class CachedElementQueryResponse(BaseModel):
    total: int = 0
    items: list[CachedElementRecord] = Field(default_factory=list)


class StereotypeElementSearchResponse(BaseModel):
    stereotype: str
    include_details: bool = False
    total: int = 0
    matched_stereotype_ids: list[str] = Field(default_factory=list)
    matched_stereotype_names: list[str] = Field(default_factory=list)
    items: list[CachedElementRecord] = Field(default_factory=list)
    details: list[ItemDetails] = Field(default_factory=list)


class CacheTreeResponse(BaseModel):
    server_id: str
    project_id: str
    branch_id: str
    model_id: str | None = None
    root_id: str | None = None
    depth: int | None = None
    include_orphans: bool = True
    total_nodes: int = 0
    nodes: list[TreeNode] = Field(default_factory=list)


class CacheChildrenResponse(BaseModel):
    server_id: str
    project_id: str
    branch_id: str
    parent_id: str
    model_id: str | None = None
    total_children: int = 0
    items: list[TreeNode] = Field(default_factory=list)


class CacheElementSearchResponse(BaseModel):
    query: str = ""
    item_type: str | None = None
    metaclass: str | None = None
    stereotype: str | None = None
    owner_id: str | None = None
    include_details: bool = False
    total: int = 0
    items: list[CachedElementRecord] = Field(default_factory=list)
    details: list[ItemDetails] = Field(default_factory=list)


class CacheElementGraphResponse(BaseModel):
    server_id: str
    project_id: str
    branch_id: str
    element_id: str
    model_id: str | None = None
    item: ItemDetails
    owner_chain: list[ItemReference] = Field(default_factory=list)
    contained_elements: list[ItemReference] = Field(default_factory=list)
    type_references: list[ItemReference] = Field(default_factory=list)
    related_items: list[ItemReference] = Field(default_factory=list)
    incoming_references: list[ItemReference] = Field(default_factory=list)
    stereotypes: list[ItemReference] = Field(default_factory=list)


class BranchCacheSnapshot(BaseModel):
    summary: BranchCacheSummary
    models: list[CachedModelView] = Field(default_factory=list)


class IngestModelRecord(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    model_id: str = Field(alias="modelId")
    name: str = ""
    human_name: str = Field(default="", alias="humanName")
    qualified_name: str = Field(default="", alias="qualifiedName")
    owner_id: str | None = Field(default=None, alias="ownerId")
    root_element_ids: list[str] = Field(default_factory=list, alias="rootElementIds")

    @field_validator("name", "human_name", "qualified_name", mode="before")
    @classmethod
    def normalize_nullable_strings(cls, value: object) -> str:
        if value is None:
            return ""
        if isinstance(value, str):
            return value
        return str(value)


class IngestElementRecord(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    element_id: str = Field(alias="elementId")
    model_id: str | None = Field(default=None, alias="modelId")
    local_id: str | None = Field(default=None, alias="localId")
    owner_id: str | None = Field(default=None, alias="ownerId")
    name: str = ""
    human_name: str = Field(default="", alias="humanName")
    qualified_name: str = Field(default="", alias="qualifiedName")
    human_type: str = Field(default="element", alias="humanType")
    metaclass: str = "Element"
    documentation: str = ""
    diagram_type: str = Field(default="", alias="diagramType")
    diagram_preview_format: str = Field(default="", alias="diagramPreviewFormat")
    diagram_preview_base64: str = Field(default="", alias="diagramPreviewBase64")
    owned_element_ids: list[str] = Field(default_factory=list, alias="ownedElementIds")
    applied_stereotype_ids: list[str] = Field(default_factory=list, alias="appliedStereotypeIds")
    diagram_element_ids: list[str] = Field(default_factory=list, alias="diagramElementIds")
    attributes: dict[str, Any] = Field(default_factory=dict)
    references: dict[str, list[str]] = Field(default_factory=dict)
    spec_sections: dict[str, Any] = Field(default_factory=dict, alias="specSections")

    @field_validator(
        "name",
        "human_name",
        "qualified_name",
        "human_type",
        "metaclass",
        "documentation",
        "diagram_type",
        "diagram_preview_format",
        "diagram_preview_base64",
        mode="before",
    )
    @classmethod
    def normalize_nullable_strings(cls, value: object) -> str:
        if value is None:
            return ""
        if isinstance(value, str):
            return value
        return str(value)


class BranchSnapshotIngestRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    schema_version: str = Field(default="1.0", alias="schemaVersion")
    source: str = "cameo-plugin"
    exported_at: datetime = Field(default_factory=utcnow, alias="exportedAt")
    export_reason: str = Field(default="", alias="exportReason")
    server_id: str = Field(alias="serverId")
    server_url: str | None = Field(default=None, alias="serverUrl")
    workspace_id: str | None = Field(default=None, alias="workspaceId")
    resource_id: str | None = Field(default=None, alias="resourceId")
    project_id: str = Field(alias="projectId")
    project_name: str = Field(default="", alias="projectName")
    branch_id: str = Field(alias="branchId")
    branch_name: str = Field(default="", alias="branchName")
    revision_id: str | None = Field(default=None, alias="revisionId")
    snapshot_hash: str | None = Field(default=None, alias="snapshotHash")
    source_user: str = Field(alias="sourceUser")
    models: list[IngestModelRecord] = Field(default_factory=list)
    elements: list[IngestElementRecord] = Field(default_factory=list)


class BranchDeltaIngestRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    schema_version: str = Field(default="1.0", alias="schemaVersion")
    source: str = "cameo-plugin"
    exported_at: datetime = Field(default_factory=utcnow, alias="exportedAt")
    export_reason: str = Field(default="", alias="exportReason")
    server_id: str = Field(alias="serverId")
    server_url: str | None = Field(default=None, alias="serverUrl")
    workspace_id: str | None = Field(default=None, alias="workspaceId")
    resource_id: str | None = Field(default=None, alias="resourceId")
    project_id: str = Field(alias="projectId")
    project_name: str = Field(default="", alias="projectName")
    branch_id: str = Field(alias="branchId")
    branch_name: str = Field(default="", alias="branchName")
    from_revision_id: str | None = Field(default=None, alias="fromRevisionId")
    to_revision_id: str | None = Field(default=None, alias="toRevisionId")
    base_snapshot_hash: str | None = Field(default=None, alias="baseSnapshotHash")
    target_snapshot_hash: str | None = Field(default=None, alias="targetSnapshotHash")
    source_user: str = Field(alias="sourceUser")
    added_models: list[IngestModelRecord] = Field(default_factory=list, alias="addedModels")
    updated_models: list[IngestModelRecord] = Field(default_factory=list, alias="updatedModels")
    removed_model_ids: list[str] = Field(default_factory=list, alias="removedModelIds")
    added_elements: list[IngestElementRecord] = Field(default_factory=list, alias="addedElements")
    updated_elements: list[IngestElementRecord] = Field(default_factory=list, alias="updatedElements")
    removed_element_ids: list[str] = Field(default_factory=list, alias="removedElementIds")


class CacheProjectBranchEntry(BaseModel):
    branch_id: str
    branch_name: str = ""
    latest_revision: str | None = None
    status: MaterializedCacheStatus = MaterializedCacheStatus.EMPTY
    model_count: int = 0
    element_count: int = 0
    updated_at: datetime = Field(default_factory=utcnow)


class BranchIngestState(BaseModel):
    server_id: str
    project_id: str
    branch_id: str
    workspace_id: str | None = None
    exists: bool = False
    project_name: str = ""
    branch_name: str = ""
    latest_revision: str | None = None
    snapshot_hash: str | None = None
    model_count: int = 0
    element_count: int = 0
    source_kind: str = "none"
    source_user: str | None = None
    updated_at: datetime | None = None


class CacheProjectEntry(BaseModel):
    project_id: str
    project_name: str = ""
    workspace_id: str | None = None
    branches: list[CacheProjectBranchEntry] = Field(default_factory=list)


class DashboardPayload(BaseModel):
    projects: list[ProjectSummary] = Field(default_factory=list)
    recent_items: list[Bookmark] = Field(default_factory=list)
    bookmarks: list[Bookmark] = Field(default_factory=list)
    capability_badges: list[Capability] = Field(default_factory=list)
    active_jobs: list[JobRecord] = Field(default_factory=list)
    publish_presets: list[PublishPreset] = Field(default_factory=list)


class SwaggerParameterSpec(BaseModel):
    name: str
    location: str
    required: bool = False
    schema_type: str = "string"
    schema_format: str | None = None
    schema_ref: str | None = None
    description: str = ""
    enum: list[Any] = Field(default_factory=list)
    default: Any = None
    is_file: bool = False


class SwaggerRequestBodySpec(BaseModel):
    required: bool = False
    description: str = ""
    content_types: list[str] = Field(default_factory=list)
    schema_refs: dict[str, str | None] = Field(default_factory=dict)


class SwaggerResponseSpec(BaseModel):
    status_code: str
    description: str = ""
    content_types: list[str] = Field(default_factory=list)
    schema_ref: str | None = None


class SwaggerSchemaProperty(BaseModel):
    name: str
    schema_type: str = "object"
    schema_format: str | None = None
    schema_ref: str | None = None
    description: str = ""
    required: bool = False
    enum: list[Any] = Field(default_factory=list)


class SwaggerSchemaSummary(BaseModel):
    name: str
    schema_type: str = "object"
    description: str = ""
    required: list[str] = Field(default_factory=list)
    properties: list[SwaggerSchemaProperty] = Field(default_factory=list)


class SwaggerOperationSpec(BaseModel):
    key: str
    method: str
    path: str
    tag: str
    tags: list[str] = Field(default_factory=list)
    operation_id: str | None = None
    summary: str = ""
    description: str = ""
    path_parameters: list[SwaggerParameterSpec] = Field(default_factory=list)
    query_parameters: list[SwaggerParameterSpec] = Field(default_factory=list)
    header_parameters: list[SwaggerParameterSpec] = Field(default_factory=list)
    form_parameters: list[SwaggerParameterSpec] = Field(default_factory=list)
    request_body: SwaggerRequestBodySpec | None = None
    responses: list[SwaggerResponseSpec] = Field(default_factory=list)
    supports_file_upload: bool = False
    supports_download: bool = False
    destructive: bool = False


class SwaggerContractManifest(BaseModel):
    openapi: str
    title: str
    version: str
    server_urls: list[str] = Field(default_factory=list)
    security: list[str] = Field(default_factory=list)
    operation_counts: dict[str, int] = Field(default_factory=dict)
    tag_counts: dict[str, int] = Field(default_factory=dict)
    operations: list[SwaggerOperationSpec] = Field(default_factory=list)
    schemas: list[SwaggerSchemaSummary] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class SwaggerExecuteRequest(BaseModel):
    operation_key: str
    path_params: dict[str, Any] = Field(default_factory=dict)
    query_params: dict[str, Any] = Field(default_factory=dict)
    body: Any = None
    content_type: str | None = None
    timeout_seconds: float = Field(default=30.0, ge=1.0, le=120.0)


class SwaggerExecuteResponse(BaseModel):
    operation_key: str
    method: str
    path: str
    requested_path: str
    status_code: int
    ok: bool
    content_type: str = ""
    headers: dict[str, str] = Field(default_factory=dict)
    body: Any = None
    text: str | None = None
    body_base64: str | None = None
    is_binary: bool = False
    size_bytes: int = 0
    filename: str | None = None


class OSLCRootServicesSummary(BaseModel):
    rootservices_url: str
    service_provider_catalog_url: str | None = None
    configuration_management_service_providers_url: str | None = None
    request_token_url: str | None = None
    authorize_url: str | None = None
    access_token_url: str | None = None
    request_consumer_key_url: str | None = None
    raw_content_type: str = ""


class OSLCAuthorizationStatus(BaseModel):
    server_id: str
    configured: bool
    authorized: bool
    rootservices: OSLCRootServicesSummary | None = None
    consumer_key_configured: bool = False
    consumer_key_source: Literal["none", "config", "shared", "session"] = "none"
    can_generate_consumer_key: bool = False
    message: str = ""


class OSLCStoreConsumerRequest(BaseModel):
    consumer_key: str
    consumer_secret: str


class OSLCGenerateConsumerRequest(BaseModel):
    name: str
    secret: str
    remember_for_session: bool = True


class OSLCGenerateConsumerResponse(BaseModel):
    consumer_key: str
    request_consumer_key_url: str
    stored_for_session: bool = False
    approval_required: bool = True
    message: str = ""


class OSLCSharedConsumerRequest(BaseModel):
    consumer_key: str
    consumer_secret: str


class OSLCSharedConsumerStatus(BaseModel):
    server_id: str
    configured: bool
    consumer_key: str | None = None
    updated_at: datetime | None = None
    source: Literal["none", "shared", "config"] = "none"


class CacheIngestTokenStatus(BaseModel):
    configured: bool
    source: Literal["none", "shared", "config"] = "none"
    token_hint: str | None = None
    updated_at: datetime | None = None
    message: str = ""


class CacheIngestTokenRequest(BaseModel):
    token: str


class CacheIngestTokenRotateResponse(CacheIngestTokenStatus):
    token: str


class CacheIngestTokenRevealResponse(CacheIngestTokenStatus):
    token: str


class CacheApiKeyScope(str, Enum):
    READ = "read"
    WRITE = "write"
    EDIT = "edit"


class CacheApiKeyRecord(BaseModel):
    key_id: str = Field(default_factory=lambda: uuid4().hex)
    user_id: str
    label: str
    token_hash: str
    token_hint: str
    scopes: list[CacheApiKeyScope] = Field(default_factory=lambda: [CacheApiKeyScope.READ])
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)
    last_used_at: datetime | None = None


class CacheApiKeySummary(BaseModel):
    key_id: str
    label: str
    token_hint: str
    scopes: list[CacheApiKeyScope] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime
    last_used_at: datetime | None = None


class CacheApiKeyCreateRequest(BaseModel):
    label: str
    scopes: list[CacheApiKeyScope] = Field(default_factory=lambda: [CacheApiKeyScope.READ])

    @field_validator("scopes")
    @classmethod
    def require_non_empty_scopes(cls, value: list[CacheApiKeyScope]) -> list[CacheApiKeyScope]:
        scopes = list(dict.fromkeys(value))
        if not scopes:
            raise ValueError("At least one API key scope is required.")
        return scopes


class CacheApiKeyCreateResponse(CacheApiKeySummary):
    token: str


class CacheApiTokenIdentity(BaseModel):
    preferred_username: str
    source: Literal["app-key", "config"] = "app-key"
    scopes: list[CacheApiKeyScope] = Field(default_factory=list)


class CacheServerEntry(BaseModel):
    server_id: str
    server_name: str
    project_count: int = 0
    branch_count: int = 0
    updated_at: datetime | None = None


class CacheApiManifest(BaseModel):
    preferred_username: str
    source: Literal["app-key", "config"] = "app-key"
    scopes: list[CacheApiKeyScope] = Field(default_factory=list)
    message: str = ""
    available_routes: list[str] = Field(default_factory=list)


class OpenWebUIModelEntry(BaseModel):
    id: str
    name: str
    owned_by: str | None = None
    description: str = ""


class WorkbenchAgentSecret(BaseModel):
    base_url: str
    api_key: str
    model_id: str = ""
    model_name: str = ""
    knowledge_file_id: str | None = None
    knowledge_file_name: str | None = None
    knowledge_project_id: str | None = None
    knowledge_branch_id: str | None = None
    updated_at: datetime = Field(default_factory=utcnow)
    knowledge_synced_at: datetime | None = None


class WorkbenchAgentConfigRequest(BaseModel):
    base_url: str
    api_key: str
    model_id: str = ""
    model_name: str = ""

    @field_validator("base_url", "api_key", "model_id", "model_name", mode="before")
    @classmethod
    def normalize_string_fields(cls, value: object) -> str:
        if value is None:
            return ""
        if isinstance(value, str):
            return value.strip()
        return str(value).strip()


class WorkbenchAgentStatus(BaseModel):
    configured: bool = False
    base_url: str | None = None
    model_id: str | None = None
    model_name: str | None = None
    has_api_key: bool = False
    knowledge_file_id: str | None = None
    knowledge_file_name: str | None = None
    knowledge_project_id: str | None = None
    knowledge_branch_id: str | None = None
    updated_at: datetime | None = None
    knowledge_synced_at: datetime | None = None
    message: str = ""


class WorkbenchAgentKnowledgeSyncRequest(BaseModel):
    project_id: str
    branch_id: str

    @field_validator("project_id", "branch_id", mode="before")
    @classmethod
    def normalize_sync_strings(cls, value: object) -> str:
        if value is None:
            return ""
        if isinstance(value, str):
            return value.strip()
        return str(value).strip()


class WorkbenchAgentKnowledgeStatus(BaseModel):
    project_id: str
    branch_id: str
    knowledge_file_id: str
    knowledge_file_name: str
    synced_at: datetime
    message: str = ""


class WorkbenchAgentChatMessage(BaseModel):
    role: Literal["system", "user", "assistant"]
    content: str

    @field_validator("content", mode="before")
    @classmethod
    def normalize_message_content(cls, value: object) -> str:
        if value is None:
            return ""
        if isinstance(value, str):
            return value
        return str(value)


class WorkbenchAgentChatRequest(BaseModel):
    project_id: str
    branch_id: str
    messages: list[WorkbenchAgentChatMessage] = Field(default_factory=list)
    sync_knowledge: bool = True

    @field_validator("project_id", "branch_id", mode="before")
    @classmethod
    def normalize_chat_strings(cls, value: object) -> str:
        if value is None:
            return ""
        if isinstance(value, str):
            return value.strip()
        return str(value).strip()


class WorkbenchAgentChatResponse(BaseModel):
    model_id: str
    model_name: str
    assistant_message: str
    knowledge_file_id: str | None = None
    knowledge_file_name: str | None = None
    raw_response: dict[str, Any] = Field(default_factory=dict)
    message: str = ""


class CacheElementEditRequest(BaseModel):
    name: str | None = None
    human_name: str | None = None
    qualified_name: str | None = None
    documentation: str | None = None
    attributes: dict[str, Any] | None = None
    references: dict[str, list[str]] | None = None
    owned_element_ids: list[str] | None = None


class OSLCExecuteRequest(BaseModel):
    path_or_url: str
    accept: str | None = None
    timeout_seconds: float = Field(default=30.0, ge=1.0, le=120.0)


class OSLCExecuteResponse(BaseModel):
    requested_url: str
    status_code: int
    ok: bool
    content_type: str = ""
    headers: dict[str, str] = Field(default_factory=dict)
    body: Any = None
    text: str | None = None
    body_base64: str | None = None
    is_binary: bool = False
    size_bytes: int = 0
    filename: str | None = None
