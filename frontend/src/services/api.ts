import {
  AuthOptions,
  BranchAccessManifestStatus,
  CacheElementSearchResponse,
  CacheApiKeyCreateRequest,
  CacheApiKeyCreateResponse,
  CacheApiKeySummary,
  CacheApiManifest,
  StereotypeElementSearchResponse,
  CacheServerEntry,
  CacheIngestTokenRequest,
  BranchSummary,
  CacheIngestTokenRotateResponse,
  CacheIngestTokenStatus,
  CapabilitySummary,
  CompareResult,
  DashboardPayload,
  ItemDetails,
  OSLCAuthorizationStatus,
  OSLCGenerateConsumerRequest,
  OSLCGenerateConsumerResponse,
  OSLCSharedConsumerRequest,
  OSLCSharedConsumerStatus,
  OSLCStoreConsumerRequest,
  OSLCExecuteRequest,
  OSLCExecuteResponse,
  ProjectSummary,
  ServerHealth,
  ServerProfile,
  ServerProfileInput,
  SessionPreferences,
  SessionSnapshot,
  SwaggerContractManifest,
  SwaggerExecuteRequest,
  SwaggerExecuteResponse,
  TokenLoginRequest,
  TreeNode,
  OpenWebUIModelEntry,
  WorkbenchAgentChatRequest,
  WorkbenchAgentChatResponse,
  WorkbenchAgentConfigRequest,
  WorkbenchAgentKnowledgeStatus,
  WorkbenchAgentStatus,
} from "../models/api";

const API_BASE = import.meta.env.VITE_API_BASE ?? "/api";

class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    ...options,
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const contentType = response.headers.get("content-type") ?? "";
  const bodyText = await response.text();

  if (!response.ok) {
    let message = response.statusText;
    if (bodyText) {
      if (contentType.includes("application/json")) {
        try {
          const payload = JSON.parse(bodyText) as { detail?: string };
          message = payload.detail ?? bodyText;
        } catch {
          message = bodyText;
        }
      } else {
        message = bodyText;
      }
    }
    throw new ApiError(message, response.status);
  }

  if (!bodyText) {
    return undefined as T;
  }

  if (contentType.includes("application/json")) {
    return JSON.parse(bodyText) as T;
  }

  return bodyText as T;
}

function jsonHeaders(csrfToken?: string) {
  return {
    "Content-Type": "application/json",
    ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
  };
}

export const api = {
  errorClass: ApiError,
  signInUrl(serverId: string) {
    return `${API_BASE}/auth/signin/${serverId}`;
  },
  oslcSignInUrl() {
    return `${API_BASE}/auth/oslc/signin`;
  },
  getSession() {
    return request<SessionSnapshot>("/auth/session");
  },
  getAuthOptions() {
    return request<AuthOptions>("/auth/options");
  },
  logout(csrfToken: string) {
    return request<{ ok: boolean }>("/auth/logout", {
      method: "POST",
      headers: jsonHeaders(csrfToken),
    });
  },
  tokenLogin(payload: TokenLoginRequest) {
    return request<SessionSnapshot>("/auth/token", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify(payload),
    });
  },
  listServers() {
    return request<ServerProfile[]>("/servers");
  },
  listManagedServers() {
    return request<ServerProfile[]>("/servers/manage");
  },
  createServer(payload: ServerProfileInput, csrfToken: string) {
    return request<ServerProfile>("/servers", {
      method: "POST",
      headers: jsonHeaders(csrfToken),
      body: JSON.stringify(payload),
    });
  },
  updateServer(serverId: string, payload: Partial<ServerProfileInput>, csrfToken: string) {
    return request<ServerProfile>(`/servers/${serverId}`, {
      method: "PUT",
      headers: jsonHeaders(csrfToken),
      body: JSON.stringify(payload),
    });
  },
  deleteServer(serverId: string, csrfToken: string) {
    return request<void>(`/servers/${serverId}`, {
      method: "DELETE",
      headers: jsonHeaders(csrfToken),
    });
  },
  reorderServers(serverIds: string[], csrfToken: string) {
    return request<ServerProfile[]>("/servers/reorder", {
      method: "POST",
      headers: jsonHeaders(csrfToken),
      body: JSON.stringify({ server_ids: serverIds }),
    });
  },
  getServerHealth(serverId: string) {
    return request<ServerHealth>(`/servers/${serverId}/health`);
  },
  getDashboard() {
    return request<DashboardPayload>("/workspace/dashboard");
  },
  getOslcStatus() {
    return request<OSLCAuthorizationStatus>("/workspace/oslc/status");
  },
  getCacheIngestTokenStatus() {
    return request<CacheIngestTokenStatus>("/workspace/cache-ingest-token");
  },
  listCacheApiKeys() {
    return request<CacheApiKeySummary[]>("/workspace/cache-api-keys");
  },
  createCacheApiKey(payload: CacheApiKeyCreateRequest, csrfToken: string) {
    return request<CacheApiKeyCreateResponse>("/workspace/cache-api-keys", {
      method: "POST",
      headers: jsonHeaders(csrfToken),
      body: JSON.stringify(payload),
    });
  },
  deleteCacheApiKey(keyId: string, csrfToken: string) {
    return request<{ ok: boolean }>(`/workspace/cache-api-keys/${keyId}`, {
      method: "DELETE",
      headers: jsonHeaders(csrfToken),
    });
  },
  rotateCacheIngestToken(csrfToken: string) {
    return request<CacheIngestTokenRotateResponse>("/workspace/cache-ingest-token/rotate", {
      method: "POST",
      headers: jsonHeaders(csrfToken),
    });
  },
  updateCacheIngestToken(payload: CacheIngestTokenRequest, csrfToken: string) {
    return request<CacheIngestTokenStatus>("/workspace/cache-ingest-token", {
      method: "PUT",
      headers: jsonHeaders(csrfToken),
      body: JSON.stringify(payload),
    });
  },
  clearCacheIngestToken(csrfToken: string) {
    return request<CacheIngestTokenStatus>("/workspace/cache-ingest-token", {
      method: "DELETE",
      headers: jsonHeaders(csrfToken),
    });
  },
  getCacheApiManifest(token: string) {
    return request<CacheApiManifest>("/cache", {
      headers: { Authorization: `Bearer ${token}` },
      credentials: "omit",
    });
  },
  getCachedServers(token: string) {
    return request<CacheServerEntry[]>("/cache/servers", {
      headers: { Authorization: `Bearer ${token}` },
      credentials: "omit",
    });
  },
  getSharedOslcConsumer() {
    return request<OSLCSharedConsumerStatus>("/workspace/oslc/shared-consumer");
  },
  updateSharedOslcConsumer(payload: OSLCSharedConsumerRequest, csrfToken: string) {
    return request<OSLCSharedConsumerStatus>("/workspace/oslc/shared-consumer", {
      method: "PUT",
      headers: jsonHeaders(csrfToken),
      body: JSON.stringify(payload),
    });
  },
  clearSharedOslcConsumer(csrfToken: string) {
    return request<{ ok: boolean }>("/workspace/oslc/shared-consumer", {
      method: "DELETE",
      headers: jsonHeaders(csrfToken),
    });
  },
  executeOslcRequest(payload: OSLCExecuteRequest, csrfToken: string) {
    return request<OSLCExecuteResponse>("/workspace/oslc/request", {
      method: "POST",
      headers: jsonHeaders(csrfToken),
      body: JSON.stringify(payload),
    });
  },
  disconnectOslc(csrfToken: string) {
    return request<{ ok: boolean }>("/workspace/oslc/disconnect", {
      method: "POST",
      headers: jsonHeaders(csrfToken),
    });
  },
  generateOslcConsumer(payload: OSLCGenerateConsumerRequest, csrfToken: string) {
    return request<OSLCGenerateConsumerResponse>("/workspace/oslc/consumer/generate", {
      method: "POST",
      headers: jsonHeaders(csrfToken),
      body: JSON.stringify(payload),
    });
  },
  storeOslcConsumer(payload: OSLCStoreConsumerRequest, csrfToken: string) {
    return request<OSLCAuthorizationStatus>("/workspace/oslc/consumer/session", {
      method: "POST",
      headers: jsonHeaders(csrfToken),
      body: JSON.stringify(payload),
    });
  },
  clearOslcConsumer(csrfToken: string) {
    return request<{ ok: boolean }>("/workspace/oslc/consumer/session", {
      method: "DELETE",
      headers: jsonHeaders(csrfToken),
    });
  },
  getContractManifest() {
    return request<SwaggerContractManifest>("/workspace/contract");
  },
  executeContractOperation(payload: SwaggerExecuteRequest, csrfToken: string) {
    return request<SwaggerExecuteResponse>("/workspace/contract/execute", {
      method: "POST",
      headers: jsonHeaders(csrfToken),
      body: JSON.stringify(payload),
    });
  },
  executeContractUpload(
    operationKey: string,
    pathParams: Record<string, unknown>,
    queryParams: Record<string, unknown>,
    file: File,
    csrfToken: string,
  ) {
    const body = new FormData();
    body.set("operationKey", operationKey);
    body.set("pathParams", JSON.stringify(pathParams));
    body.set("queryParams", JSON.stringify(queryParams));
    body.set("file", file);
    return request<SwaggerExecuteResponse>("/workspace/contract/execute-upload", {
      method: "POST",
      headers: csrfToken ? { "X-CSRF-Token": csrfToken } : undefined,
      body,
    });
  },
  getProjects(refresh = false) {
    const params = new URLSearchParams();
    if (refresh) {
      params.set("refresh", "true");
    }
    const suffix = params.toString() ? `?${params.toString()}` : "";
    return request<ProjectSummary[]>(`/workspace/projects${suffix}`);
  },
  getProjectBranches(projectId: string, workspaceId?: string, refresh = false) {
    const params = new URLSearchParams();
    if (workspaceId) {
      params.set("workspaceId", workspaceId);
    }
    if (refresh) {
      params.set("refresh", "true");
    }
    const suffix = params.toString() ? `?${params.toString()}` : "";
    return request<BranchSummary[]>(`/workspace/projects/${projectId}/branches${suffix}`);
  },
  getTree(projectId?: string, branchId?: string, workspaceId?: string, refresh = false, depth?: number) {
    const params = new URLSearchParams();
    if (projectId) {
      params.set("projectId", projectId);
    }
    if (branchId) {
      params.set("branchId", branchId);
    }
    if (workspaceId) {
      params.set("workspaceId", workspaceId);
    }
    if (refresh) {
      params.set("refresh", "true");
    }
    if (typeof depth === "number") {
      params.set("depth", String(depth));
    }
    const suffix = params.toString() ? `?${params.toString()}` : "";
    return request<TreeNode[]>(`/workspace/tree${suffix}`);
  },
  getTreeChildren(projectId: string, branchId: string, parentId: string, modelId?: string, workspaceId?: string, refresh = false) {
    const params = new URLSearchParams({
      projectId,
      branchId,
      parentId,
    });
    if (modelId) {
      params.set("modelId", modelId);
    }
    if (workspaceId) {
      params.set("workspaceId", workspaceId);
    }
    if (refresh) {
      params.set("refresh", "true");
    }
    return request<TreeNode[]>(`/workspace/tree/children?${params.toString()}`);
  },
  getBranchAccessManifestStatus(projectId: string, branchId: string) {
    const params = new URLSearchParams({ projectId, branchId });
    return request<BranchAccessManifestStatus>(`/workspace/model-cache/access-map?${params.toString()}`);
  },
  refreshBranchAccessManifest(projectId: string, branchId: string, csrfToken: string) {
    const params = new URLSearchParams({ projectId, branchId });
    return request<BranchAccessManifestStatus>(`/workspace/model-cache/access-map/refresh?${params.toString()}`, {
      method: "POST",
      headers: jsonHeaders(csrfToken),
    });
  },
  getItem(itemId: string, projectId?: string, branchId?: string, workspaceId?: string, refresh = false) {
    const params = new URLSearchParams();
    if (projectId) {
      params.set("projectId", projectId);
    }
    if (branchId) {
      params.set("branchId", branchId);
    }
    if (workspaceId) {
      params.set("workspaceId", workspaceId);
    }
    if (refresh) {
      params.set("refresh", "true");
    }
    const suffix = params.toString() ? `?${params.toString()}` : "";
    return request<ItemDetails>(`/workspace/items/${itemId}${suffix}`);
  },
  searchCachedElements(
    payload: {
      projectId: string;
      branchId: string;
      q?: string;
      itemType?: string;
      metaclass?: string;
      stereotype?: string;
      ownerId?: string;
      includeDetails?: boolean;
      limit?: number;
      offset?: number;
    },
  ) {
    const params = new URLSearchParams({
      projectId: payload.projectId,
      branchId: payload.branchId,
    });
    if (payload.q) {
      params.set("q", payload.q);
    }
    if (payload.itemType) {
      params.set("itemType", payload.itemType);
    }
    if (payload.metaclass) {
      params.set("metaclass", payload.metaclass);
    }
    if (payload.stereotype) {
      params.set("stereotype", payload.stereotype);
    }
    if (payload.ownerId) {
      params.set("ownerId", payload.ownerId);
    }
    if (typeof payload.includeDetails === "boolean") {
      params.set("includeDetails", String(payload.includeDetails));
    }
    if (typeof payload.limit === "number") {
      params.set("limit", String(payload.limit));
    }
    if (typeof payload.offset === "number") {
      params.set("offset", String(payload.offset));
    }
    return request<CacheElementSearchResponse>(`/workspace/model-cache/elements/search?${params.toString()}`);
  },
  searchCachedElementsByStereotype(
    payload: {
      projectId: string;
      branchId: string;
      stereotype: string;
      includeDetails?: boolean;
      limit?: number;
      offset?: number;
    },
  ) {
    const params = new URLSearchParams({
      projectId: payload.projectId,
      branchId: payload.branchId,
      stereotype: payload.stereotype,
    });
    if (typeof payload.includeDetails === "boolean") {
      params.set("includeDetails", String(payload.includeDetails));
    }
    if (typeof payload.limit === "number") {
      params.set("limit", String(payload.limit));
    }
    if (typeof payload.offset === "number") {
      params.set("offset", String(payload.offset));
    }
    return request<StereotypeElementSearchResponse>(`/workspace/model-cache/elements/by-stereotype?${params.toString()}`);
  },
  updateItem(itemId: string, payload: Partial<ItemDetails>, csrfToken: string, projectId?: string, branchId?: string) {
    const params = new URLSearchParams();
    if (projectId) {
      params.set("projectId", projectId);
    }
    if (branchId) {
      params.set("branchId", branchId);
    }
    const suffix = params.toString() ? `?${params.toString()}` : "";
    return request<ItemDetails>(`/workspace/items/${itemId}${suffix}`, {
      method: "PUT",
      headers: jsonHeaders(csrfToken),
      body: JSON.stringify(payload),
    });
  },
  compare(
    leftId: string,
    rightId: string,
    leftProjectId?: string,
    leftBranchId?: string,
    rightProjectId?: string,
    rightBranchId?: string,
  ) {
    const params = new URLSearchParams({
      leftId,
      rightId,
    });
    if (leftProjectId) {
      params.set("leftProjectId", leftProjectId);
    }
    if (leftBranchId) {
      params.set("leftBranchId", leftBranchId);
    }
    if (rightProjectId) {
      params.set("rightProjectId", rightProjectId);
    }
    if (rightBranchId) {
      params.set("rightBranchId", rightBranchId);
    }
    return request<CompareResult>(`/workspace/compare?${params.toString()}`);
  },
  refreshCapabilities(csrfToken: string) {
    return request<CapabilitySummary>("/workspace/capabilities/refresh", {
      method: "POST",
      headers: jsonHeaders(csrfToken),
    });
  },
  getPreferences() {
    return request<SessionPreferences>("/workspace/preferences");
  },
  updatePreferences(payload: SessionPreferences, csrfToken: string) {
    return request<SessionPreferences>("/workspace/preferences", {
      method: "PUT",
      headers: jsonHeaders(csrfToken),
      body: JSON.stringify(payload),
    });
  },
  getWorkbenchAgentStatus() {
    return request<WorkbenchAgentStatus>("/workspace/agent");
  },
  updateWorkbenchAgentConfig(payload: WorkbenchAgentConfigRequest, csrfToken: string) {
    return request<WorkbenchAgentStatus>("/workspace/agent", {
      method: "PUT",
      headers: jsonHeaders(csrfToken),
      body: JSON.stringify(payload),
    });
  },
  clearWorkbenchAgentConfig(csrfToken: string) {
    return request<WorkbenchAgentStatus>("/workspace/agent", {
      method: "DELETE",
      headers: jsonHeaders(csrfToken),
    });
  },
  listWorkbenchAgentModels() {
    return request<OpenWebUIModelEntry[]>("/workspace/agent/models");
  },
  syncWorkbenchAgentKnowledge(payload: { project_id: string; branch_id: string }, csrfToken: string) {
    return request<WorkbenchAgentKnowledgeStatus>("/workspace/agent/knowledge/sync", {
      method: "POST",
      headers: jsonHeaders(csrfToken),
      body: JSON.stringify(payload),
    });
  },
  runWorkbenchAgentChat(payload: WorkbenchAgentChatRequest, csrfToken: string) {
    return request<WorkbenchAgentChatResponse>("/workspace/agent/chat", {
      method: "POST",
      headers: jsonHeaders(csrfToken),
      body: JSON.stringify(payload),
    });
  },
};
