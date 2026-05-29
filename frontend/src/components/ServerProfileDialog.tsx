import { useEffect, useState } from "react";
import {
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Button,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import Grid from "@mui/material/GridLegacy";

import { ServerProfile, ServerProfileInput, TWCVersion } from "../models/api";

interface ServerProfileDialogProps {
  open: boolean;
  initialValue?: ServerProfile | null;
  defaultDisplayOrder?: number;
  onClose: () => void;
  onSubmit: (value: ServerProfileInput) => Promise<void> | void;
}

function createDefaultProfile(defaultDisplayOrder = 0): ServerProfileInput {
  return {
    name: "",
    base_url: "",
    version: "2022x",
    verify_tls: true,
    ca_bundle_path: null,
    enabled: true,
    display_order: defaultDisplayOrder,
  };
}

export default function ServerProfileDialog({ open, initialValue, defaultDisplayOrder = 0, onClose, onSubmit }: ServerProfileDialogProps) {
  const [form, setForm] = useState<ServerProfileInput>(createDefaultProfile(defaultDisplayOrder));
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }
    if (!initialValue) {
      setForm(createDefaultProfile(defaultDisplayOrder));
      return;
    }
    setForm({
      name: initialValue.name,
      base_url: initialValue.base_url,
      version: initialValue.version,
      verify_tls: initialValue.verify_tls,
      ca_bundle_path: initialValue.ca_bundle_path,
      enabled: initialValue.enabled,
      display_order: initialValue.display_order,
    });
  }, [defaultDisplayOrder, initialValue, open]);

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      await onSubmit({
        ...form,
        base_url: form.base_url.trim(),
        ca_bundle_path: form.ca_bundle_path?.trim() || null,
      });
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  const setField = <K extends keyof ServerProfileInput>(key: K, value: ServerProfileInput[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>{initialValue ? "Edit Preset Teamwork Cloud Server" : "Add Preset Teamwork Cloud Server"}</DialogTitle>
      <DialogContent>
        <Grid container spacing={2} sx={{ mt: 0.5 }}>
          <Grid item xs={12} md={6}>
            <TextField
              label="Display Name"
              value={form.name}
              onChange={(event) => setField("name", event.target.value)}
              fullWidth
              required
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <TextField
              select
              label="Version"
              value={form.version}
              onChange={(event) => setField("version", event.target.value as TWCVersion)}
              fullWidth
            >
              <MenuItem value="2022x">2022x</MenuItem>
              <MenuItem value="2024x">2024x</MenuItem>
            </TextField>
          </Grid>
          <Grid item xs={12}>
            <TextField
              label="Base URL"
              value={form.base_url}
              onChange={(event) => setField("base_url", event.target.value)}
              placeholder="https://twc.company.example"
              fullWidth
              required
            />
          </Grid>
          <Grid item xs={12}>
            <Stack
              spacing={0.5}
              sx={{ px: 2, py: 1.75, borderRadius: 3, border: "1px solid", borderColor: "divider", bgcolor: "background.default" }}
            >
              <Typography fontWeight={600}>TWC Authentication</Typography>
              <Typography variant="body2" color="text.secondary">
                This profile uses Teamwork Cloud as the authentication authority. Operators can either reuse an existing TWC browser session or provide a user-scoped TWC token at sign-in time.
              </Typography>
            </Stack>
          </Grid>
          <Grid item xs={12} md={6}>
            <TextField
              label="Custom CA Bundle Path"
              value={form.ca_bundle_path ?? ""}
              onChange={(event) => setField("ca_bundle_path", event.target.value || null)}
              placeholder="C:\\certs\\twc-ca.pem"
              fullWidth
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <Stack
              direction="row"
              spacing={2}
              alignItems="center"
              sx={{ px: 2, py: 1.5, borderRadius: 3, border: "1px solid", borderColor: "divider", height: "100%" }}
            >
              <Switch checked={form.verify_tls} onChange={(event) => setField("verify_tls", event.target.checked)} />
              <div>
                <Typography fontWeight={600}>Certificate Validation</Typography>
                <Typography variant="body2" color="text.secondary">
                  Enforce TLS verification and optionally pin a custom CA bundle.
                </Typography>
              </div>
            </Stack>
          </Grid>
          <Grid item xs={12} md={6}>
            <TextField
              label="Display Order"
              type="number"
              value={form.display_order}
              onChange={(event) => setField("display_order", Math.max(0, Number.parseInt(event.target.value, 10) || 0))}
              fullWidth
              inputProps={{ min: 0 }}
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <Stack
              direction="row"
              spacing={2}
              alignItems="center"
              sx={{ px: 2, py: 1.5, borderRadius: 3, border: "1px solid", borderColor: "divider" }}
            >
              <Switch checked={form.enabled} onChange={(event) => setField("enabled", event.target.checked)} />
              <div>
                <Typography fontWeight={600}>Preset Enabled</Typography>
                <Typography variant="body2" color="text.secondary">
                  Disabled presets remain visible to administrators but are hidden from normal user sign-in flows.
                </Typography>
              </div>
            </Stack>
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 3 }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          onClick={handleSubmit}
          disabled={submitting || !form.name || !form.base_url}
        >
          {initialValue ? "Save Changes" : "Create Preset"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
