from __future__ import annotations

from fastapi import Depends, HTTPException, Request, status

from app.models.domain import CacheApiKeyScope
from app.security.session import SessionManager
from app.services.platform import ApplicationContainer


def get_container(request: Request) -> ApplicationContainer:
    return request.app.state.container


def _extract_bearer_token(request: Request) -> str | None:
    header = request.headers.get("authorization")
    if not header:
        return None
    scheme, _, value = header.partition(" ")
    if scheme.lower() != "bearer" or not value.strip():
        return None
    return value.strip()


async def get_session(request: Request, container: ApplicationContainer = Depends(get_container)):
    session = await container.platform.get_live_session(request.cookies.get(container.settings.session_cookie_name))
    if not session:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")
    return session


def require_csrf(
    request: Request,
    session=Depends(get_session),
    container: ApplicationContainer = Depends(get_container),
):
    token = request.headers.get(container.settings.csrf_header_name)
    if not container.sessions.validate_csrf(session, token):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid CSRF token")
    return session


def require_admin(
    session=Depends(get_session),
    container: ApplicationContainer = Depends(get_container),
):
    if not container.platform.can_manage_server_presets(session):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Administrator access required")
    return session


def require_group_manager(
    session=Depends(get_session),
    container: ApplicationContainer = Depends(get_container),
):
    if not container.platform.can_manage_groups(session):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Group manager access required")
    return session


def require_admin_csrf(
    request: Request,
    session=Depends(require_admin),
    container: ApplicationContainer = Depends(get_container),
):
    token = request.headers.get(container.settings.csrf_header_name)
    if not container.sessions.validate_csrf(session, token):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid CSRF token")
    return session


def require_group_manager_csrf(
    request: Request,
    session=Depends(require_group_manager),
    container: ApplicationContainer = Depends(get_container),
):
    token = request.headers.get(container.settings.csrf_header_name)
    if not container.sessions.validate_csrf(session, token):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid CSRF token")
    return session


def require_cache_ingest_token(
    request: Request,
    container: ApplicationContainer = Depends(get_container),
):
    token = _extract_bearer_token(request)
    if token and container.platform.is_valid_cache_ingest_token(token):
        return token
    identity = container.platform.authenticate_cache_api_token(token or "")
    if not identity or CacheApiKeyScope.WRITE not in identity.scopes:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Valid cache ingest bearer token required")
    return identity


def require_cache_api_token(
    request: Request,
    container: ApplicationContainer = Depends(get_container),
):
    token = _extract_bearer_token(request)
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Valid cache API bearer token required")
    identity = container.platform.authenticate_cache_api_token(token)
    if not identity or not identity.preferred_username.strip():
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Valid cache API bearer token required")
    if CacheApiKeyScope.READ not in identity.scopes:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This API key does not allow cache reads.")
    return identity.preferred_username.strip()


def require_cache_api_identity(
    request: Request,
    container: ApplicationContainer = Depends(get_container),
):
    token = _extract_bearer_token(request)
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Valid cache API bearer token required")
    identity = container.platform.authenticate_cache_api_token(token)
    if not identity or not identity.preferred_username.strip():
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Valid cache API bearer token required")
    return identity


def require_cache_api_scope(scope: CacheApiKeyScope):
    def dependency(identity=Depends(require_cache_api_identity)):
        if scope not in identity.scopes:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"This API key does not allow {scope.value} access.")
        return identity

    return dependency
