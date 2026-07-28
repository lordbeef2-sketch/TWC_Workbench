from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
from datetime import UTC, datetime, timedelta
from urllib.parse import urlencode

import structlog
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import RedirectResponse

from app.api.deps import get_container, require_admin, require_admin_csrf, require_csrf, require_group_manager, require_group_manager_csrf
from app.auth.twc import build_twc_authorize_base_url, build_twc_saml_signin_url, exchange_twc_auth_code
from app.models.domain import (
    OSLCConsumerCredentials,
    OSLCRootServicesSummary,
    TokenLoginRequest,
    WorkbenchAuthSettings,
    WorkbenchAuthSettingsUpdate,
    WorkbenchGroupCreateRequest,
    WorkbenchGroupUpdateRequest,
    WorkbenchLocalLoginRequest,
    WorkbenchProjectAccessAssignmentRequest,
    WorkbenchUserCreateRequest,
    WorkbenchUserUpdateRequest,
)
from app.services.platform import ApplicationContainer

router = APIRouter(prefix="/auth", tags=["auth"])

logger = structlog.get_logger(__name__)

REDIRECT_SIGNIN_MESSAGE = (
    "Sign in via TWC redirects to the selected Teamwork Cloud Authentication Server, uses that server's configured SAML login, exchanges the returned code with authentication.client.secret, and validates the session through /osmc/admin/currentUser."
)


def set_session_cookie(response: Response, container: ApplicationContainer, session_id: str) -> None:
    response.set_cookie(
        key=container.settings.session_cookie_name,
        value=session_id,
        httponly=True,
        secure=container.settings.secure_cookies,
        samesite="lax",
        max_age=container.settings.session_ttl_minutes * 60,
        path="/",
    )


def set_pending_server_cookie(response: Response, container: ApplicationContainer, server_id: str) -> None:
    response.set_cookie(
        key=container.settings.pending_server_cookie_name,
        value=server_id,
        httponly=True,
        secure=container.settings.secure_cookies,
        samesite="lax",
        max_age=container.settings.session_ttl_minutes * 60,
        path="/",
    )


def clear_pending_server_cookie(response: Response, container: ApplicationContainer) -> None:
    response.delete_cookie(container.settings.pending_server_cookie_name, path="/")


def clear_auth_state_cookie(response: Response, container: ApplicationContainer) -> None:
    response.delete_cookie(container.settings.auth_state_cookie_name, path="/")


def clear_oslc_auth_state_cookie(response: Response, container: ApplicationContainer) -> None:
    response.delete_cookie(container.settings.oslc_auth_state_cookie_name, path="/")


def set_auth_state_cookie(response: Response, container: ApplicationContainer, value: str) -> None:
    response.set_cookie(
        key=container.settings.auth_state_cookie_name,
        value=value,
        httponly=True,
        secure=container.settings.secure_cookies,
        samesite="lax",
        max_age=container.settings.twc_auth_state_ttl_minutes * 60,
        path="/",
    )


def set_oslc_auth_state_cookie(response: Response, container: ApplicationContainer, value: str) -> None:
    response.set_cookie(
        key=container.settings.oslc_auth_state_cookie_name,
        value=value,
        httponly=True,
        secure=container.settings.secure_cookies,
        samesite="lax",
        max_age=container.settings.twc_auth_state_ttl_minutes * 60,
        path="/",
    )


def build_workspace_redirect(
    container: ApplicationContainer,
    session_id: str,
    *,
    params: dict[str, str] | None = None,
) -> RedirectResponse:
    suffix = f"?{urlencode(params)}" if params else ""
    redirect = RedirectResponse(f"{container.settings.resolved_app_origin}/workspace{suffix}", status_code=status.HTTP_302_FOUND)
    set_session_cookie(redirect, container, session_id)
    clear_pending_server_cookie(redirect, container)
    clear_auth_state_cookie(redirect, container)
    clear_oslc_auth_state_cookie(redirect, container)
    return redirect


def build_session_redirect(container: ApplicationContainer, session_id: str) -> RedirectResponse:
    redirect = RedirectResponse(f"{container.settings.resolved_app_origin}/", status_code=status.HTTP_302_FOUND)
    set_session_cookie(redirect, container, session_id)
    clear_pending_server_cookie(redirect, container)
    clear_auth_state_cookie(redirect, container)
    clear_oslc_auth_state_cookie(redirect, container)
    return redirect


def build_error_redirect(container: ApplicationContainer, detail: str) -> RedirectResponse:
    query = urlencode({"authError": detail})
    redirect = RedirectResponse(f"{container.settings.resolved_app_origin}/?{query}", status_code=status.HTTP_302_FOUND)
    clear_pending_server_cookie(redirect, container)
    clear_auth_state_cookie(redirect, container)
    clear_oslc_auth_state_cookie(redirect, container)
    return redirect


def upstream_signin_context(request: Request, container: ApplicationContainer) -> tuple[str | None, dict[str, str], str | None]:
    access_token = container.settings.extract_upstream_access_token(request.headers)
    session_cookies = container.settings.extract_upstream_auth_cookies(request.cookies)
    preferred_username = container.settings.extract_upstream_username(request.headers)
    return access_token, session_cookies, preferred_username


def _urlsafe_b64encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def _urlsafe_b64decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + ("=" * (-len(value) % 4)))


def create_auth_state_cookie(container: ApplicationContainer, server_id: str) -> tuple[str, str]:
    state = secrets.token_urlsafe(24)
    payload = json.dumps(
        {
            "state": state,
            "server_id": server_id,
            "issued_at": datetime.now(UTC).isoformat(),
        },
        separators=(",", ":"),
    ).encode("utf-8")
    signature = hmac.new(container.settings.session_secret.encode("utf-8"), payload, hashlib.sha256).digest()
    return state, f"{_urlsafe_b64encode(payload)}.{_urlsafe_b64encode(signature)}"


def load_auth_state_cookie(container: ApplicationContainer, raw_value: str | None) -> dict[str, str] | None:
    if not raw_value or "." not in raw_value:
        return None

    encoded_payload, encoded_signature = raw_value.split(".", 1)
    try:
        payload = _urlsafe_b64decode(encoded_payload)
        signature = _urlsafe_b64decode(encoded_signature)
    except Exception:
        return None

    expected_signature = hmac.new(container.settings.session_secret.encode("utf-8"), payload, hashlib.sha256).digest()
    if not hmac.compare_digest(signature, expected_signature):
        return None

    try:
        data = json.loads(payload)
    except json.JSONDecodeError:
        return None

    issued_at_raw = data.get("issued_at")
    if not isinstance(issued_at_raw, str):
        return None
    try:
        issued_at = datetime.fromisoformat(issued_at_raw)
    except ValueError:
        return None

    if issued_at < datetime.now(UTC) - timedelta(minutes=container.settings.twc_auth_state_ttl_minutes):
        return None

    if not isinstance(data.get("state"), str) or not isinstance(data.get("server_id"), str):
        return None
    return {"state": data["state"], "server_id": data["server_id"]}


def create_oslc_auth_state_cookie(
    container: ApplicationContainer,
    *,
    session_id: str,
    server_id: str,
    state: str,
    request_token: str,
    request_token_secret: str,
    rootservices_summary: dict[str, str | None],
    consumer_key: str | None = None,
    consumer_secret: str | None = None,
) -> str:
    payload = json.dumps(
        {
            "session_id": session_id,
            "server_id": server_id,
            "state": state,
            "request_token": request_token,
            "request_token_secret": request_token_secret,
            "rootservices_summary": rootservices_summary,
            "consumer_key": consumer_key,
            "consumer_secret": consumer_secret,
            "issued_at": datetime.now(UTC).isoformat(),
        },
        separators=(",", ":"),
    ).encode("utf-8")
    return container.sessions.cipher.encrypt_raw(payload)


def load_oslc_auth_state_cookie(container: ApplicationContainer, raw_value: str | None) -> dict[str, object] | None:
    if not raw_value:
        return None
    try:
        payload = container.sessions.cipher.decrypt_raw(raw_value)
        data = json.loads(payload)
    except Exception:
        return None

    issued_at_raw = data.get("issued_at")
    if not isinstance(issued_at_raw, str):
        return None
    try:
        issued_at = datetime.fromisoformat(issued_at_raw)
    except ValueError:
        return None

    if issued_at < datetime.now(UTC) - timedelta(minutes=container.settings.twc_auth_state_ttl_minutes):
        return None

    required_fields = ("session_id", "server_id", "state", "request_token", "request_token_secret")
    if any(not isinstance(data.get(field), str) or not str(data.get(field)).strip() for field in required_fields):
        return None

    if not isinstance(data.get("rootservices_summary"), dict):
        data["rootservices_summary"] = {}
    return data


@router.get("/session")
async def get_session_snapshot(
    request: Request,
    response: Response,
    container: ApplicationContainer = Depends(get_container),
):
    session_id = request.cookies.get(container.settings.session_cookie_name)
    try:
        live_session = await container.platform.get_live_session(session_id)
    except PermissionError:
        live_session = None
        if session_id:
            container.sessions.destroy_session(session_id)
            response.delete_cookie(container.settings.session_cookie_name, path="/")
    snapshot = container.platform.get_session_snapshot_for_session(live_session)
    if snapshot.authenticated:
        return snapshot

    pending_server_id = request.cookies.get(container.settings.pending_server_cookie_name)
    if not pending_server_id:
        return snapshot

    pending_server = container.platform.get_server(pending_server_id, include_disabled=False)
    if not pending_server:
        clear_pending_server_cookie(response, container)
        clear_auth_state_cookie(response, container)
        return snapshot

    return snapshot.model_copy(update={"pending_server": pending_server})


@router.get("/options")
def get_auth_options(container: ApplicationContainer = Depends(get_container)):
    settings = container.platform.get_auth_settings()
    return {
        "local_signin_enabled": settings.local_users_enabled,
        "token_signin_enabled": settings.twc_token_enabled,
        "redirect_signin_enabled": settings.twc_redirect_enabled,
        "redirect_signin_message": REDIRECT_SIGNIN_MESSAGE,
        "csrf_header_name": container.settings.csrf_header_name,
        "user_management_mode": settings.user_management_mode,
    }


@router.get("/signin/{server_id}")
async def signin(server_id: str, container: ApplicationContainer = Depends(get_container)):
    if not container.platform.get_auth_settings().twc_redirect_enabled:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="TWC browser sign-in is disabled.")
    server = container.platform.get_server(server_id, include_disabled=False)
    if not server:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Preset server not found")

    state, cookie_value = create_auth_state_cookie(container, server.id)
    try:
        twc_signin_url = build_twc_saml_signin_url(container, server, state)
    except ValueError as exc:
        logger.warning("auth-signin-failed", auth_mode="twc-authserver-redirect-start", server_id=server.id, detail=str(exc))
        return build_error_redirect(container, str(exc))
    redirect = RedirectResponse(twc_signin_url, status_code=status.HTTP_302_FOUND)
    set_pending_server_cookie(redirect, container, server.id)
    set_auth_state_cookie(redirect, container, cookie_value)
    logger.info(
        "auth-mode-selected",
        auth_mode="twc-authserver-redirect-start",
        server_id=server.id,
        twc_authorize_url=build_twc_authorize_base_url(container, server),
        callback=container.settings.resolved_twc_auth_callback_url,
    )
    return redirect


@router.get("/callback")
async def callback(
    request: Request,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    error_description: str | None = None,
    container: ApplicationContainer = Depends(get_container),
):
    if error:
        logger.warning("auth-callback-failed", auth_mode="redirect-callback", detail=error_description or error)
        return build_error_redirect(container, error_description or error)

    pending_server_id = request.cookies.get(container.settings.pending_server_cookie_name)
    auth_state = load_auth_state_cookie(container, request.cookies.get(container.settings.auth_state_cookie_name))
    if not pending_server_id or not auth_state:
        logger.warning("auth-callback-failed", auth_mode="redirect-callback", detail="Authentication state is missing or expired")
        return build_error_redirect(container, "Authentication state is missing or expired. Start Sign in via TWC again.")

    if auth_state["server_id"] != pending_server_id:
        logger.warning("auth-callback-failed", auth_mode="redirect-callback", detail="Selected Teamwork Cloud server no longer matches callback state")
        return build_error_redirect(container, "Selected Teamwork Cloud server no longer matches callback state. Start Sign in via TWC again.")

    relay_state = request.query_params.get("RelayState")
    callback_state = state or relay_state
    if callback_state and callback_state != auth_state["state"]:
        logger.warning("auth-callback-failed", auth_mode="redirect-callback", detail="Authentication state mismatch")
        return build_error_redirect(container, "Authentication state mismatch. Start Sign in via TWC again.")

    server = container.platform.get_server(auth_state["server_id"], include_disabled=False)
    if not server:
        logger.warning("auth-callback-failed", auth_mode="redirect-callback", detail="Preset server not found")
        return build_error_redirect(container, "Preset server not found")

    session = None
    if code:
        try:
            token_bundle = await exchange_twc_auth_code(container, server, code)
            session = await container.platform.login_with_token_bundle(
                server.id,
                token_bundle,
                upstream_roles=container.settings.extract_upstream_roles(request.headers),
                upstream_groups=container.settings.extract_upstream_groups(request.headers),
            )
        except PermissionError as exc:
            logger.warning("auth-callback-failed", auth_mode="authserver-code-callback", server_id=server.id, detail=str(exc))
            return build_error_redirect(container, str(exc))

    access_token, session_cookies, preferred_username = upstream_signin_context(request, container)
    if session is None and not access_token and not session_cookies:
        logger.warning(
            "auth-callback-failed",
            auth_mode="redirect-callback",
            server_id=server.id,
            detail="No Teamwork Cloud AuthServer code, upstream session, or upstream token was available at the callback.",
        )
        return build_error_redirect(
            container,
            "TWC sign-in returned to the app, but the callback did not receive an AuthServer code, Teamwork Cloud session cookies, or forwarded access token.",
        )

    if session is None:
        try:
            session = await container.platform.login_with_upstream_session(
                server.id,
                access_token=access_token,
                session_cookies=session_cookies,
                preferred_username=preferred_username,
                upstream_roles=container.settings.extract_upstream_roles(request.headers),
                upstream_groups=container.settings.extract_upstream_groups(request.headers),
            )
        except PermissionError as exc:
            logger.warning("auth-callback-failed", auth_mode="redirect-callback", server_id=server.id, detail=str(exc))
            return build_error_redirect(container, str(exc))

    logger.info(
        "auth-mode-selected",
        auth_mode="redirect-callback-complete",
        server_id=server.id,
        user=session.user.preferred_username,
        has_access_token=bool(access_token),
        cookie_count=len(session_cookies),
    )
    return build_session_redirect(container, session.session_id)


@router.get("/oslc/signin")
async def oslc_signin(
    session=Depends(require_admin),
    container: ApplicationContainer = Depends(get_container),
):
    server = container.platform.get_server(session.server.id, include_disabled=False)
    if not server:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Preset server not found")

    shared_consumer, _ = container.platform._shared_oslc_consumer_credentials(server.id)
    session_consumer = container.sessions.get_oslc_consumer_credentials(session)
    resolved_consumer = container.oauth.effective_consumer_credentials(server, shared_consumer, session_consumer)
    configuration_error = container.oauth.configuration_error(server, shared_consumer, session_consumer)
    if configuration_error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=configuration_error)

    try:
        discovery = await container.oauth.discover(server)
        state = secrets.token_urlsafe(24)
        callback_url = f"{container.settings.resolved_twc_oslc_callback_url}?{urlencode({'state': state})}"
        request_token, request_token_secret = await container.oauth.request_token(
            server,
            discovery.summary,
            callback_url,
            consumer_credentials=resolved_consumer,
            shared_credentials=shared_consumer,
        )
        cookie_value = create_oslc_auth_state_cookie(
            container,
            session_id=session.session_id,
            server_id=server.id,
            state=state,
            request_token=request_token,
            request_token_secret=request_token_secret,
            rootservices_summary=discovery.summary.model_dump(),
            consumer_key=resolved_consumer.consumer_key if resolved_consumer else None,
            consumer_secret=resolved_consumer.consumer_secret if resolved_consumer else None,
        )
    except (PermissionError, RuntimeError) as exc:
        logger.warning("auth-oslc-signin-failed", server_id=server.id, detail=str(exc))
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    redirect = RedirectResponse(
        container.oauth.authorize_redirect_url(discovery.summary, request_token),
        status_code=status.HTTP_302_FOUND,
    )
    set_oslc_auth_state_cookie(redirect, container, cookie_value)
    return redirect


@router.get("/oslc/callback")
async def oslc_callback(
    request: Request,
    oauth_token: str | None = None,
    oauth_verifier: str | None = None,
    state: str | None = None,
    error: str | None = None,
    error_description: str | None = None,
    container: ApplicationContainer = Depends(get_container),
):
    oslc_state = load_oslc_auth_state_cookie(container, request.cookies.get(container.settings.oslc_auth_state_cookie_name))
    session_id = request.cookies.get(container.settings.session_cookie_name) or (
        str(oslc_state["session_id"]) if oslc_state else None
    )
    session = container.sessions.get_session(session_id)
    if not session:
        return build_error_redirect(container, "The app session expired before OSLC authorization completed. Sign in again.")

    if error:
        return build_workspace_redirect(container, session.session_id, params={"oslcAuthError": error_description or error})

    if not oslc_state:
        return build_workspace_redirect(
            container,
            session.session_id,
            params={"oslcAuthError": "OSLC authorization state is missing or expired. Start OSLC sign-in again."},
        )

    if state != oslc_state["state"]:
        return build_workspace_redirect(
            container,
            session.session_id,
            params={"oslcAuthError": "OSLC authorization state mismatch. Start OSLC sign-in again."},
        )

    if oauth_token != oslc_state["request_token"] or not oauth_verifier:
        return build_workspace_redirect(
            container,
            session.session_id,
            params={"oslcAuthError": "OSLC callback did not return the expected OAuth verifier."},
        )

    server = container.platform.get_server(str(oslc_state["server_id"]), include_disabled=False)
    if not server:
        return build_workspace_redirect(container, session.session_id, params={"oslcAuthError": "Preset server not found."})

    try:
        summary = OSLCRootServicesSummary.model_validate(oslc_state.get("rootservices_summary") or {})
        shared_consumer, _ = container.platform._shared_oslc_consumer_credentials(server.id)
        consumer_credentials = None
        consumer_key = oslc_state.get("consumer_key")
        consumer_secret = oslc_state.get("consumer_secret")
        if isinstance(consumer_key, str) and consumer_key.strip() and isinstance(consumer_secret, str) and consumer_secret.strip():
            consumer_credentials = OSLCConsumerCredentials(
                consumer_key=consumer_key.strip(),
                consumer_secret=consumer_secret.strip(),
                source="session",
            )
        credentials = await container.oauth.access_token(
            server,
            summary,
            request_token=str(oslc_state["request_token"]),
            request_token_secret=str(oslc_state["request_token_secret"]),
            verifier=oauth_verifier,
            consumer_credentials=consumer_credentials,
            shared_credentials=shared_consumer,
        )
        container.sessions.set_oslc_credentials(session, credentials)
    except (PermissionError, RuntimeError) as exc:
        logger.warning("auth-oslc-callback-failed", server_id=server.id, detail=str(exc))
        return build_workspace_redirect(container, session.session_id, params={"oslcAuthError": str(exc)})

    return build_workspace_redirect(container, session.session_id, params={"oslcAuth": "connected"})


@router.post("/token")
async def token_login(
    payload: TokenLoginRequest,
    request: Request,
    response: Response,
    container: ApplicationContainer = Depends(get_container),
):
    if not container.platform.get_auth_settings().twc_token_enabled:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="TWC token sign-in is disabled.")
    logger.info("auth-mode-selected", auth_mode="token", server_id=payload.server_id)
    try:
        session = await container.platform.login_with_token(
            payload,
            upstream_roles=container.settings.extract_upstream_roles(request.headers),
            upstream_groups=container.settings.extract_upstream_groups(request.headers),
        )
    except KeyError as exc:
        logger.warning("auth-token-login-failed", auth_mode="token", server_id=payload.server_id, detail="Preset server not found")
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Preset server not found") from exc
    except PermissionError as exc:
        logger.warning("auth-token-login-failed", auth_mode="token", server_id=payload.server_id, detail=str(exc))
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc

    set_session_cookie(response, container, session.session_id)
    clear_pending_server_cookie(response, container)
    return container.platform.get_session_snapshot(session.session_id)


@router.post("/workbench/login")
def workbench_login(
    payload: WorkbenchLocalLoginRequest,
    response: Response,
    container: ApplicationContainer = Depends(get_container),
):
    logger.info("auth-mode-selected", auth_mode="workbench-local", server_id=payload.server_id)
    try:
        session = container.platform.login_with_workbench_password(payload)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Preset server not found") from exc
    except (PermissionError, ValueError) as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc

    set_session_cookie(response, container, session.session_id)
    clear_pending_server_cookie(response, container)
    return container.platform.get_session_snapshot(session.session_id)


@router.get("/management/status")
def auth_management_status(
    session=Depends(require_admin),
    container: ApplicationContainer = Depends(get_container),
):
    return container.platform.auth_admin_status(session)


@router.put("/management/settings")
def update_auth_management_settings(
    payload: WorkbenchAuthSettingsUpdate,
    session=Depends(require_admin_csrf),
    container: ApplicationContainer = Depends(get_container),
) -> WorkbenchAuthSettings:
    try:
        return container.platform.update_auth_settings(payload)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.get("/management/users")
def list_workbench_users(
    session=Depends(require_group_manager),
    container: ApplicationContainer = Depends(get_container),
):
    return container.platform.list_workbench_users(session)


@router.post("/management/users")
def create_workbench_user(
    payload: WorkbenchUserCreateRequest,
    session=Depends(require_admin_csrf),
    container: ApplicationContainer = Depends(get_container),
):
    try:
        return container.platform.create_workbench_user(payload)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.put("/management/users/{username}")
def update_workbench_user(
    username: str,
    payload: WorkbenchUserUpdateRequest,
    session=Depends(require_admin_csrf),
    container: ApplicationContainer = Depends(get_container),
):
    try:
        return container.platform.update_workbench_user(username, payload)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workbench user not found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.delete("/management/users/{username}")
def delete_workbench_user(
    username: str,
    session=Depends(require_admin_csrf),
    container: ApplicationContainer = Depends(get_container),
):
    try:
        deleted = container.platform.delete_workbench_user(username)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workbench user not found")
    return {"ok": True}


@router.get("/management/groups")
def list_workbench_groups(
    session=Depends(require_group_manager),
    container: ApplicationContainer = Depends(get_container),
):
    return container.platform.list_workbench_groups(session)


@router.post("/management/groups")
def create_workbench_group(
    payload: WorkbenchGroupCreateRequest,
    session=Depends(require_admin_csrf),
    container: ApplicationContainer = Depends(get_container),
):
    try:
        return container.platform.create_workbench_group(payload)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.put("/management/groups/{name}")
def update_workbench_group(
    name: str,
    payload: WorkbenchGroupUpdateRequest,
    session=Depends(require_group_manager_csrf),
    container: ApplicationContainer = Depends(get_container),
):
    try:
        return container.platform.update_workbench_group(session, name, payload)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workbench group not found") from exc
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.delete("/management/groups/{name}")
def delete_workbench_group(
    name: str,
    session=Depends(require_admin_csrf),
    container: ApplicationContainer = Depends(get_container),
):
    try:
        if not container.platform.delete_workbench_group(session, name):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workbench group not found")
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    return {"ok": True}


@router.post("/management/project-access")
def assign_workbench_project_access(
    payload: WorkbenchProjectAccessAssignmentRequest,
    session=Depends(require_admin_csrf),
    container: ApplicationContainer = Depends(get_container),
):
    try:
        return container.platform.assign_workbench_project_access(session, payload)
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc


@router.post("/logout")
def logout(
    response: Response,
    request: Request,
    session=Depends(require_csrf),
    container: ApplicationContainer = Depends(get_container),
):
    session_id = request.cookies.get(container.settings.session_cookie_name)
    if session_id:
        container.sessions.destroy_session(session_id)
    response.delete_cookie(container.settings.session_cookie_name, path="/")
    clear_pending_server_cookie(response, container)
    clear_auth_state_cookie(response, container)
    clear_oslc_auth_state_cookie(response, container)
    return {"ok": True}
