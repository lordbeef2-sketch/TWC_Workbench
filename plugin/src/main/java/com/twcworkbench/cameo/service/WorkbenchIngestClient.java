package com.twcworkbench.cameo.service;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.nomagic.magicdraw.core.Application;
import com.twcworkbench.cameo.config.PluginConfig;
import com.twcworkbench.cameo.model.BranchIngestState;
import com.twcworkbench.cameo.model.BranchDeltaPayload;
import com.twcworkbench.cameo.model.BranchSnapshotPayload;

import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.HttpTimeoutException;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;

import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLParameters;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;
import java.security.cert.X509Certificate;
import java.util.function.Consumer;

public class WorkbenchIngestClient {
    private static final int MIN_LONG_RUNNING_POST_TIMEOUT_SECONDS = 600;
    private static final int POST_COMPLETION_CONFIRMATION_SECONDS = 420;
    private static final int POST_COMPLETION_POLL_SECONDS = 15;

    private final PluginConfig config;
    private final ObjectMapper objectMapper;

    public WorkbenchIngestClient(PluginConfig config) {
        this.config = config;
        this.objectMapper = new ObjectMapper()
                .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
    }

    public PublishResult publishWithPrecheck(
            BranchSnapshotPayload current,
            BranchSnapshotPayload previous,
            DeltaExportService deltaExportService,
            String reason,
            Consumer<String> progress
    ) throws IOException, InterruptedException {
        return publishWithPrecheckInternal(current, previous, null, deltaExportService, reason, progress);
    }

    public PublishResult publishWithPrecheck(
            BranchSnapshotPayload current,
            BranchSnapshotPayload previous,
            BranchDeltaPayload preparedDelta,
            String reason,
            Consumer<String> progress
    ) throws IOException, InterruptedException {
        return publishWithPrecheckInternal(current, previous, preparedDelta, null, reason, progress);
    }

    private PublishResult publishWithPrecheckInternal(
            BranchSnapshotPayload current,
            BranchSnapshotPayload previous,
            BranchDeltaPayload preparedDelta,
            DeltaExportService deltaExportService,
            String reason,
            Consumer<String> progress
    ) throws IOException, InterruptedException {
        requireWorkbenchIngestTarget();
        validateSnapshotForWorkbench(current);

        BranchIngestState state = fetchBranchState(current, progress);
        String serverHash = normalizeHash(state != null ? state.snapshotHash : null);
        String currentHash = normalizeHash(current.snapshotHash);
        String previousHash = normalizeHash(previous != null ? previous.snapshotHash : null);

        if (state != null && state.exists && currentHash != null && currentHash.equals(serverHash)) {
            report(progress, "Workbench already has the current branch snapshot fingerprint. Skipping publish.");
            return PublishResult.skipped("Workbench already has the current stored branch snapshot.");
        }

        if (previous != null && previousHash != null && serverHash != null && previousHash.equals(serverHash)) {
            BranchDeltaPayload delta = preparedDelta != null
                    ? preparedDelta
                    : deltaExportService.createDelta(previous, current);
            if (!delta.hasChanges()) {
                report(progress, "Local baseline and current model match. No delta publish needed.");
                return PublishResult.skipped("No model changes were detected against the stored Workbench branch baseline.");
            }
            try {
                publishDelta(delta, reason, progress);
                return PublishResult.delta("Published delta after matching the stored Workbench branch baseline.");
            }
            catch (IOException exception) {
                if (!isConflict(exception)) {
                    throw exception;
                }
                report(progress, "Workbench reported a delta baseline mismatch. Falling back to full snapshot rebaseline...");
                BranchIngestState refreshedState = fetchBranchState(current, progress);
                String refreshedHash = normalizeHash(refreshedState != null ? refreshedState.snapshotHash : null);
                if (currentHash != null && currentHash.equals(refreshedHash)) {
                    report(progress, "Workbench already reflects the current branch snapshot after refresh. Skipping rebaseline.");
                    return PublishResult.skipped("Workbench already reflects the current branch snapshot after baseline refresh.");
                }
            }
        }

        report(progress, "Publishing a full snapshot to establish or rebaseline the stored Workbench branch.");
        publishSnapshot(current, reason, progress);
        return PublishResult.snapshot("Published full snapshot to establish or rebaseline the stored Workbench branch.");
    }

    public void publishSnapshot(BranchSnapshotPayload payload, String reason) throws IOException, InterruptedException {
        publishSnapshot(payload, reason, null);
    }

    public void publishSnapshot(BranchSnapshotPayload payload, String reason, Consumer<String> progress) throws IOException, InterruptedException {
        payload.exportReason = reason;
        requireWorkbenchIngestTarget();
        validateSnapshotForWorkbench(payload);
        postJson("/api/cache-ingest/branch-snapshots", payload, progress, payload, normalizeHash(payload.snapshotHash), true);
    }

    public void publishDelta(BranchDeltaPayload payload, String reason) throws IOException, InterruptedException {
        publishDelta(payload, reason, null);
    }

    public void publishDelta(BranchDeltaPayload payload, String reason, Consumer<String> progress) throws IOException, InterruptedException {
        payload.exportReason = reason;
        requireWorkbenchIngestTarget();
        validateDeltaForWorkbench(payload);
        postJson(
                "/api/cache-ingest/branch-deltas",
                payload,
                progress,
                branchContext(payload),
                normalizeHash(payload.targetSnapshotHash),
                true
        );
    }

    public BranchIngestState fetchBranchState(BranchSnapshotPayload payload, Consumer<String> progress) throws IOException, InterruptedException {
        requireWorkbenchIngestTarget();
        validateSnapshotForWorkbench(payload);
        String query = String.format(
                "serverId=%s&projectId=%s&branchId=%s",
                encodeQueryValue(payload.serverId),
                encodeQueryValue(payload.projectId),
                encodeQueryValue(payload.branchId)
        );
        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(trimTrailingSlash(config.workbenchBaseUrl) + "/api/cache-ingest/branch-state?" + query))
                .timeout(Duration.ofSeconds(config.readTimeoutSeconds))
                .header("Authorization", "Bearer " + config.workbenchIngestToken)
                .header("Accept", "application/json")
                .header("User-Agent", "twc-workbench-cameo-plugin/0.1.0")
                .GET()
                .build();
        HttpClient httpClient = createHttpClient();
        report(progress, "Checking stored Workbench branch state...");
        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        int statusCode = response.statusCode();
        if (statusCode < 200 || statusCode >= 300) {
            throw new IOException("Workbench branch-state lookup failed with status " + statusCode + ": " + response.body());
        }
        BranchIngestState state = objectMapper.readValue(response.body(), BranchIngestState.class);
        if (state.exists) {
            report(progress, "Workbench branch state: revision " + safe(state.latestRevision) + ", fingerprint " + safe(state.snapshotHash) + ".");
        }
        else {
            report(progress, "Workbench branch state: no stored snapshot exists yet.");
        }
        return state;
    }

    private void postJson(
            String path,
            Object payload,
            Consumer<String> progress,
            BranchSnapshotPayload branchContext,
            String expectedSnapshotHash,
            boolean longRunning
    ) throws IOException, InterruptedException {
        report(progress, "Serializing snapshot payload for Workbench...");
        byte[] body = objectMapper.writerWithDefaultPrettyPrinter().writeValueAsBytes(payload);
        int requestTimeoutSeconds = longRunning
                ? Math.max(config.readTimeoutSeconds, MIN_LONG_RUNNING_POST_TIMEOUT_SECONDS)
                : config.readTimeoutSeconds;
        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(trimTrailingSlash(config.workbenchBaseUrl) + path))
                .timeout(Duration.ofSeconds(requestTimeoutSeconds))
                .header("Authorization", "Bearer " + config.workbenchIngestToken)
                .header("Content-Type", "application/json")
                .header("User-Agent", "twc-workbench-cameo-plugin/0.1.0")
                .POST(HttpRequest.BodyPublishers.ofByteArray(body))
                .build();

        HttpClient httpClient = createHttpClient();
        report(progress, "Posting payload to Workbench: " + path);
        HttpResponse<String> response;
        try {
            response = httpClient.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        }
        catch (HttpTimeoutException exception) {
            if (branchContext != null && expectedSnapshotHash != null) {
                report(progress, "Workbench publish timed out while waiting for a response. Checking whether the stored branch finished processing...");
                if (waitForSnapshotHash(branchContext, expectedSnapshotHash, progress)) {
                    report(progress, "Workbench finished processing the publish after the client timeout. Treating the publish as successful.");
                    return;
                }
            }
            throw new IOException(
                    "Workbench ingest timed out before returning a response even after extended confirmation polling. Increase the plugin read timeout or retry after Workbench finishes processing the branch snapshot.",
                    exception
            );
        }
        int statusCode = response.statusCode();
        if (statusCode < 200 || statusCode >= 300) {
            throw new IOException("Workbench ingest failed with status " + statusCode + ": " + response.body());
        }
        report(progress, "Workbench ingest accepted the payload.");
        Application.getInstance().getGUILog().log("[INFO] Posted payload to Workbench ingest endpoint: " + path);
    }

    private BranchSnapshotPayload branchContext(BranchDeltaPayload payload) {
        BranchSnapshotPayload branchContext = new BranchSnapshotPayload();
        branchContext.serverId = payload.serverId;
        branchContext.serverUrl = payload.serverUrl;
        branchContext.workspaceId = payload.workspaceId;
        branchContext.resourceId = payload.resourceId;
        branchContext.projectId = payload.projectId;
        branchContext.projectName = payload.projectName;
        branchContext.branchId = payload.branchId;
        branchContext.branchName = payload.branchName;
        branchContext.revisionId = payload.toRevisionId;
        branchContext.snapshotHash = payload.targetSnapshotHash;
        branchContext.sourceUser = payload.sourceUser;
        return branchContext;
    }

    private boolean waitForSnapshotHash(
            BranchSnapshotPayload branchContext,
            String expectedSnapshotHash,
            Consumer<String> progress
    ) throws InterruptedException {
        if (branchContext == null || expectedSnapshotHash == null || expectedSnapshotHash.isBlank()) {
            return false;
        }
        long deadline = System.currentTimeMillis() + (POST_COMPLETION_CONFIRMATION_SECONDS * 1000L);
        boolean announcedWait = false;
        while (System.currentTimeMillis() < deadline) {
            if (!announcedWait) {
                report(progress, "Polling Workbench branch state for up to " + POST_COMPLETION_CONFIRMATION_SECONDS + " seconds...");
                announcedWait = true;
            }
            try {
                BranchIngestState state = fetchBranchState(branchContext, null);
                String storedHash = normalizeHash(state != null ? state.snapshotHash : null);
                if (expectedSnapshotHash.equals(storedHash)) {
                    return true;
                }
            }
            catch (IOException ignored) {
                // Keep polling. A transient lookup miss right after a timeout is expected while Workbench finishes processing.
            }
            Thread.sleep(POST_COMPLETION_POLL_SECONDS * 1000L);
        }
        return false;
    }

    private String encodeQueryValue(String value) {
        return URLEncoder.encode(value == null ? "" : value, StandardCharsets.UTF_8);
    }

    private HttpClient createHttpClient() throws IOException {
        HttpClient.Builder builder = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(config.connectTimeoutSeconds));
        if (config.insecureTls) {
            try {
                builder.sslContext(buildInsecureSslContext());
                SSLParameters sslParameters = new SSLParameters();
                sslParameters.setEndpointIdentificationAlgorithm("");
                builder.sslParameters(sslParameters);
            }
            catch (GeneralSecurityException exception) {
                throw new IOException("Failed to initialize insecure TLS mode for Workbench ingest.", exception);
            }
        }
        return builder.build();
    }

    private SSLContext buildInsecureSslContext() throws GeneralSecurityException {
        TrustManager[] trustManagers = new TrustManager[]{
                new X509TrustManager() {
                    @Override
                    public void checkClientTrusted(X509Certificate[] chain, String authType) {
                    }

                    @Override
                    public void checkServerTrusted(X509Certificate[] chain, String authType) {
                    }

                    @Override
                    public X509Certificate[] getAcceptedIssuers() {
                        return new X509Certificate[0];
                    }
                }
        };
        SSLContext sslContext = SSLContext.getInstance("TLS");
        sslContext.init(null, trustManagers, new SecureRandom());
        return sslContext;
    }

    private String trimTrailingSlash(String value) {
        return value.endsWith("/") ? value.substring(0, value.length() - 1) : value;
    }

    private void requireWorkbenchIngestTarget() throws IOException {
        if (!config.hasWorkbenchIngestTarget()) {
            throw new IOException("Workbench Base URL and Ingest Bearer Token are required. Configure them from TWC Workbench -> Configure Workbench Connection...");
        }
    }

    private void validateSnapshotForWorkbench(BranchSnapshotPayload payload) throws IOException {
        validateCommonWorkbenchFields(payload.serverId, payload.serverUrl, payload.resourceId, payload.projectId, payload.branchId, payload.sourceUser);
    }

    private void validateDeltaForWorkbench(BranchDeltaPayload payload) throws IOException {
        validateCommonWorkbenchFields(payload.serverId, payload.serverUrl, payload.resourceId, payload.projectId, payload.branchId, payload.sourceUser);
    }

    private void validateCommonWorkbenchFields(
            String serverId,
            String serverUrl,
            String resourceId,
            String projectId,
            String branchId,
            String sourceUser
    ) throws IOException {
        if (isBlank(serverId) || (!isBlank(serverUrl) && serverId.equals(serverUrl))) {
            throw new IOException("Workbench ingest requires config/workbench-plugin.properties metadata.serverId to match the Workbench server profile id.");
        }
        if (isBlank(resourceId)) {
            throw new IOException("Workbench ingest requires a resolvable TWC resource ID from the active remote TWC project.");
        }
        if (isBlank(projectId)) {
            throw new IOException("Workbench ingest requires a project ID. The plugin now uses the TWC resource ID as the Workbench project key.");
        }
        if (isBlank(branchId)) {
            throw new IOException("Workbench ingest requires a branch ID.");
        }
        if (isBlank(sourceUser)) {
            throw new IOException("Workbench ingest requires the active Cameo/TWC user identity.");
        }
    }

    private boolean isBlank(String value) {
        return value == null || value.isBlank();
    }

    private String normalizeHash(String value) {
        if (value == null) {
            return null;
        }
        String cleaned = value.trim();
        return cleaned.isEmpty() ? null : cleaned;
    }

    private boolean isConflict(IOException exception) {
        String message = exception.getMessage();
        return message != null && message.contains("status 409");
    }

    private String safe(String value) {
        return value == null ? "" : value;
    }

    private void report(Consumer<String> progress, String message) {
        if (progress != null) {
            progress.accept(message);
        }
    }

    public static final class PublishResult {
        public final String mode;
        public final boolean published;
        public final String message;

        private PublishResult(String mode, boolean published, String message) {
            this.mode = mode;
            this.published = published;
            this.message = message;
        }

        public static PublishResult snapshot(String message) {
            return new PublishResult("snapshot", true, message);
        }

        public static PublishResult delta(String message) {
            return new PublishResult("delta", true, message);
        }

        public static PublishResult skipped(String message) {
            return new PublishResult("skipped", false, message);
        }
    }
}
