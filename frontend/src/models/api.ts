export type TWCVersion = "auto" | "2022x" | "2024x";
export type ThemeMode = "light" | "dark" | "system";
export type ItemDetailViewMode = "standard" | "expert" | "all";
export type CapabilityState = "ready" | "restricted" | "not_available" | "unknown";
export type JobStatus = "pending" | "running" | "succeeded" | "failed" | "cancelled";
export type JobType = "simulation" | "publish" | "export" | "model_cache";
export type ExportFormat = "json" | "csv" | "markdown" | "html" | "pdf";
export type CacheApiKeyScope = "read" | "write" | "edit";

export interface ServerProfile {
  id: string;
  name: string;
  base_url: string;
  version: TWCVersion;
  verify_tls: boolean;
  ca_bundle_path: string | null;
  enabled: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
}

export interface ServerProfileInput {
  name: string;
  base_url: string;
  version: TWCVersion;
  verify_tls: boolean;
  ca_bundle_path: string | null;
  enabled: boolean;
  display_order: number;
}

export interface UserServerState {
  user_id: string;
  selected_server_id: string | null;
  last_used_server_id: string | null;
  favorite_server_ids: string[];
  updated_at: string;
}

export interface ServerHealth {
  server_id: string;
  status: "healthy" | "degraded" | "unreachable";
  version_hint: string | null;
  response_time_ms: number | null;
  checks: Record<string, boolean>;
  message: string;
}

export interface UserContext {
  preferred_username: string;
  server_id: string;
  server_name: string;
}

export interface Capability {
  name: string;
  state: CapabilityState;
  reason: string;
  source: string;
  detected_at: string;
}

export interface CapabilitySummary {
  detected_version: string;
  reachable_endpoints: Record<string, boolean>;
  capabilities: Record<string, Capability>;
  detected_at: string;
}

export interface SessionPreferences {
  theme_mode: ThemeMode;
  font_scale: number;
  request_timeout_seconds: number;
  live_log_poll_interval_ms: number;
  presentation_font_scale: number;
  compact_ui: boolean;
  show_hidden_packages_in_tree: boolean;
  item_detail_view_mode: ItemDetailViewMode;
}

export interface Bookmark {
  id: string;
  title: string;
  item_id: string;
  item_type: string;
  path: string;
  project_id?: string | null;
  branch_id?: string | null;
}

export interface SavedSearch {
  id: string;
  name: string;
  query: string;
  filters: Record<string, unknown>;
}

export interface SessionSnapshot {
  authenticated: boolean;
  session_id: string | null;
  csrf_token: string | null;
  user: UserContext | null;
  server: ServerProfile | null;
  pending_server: ServerProfile | null;
  server_state: UserServerState | null;
  can_manage_server_presets: boolean;
  capabilities: CapabilitySummary | null;
  preferences: SessionPreferences;
  bookmarks: Bookmark[];
  saved_searches: SavedSearch[];
  recent_items: Bookmark[];
}

export interface BranchSummary {
  id: string;
  name: string;
  description: string;
}

export interface BranchUpdateRequest {
  name?: string;
  description?: string;
}

export interface ProjectSummary {
  id: string;
  name: string;
  description: string;
  favorite: boolean;
  branches: BranchSummary[];
  workspace_id?: string | null;
  resource_id?: string | null;
  categories?: unknown;
}

export interface TreeNode {
  id: string;
  label: string;
  node_type: string;
  path: string;
  children: TreeNode[];
  metadata: Record<string, unknown>;
}

export interface ItemReference {
  id: string;
  name: string;
  item_type: string;
  relationship_type: string;
  path: string;
}

export interface ItemDetails {
  id: string;
  name: string;
  item_type: string;
  path: string;
  project_id: string;
  branch_id: string;
  description: string;
  documentation_markdown: string;
  raw_types: string[];
  stereotypes: string[];
  owner: ItemReference | null;
  type_references: ItemReference[];
  contained_elements: ItemReference[];
  related_items: ItemReference[];
  metadata: Record<string, unknown>;
  relationships: Array<Record<string, unknown>>;
  version: string;
  editable: boolean;
  attachment_supported: boolean;
  collaborators: string[];
  source_payload: Record<string, unknown>;
}

export interface CachedElementRecord {
  server_id: string;
  project_id: string;
  branch_id: string;
  model_id: string;
  element_id: string;
  workspace_id?: string | null;
  latest_revision?: string | null;
  name: string;
  item_type: string;
  path: string;
  child_count: number;
  payload: Record<string, unknown>;
  source_user?: string | null;
  synced_at: string;
}

export interface CacheElementSearchResponse {
  query: string;
  item_type?: string | null;
  metaclass?: string | null;
  stereotype?: string | null;
  owner_id?: string | null;
  include_details: boolean;
  total: number;
  items: CachedElementRecord[];
  details: ItemDetails[];
}

export interface StereotypeElementSearchResponse {
  stereotype: string;
  include_details: boolean;
  total: number;
  matched_stereotype_ids: string[];
  matched_stereotype_names: string[];
  items: CachedElementRecord[];
  details: ItemDetails[];
}

export interface ElementDiscoveryEntry {
  id: string;
  name: string;
  item_type: string;
  child_count: number;
}

export interface ElementDiscoveryResult {
  project_id: string;
  branch_id: string;
  workspace_id?: string | null;
  latest_revision?: string | null;
  seed_source: string;
  seed_ids: string[];
  ids: string[];
  entries: ElementDiscoveryEntry[];
  total_ids: number;
  traversed_elements: number;
  hydrated_elements: number;
  batch_count: number;
  batch_size: number;
  cache_status?: "full-refresh" | "incremental-refresh" | "cache-hit";
  warnings: string[];
  discovered_at: string;
}

export interface SearchResult {
  id: string;
  title: string;
  item_type: string;
  path: string;
  excerpt: string;
  score: number;
  project_id?: string | null;
  branch_id?: string | null;
  document_id?: string | null;
  target_tab?: "details" | "collaborator";
}

export interface SearchResponse {
  query: string;
  total: number;
  results: SearchResult[];
}

export interface SimulationParameter {
  name: string;
  label: string;
  kind: "string" | "integer" | "number" | "boolean" | "choice";
  description: string;
  required: boolean;
  default_value: string | number | boolean | null;
  options: string[];
}

export interface SimulationConfig {
  id: string;
  name: string;
  description: string;
  project_id: string;
  editable_parameters: SimulationParameter[];
  supports_cancel: boolean;
}

export interface PublishPreset {
  id: string;
  name: string;
  template: string;
  category: string;
  description: string;
}

export interface DocumentVersion {
  id: string;
  label: string;
  created_at: string;
  summary: string;
}

export interface AttachmentInfo {
  id: string;
  document_id: string;
  file_name: string;
  content_type: string;
  size_bytes: number;
  uploaded_at: string;
  source: string;
}

export interface CommentEntry {
  id: string;
  document_id: string;
  author: string;
  content: string;
  created_at: string;
}

export interface CollaboratorDocument {
  id: string;
  title: string;
  item_id: string;
  project_id: string;
  branch_id: string;
  body_markdown: string;
  breadcrumbs: string[];
  toc: string[];
  editable: boolean;
  attachments_supported: boolean;
  versions: DocumentVersion[];
}

export interface CompareDifference {
  field_path: string;
  left_value: unknown;
  right_value: unknown;
  summary: string;
}

export interface CompareResult {
  compare_type: string;
  left_id: string;
  right_id: string;
  summary: string;
  differences: CompareDifference[];
}

export interface JobRecord {
  id: string;
  job_type: JobType;
  status: JobStatus;
  title: string;
  owner: string;
  server_id: string;
  progress: number;
  message: string;
  logs: string[];
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  artifact_path: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
  cancel_requested: boolean;
}

export interface DashboardPayload {
  projects: ProjectSummary[];
  recent_items: Bookmark[];
  bookmarks: Bookmark[];
  capability_badges: Capability[];
  active_jobs: JobRecord[];
  publish_presets: PublishPreset[];
}

export interface SimulationRunRequest {
  config_id: string;
  project_id: string;
  branch_id: string;
  parameters: Record<string, string | number | boolean>;
}

export interface PublishRequest {
  project_id: string;
  branch_id: string;
  scope: string;
  template: string;
  category: string;
  republish: boolean;
  open_result: boolean;
  presets: Record<string, unknown>;
}

export interface ExportRequest {
  export_type: "item" | "compare" | "search" | "simulation";
  export_format: ExportFormat;
  reference_id?: string | null;
  project_id?: string | null;
  branch_id?: string | null;
  payload: Record<string, unknown>;
}

export interface AuthOptions {
  token_signin_enabled: boolean;
  redirect_signin_enabled: boolean;
  redirect_signin_message?: string | null;
  csrf_header_name: string;
}

export interface OSLCRootServicesSummary {
  rootservices_url: string;
  service_provider_catalog_url?: string | null;
  configuration_management_service_providers_url?: string | null;
  request_token_url?: string | null;
  authorize_url?: string | null;
  access_token_url?: string | null;
  request_consumer_key_url?: string | null;
  raw_content_type: string;
}

export interface OSLCAuthorizationStatus {
  server_id: string;
  configured: boolean;
  authorized: boolean;
  rootservices?: OSLCRootServicesSummary | null;
  consumer_key_configured: boolean;
  consumer_key_source: "none" | "config" | "shared" | "session";
  can_generate_consumer_key: boolean;
  message: string;
}

export interface OSLCSharedConsumerRequest {
  consumer_key: string;
  consumer_secret: string;
}

export interface OSLCSharedConsumerStatus {
  server_id: string;
  configured: boolean;
  consumer_key?: string | null;
  updated_at?: string | null;
  source: "none" | "shared" | "config";
}

export interface CacheIngestTokenStatus {
  configured: boolean;
  source: "none" | "shared" | "config";
  token_hint?: string | null;
  updated_at?: string | null;
  message: string;
}

export interface CacheIngestTokenRequest {
  token: string;
}

export interface CacheIngestTokenRotateResponse extends CacheIngestTokenStatus {
  token: string;
}

export interface CacheApiKeySummary {
  key_id: string;
  label: string;
  token_hint: string;
  scopes: CacheApiKeyScope[];
  created_at: string;
  updated_at: string;
  last_used_at?: string | null;
}

export interface CacheApiKeyCreateRequest {
  label: string;
  scopes: CacheApiKeyScope[];
}

export interface CacheApiKeyCreateResponse extends CacheApiKeySummary {
  token: string;
}

export interface CacheServerEntry {
  server_id: string;
  server_name: string;
  project_count: number;
  branch_count: number;
  updated_at?: string | null;
}

export interface BranchAccessManifestStatus {
  server_id: string;
  project_id: string;
  branch_id: string;
  workspace_id?: string | null;
  branch_name: string;
  latest_revision?: string | null;
  accessible_user_count: number;
  editable_user_count: number;
  admin_user_count: number;
  updated_at?: string | null;
  source: string;
  file_path?: string | null;
  message: string;
}

export interface CacheApiManifest {
  preferred_username: string;
  source: "app-key" | "config";
  scopes: CacheApiKeyScope[];
  message: string;
  available_routes: string[];
}

export interface OpenWebUIModelEntry {
  id: string;
  name: string;
  owned_by?: string | null;
  description: string;
}

export interface WorkbenchAgentConfigRequest {
  base_url: string;
  api_key: string;
  model_id: string;
  model_name: string;
}

export interface WorkbenchAgentStatus {
  configured: boolean;
  base_url?: string | null;
  model_id?: string | null;
  model_name?: string | null;
  has_api_key: boolean;
  knowledge_file_id?: string | null;
  knowledge_file_name?: string | null;
  knowledge_project_id?: string | null;
  knowledge_branch_id?: string | null;
  updated_at?: string | null;
  knowledge_synced_at?: string | null;
  message: string;
}

export interface WorkbenchAgentKnowledgeSyncRequest {
  project_id: string;
  branch_id: string;
}

export interface WorkbenchAgentKnowledgeStatus {
  project_id: string;
  branch_id: string;
  knowledge_file_id: string;
  knowledge_file_name: string;
  synced_at: string;
  message: string;
}

export interface WorkbenchAgentChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface WorkbenchAgentChatRequest {
  project_id: string;
  branch_id: string;
  messages: WorkbenchAgentChatMessage[];
  sync_knowledge: boolean;
}

export interface WorkbenchAgentChatResponse {
  model_id: string;
  model_name: string;
  assistant_message: string;
  knowledge_file_id?: string | null;
  knowledge_file_name?: string | null;
  raw_response: Record<string, unknown>;
  message: string;
}

export interface OSLCStoreConsumerRequest {
  consumer_key: string;
  consumer_secret: string;
}

export interface OSLCGenerateConsumerRequest {
  name: string;
  secret: string;
  remember_for_session: boolean;
}

export interface OSLCGenerateConsumerResponse {
  consumer_key: string;
  request_consumer_key_url: string;
  stored_for_session: boolean;
  approval_required: boolean;
  message: string;
}

export interface OSLCExecuteRequest {
  path_or_url: string;
  accept?: string | null;
  timeout_seconds: number;
}

export interface OSLCExecuteResponse {
  requested_url: string;
  status_code: number;
  ok: boolean;
  content_type: string;
  headers: Record<string, string>;
  body: unknown;
  text?: string | null;
  body_base64?: string | null;
  is_binary: boolean;
  size_bytes: number;
  filename?: string | null;
}

export interface TokenLoginRequest {
  server_id: string;
  token: string;
}

export interface SwaggerParameterSpec {
  name: string;
  location: string;
  required: boolean;
  schema_type: string;
  schema_format?: string | null;
  schema_ref?: string | null;
  description: string;
  enum: unknown[];
  default?: unknown;
  is_file: boolean;
}

export interface SwaggerRequestBodySpec {
  required: boolean;
  description: string;
  content_types: string[];
  schema_refs: Record<string, string | null>;
}

export interface SwaggerResponseSpec {
  status_code: string;
  description: string;
  content_types: string[];
  schema_ref?: string | null;
}

export interface SwaggerSchemaProperty {
  name: string;
  schema_type: string;
  schema_format?: string | null;
  schema_ref?: string | null;
  description: string;
  required: boolean;
  enum: unknown[];
}

export interface SwaggerSchemaSummary {
  name: string;
  schema_type: string;
  description: string;
  required: string[];
  properties: SwaggerSchemaProperty[];
}

export interface SwaggerOperationSpec {
  key: string;
  method: string;
  path: string;
  tag: string;
  tags: string[];
  operation_id?: string | null;
  summary: string;
  description: string;
  path_parameters: SwaggerParameterSpec[];
  query_parameters: SwaggerParameterSpec[];
  header_parameters: SwaggerParameterSpec[];
  form_parameters: SwaggerParameterSpec[];
  request_body?: SwaggerRequestBodySpec | null;
  responses: SwaggerResponseSpec[];
  supports_file_upload: boolean;
  supports_download: boolean;
  destructive: boolean;
}

export interface SwaggerContractManifest {
  openapi: string;
  title: string;
  version: string;
  server_urls: string[];
  security: string[];
  operation_counts: Record<string, number>;
  tag_counts: Record<string, number>;
  operations: SwaggerOperationSpec[];
  schemas: SwaggerSchemaSummary[];
  warnings: string[];
}

export interface SwaggerExecuteRequest {
  operation_key: string;
  path_params: Record<string, unknown>;
  query_params: Record<string, unknown>;
  body?: unknown;
  content_type?: string | null;
  timeout_seconds?: number;
}

export interface SwaggerExecuteResponse {
  operation_key: string;
  method: string;
  path: string;
  requested_path: string;
  status_code: number;
  ok: boolean;
  content_type: string;
  headers: Record<string, string>;
  body?: unknown;
  text?: string | null;
  body_base64?: string | null;
  is_binary: boolean;
  size_bytes: number;
  filename?: string | null;
}
