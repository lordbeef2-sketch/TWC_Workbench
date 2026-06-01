package com.twcworkbench.cameo.listener;

import com.nomagic.magicdraw.core.Application;
import com.nomagic.magicdraw.core.Project;
import com.nomagic.magicdraw.core.project.ProjectEventListenerAdapter;
import com.twcworkbench.cameo.config.PluginConfig;
import com.twcworkbench.cameo.model.BranchDeltaPayload;
import com.twcworkbench.cameo.model.BranchSnapshotPayload;
import com.twcworkbench.cameo.service.DirtyTrackingService;
import com.twcworkbench.cameo.service.DeltaExportService;
import com.twcworkbench.cameo.service.SnapshotExportService;
import com.twcworkbench.cameo.service.WorkbenchIngestClient;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

public class TWCWorkbenchProjectListener extends ProjectEventListenerAdapter {
    private final PluginConfig config;
    private final SnapshotExportService snapshotExportService;
    private final DeltaExportService deltaExportService;
    private final WorkbenchIngestClient ingestClient;
    private final DirtyTrackingService dirtyTrackingService;
    private final Map<String, BranchSnapshotPayload> baselines = new ConcurrentHashMap<>();

    public TWCWorkbenchProjectListener(
            PluginConfig config,
            SnapshotExportService snapshotExportService,
            DeltaExportService deltaExportService,
            WorkbenchIngestClient ingestClient
    ) {
        this.config = config;
        this.snapshotExportService = snapshotExportService;
        this.deltaExportService = deltaExportService;
        this.ingestClient = ingestClient;
        this.dirtyTrackingService = new DirtyTrackingService(snapshotExportService, deltaExportService);
    }

    @Override
    public void projectOpened(Project project) {
        dirtyTrackingService.register(project);
        if (!config.snapshotOnOpen) {
            return;
        }
        try {
            BranchSnapshotPayload baseline = snapshotExportService.capture(project, config);
            baselines.put(projectKey(project), baseline);
            dirtyTrackingService.clear(project);
            Application.getInstance().getGUILog().log("[INFO] Captured open baseline for " + baseline.projectName + " [" + baseline.branchName + "].");
        }
        catch (Exception exception) {
            Application.getInstance().getGUILog().log("[WARNING] Failed to capture project-open baseline: " + exception.getMessage());
        }
    }

    @Override
    public void projectSaved(Project project, boolean savedInServer) {
        if (!config.snapshotOnSave) {
            return;
        }
        try {
            String key = projectKey(project);
            BranchSnapshotPayload previous = baselines.get(key);
            DirtyTrackingService.DirtyPublishPlan plan = dirtyTrackingService.preparePublish(project, config, previous, null);
            if ("no-changes".equals(plan.mode)) {
                dirtyTrackingService.clear(project);
                Application.getInstance().getGUILog().log("[INFO] " + plan.message);
                return;
            }

            BranchSnapshotPayload current;
            WorkbenchIngestClient.PublishResult result;
            if ("scoped-delta".equals(plan.mode)) {
                current = plan.currentSnapshot;
                result = ingestClient.publishWithPrecheck(current, previous, plan.deltaPayload, "save", null);
            }
            else {
                current = snapshotExportService.capture(project, config);
                result = ingestClient.publishWithPrecheck(current, previous, deltaExportService, "save", null);
            }
            baselines.put(key, current);
            dirtyTrackingService.clear(project);
            Application.getInstance().getGUILog().log("[INFO] " + result.message + " " + current.projectName + " [" + current.branchName + "].");
        }
        catch (Exception exception) {
            Application.getInstance().getGUILog().log("[ERROR] Failed to publish project-save delta: " + exception.getMessage());
        }
    }

    @Override
    public void projectClosed(Project project) {
        try {
            String key = projectKey(project);
            baselines.remove(key);
            dirtyTrackingService.unregister(project);
        }
        catch (Exception exception) {
            dirtyTrackingService.unregister(project);
            Application.getInstance().getGUILog().log("[WARNING] Failed to clean up project-close state: " + exception.getMessage());
        }
    }

    public void rememberBaseline(Project project, BranchSnapshotPayload payload) {
        baselines.put(projectKey(project), payload);
        dirtyTrackingService.clear(project);
    }

    private String projectKey(Project project) {
        return project.getID();
    }
}
