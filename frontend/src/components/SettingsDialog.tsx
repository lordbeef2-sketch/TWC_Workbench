import { ReactNode, useEffect, useState } from "react";
import {
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Slider,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import Grid from "@mui/material/GridLegacy";

import { ItemDetailViewMode, SessionPreferences, ThemeMode } from "../models/api";

interface SettingsDialogProps {
  open: boolean;
  preferences: SessionPreferences;
  saving: boolean;
  extraContent?: ReactNode;
  onClose: () => void;
  onSave: (preferences: SessionPreferences) => Promise<void> | void;
}

export default function SettingsDialog({ open, preferences, saving, extraContent, onClose, onSave }: SettingsDialogProps) {
  const [draft, setDraft] = useState<SessionPreferences>(preferences);
  const detailViewOptions: Array<{ value: ItemDetailViewMode; label: string }> = [
    { value: "standard", label: "Standard" },
    { value: "expert", label: "Expert" },
    { value: "all", label: "All" },
  ];

  useEffect(() => {
    if (open) {
      setDraft(preferences);
    }
  }, [open, preferences]);

  const setField = <K extends keyof SessionPreferences>(key: K, value: SessionPreferences[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const handleSave = async () => {
    await onSave(draft);
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="lg">
      <DialogTitle>Workspace Settings</DialogTitle>
      <DialogContent>
        <Stack spacing={3} sx={{ mt: 1 }}>
          <TextField
            select
            label="Theme"
            value={draft.theme_mode}
            onChange={(event) => setField("theme_mode", event.target.value as ThemeMode)}
            fullWidth
          >
            <MenuItem value="light">Light</MenuItem>
            <MenuItem value="dark">Dark</MenuItem>
            <MenuItem value="system">System</MenuItem>
          </TextField>
          <Grid container spacing={2}>
            <Grid item xs={12}>
              <Typography gutterBottom fontWeight={600}>
                Font Scale
              </Typography>
              <Slider
                value={draft.font_scale}
                min={0.85}
                max={1.4}
                step={0.05}
                marks
                onChange={(_, value) => setField("font_scale", value as number)}
                valueLabelDisplay="auto"
              />
            </Grid>
            <Grid item xs={12}>
              <Typography gutterBottom fontWeight={600}>
                Presentation Font Scale
              </Typography>
              <Slider
                value={draft.presentation_font_scale}
                min={1}
                max={2}
                step={0.05}
                marks
                onChange={(_, value) => setField("presentation_font_scale", value as number)}
                valueLabelDisplay="auto"
              />
            </Grid>
          </Grid>
          <Grid container spacing={2}>
            <Grid item xs={12} md={6}>
              <TextField
                select
                label="Specification View Mode"
                value={draft.item_detail_view_mode}
                onChange={(event) => setField("item_detail_view_mode", event.target.value as ItemDetailViewMode)}
                fullWidth
              >
                {detailViewOptions.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                label="Request Timeout (seconds)"
                type="number"
                fullWidth
                value={draft.request_timeout_seconds}
                onChange={(event) => setField("request_timeout_seconds", Number(event.target.value))}
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                label="Live Log Polling (ms)"
                type="number"
                fullWidth
                value={draft.live_log_poll_interval_ms}
                onChange={(event) => setField("live_log_poll_interval_ms", Number(event.target.value))}
              />
            </Grid>
          </Grid>
          <FormControlLabel
            control={
              <Checkbox
                checked={draft.compact_ui}
                onChange={(event) => setField("compact_ui", event.target.checked)}
              />
            }
            label="Use compact workspace layout"
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={draft.show_hidden_packages_in_tree}
                onChange={(event) => setField("show_hidden_packages_in_tree", event.target.checked)}
              />
            }
            label="Show hidden packages in containment tree"
          />
          {extraContent ? <>{extraContent}</> : null}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 3 }}>
        <Button onClick={onClose}>Close</Button>
        <Button variant="contained" onClick={handleSave} disabled={saving}>
          Save Settings
        </Button>
      </DialogActions>
    </Dialog>
  );
}
