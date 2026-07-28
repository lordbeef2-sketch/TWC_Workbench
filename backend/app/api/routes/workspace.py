from __future__ import annotations

import json

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile, status

from app.api.deps import get_container, get_session, require_admin, require_admin_csrf, require_csrf
from app.models.domain import (
    BranchAccessManifestStatus,
    BranchCacheSyncRequest,
    CacheApiKeyCreateRequest,
    CacheIngestTokenRequest,
    CacheElementSearchResponse,
    OSLCExecuteRequest,
    OSLCGenerateConsumerRequest,
    OSLCSharedConsumerRequest,
    OSLCStoreConsumerRequest,
    SessionPreferences,
    StereotypeElementSearchResponse,
    SwaggerExecuteRequest,
    WorkbenchAgentChatRequest,
    WorkbenchAgentConfigRequest,
    WorkbenchAgentKnowledgeSyncRequest,
)
from app.services.platform import ApplicationContainer

router = APIRouter(prefix="/workspace", tags=["workspace"])


@router.get("/dashboard")
async def dashboard(session=Depends(get_session), container: ApplicationContainer = Depends(get_container)):
    try:
        return await container.platform.dashboard(session)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.get("/cache-ingest-token")
def cache_ingest_token_status(
    session=Depends(require_admin),
    container: ApplicationContainer = Depends(get_container),
):
    return container.platform.cache_ingest_token_status()


@router.post("/cache-ingest-token/rotate")
def rotate_cache_ingest_token(
    session=Depends(require_admin_csrf),
    container: ApplicationContainer = Depends(get_container),
):
    return container.platform.rotate_cache_ingest_token()


@router.post("/cache-ingest-token/reveal")
def reveal_cache_ingest_token(
    session=Depends(require_admin_csrf),
    container: ApplicationContainer = Depends(get_container),
):
    try:
        return container.platform.reveal_cache_ingest_token()
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.put("/cache-ingest-token")
def store_cache_ingest_token(
    payload: CacheIngestTokenRequest,
    session=Depends(require_admin_csrf),
    container: ApplicationContainer = Depends(get_container),
):
    try:
        return container.platform.set_cache_ingest_token(payload.token)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc


@router.delete("/cache-ingest-token")
def clear_cache_ingest_token(
    session=Depends(require_admin_csrf),
    container: ApplicationContainer = Depends(get_container),
):
    return container.platform.clear_cache_ingest_token()


@router.get("/cache-api-keys")
def list_cache_api_keys(
    session=Depends(require_admin),
    container: ApplicationContainer = Depends(get_container),
):
    return container.platform.list_cache_api_keys(session)


@router.post("/cache-api-keys")
def create_cache_api_key(
    payload: CacheApiKeyCreateRequest,
    session=Depends(require_admin_csrf),
    container: ApplicationContainer = Depends(get_container),
):
    try:
        return container.platform.create_cache_api_key(session, payload.label, payload.scopes)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc


@router.delete("/cache-api-keys/{key_id}")
def delete_cache_api_key(
    key_id: str,
    session=Depends(require_admin_csrf),
    container: ApplicationContainer = Depends(get_container),
):
    deleted = container.platform.delete_cache_api_key(session, key_id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="API key not found")
    return {"ok": True}


@router.get("/contract")
def contract_manifest(session=Depends(require_admin), container: ApplicationContainer = Depends(get_container)):
    return container.platform.swagger_contract_manifest()


@router.get("/oslc/status")
async def oslc_status(session=Depends(require_admin), container: ApplicationContainer = Depends(get_container)):
    return await container.platform.oslc_status(session)


@router.get("/oslc/shared-consumer")
def oslc_shared_consumer_status(
    session=Depends(require_admin),
    container: ApplicationContainer = Depends(get_container),
):
    return container.platform.oslc_shared_consumer_status(session)


@router.put("/oslc/shared-consumer")
def store_shared_oslc_consumer(
    payload: OSLCSharedConsumerRequest,
    session=Depends(require_admin_csrf),
    container: ApplicationContainer = Depends(get_container),
):
    try:
        return container.platform.set_shared_oslc_consumer(
            session,
            consumer_key=payload.consumer_key,
            consumer_secret=payload.consumer_secret,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc


@router.delete("/oslc/shared-consumer")
def clear_shared_oslc_consumer(
    session=Depends(require_admin_csrf),
    container: ApplicationContainer = Depends(get_container),
):
    container.platform.clear_shared_oslc_consumer(session)
    return {"ok": True}


@router.post("/oslc/request")
async def execute_oslc_request(
    payload: OSLCExecuteRequest,
    session=Depends(require_admin_csrf),
    container: ApplicationContainer = Depends(get_container),
):
    try:
        return await container.platform.execute_oslc_request(session, payload)
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.post("/oslc/disconnect")
def disconnect_oslc(session=Depends(require_admin_csrf), container: ApplicationContainer = Depends(get_container)):
    container.platform.disconnect_oslc(session)
    return {"ok": True}


@router.post("/oslc/consumer/generate")
async def generate_oslc_consumer(
    payload: OSLCGenerateConsumerRequest,
    session=Depends(require_admin_csrf),
    container: ApplicationContainer = Depends(get_container),
):
    try:
        return await container.platform.generate_oslc_consumer(
            session,
            consumer_name=payload.name,
            consumer_secret=payload.secret,
            remember_for_session=payload.remember_for_session,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.post("/oslc/consumer/session")
def store_oslc_consumer(
    payload: OSLCStoreConsumerRequest,
    session=Depends(require_admin_csrf),
    container: ApplicationContainer = Depends(get_container),
):
    try:
        return container.platform.set_oslc_consumer(
            session,
            consumer_key=payload.consumer_key,
            consumer_secret=payload.consumer_secret,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc


@router.delete("/oslc/consumer/session")
def clear_oslc_consumer(
    session=Depends(require_admin_csrf),
    container: ApplicationContainer = Depends(get_container),
):
    container.platform.clear_oslc_consumer(session)
    return {"ok": True}


@router.post("/contract/execute")
async def execute_contract_operation(
    payload: SwaggerExecuteRequest,
    session=Depends(require_admin_csrf),
    container: ApplicationContainer = Depends(get_container),
):
    try:
        return await container.platform.execute_swagger_operation(session, payload)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.post("/contract/execute-upload")
async def execute_contract_upload(
    operationKey: str = Form(...),
    pathParams: str = Form("{}"),
    queryParams: str = Form("{}"),
    file: UploadFile = File(...),
    session=Depends(require_admin_csrf),
    container: ApplicationContainer = Depends(get_container),
):
    try:
        path_params = _decode_form_json(pathParams, "pathParams")
        query_params = _decode_form_json(queryParams, "queryParams")
        content = await file.read()
        return await container.platform.execute_swagger_upload(
            session,
            operation_key=operationKey,
            path_params=path_params,
            query_params=query_params,
            file_name=file.filename or "upload.bin",
            content_type=file.content_type or "application/octet-stream",
            content=content,
        )
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


def _decode_form_json(raw_value: str, field_name: str) -> dict:
    try:
        decoded = json.loads(raw_value or "{}")
    except json.JSONDecodeError as exc:
        raise ValueError(f"{field_name} must be a JSON object.") from exc
    if not isinstance(decoded, dict):
        raise ValueError(f"{field_name} must be a JSON object.")
    return decoded


@router.get("/projects")
async def projects(
    refresh: bool = Query(default=False),
    session=Depends(get_session),
    container: ApplicationContainer = Depends(get_container),
):
    try:
        return await container.platform.list_projects(session, refresh=refresh)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.get("/projects/{project_id}/branches")
async def project_branches(
    project_id: str,
    workspaceId: str | None = Query(default=None),
    refresh: bool = Query(default=False),
    session=Depends(get_session),
    container: ApplicationContainer = Depends(get_container),
):
    try:
        return await container.platform.list_project_branches(session, project_id, workspaceId, refresh=refresh)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.get("/tree")
async def tree(
    projectId: str | None = Query(default=None),
    branchId: str | None = Query(default=None),
    workspaceId: str | None = Query(default=None),
    refresh: bool = Query(default=False),
    depth: int | None = Query(default=None, ge=0, le=20),
    session=Depends(get_session),
    container: ApplicationContainer = Depends(get_container),
):
    try:
        return await container.platform.get_model_tree(session, projectId, branchId, workspaceId, refresh=refresh, depth=depth)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.get("/tree/children")
async def tree_children(
    projectId: str = Query(...),
    branchId: str = Query(...),
    parentId: str = Query(...),
    workspaceId: str | None = Query(default=None),
    modelId: str | None = Query(default=None),
    refresh: bool = Query(default=False),
    session=Depends(get_session),
    container: ApplicationContainer = Depends(get_container),
):
    try:
        return await container.platform.get_model_tree_children(
            session,
            projectId,
            branchId,
            parentId,
            workspace_id=workspaceId,
            model_id=modelId,
            refresh=refresh,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.get("/elements/discovery")
async def discover_elements(
    projectId: str = Query(...),
    branchId: str = Query(...),
    workspaceId: str | None = Query(default=None),
    refresh: bool = Query(default=False),
    session=Depends(get_session),
    container: ApplicationContainer = Depends(get_container),
):
    try:
        return await container.platform.discover_elements(
            session,
            projectId,
            branchId,
            workspace_id=workspaceId,
            refresh=refresh,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.get("/jobs")
def jobs(session=Depends(get_session), container: ApplicationContainer = Depends(get_container)):
    return container.platform.list_jobs(session)


@router.get("/jobs/{job_id}")
def job(job_id: str, session=Depends(get_session), container: ApplicationContainer = Depends(get_container)):
    record = container.platform.get_job(session, job_id)
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")
    return record


@router.post("/jobs/{job_id}/cancel")
def cancel_job(job_id: str, session=Depends(require_csrf), container: ApplicationContainer = Depends(get_container)):
    record = container.platform.cancel_job(session, job_id)
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")
    return record


@router.post("/model-cache/sync")
async def start_model_cache_sync(
    payload: BranchCacheSyncRequest,
    session=Depends(require_csrf),
    container: ApplicationContainer = Depends(get_container),
):
    try:
        return await container.platform.submit_branch_cache_sync(session, payload)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.post("/model-cache/webhooks/{registration_id}", status_code=status.HTTP_202_ACCEPTED)
async def model_cache_webhook(
    registration_id: str,
    request: Request,
    container: ApplicationContainer = Depends(get_container),
):
    raw_body = await request.body()
    try:
        payload = json.loads(raw_body.decode("utf-8")) if raw_body else {}
    except Exception:
        payload = raw_body.decode("utf-8", errors="replace") if raw_body else ""
    try:
        return await container.platform.handle_model_cache_webhook(
            registration_id,
            request.headers.get("authorization"),
            payload,
        )
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Webhook registration not found") from exc
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc


@router.get("/model-cache/summary")
def model_cache_summary(
    projectId: str = Query(...),
    branchId: str = Query(...),
    session=Depends(get_session),
    container: ApplicationContainer = Depends(get_container),
):
    return container.platform.get_branch_cache_summary(session, projectId, branchId)


@router.get("/model-cache/access-map", response_model=BranchAccessManifestStatus)
def model_cache_access_map_status(
    projectId: str = Query(...),
    branchId: str = Query(...),
    session=Depends(get_session),
    container: ApplicationContainer = Depends(get_container),
):
    return container.platform.get_branch_access_manifest_status(session, projectId, branchId)


@router.post("/model-cache/access-map/refresh", response_model=BranchAccessManifestStatus)
async def refresh_model_cache_access_map(
    projectId: str = Query(...),
    branchId: str = Query(...),
    session=Depends(require_csrf),
    container: ApplicationContainer = Depends(get_container),
):
    try:
        return await container.platform.refresh_branch_access_manifest(session, projectId, branchId)
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.get("/model-cache/snapshot")
def model_cache_snapshot(
    projectId: str = Query(...),
    branchId: str = Query(...),
    session=Depends(get_session),
    container: ApplicationContainer = Depends(get_container),
):
    return container.platform.get_branch_cache_snapshot(session, projectId, branchId)


@router.get("/model-cache/models/{model_id}")
def cached_model(
    model_id: str,
    projectId: str = Query(...),
    branchId: str = Query(...),
    session=Depends(get_session),
    container: ApplicationContainer = Depends(get_container),
):
    record = container.platform.get_cached_branch_model(session, projectId, branchId, model_id)
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cached model not found")
    return record


@router.get("/model-cache/elements")
def cached_elements(
    projectId: str = Query(...),
    branchId: str = Query(...),
    modelId: str | None = Query(default=None),
    search: str | None = Query(default=None),
    allResults: bool = Query(default=False),
    limit: int = Query(default=200, ge=1, le=5000),
    offset: int = Query(default=0, ge=0),
    session=Depends(get_session),
    container: ApplicationContainer = Depends(get_container),
):
    return container.platform.list_cached_branch_elements(
        session,
        projectId,
        branchId,
        model_id=modelId,
        search=search,
        limit=limit,
        offset=offset,
        all_results=allResults,
    )


@router.get("/model-cache/elements/search", response_model=CacheElementSearchResponse)
def cached_element_search(
    projectId: str = Query(...),
    branchId: str = Query(...),
    q: str | None = Query(default=None),
    itemType: str | None = Query(default=None),
    metaclass: str | None = Query(default=None),
    stereotype: str | None = Query(default=None),
    ownerId: str | None = Query(default=None),
    includeDetails: bool = Query(default=False),
    limit: int = Query(default=200, ge=1, le=5000),
    offset: int = Query(default=0, ge=0),
    session=Depends(get_session),
    container: ApplicationContainer = Depends(get_container),
):
    return container.platform.search_cached_branch_elements(
        session,
        projectId,
        branchId,
        query=q,
        item_type=itemType,
        metaclass=metaclass,
        stereotype=stereotype,
        owner_id=ownerId,
        include_details=includeDetails,
        limit=limit,
        offset=offset,
    )


@router.get("/model-cache/elements/by-stereotype", response_model=StereotypeElementSearchResponse)
def cached_elements_by_stereotype(
    projectId: str = Query(...),
    branchId: str = Query(...),
    stereotype: str = Query(..., min_length=1),
    includeDetails: bool = Query(default=False),
    limit: int = Query(default=200, ge=1, le=5000),
    offset: int = Query(default=0, ge=0),
    session=Depends(get_session),
    container: ApplicationContainer = Depends(get_container),
):
    return container.platform.search_cached_branch_elements_by_stereotype(
        session,
        projectId,
        branchId,
        stereotype,
        include_details=includeDetails,
        limit=limit,
        offset=offset,
    )


@router.get("/model-cache/elements/{element_id}")
def cached_element(
    element_id: str,
    projectId: str = Query(...),
    branchId: str = Query(...),
    modelId: str | None = Query(default=None),
    session=Depends(get_session),
    container: ApplicationContainer = Depends(get_container),
):
    record = container.platform.get_cached_branch_element(
        session,
        projectId,
        branchId,
        element_id,
        model_id=modelId,
    )
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cached element not found")
    return record


@router.get("/items/{item_id}")
async def item(
    item_id: str,
    projectId: str | None = Query(default=None),
    branchId: str | None = Query(default=None),
    workspaceId: str | None = Query(default=None),
    refresh: bool = Query(default=False),
    session=Depends(get_session),
    container: ApplicationContainer = Depends(get_container),
):
    try:
        return await container.platform.get_item(session, item_id, projectId, branchId, workspaceId, refresh=refresh)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item not found") from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.put("/items/{item_id}")
async def update_item(
    item_id: str,
    payload: dict,
    projectId: str | None = Query(default=None),
    branchId: str | None = Query(default=None),
    session=Depends(require_csrf),
    container: ApplicationContainer = Depends(get_container),
):
    try:
        return await container.platform.update_item(session, item_id, payload, projectId, branchId)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item not found") from exc
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc


@router.get("/compare")
async def compare(
    leftId: str = Query(...),
    rightId: str = Query(...),
    leftProjectId: str | None = Query(default=None),
    leftBranchId: str | None = Query(default=None),
    rightProjectId: str | None = Query(default=None),
    rightBranchId: str | None = Query(default=None),
    session=Depends(get_session),
    container: ApplicationContainer = Depends(get_container),
):
    return await container.platform.compare_items(
        session,
        leftId,
        rightId,
        leftProjectId,
        leftBranchId,
        rightProjectId,
        rightBranchId,
    )


@router.post("/capabilities/refresh")
async def refresh_capabilities(session=Depends(require_csrf), container: ApplicationContainer = Depends(get_container)):
    return await container.platform.refresh_capabilities(session)


@router.get("/agent")
def workbench_agent_status(session=Depends(get_session), container: ApplicationContainer = Depends(get_container)):
    return container.platform.get_workbench_agent_status(session)


@router.put("/agent")
def update_workbench_agent_config(
    payload: WorkbenchAgentConfigRequest,
    session=Depends(require_admin_csrf),
    container: ApplicationContainer = Depends(get_container),
):
    try:
        return container.platform.set_workbench_agent_config(session, payload)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc


@router.delete("/agent")
def clear_workbench_agent_config(
    session=Depends(require_admin_csrf),
    container: ApplicationContainer = Depends(get_container),
):
    return container.platform.clear_workbench_agent_config(session)


@router.get("/agent/models")
async def workbench_agent_models(session=Depends(require_admin), container: ApplicationContainer = Depends(get_container)):
    try:
        return await container.platform.list_openwebui_models(session)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.post("/agent/knowledge/sync")
async def sync_workbench_agent_knowledge(
    payload: WorkbenchAgentKnowledgeSyncRequest,
    session=Depends(require_csrf),
    container: ApplicationContainer = Depends(get_container),
):
    try:
        return await container.platform.sync_workbench_agent_knowledge(session, payload.project_id, payload.branch_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.post("/agent/chat")
async def workbench_agent_chat(
    payload: WorkbenchAgentChatRequest,
    session=Depends(require_csrf),
    container: ApplicationContainer = Depends(get_container),
):
    try:
        return await container.platform.run_workbench_agent_chat(session, payload)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.get("/preferences")
def preferences(session=Depends(get_session), container: ApplicationContainer = Depends(get_container)):
    return container.platform.get_preferences(session)


@router.put("/preferences")
def update_preferences(
    payload: SessionPreferences,
    session=Depends(require_csrf),
    container: ApplicationContainer = Depends(get_container),
):
    return container.platform.update_preferences(session, payload)
