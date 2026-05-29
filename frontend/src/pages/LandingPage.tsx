import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Box,
  Button,
  Chip,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import Grid from "@mui/material/GridLegacy";
import HttpsRoundedIcon from "@mui/icons-material/HttpsRounded";
import LoginRoundedIcon from "@mui/icons-material/LoginRounded";
import MonitorHeartRoundedIcon from "@mui/icons-material/MonitorHeartRounded";
import PublicRoundedIcon from "@mui/icons-material/PublicRounded";
import VpnKeyRoundedIcon from "@mui/icons-material/VpnKeyRounded";
import VerifiedUserRoundedIcon from "@mui/icons-material/VerifiedUserRounded";

import { ServerHealth, TokenLoginRequest } from "../models/api";
import { api } from "../services/api";
import { useSession } from "../state/SessionProvider";

function healthColor(status?: ServerHealth["status"]): "success" | "warning" | "error" | "default" {
  if (status === "healthy") {
    return "success";
  }
  if (status === "degraded") {
    return "warning";
  }
  if (status === "unreachable") {
    return "error";
  }
  return "default";
}

function errorMessage(caught: unknown): string {
  return caught instanceof Error ? caught.message : "The request failed.";
}

export default function LandingPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { authOptions, error, session, setSessionSnapshot } = useSession();
  const [tokenDialogOpen, setTokenDialogOpen] = useState(false);
  const [tokenForm, setTokenForm] = useState<TokenLoginRequest>({
    server_id: "",
    token: "",
  });
  const [banner, setBanner] = useState<{ severity: "success" | "error"; message: string } | null>(null);

  const serversQuery = useQuery({
    queryKey: ["servers"],
    queryFn: api.listServers,
  });

  const healthQueries = useQueries({
    queries: (serversQuery.data ?? []).map((server) => ({
      queryKey: ["server-health", server.id],
      queryFn: () => api.getServerHealth(server.id),
      staleTime: 60_000,
    })),
  });

  const tokenMutation = useMutation({
    mutationFn: api.tokenLogin,
    onSuccess: (snapshot) => {
      setSessionSnapshot(snapshot);
      navigate("/workspace", { replace: true });
    },
    onError: (caught) => setBanner({ severity: "error", message: errorMessage(caught) }),
  });

  const healthById = new Map<string, ServerHealth>();
  healthQueries.forEach((query) => {
    if (query.data) {
      healthById.set(query.data.server_id, query.data);
    }
  });

  const servers = serversQuery.data ?? [];
  const pendingServer = session?.pending_server ?? null;
  const selectedTokenServer = servers.find((server) => server.id === tokenForm.server_id) ?? null;
  const authError = searchParams.get("authError");
  const redirectSignInEnabled = authOptions?.redirect_signin_enabled !== false;

  const openTokenDialog = (serverId: string) => {
    setTokenForm({ server_id: serverId, token: "" });
    setTokenDialogOpen(true);
  };

  const closeTokenDialog = () => {
    setTokenDialogOpen(false);
    setTokenForm((current) => ({ ...current, token: "" }));
  };

  return (
    <Container maxWidth="xl" sx={{ py: { xs: 3, md: 5 } }}>
      <Stack spacing={3}>
        <Paper
          sx={{
            overflow: "hidden",
            p: { xs: 2.5, md: 4 },
            borderRadius: 6,
            color: "#f8fbff",
            background: "linear-gradient(120deg, #2d6fb2 0%, #275f98 28%, #247a8d 68%, #28b37a 100%)",
            boxShadow: "0 28px 60px rgba(12, 38, 73, 0.22)",
          }}
        >
          <Grid container spacing={3} alignItems="stretch">
            <Grid item xs={12} lg={8}>
              <Stack spacing={2.5} sx={{ height: "100%" }}>
                <Chip
                  icon={<MonitorHeartRoundedIcon sx={{ color: "inherit !important" }} />}
                  label="Teamwork Cloud 2022x"
                  size="small"
                  variant="outlined"
                  sx={{
                    alignSelf: "flex-start",
                    color: "#f8fbff",
                    borderColor: "rgba(255,255,255,0.32)",
                    backgroundColor: "rgba(18, 48, 92, 0.18)",
                  }}
                />
                <Box>
                  <Typography
                    variant="h1"
                    sx={{
                      fontSize: { xs: "2.5rem", md: "4rem" },
                      lineHeight: 1.05,
                      letterSpacing: 0,
                      maxWidth: 920,
                    }}
                  >
                    TWC WorkBench
                  </Typography>
                  <Typography
                    variant="h6"
                    sx={{
                      mt: 2,
                      maxWidth: 940,
                      fontWeight: 400,
                      color: "rgba(244, 249, 255, 0.9)",
                      fontSize: { xs: "1rem", md: "1.15rem" },
                    }}
                  >
                    Secure Enterprise Workbench for teamwork cloud repository browsing,item details and compact work flows
                  </Typography>
                </Box>
                <Button
                  variant="outlined"
                  startIcon={<MonitorHeartRoundedIcon />}
                  onClick={() => queryClient.invalidateQueries({ queryKey: ["server-health"] })}
                  sx={{
                    alignSelf: "stretch",
                    maxWidth: { xs: "100%", lg: 880 },
                    color: "#f8fbff",
                    borderColor: "rgba(255,255,255,0.78)",
                    backgroundColor: "rgba(17, 48, 93, 0.12)",
                    "&:hover": {
                      borderColor: "#f8fbff",
                      backgroundColor: "rgba(17, 48, 93, 0.22)",
                    },
                  }}
                >
                  Refresh Health
                </Button>
              </Stack>
            </Grid>
            <Grid item xs={12} lg={4}>
              <Paper
                sx={{
                  height: "100%",
                  p: 3,
                  borderRadius: 5,
                  backgroundColor: "rgba(16, 61, 78, 0.56)",
                  color: "#f8fbff",
                  boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.08)",
                }}
              >
                <Stack spacing={2}>
                  <Typography variant="h4" sx={{ color: "#f8fbff", fontSize: { xs: "1.85rem", md: "2.1rem" } }}>
                    Platform Summary
                  </Typography>
                  <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                    <Chip
                      label={`${servers.length} available presets`}
                      size="small"
                      variant="outlined"
                      sx={{ color: "#f8fbff", borderColor: "rgba(255,255,255,0.22)", backgroundColor: "rgba(10, 34, 51, 0.14)" }}
                    />
                    <Chip
                      label="Central admin catalog"
                      size="small"
                      variant="outlined"
                      sx={{ color: "#f8fbff", borderColor: "rgba(255,255,255,0.22)", backgroundColor: "rgba(10, 34, 51, 0.14)" }}
                    />
                    <Chip
                      label="User-scoped TWC auth"
                      size="small"
                      variant="outlined"
                      sx={{ color: "#f8fbff", borderColor: "rgba(255,255,255,0.22)", backgroundColor: "rgba(10, 34, 51, 0.14)" }}
                    />
                  </Stack>
                  <Typography variant="body1" sx={{ color: "rgba(244, 249, 255, 0.92)", lineHeight: 1.5 }}>
                    TWC remains the authentication and authorization authority. Sign in via TWC uses the selected server&apos;s Authentication Server and its configured SAML login, while token sign-in remains available as a fallback.
                  </Typography>
                  <Stack spacing={1.1}>
                    <Stack direction="row" spacing={1.25} alignItems="center">
                      <HttpsRoundedIcon fontSize="small" />
                      <Typography variant="body2" sx={{ color: "#f8fbff" }}>
                        TLS verification and custom CA bundle support
                      </Typography>
                    </Stack>
                    <Stack direction="row" spacing={1.25} alignItems="center">
                      <PublicRoundedIcon fontSize="small" />
                      <Typography variant="body2" sx={{ color: "#f8fbff" }}>
                        RealSwagger-backed repository workflows
                      </Typography>
                    </Stack>
                    <Stack direction="row" spacing={1.25} alignItems="center">
                      <VerifiedUserRoundedIcon fontSize="small" />
                      <Typography variant="body2" sx={{ color: "#f8fbff" }}>
                        Permissions stay aligned to the active Teamwork Cloud user session
                      </Typography>
                    </Stack>
                  </Stack>
                </Stack>
              </Paper>
            </Grid>
          </Grid>
        </Paper>

        {banner ? <Alert severity={banner.severity}>{banner.message}</Alert> : null}
        {authError ? <Alert severity="error">{authError}</Alert> : null}
        {authOptions?.redirect_signin_message ? <Alert severity="info">{authOptions.redirect_signin_message}</Alert> : null}
        {redirectSignInEnabled && pendingServer ? (
          <Alert
            severity="info"
            action={
              <Button color="inherit" size="small" onClick={() => window.location.assign(api.signInUrl(pendingServer.id))} disabled={!redirectSignInEnabled}>
                Continue TWC Sign-In
              </Button>
            }
          >
            Selected server: {pendingServer.name}. If your TWC SSO login completed in another tab or your proxy just established the upstream user session, continue here to finish the app session.
          </Alert>
        ) : null}
        {error ? <Alert severity="warning">{error}</Alert> : null}

        <Grid container spacing={3}>
          <Grid item xs={12} lg={8}>
            <Stack spacing={2}>
              <Typography variant="h4">Teamwork Cloud Presets</Typography>
              <Typography variant="body2" color="text.secondary">
                Choose the configured Teamwork Cloud 2022x server before app authentication. Preset definitions are global app data, readable on this landing page without prior login, and managed centrally by administrators.
              </Typography>
              {serversQuery.isLoading ? (
                <Paper sx={{ p: 4, borderRadius: 5 }}>
                  <Typography color="text.secondary">Loading preset servers...</Typography>
                </Paper>
              ) : servers.length ? (
                <Grid container spacing={2}>
                  {servers.map((server) => {
                    const health = healthById.get(server.id);
                    return (
                      <Grid item xs={12} md={6} key={server.id}>
                        <Paper sx={{ p: 3, borderRadius: 2, height: "100%" }}>
                            <Stack spacing={2.5} sx={{ height: "100%" }}>
                              <Stack spacing={1}>
                                <Box>
                                  <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap">
                                    <Typography variant="h5">{server.name}</Typography>
                                    <Chip size="small" label="Preset" variant="outlined" />
                                  </Stack>
                                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
                                    {server.base_url}
                                  </Typography>
                                </Box>
                              </Stack>
                              <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                                <Chip label={`Version ${health?.version_hint ?? "2022x"}`} variant="outlined" />
                                <Chip label={`Order ${server.display_order}`} variant="outlined" />
                                <Chip label="TWC user auth" variant="outlined" />
                                <Chip label={health?.status ?? "probing"} color={healthColor(health?.status)} />
                                <Chip label={server.verify_tls ? "TLS verified" : "TLS relaxed"} variant="outlined" />
                              </Stack>
                              <Stack spacing={0.75}>
                                <Typography variant="body2" color="text.secondary">
                                  The selected preset server is established first. Sign in via TWC preserves that selection through the callback and binds the app session to that same Teamwork Cloud server.
                                </Typography>
                                {health?.message ? (
                                  <Typography variant="body2" color="warning.main">
                                    {health.message}
                                  </Typography>
                                ) : null}
                              </Stack>
                              <Stack direction={{ xs: "column", sm: "row" }} spacing={1.25} sx={{ mt: "auto" }}>
                                {redirectSignInEnabled ? (
                                  <Button
                                    fullWidth
                                    variant="contained"
                                    startIcon={<LoginRoundedIcon />}
                                    onClick={() => window.location.assign(api.signInUrl(server.id))}
                                  >
                                    Sign In via TWC
                                  </Button>
                                ) : null}
                                {authOptions?.token_signin_enabled !== false ? (
                                  <Button
                                    fullWidth
                                    variant="outlined"
                                    startIcon={<VpnKeyRoundedIcon />}
                                    onClick={() => openTokenDialog(server.id)}
                                  >
                                    Use TWC Token
                                  </Button>
                                ) : null}
                              </Stack>
                            </Stack>
                        </Paper>
                      </Grid>
                    );
                  })}
                </Grid>
              ) : (
                <Paper sx={{ p: 5, borderRadius: 5, textAlign: "center" }}>
                  <Typography variant="h5">No preset servers available</Typography>
                  <Typography variant="body1" color="text.secondary" sx={{ mt: 1 }}>
                    An administrator needs to publish at least one enabled Teamwork Cloud preset before users can sign in.
                  </Typography>
                </Paper>
              )}
            </Stack>
          </Grid>
          <Grid item xs={12} lg={4}>
            <Stack spacing={2}>
              <Paper sx={{ p: 3, borderRadius: 5 }}>
                <Typography variant="h5">Operational Guidance</Typography>
                <Stack spacing={1.5} sx={{ mt: 2 }}>
                  <Typography variant="body2" color="text.secondary">
                    This deployment exposes Teamwork Cloud presets before login so users can choose the configured 2022x server first. Sign in via TWC preserves that selected server until the callback finishes the app session.
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    TWC Authentication Server handles SAML. After login, the app exchanges the returned code using the registered client id and Authentication Server secret, then validates the user against Teamwork Cloud.
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    OSLC uses its own OAuth consumer authorization. After you enter the workbench, the OSLC Explorer can connect that separate lane for approved consumer keys without changing the main TWC session.
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Use TWC Token remains available as a fallback. The backend validates that token against the selected Teamwork Cloud server before opening a workbench session.
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Preset server definitions are global and admin-managed. Users do not edit `.env` and do not create their own target servers on the landing page.
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    For enterprise deployments, keep certificate validation enabled and provide a CA bundle path when your Teamwork Cloud environment is issued by a private PKI.
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Server profiles default to 2022x so the workbench stays aligned to the supported deployment profile.
                  </Typography>
                </Stack>
              </Paper>
              <Paper sx={{ p: 3, borderRadius: 5 }}>
                <Typography variant="h5">Feature Envelope</Typography>
                <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mt: 2 }}>
                  <Chip label="Projects and model browsing" color="success" />
                  <Chip label="Item details" color="success" />
                  <Chip label="Compare and revision diff" color="success" />
                  <Chip label="TWC SAML sign-in" color="success" />
                  <Chip label="OSLC OAuth explorer" color="success" />
                </Stack>
              </Paper>
            </Stack>
          </Grid>
        </Grid>
      </Stack>

      <Dialog open={tokenDialogOpen} onClose={closeTokenDialog} fullWidth maxWidth="sm">
        <DialogTitle>Teamwork Cloud Token Sign-In</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Alert severity="info">
              Provide a user-scoped Teamwork Cloud token. The backend will validate it against TWC and create a local session only after resolving the authenticated TWC user.
            </Alert>
            {selectedTokenServer ? <Typography variant="body2">Server: {selectedTokenServer.name}</Typography> : null}
            <TextField
              label="Teamwork Cloud Token"
              type="password"
              value={tokenForm.token}
              onChange={(event) => setTokenForm((current) => ({ ...current, token: event.target.value }))}
              fullWidth
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button onClick={closeTokenDialog}>Cancel</Button>
          <Button
            variant="contained"
            startIcon={<VpnKeyRoundedIcon />}
            disabled={!tokenForm.server_id || !tokenForm.token || tokenMutation.isPending}
            onClick={async () => {
              await tokenMutation.mutateAsync(tokenForm);
              closeTokenDialog();
            }}
          >
            Sign In with Token
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}
