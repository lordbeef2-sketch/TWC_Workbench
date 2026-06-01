import { type MouseEvent as ReactMouseEvent, type ReactNode, type SyntheticEvent, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  AppBar,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  CircularProgress,
  Divider,
  FormControlLabel,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  Menu,
  MenuItem,
  Paper,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Toolbar,
  Tooltip,
  Typography,
} from "@mui/material";
import Grid from "@mui/material/GridLegacy";
import CompareArrowsRoundedIcon from "@mui/icons-material/CompareArrowsRounded";
import ExpandMoreRoundedIcon from "@mui/icons-material/ExpandMoreRounded";
import KeyboardArrowDownRoundedIcon from "@mui/icons-material/KeyboardArrowDownRounded";
import LogoutRoundedIcon from "@mui/icons-material/LogoutRounded";
import RefreshRoundedIcon from "@mui/icons-material/RefreshRounded";
import SaveRoundedIcon from "@mui/icons-material/SaveRounded";
import SettingsRoundedIcon from "@mui/icons-material/SettingsRounded";

import CapabilityBadges from "../components/CapabilityBadges";
import ProjectTree from "../components/ProjectTree";
import SettingsDialog from "../components/SettingsDialog";
import {
  BranchAccessManifestStatus,
  CacheApiKeyScope,
  CacheApiKeySummary,
  ItemDetailViewMode,
  ItemReference,
  OpenWebUIModelEntry,
  ItemDetails,
  OSLCExecuteResponse,
  ProjectSummary,
  SessionPreferences,
  SwaggerContractManifest,
  SwaggerExecuteResponse,
  SwaggerOperationSpec,
  SwaggerParameterSpec,
  TreeNode,
  WorkbenchAgentChatMessage,
} from "../models/api";
import { api } from "../services/api";
import { useSession } from "../state/SessionProvider";

type WorkspaceTab = "dashboard" | "projects" | "models" | "diagram-viewer" | "compare" | "agent" | "developer" | "api";
type WorkspaceMenuGroup = "views" | "diagrams" | "api";

const WORKSPACE_TABS: WorkspaceTab[] = ["dashboard", "projects", "models", "diagram-viewer", "compare", "agent", "developer", "api"];
const ITEM_DETAIL_VIEW_MODES: ItemDetailViewMode[] = ["standard", "expert", "all"];
const ITEM_DETAIL_VIEW_LABELS: Record<ItemDetailViewMode, string> = {
  standard: "Standard",
  expert: "Expert",
  all: "All",
};
type SpecificationSectionId =
  | "properties"
  | "documentation"
  | "navigation"
  | "usage-diagrams"
  | "inner-elements"
  | "relations"
  | "tags"
  | "constraints"
  | "traceability"
  | "allocations";

const SPECIFICATION_SECTION_LABELS: Record<SpecificationSectionId, string> = {
  properties: "Properties",
  documentation: "Documentation/Comments",
  navigation: "Navigation/Hyperlinks",
  "usage-diagrams": "Usage in Diagrams",
  "inner-elements": "Inner Elements",
  relations: "Relations",
  tags: "Tags",
  constraints: "Constraints",
  traceability: "Traceability",
  allocations: "Allocations",
};

const SPECIFICATION_CHILD_SECTIONS: SpecificationSectionId[] = [
  "documentation",
  "navigation",
  "usage-diagrams",
  "inner-elements",
  "relations",
  "tags",
  "constraints",
  "traceability",
  "allocations",
];

function parseWorkspaceTab(value: string | null, isAdmin = false): WorkspaceTab {
  const fallback: WorkspaceTab = "dashboard";
  if (value === "details" || value === "diagram-details") {
    return "models";
  }
  if (!value || !WORKSPACE_TABS.includes(value as WorkspaceTab)) {
    return fallback;
  }
  if (value === "api" && !isAdmin) {
    return fallback;
  }
  return value as WorkspaceTab;
}

function parseItemDetailViewMode(value: string | null | undefined): ItemDetailViewMode {
  if (!value || !ITEM_DETAIL_VIEW_MODES.includes(value as ItemDetailViewMode)) {
    return "standard";
  }
  return value as ItemDetailViewMode;
}

function errorMessage(caught: unknown): string {
  return caught instanceof Error ? caught.message : "The request failed.";
}

function flattenTree(nodes: TreeNode[]): TreeNode[] {
  const flattened: TreeNode[] = [];
  const stack = [...nodes].reverse();
  while (stack.length) {
    const node = stack.pop();
    if (!node) {
      continue;
    }
    flattened.push(node);
    for (let index = node.children.length - 1; index >= 0; index -= 1) {
      stack.push(node.children[index]);
    }
  }
  return flattened;
}

function clampNumber(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function paneMaxWidthForViewport(viewportWidth: number, fraction: number, minimum: number, maximum: number): number {
  return clampNumber(Math.floor(viewportWidth * fraction), minimum, maximum);
}

function readStoredNumber(key: string, fallback: number, minimum: number, maximum: number): number {
  if (typeof window === "undefined") {
    return fallback;
  }
  const raw = window.localStorage.getItem(key);
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    return fallback;
  }
  return clampNumber(parsed, minimum, maximum);
}

function readStoredStringArray(key: string): string[] {
  if (typeof window === "undefined") {
    return [];
  }
  const raw = window.localStorage.getItem(key);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((value) => typeof value === "string") : [];
  } catch {
    return [];
  }
}

function persistStoredValue(key: string, value: number | string[] | null): void {
  if (typeof window === "undefined") {
    return;
  }
  if (value === null) {
    window.localStorage.removeItem(key);
    return;
  }
  if (typeof value === "number") {
    window.localStorage.setItem(key, String(value));
    return;
  }
  window.localStorage.setItem(key, JSON.stringify(value));
}

function findNodeTrail(nodes: TreeNode[], targetId: string): TreeNode[] {
  const trail: TreeNode[] = [];
  const walk = (candidates: TreeNode[]): boolean => {
    for (const node of candidates) {
      trail.push(node);
      if (node.id === targetId) {
        return true;
      }
      if (walk(node.children)) {
        return true;
      }
      trail.pop();
    }
    return false;
  };
  return walk(nodes) ? [...trail] : [];
}

function resizeHandleStyles() {
  return {
    display: { xs: "none", lg: "block" },
    width: 12,
    borderRadius: 2,
    cursor: "col-resize",
    position: "relative",
    "&::before": {
      content: '""',
      position: "absolute",
      top: 8,
      bottom: 8,
      left: "50%",
      width: 4,
      transform: "translateX(-50%)",
      borderRadius: 999,
      bgcolor: "divider",
      transition: "background-color 150ms ease",
    },
    "&:hover::before": {
      bgcolor: "text.secondary",
    },
  } as const;
}

function replaceNodeChildren(nodes: TreeNode[], targetId: string, children: TreeNode[]): TreeNode[] {
  let changed = false;
  const nextNodes = nodes.map((node) => {
    if (node.id === targetId) {
      changed = true;
      return {
        ...node,
        children,
        metadata: {
          ...node.metadata,
          children_loaded: true,
          child_count: children.length,
        },
      };
    }
    if (!node.children.length) {
      return node;
    }
    const nextChildren = replaceNodeChildren(node.children, targetId, children);
    if (nextChildren !== node.children) {
      changed = true;
      return { ...node, children: nextChildren };
    }
    return node;
  });
  return changed ? nextNodes : nodes;
}

function mergeTreeNodesPreservingLoadedChildren(baseNodes: TreeNode[], currentNodes: TreeNode[]): TreeNode[] {
  const currentById = new Map(currentNodes.map((node) => [node.id, node]));
  const mergeNode = (baseNode: TreeNode): TreeNode => {
    const currentNode = currentById.get(baseNode.id);
    if (!currentNode) {
      return baseNode;
    }
    const hasLoadedChildren = currentNode.children.length > 0 || currentNode.metadata.children_loaded === true;
    const nextChildren = hasLoadedChildren
      ? currentNode.children.map((child) => mergeNode(child))
      : baseNode.children.map((child) => mergeNode(child));
    return {
      ...baseNode,
      children: nextChildren,
      metadata: {
        ...baseNode.metadata,
        ...currentNode.metadata,
      },
    };
  };
  return baseNodes.map((node) => mergeNode(node));
}

function valueText(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value, null, 2);
}

function branchLabel(branches: ProjectSummary["branches"], branchId: string): string {
  if (!branchId) {
    return "Default branch context";
  }
  return branches.find((branch) => branch.id === branchId)?.name ?? "Selected branch";
}

function normalizeLookupKey(value: string): string {
  return value.trim().toLowerCase();
}

function isRevisionValue(value: string): boolean {
  return /^\d+$/.test(value.trim());
}

function isOpaqueIdentifier(value: string): boolean {
  const cleaned = value.trim();
  if (!cleaned) {
    return false;
  }
  return (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cleaned) ||
    /^[0-9a-f]{24,32}$/i.test(cleaned)
  );
}

function humanizeFieldLabel(value: string): string {
  return value
    .replace(/^kerml:/i, "")
    .replace(/^dcterms:/i, "")
    .replace(/^models:/i, "")
    .replace(/^esi\./i, "ESI ")
    .replace(/[_:.-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function normalizeContainmentKind(value: unknown): string {
  return String(value ?? "")
    .replace(/[_:.-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function isHiddenContainmentPackage(node: TreeNode): boolean {
  const nodeType = normalizeContainmentKind(node.node_type);
  const metaclass = normalizeContainmentKind(node.metadata.metaclass);
  return nodeType === "package import" || nodeType === "element import" || metaclass === "package import" || metaclass === "element import";
}

function filterContainmentTree(nodes: TreeNode[], showHiddenPackages: boolean): TreeNode[] {
  if (showHiddenPackages) {
    return nodes;
  }
  return nodes
    .filter((node) => !isHiddenContainmentPackage(node))
    .map((node) => ({
      ...node,
      children: filterContainmentTree(node.children, showHiddenPackages),
    }));
}

function projectSummaryText(project: ProjectSummary): string {
  return project.description || "Project available for model exploration.";
}

function compareDisplayValues(left: string, right: string): number {
  return left.localeCompare(right, undefined, { sensitivity: "base", numeric: true });
}

function resolvedNameForId(value: string, lookup: Record<string, string>): string | null {
  const normalized = normalizeLookupKey(value);
  const resolved = lookup[normalized]?.trim();
  if (!resolved) {
    return null;
  }
  return normalizeLookupKey(resolved) === normalized ? null : resolved;
}

function friendlyPath(path: string, lookup: Record<string, string>): string {
  const cleaned = path.trim();
  if (!cleaned) {
    return "";
  }
  return cleaned
    .split("/")
    .map((segment) => {
      const trimmed = segment.trim();
      return resolvedNameForId(trimmed, lookup) ?? (isOpaqueIdentifier(trimmed) ? "Unnamed item" : trimmed);
    })
    .join(" / ");
}

function finalPathSegment(path: string, lookup: Record<string, string>): string {
  const formattedPath = friendlyPath(path, lookup);
  if (!formattedPath) {
    return "";
  }
  const segments = formattedPath
    .split(" / ")
    .map((segment) => segment.trim())
    .filter(Boolean);
  return segments[segments.length - 1] ?? "";
}

function humanReadableReference(value: string, lookup: Record<string, string>): string {
  const cleaned = value.trim();
  if (!cleaned) {
    return "";
  }
  const resolved = resolvedNameForId(cleaned, lookup);
  if (resolved) {
    return resolved;
  }
  if (isRevisionValue(cleaned)) {
    return `Revision ${cleaned}`;
  }
  const resolvedPath = cleaned.includes("/") ? friendlyPath(cleaned, lookup) : "";
  if (resolvedPath && resolvedPath !== cleaned) {
    return resolvedPath;
  }
  return isOpaqueIdentifier(cleaned) ? "Referenced item" : cleaned;
}

function displayEntityName(name: string, id: string, itemType: string, lookup: Record<string, string>, path = ""): string {
  const pathTail = finalPathSegment(path, lookup);
  if (pathTail && normalizeLookupKey(pathTail) !== normalizeLookupKey(id)) {
    return pathTail;
  }
  const cleanedName = name.trim();
  if (cleanedName && normalizeLookupKey(cleanedName) !== normalizeLookupKey(id)) {
    return cleanedName;
  }
  return resolvedNameForId(id, lookup) ?? `Unnamed ${humanizeFieldLabel(itemType || "item")}`;
}

function itemReferenceDisplayName(reference: ItemReference, lookup: Record<string, string>): string {
  return displayEntityName(reference.name, reference.id, reference.item_type, lookup, reference.path);
}

function itemReferenceSecondaryText(reference: ItemReference, lookup: Record<string, string>): string {
  const path = friendlyPath(reference.path, lookup);
  if (path) {
    return path;
  }
  if (reference.relationship_type) {
    return humanizeFieldLabel(reference.relationship_type);
  }
  return humanizeFieldLabel(reference.item_type);
}

function itemReferenceTypeLabel(reference: ItemReference): string {
  return humanizeFieldLabel(reference.relationship_type || reference.item_type || "item");
}

function humanizeFieldPath(path: string): string {
  return path
    .split(".")
    .map((segment) =>
      segment
        .replace(/\[(\d+)\]/g, " $1")
        .trim(),
    )
    .map((segment) => humanizeFieldLabel(segment || "Value"))
    .join(" / ");
}

function resolveDisplayValue(value: unknown, lookup: Record<string, string>): unknown {
  if (typeof value === "string") {
    return humanReadableReference(value, lookup);
  }
  if (Array.isArray(value)) {
    return value.map((item) => resolveDisplayValue(item, lookup));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nestedValue]) => [key, resolveDisplayValue(nestedValue, lookup)]),
    );
  }
  return value;
}

function humanReadableValue(value: unknown, lookup: Record<string, string>): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return humanReadableReference(value, lookup);
  }
  const resolved = resolveDisplayValue(value, lookup);
  if (typeof resolved === "string") {
    return resolved;
  }
  return JSON.stringify(resolved, null, 2);
}

function hasMeaningfulValue(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false;
  }
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (typeof value === "object") {
    return Object.keys(value as Record<string, unknown>).length > 0;
  }
  return true;
}

interface InspectorRow {
  key: string;
  label: string;
  value: string;
}

interface DataTableRow {
  key: string;
  cells: Array<string | ReactNode>;
}

const SPECIFICATION_FIELD_HINTS = ["specification", "expression", "formula", "guard", "condition", "language", "body", "constraint"];
const CONSTRAINT_FIELD_HINTS = ["constraint", "constrained", "guard", "condition", "rule", "expression"];
const NAVIGATION_FIELD_HINTS = ["navigation", "hyperlink", "link", "url", "uri", "target"];
const TAG_FIELD_HINTS = ["tag", "tagged", "stereotype", "profile", "author", "created", "creation", "modified", "diagraminfo"];
const TRACEABILITY_FIELD_HINTS = ["trace", "traced", "traceability", "satisf", "verify", "refine", "realiz", "specif"];
const ALLOCATION_FIELD_HINTS = ["allocat"];
const PROPERTY_FIELD_HINTS = [
  "representation",
  "visibility",
  "namespace",
  "context",
  "diagramtype",
  "ownerofdiagram",
  "activehyperlink",
  "elementid",
  "elementserverid",
  "nameexpression",
  "clientdependency",
  "supplierdependency",
  "image",
  "todo",
];

function normalizedFieldKey(value: string): string {
  return value.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function keyMatchesHints(key: string, hints: string[]): boolean {
  const normalized = normalizedFieldKey(key);
  return hints.some((hint) => normalized.includes(normalizedFieldKey(hint)));
}

function dedupeInspectorRows(rows: InspectorRow[]): InspectorRow[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = `${row.label}::${row.value}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function mapToInspectorRows(source: Record<string, unknown>, lookup: Record<string, string>): InspectorRow[] {
  return Object.entries(source)
    .filter(([, value]) => hasMeaningfulValue(value))
    .sort(([leftKey], [rightKey]) => compareDisplayValues(humanizeFieldLabel(leftKey), humanizeFieldLabel(rightKey)))
    .map(([key, value]) => ({
      key,
      label: humanizeFieldLabel(key),
      value: humanReadableValue(value, lookup),
    }));
}

function isInlineDisplayValue(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false;
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return true;
  }
  if (Array.isArray(value)) {
    return value.length > 0 && value.length <= 4 && value.every((entry) => typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean");
  }
  return false;
}

function humanReadableInlineValue(value: unknown, lookup: Record<string, string>): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (Array.isArray(value)) {
    return value.map((entry) => humanReadableReference(String(entry), lookup)).join(", ");
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "number") {
    return String(value);
  }
  return humanReadableReference(String(value), lookup);
}

function mapInlineInspectorRows(source: Record<string, unknown>, lookup: Record<string, string>): InspectorRow[] {
  return Object.entries(source)
    .filter(([, value]) => hasMeaningfulValue(value) && isInlineDisplayValue(value))
    .sort(([leftKey], [rightKey]) => compareDisplayValues(humanizeFieldLabel(leftKey), humanizeFieldLabel(rightKey)))
    .map(([key, value]) => ({
      key,
      label: humanizeFieldLabel(key),
      value: humanReadableInlineValue(value, lookup),
    }));
}

function payloadAttributes(item: ItemDetails): Record<string, unknown> {
  const sourcePayload = item.source_payload ?? {};
  return sourcePayload.attributes && typeof sourcePayload.attributes === "object" && !Array.isArray(sourcePayload.attributes)
    ? (sourcePayload.attributes as Record<string, unknown>)
    : {};
}

function payloadReferences(item: ItemDetails): Record<string, unknown> {
  const sourcePayload = item.source_payload ?? {};
  return sourcePayload.references && typeof sourcePayload.references === "object" && !Array.isArray(sourcePayload.references)
    ? (sourcePayload.references as Record<string, unknown>)
    : {};
}

const SPECIFICATION_SECTION_SOURCE_KEYS: Record<SpecificationSectionId, string[]> = {
  properties: ["properties"],
  documentation: ["documentation"],
  navigation: ["navigation"],
  "usage-diagrams": ["usageDiagrams", "usage_diagrams"],
  "inner-elements": ["innerElements", "inner_elements"],
  relations: ["relations"],
  tags: ["tags"],
  constraints: ["constraints"],
  traceability: ["traceability"],
  allocations: ["allocations"],
};

function payloadSpecSections(item: ItemDetails): Record<string, unknown> {
  const sourcePayload = item.source_payload ?? {};
  const candidate = sourcePayload.spec_sections ?? sourcePayload.specSections;
  return candidate && typeof candidate === "object" && !Array.isArray(candidate) ? (candidate as Record<string, unknown>) : {};
}

function payloadSpecSection(item: ItemDetails, section: SpecificationSectionId): Record<string, unknown> {
  const sections = payloadSpecSections(item);
  for (const key of SPECIFICATION_SECTION_SOURCE_KEYS[section]) {
    const candidate = sections[key];
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
      return candidate as Record<string, unknown>;
    }
  }
  return {};
}

function payloadSpecSectionEntries(item: ItemDetails, section: SpecificationSectionId): Array<Record<string, unknown>> {
  const candidate = payloadSpecSection(item, section).entries;
  if (!Array.isArray(candidate)) {
    return [];
  }
  return candidate.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object" && !Array.isArray(entry));
}

function payloadSpecSectionStrings(item: ItemDetails, section: SpecificationSectionId, fieldName: string): string[] {
  const sectionPayload = payloadSpecSection(item, section);
  const candidate = sectionPayload[fieldName];
  if (typeof candidate === "string" && candidate.trim()) {
    return [candidate.trim()];
  }
  if (!Array.isArray(candidate)) {
    return [];
  }
  return candidate
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean);
}

function structuredEntryValue(entry: Record<string, unknown>, keys: string[], lookup: Record<string, string>): string {
  for (const key of keys) {
    if (!hasMeaningfulValue(entry[key])) {
      continue;
    }
    return humanReadableValue(entry[key], lookup);
  }
  return "";
}

function structuredEntryName(entry: Record<string, unknown>, fallback = "Value"): string {
  const candidate = entry.name;
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : fallback;
}

function payloadExtraSections(item: ItemDetails): Array<[string, unknown]> {
  const sourcePayload = item.source_payload ?? {};
  return Object.entries(sourcePayload).filter(([key, value]) => {
    if (
      [
        "element_id",
        "model_id",
        "local_id",
        "owner_id",
        "name",
        "human_name",
        "qualified_name",
        "human_type",
        "metaclass",
        "documentation",
        "diagram_type",
        "diagram_preview_format",
        "diagram_preview_base64",
        "owned_element_ids",
        "applied_stereotype_ids",
        "diagram_element_ids",
        "attributes",
        "references",
        "spec_sections",
        "specSections",
      ].includes(key)
    ) {
      return false;
    }
    return hasMeaningfulValue(value);
  });
}

function diagramPreviewDataUrl(item: ItemDetails): string | null {
  const sourcePayload = item.source_payload ?? {};
  const format = typeof sourcePayload.diagram_preview_format === "string" ? sourcePayload.diagram_preview_format.trim() : "";
  const encoded = typeof sourcePayload.diagram_preview_base64 === "string" ? sourcePayload.diagram_preview_base64.trim() : "";
  if (!format || !encoded) {
    return null;
  }
  return `data:${format};base64,${encoded}`;
}

function isDiagramLikeItem(item: ItemDetails | null | undefined): boolean {
  if (!item) {
    return false;
  }
  const sourcePayload = item.source_payload ?? {};
  const candidates = [
    item.item_type,
    item.name,
    item.description,
    typeof sourcePayload.human_type === "string" ? sourcePayload.human_type : "",
    typeof sourcePayload.metaclass === "string" ? sourcePayload.metaclass : "",
    typeof sourcePayload.diagram_type === "string" ? sourcePayload.diagram_type : "",
  ];
  return candidates.some((candidate) => String(candidate ?? "").toLowerCase().includes("diagram"));
}

function pythonLiteral(value: string): string {
  return JSON.stringify(value);
}

function workbenchManifestPythonScript(workbenchBaseUrl: string): string {
  return `from __future__ import annotations

import json

import requests

WORKBENCH_BASE_URL = ${pythonLiteral(workbenchBaseUrl)}
API_KEY = "replace-with-your-api-key"
VERIFY_TLS = True


def main() -> None:
    response = requests.get(
        f"{WORKBENCH_BASE_URL}/api/cache",
        headers={"Authorization": f"Bearer {API_KEY}"},
        timeout=60,
        verify=VERIFY_TLS,
    )
    response.raise_for_status()
    print(json.dumps(response.json(), indent=2))


if __name__ == "__main__":
    main()
`;
}

function workbenchListElementsPythonScript(
  workbenchBaseUrl: string,
  serverId: string,
  projectId: string,
  branchId: string,
): string {
  return `from __future__ import annotations

import json
from urllib.parse import urlencode

import requests

WORKBENCH_BASE_URL = ${pythonLiteral(workbenchBaseUrl)}
API_KEY = "replace-with-your-api-key"
SERVER_ID = ${pythonLiteral(serverId)}
PROJECT_ID = ${pythonLiteral(projectId)}
BRANCH_ID = ${pythonLiteral(branchId)}
VERIFY_TLS = True


def main() -> None:
    query = urlencode({"allResults": "true"})
    response = requests.get(
        f"{WORKBENCH_BASE_URL}/api/cache/servers/{SERVER_ID}/projects/{PROJECT_ID}/branches/{BRANCH_ID}/elements?{query}",
        headers={"Authorization": f"Bearer {API_KEY}"},
        timeout=120,
        verify=VERIFY_TLS,
    )
    response.raise_for_status()
    payload = response.json()
    print(json.dumps(payload, indent=2))
    print(f"Returned {len(payload.get('items', []))} stored elements.")


if __name__ == "__main__":
    main()
`;
}

function workbenchStereotypeSearchPythonScript(
  workbenchBaseUrl: string,
  serverId: string,
  projectId: string,
  branchId: string,
): string {
  return `from __future__ import annotations

import json
from urllib.parse import urlencode

import requests

WORKBENCH_BASE_URL = ${pythonLiteral(workbenchBaseUrl)}
API_KEY = "replace-with-your-api-key"
SERVER_ID = ${pythonLiteral(serverId)}
PROJECT_ID = ${pythonLiteral(projectId)}
BRANCH_ID = ${pythonLiteral(branchId)}
STEREOTYPE_NAME = "Block"
INCLUDE_DETAILS = True
VERIFY_TLS = True


def main() -> None:
    query = urlencode(
        {
            "stereotype": STEREOTYPE_NAME,
            "includeDetails": str(INCLUDE_DETAILS).lower(),
            "limit": 500,
            "offset": 0,
        }
    )
    response = requests.get(
        f"{WORKBENCH_BASE_URL}/api/cache/servers/{SERVER_ID}/projects/{PROJECT_ID}/branches/{BRANCH_ID}/elements/by-stereotype?{query}",
        headers={"Authorization": f"Bearer {API_KEY}"},
        timeout=120,
        verify=VERIFY_TLS,
    )
    response.raise_for_status()
    payload = response.json()
    print(json.dumps(payload, indent=2))
    print(f"Matched {payload.get('total', 0)} elements for stereotype {STEREOTYPE_NAME!r}.")


if __name__ == "__main__":
    main()
`;
}

function workbenchEditElementPythonScript(
  workbenchBaseUrl: string,
  serverId: string,
  projectId: string,
  branchId: string,
  elementId: string,
): string {
  return `from __future__ import annotations

import json

import requests

WORKBENCH_BASE_URL = ${pythonLiteral(workbenchBaseUrl)}
API_KEY = "replace-with-your-api-key"
SERVER_ID = ${pythonLiteral(serverId)}
PROJECT_ID = ${pythonLiteral(projectId)}
BRANCH_ID = ${pythonLiteral(branchId)}
ELEMENT_ID = ${pythonLiteral(elementId)}
VERIFY_TLS = True


def main() -> None:
    payload = {
        "documentation": "Updated from a full Python example in the Workbench Developer API tab."
    }
    response = requests.patch(
        f"{WORKBENCH_BASE_URL}/api/cache/servers/{SERVER_ID}/projects/{PROJECT_ID}/branches/{BRANCH_ID}/elements/{ELEMENT_ID}",
        headers={
            "Authorization": f"Bearer {API_KEY}",
            "Content-Type": "application/json",
        },
        json=payload,
        timeout=120,
        verify=VERIFY_TLS,
    )
    response.raise_for_status()
    print(json.dumps(response.json(), indent=2))


if __name__ == "__main__":
    main()
`;
}

function identityRows(item: ItemDetails, lookup: Record<string, string>): InspectorRow[] {
  const sourcePayload = item.source_payload ?? {};
  const fields: Record<string, unknown> = {
    id: item.id,
    type: item.item_type,
    path: friendlyPath(item.path, lookup),
    qualified_name: sourcePayload.qualified_name,
    metaclass: sourcePayload.metaclass,
    model_id: sourcePayload.model_id,
    local_id: sourcePayload.local_id,
    owner_id: sourcePayload.owner_id,
    version: item.version,
  };
  return mapToInspectorRows(fields, lookup);
}

function overviewRows(item: ItemDetails, lookup: Record<string, string>): InspectorRow[] {
  const fields: Record<string, unknown> = {
    name: item.name,
    description: item.description,
    stereotypes: item.stereotypes,
    raw_types: item.raw_types,
  };
  return mapToInspectorRows(fields, lookup);
}

function specificationRows(item: ItemDetails, lookup: Record<string, string>): InspectorRow[] {
  const structuredRows = payloadSpecSectionEntries(item, "properties").map((entry, index) => ({
    key: `spec.properties.${index}.${structuredEntryName(entry)}`,
    label: structuredEntryName(entry),
    value: structuredEntryValue(entry, ["value"], lookup),
  }));
  const sourcePayload = item.source_payload ?? {};
  const attributes = payloadAttributes(item);
  const references = payloadReferences(item);
  const rows: InspectorRow[] = [...structuredRows];

  const pushRows = (source: Record<string, unknown>, sectionPrefix = "") => {
    for (const [key, value] of Object.entries(source)) {
      if (!keyMatchesHints(key, SPECIFICATION_FIELD_HINTS) || !hasMeaningfulValue(value)) {
        continue;
      }
      rows.push({
        key: `${sectionPrefix}${key}`,
        label: humanizeFieldLabel(key),
        value: humanReadableValue(value, lookup),
      });
    }
  };

  pushRows(sourcePayload, "payload.");
  pushRows(attributes, "attributes.");
  pushRows(references, "references.");

  if (!rows.length && hasMeaningfulValue(item.documentation_markdown) && keyMatchesHints(item.item_type, ["constraint"])) {
    rows.push({
      key: "documentation_markdown",
      label: "Constraint Documentation",
      value: item.documentation_markdown,
    });
  }

  return dedupeInspectorRows(
    rows.sort((left, right) => compareDisplayValues(left.label, right.label)),
  );
}

function constraintRows(item: ItemDetails, lookup: Record<string, string>): InspectorRow[] {
  const attributes = payloadAttributes(item);
  const references = payloadReferences(item);
  const rows: InspectorRow[] = payloadSpecSectionEntries(item, "constraints").map((entry, index) => ({
    key: `spec.constraints.${index}.${structuredEntryName(entry)}`,
    label: structuredEntryName(entry),
    value: structuredEntryValue(entry, ["specification", "value"], lookup),
  }));

  const pushRows = (source: Record<string, unknown>, sectionPrefix = "") => {
    for (const [key, value] of Object.entries(source)) {
      if (!keyMatchesHints(key, CONSTRAINT_FIELD_HINTS) || !hasMeaningfulValue(value)) {
        continue;
      }
      rows.push({
        key: `${sectionPrefix}${key}`,
        label: humanizeFieldLabel(key),
        value: humanReadableValue(value, lookup),
      });
    }
  };

  pushRows(attributes, "attributes.");
  pushRows(references, "references.");

  return dedupeInspectorRows(
    rows.sort((left, right) => compareDisplayValues(left.label, right.label)),
  );
}

function constraintReferenceItems(item: ItemDetails): ItemReference[] {
  const seen = new Set<string>();
  const matchesConstraint = (reference: ItemReference) =>
    keyMatchesHints(reference.item_type, ["constraint"]) ||
    keyMatchesHints(reference.relationship_type, CONSTRAINT_FIELD_HINTS) ||
    keyMatchesHints(reference.name, ["constraint"]);

  return [...item.type_references, ...item.related_items, ...item.contained_elements].filter((reference) => {
    if (!matchesConstraint(reference)) {
      return false;
    }
    const key = `${reference.relationship_type}:${reference.id}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function collectHintRows(
  item: ItemDetails,
  lookup: Record<string, string>,
  hints: string[],
  options?: {
    includeSourcePayload?: boolean;
    includeAttributes?: boolean;
    includeReferences?: boolean;
    includeMetadata?: boolean;
    inlineOnly?: boolean;
  },
): InspectorRow[] {
  const resolved = {
    includeSourcePayload: options?.includeSourcePayload ?? true,
    includeAttributes: options?.includeAttributes ?? true,
    includeReferences: options?.includeReferences ?? true,
    includeMetadata: options?.includeMetadata ?? false,
    inlineOnly: options?.inlineOnly ?? false,
  };
  const rows: InspectorRow[] = [];
  const sourcePayload = item.source_payload ?? {};
  const sources: Array<[string, Record<string, unknown>]> = [];
  if (resolved.includeSourcePayload) {
    sources.push(["payload.", sourcePayload]);
  }
  if (resolved.includeAttributes) {
    sources.push(["attributes.", payloadAttributes(item)]);
  }
  if (resolved.includeReferences) {
    sources.push(["references.", payloadReferences(item)]);
  }
  if (resolved.includeMetadata) {
    sources.push(["metadata.", item.metadata ?? {}]);
  }
  for (const [prefix, source] of sources) {
    for (const [key, value] of Object.entries(source)) {
      if (!keyMatchesHints(key, hints) || !hasMeaningfulValue(value)) {
        continue;
      }
      if (resolved.inlineOnly && !isInlineDisplayValue(value)) {
        continue;
      }
      rows.push({
        key: `${prefix}${key}`,
        label: humanizeFieldLabel(key),
        value: resolved.inlineOnly ? humanReadableInlineValue(value, lookup) : humanReadableValue(value, lookup),
      });
    }
  }
  return dedupeInspectorRows(rows.sort((left, right) => compareDisplayValues(left.label, right.label)));
}

function uniqueItemReferences(references: ItemReference[]): ItemReference[] {
  const seen = new Set<string>();
  return references.filter((reference) => {
    const key = `${reference.relationship_type}:${reference.id}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function collectReferenceMatches(item: ItemDetails, hints: string[]): ItemReference[] {
  return uniqueItemReferences(
    [...item.type_references, ...item.related_items, ...item.contained_elements].filter((reference) => {
      return (
        keyMatchesHints(reference.relationship_type, hints) ||
        keyMatchesHints(reference.item_type, hints) ||
        keyMatchesHints(reference.name, hints) ||
        keyMatchesHints(reference.path, hints)
      );
    }),
  );
}

function extractCommentBlocks(item: ItemDetails): string[] {
  const sourcePayload = item.source_payload ?? {};
  const candidates = [
    item.documentation_markdown,
    item.description,
    sourcePayload.documentation,
    sourcePayload.comments,
    sourcePayload.comment,
    sourcePayload.owned_comments,
    sourcePayload.ownedComments,
  ];
  const blocks: string[] = [];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      blocks.push(candidate.trim());
    } else if (Array.isArray(candidate)) {
      for (const entry of candidate) {
        if (typeof entry === "string" && entry.trim()) {
          blocks.push(entry.trim());
        }
      }
    }
  }
  return Array.from(new Set(blocks));
}

function extractDocumentationSections(item: ItemDetails): { documentation: string[]; comments: string[] } {
  const structuredDocumentation = payloadSpecSectionStrings(item, "documentation", "documentation");
  const structuredComments = payloadSpecSectionStrings(item, "documentation", "comments");
  if (structuredDocumentation.length || structuredComments.length) {
    return {
      documentation: structuredDocumentation,
      comments: structuredComments,
    };
  }
  const sourcePayload = item.source_payload ?? {};
  const documentation = new Set<string>();
  const comments = new Set<string>();

  const addStrings = (target: Set<string>, value: unknown) => {
    if (typeof value === "string" && value.trim()) {
      target.add(value.trim());
      return;
    }
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (typeof entry === "string" && entry.trim()) {
          target.add(entry.trim());
        }
      }
    }
  };

  addStrings(documentation, sourcePayload.documentation);
  addStrings(documentation, item.description);
  addStrings(documentation, item.documentation_markdown);

  addStrings(comments, sourcePayload.comments);
  addStrings(comments, sourcePayload.comment);
  addStrings(comments, sourcePayload.owned_comments);
  addStrings(comments, sourcePayload.ownedComments);

  if (!documentation.size && !comments.size) {
    for (const block of extractCommentBlocks(item)) {
      documentation.add(block);
    }
  }

  return {
    documentation: Array.from(documentation),
    comments: Array.from(comments),
  };
}

function hintRowsToTableRows(rows: InspectorRow[]): DataTableRow[] {
  return rows.map((row) => ({
    key: row.key,
    cells: [row.label, row.value || "Not provided"],
  }));
}

function referenceRowsToTableRows(references: ItemReference[], lookup: Record<string, string>, typeSelector?: (reference: ItemReference) => string): DataTableRow[] {
  return references.map((reference) => ({
    key: `${reference.relationship_type}:${reference.id}`,
    cells: [
      itemReferenceDisplayName(reference, lookup),
      typeSelector?.(reference) ?? itemReferenceTypeLabel(reference),
    ],
  }));
}

function relationshipTableRows(item: ItemDetails, lookup: Record<string, string>): DataTableRow[] {
  const rows: DataTableRow[] = [];
  const entityName = displayEntityName(item.name, item.id, item.item_type, lookup, item.path);

  if (item.owner) {
    rows.push({
      key: `owner:${item.owner.id}`,
      cells: ["Owner", entityName, "Parent", itemReferenceDisplayName(item.owner, lookup)],
    });
  }

  for (const reference of item.contained_elements) {
    rows.push({
      key: `contained:${reference.id}`,
      cells: ["Owned Element", entityName, "Contains", itemReferenceDisplayName(reference, lookup)],
    });
  }

  for (const reference of item.type_references) {
    rows.push({
      key: `typed:${reference.id}`,
      cells: [humanizeFieldLabel(reference.relationship_type), entityName, "References", itemReferenceDisplayName(reference, lookup)],
    });
  }

  for (const reference of item.related_items) {
    rows.push({
      key: `related:${reference.relationship_type}:${reference.id}`,
      cells: [humanizeFieldLabel(reference.relationship_type), entityName, "Related", itemReferenceDisplayName(reference, lookup)],
    });
  }

  item.relationships.forEach((relationship, index) => {
    const targetName =
      typeof relationship.target_name === "string" && relationship.target_name
        ? relationship.target_name
        : typeof relationship.target === "string"
          ? humanReadableReference(relationship.target, lookup)
          : humanReadableValue(relationship.target ?? relationship, lookup);
    if (!hasMeaningfulValue(targetName)) {
      return;
    }
    rows.push({
      key: `relationship:${index}`,
      cells: [
        humanizeFieldLabel(String(relationship.type ?? `Relationship ${index + 1}`)),
        entityName,
        "Outgoing",
        String(targetName),
      ],
    });
  });

  const deduped = new Set<string>();
  return rows.filter((row) => {
    const key = row.cells.map((cell) => String(cell)).join("::");
    if (deduped.has(key)) {
      return false;
    }
    deduped.add(key);
    return true;
  });
}

function specificationSectionIntro(section: SpecificationSectionId, item: ItemDetails): string {
  const typeLabel = humanizeFieldLabel(item.item_type || item.raw_types[0] || "item");
  switch (section) {
    case "properties":
      return `Review the published ${typeLabel} properties. Switch between Standard, Expert, and All to surface more fields.`;
    case "documentation":
      return `Review documentation and comments published for the selected ${typeLabel}.`;
    case "navigation":
      return `Review navigation targets and hyperlinks published for the selected ${typeLabel}.`;
    case "usage-diagrams":
      return `Review published diagram usage references for the selected ${typeLabel}.`;
    case "inner-elements":
      return `Review the contained elements published under the selected ${typeLabel}.`;
    case "relations":
      return `Review the relationships published for the selected ${typeLabel}.`;
    case "tags":
      return `Review published stereotypes, tags, and tagged values for the selected ${typeLabel}.`;
    case "constraints":
      return `Review constraints published for the selected ${typeLabel}.`;
    case "traceability":
      return `Review traceability references published for the selected ${typeLabel}.`;
    case "allocations":
      return `Review allocation references published for the selected ${typeLabel}.`;
    default:
      return "";
  }
}

function viewModeIncludes(viewMode: ItemDetailViewMode, target: "standard" | "expert" | "all"): boolean {
  if (viewMode === "all") {
    return true;
  }
  if (viewMode === "expert") {
    return target === "standard" || target === "expert";
  }
  return target === "standard";
}

function specificationWindowRows(
  item: ItemDetails,
  lookup: Record<string, string>,
  viewMode: ItemDetailViewMode,
): InspectorRow[] {
  const sourcePayload = item.source_payload ?? {};
  const attributes = payloadAttributes(item);
  const metadata = item.metadata ?? {};
  const references = payloadReferences(item);
  const rows: InspectorRow[] = [];
  const pushRow = (key: string, label: string, value: unknown) => {
    if (!hasMeaningfulValue(value)) {
      return;
    }
    rows.push({
      key,
      label,
      value: humanReadableValue(value, lookup),
    });
  };

  pushRow("documentation", "Documentation", item.documentation_markdown);
  pushRow("human_name", "Human Name", sourcePayload.human_name || item.name);
  pushRow("human_type", "Human Type", sourcePayload.human_type);
  pushRow("id", "ID", item.id);
  pushRow("local_id", "Local ID", sourcePayload.local_id);
  pushRow("metaclass", "Metaclass", sourcePayload.metaclass);
  pushRow("name", "Name", item.name);
  pushRow("path", "Path", friendlyPath(item.path, lookup));
  pushRow("qualified_name", "Qualified Name", sourcePayload.qualified_name);
  pushRow("type", "Type", item.item_type);
  pushRow("version", "Version", item.version);
  pushRow("description", "Description", item.description);
  pushRow("stereotypes", "Applied Stereotypes", item.stereotypes);
  pushRow("owner_name", "Owner", item.owner ? itemReferenceDisplayName(item.owner, lookup) : "");

  rows.push(
    ...collectHintRows(item, lookup, PROPERTY_FIELD_HINTS, {
      includeSourcePayload: true,
      includeAttributes: true,
      includeReferences: false,
      includeMetadata: false,
      inlineOnly: true,
    }),
    ...collectHintRows(item, lookup, SPECIFICATION_FIELD_HINTS, {
      includeSourcePayload: true,
      includeAttributes: true,
      includeReferences: false,
      includeMetadata: false,
      inlineOnly: true,
    }),
  );

  if (viewModeIncludes(viewMode, "expert")) {
    rows.push(
      ...mapInlineInspectorRows(
        {
          model_id: sourcePayload.model_id,
          local_id: sourcePayload.local_id,
          owner_id: sourcePayload.owner_id,
          raw_types: item.raw_types.slice(0, 3),
        },
        lookup,
      ),
      ...mapInlineInspectorRows(metadata, lookup),
      ...collectHintRows(item, lookup, [...PROPERTY_FIELD_HINTS, ...SPECIFICATION_FIELD_HINTS, ...CONSTRAINT_FIELD_HINTS], {
        includeSourcePayload: false,
        includeAttributes: true,
        includeReferences: true,
        inlineOnly: true,
      }),
    );
  }

  if (viewMode === "all") {
    for (const [key, value] of payloadExtraSections(item)) {
      rows.push({
        key: `extra.${key}`,
        label: humanizeFieldLabel(key),
        value: humanReadableValue(value, lookup),
      });
    }
  }

  return dedupeInspectorRows(rows);
}

function defaultParameterValue(parameter: SwaggerParameterSpec): string {
  if (parameter.default === null || parameter.default === undefined) {
    return "";
  }
  return String(parameter.default);
}

function coerceParameterValue(parameter: SwaggerParameterSpec, value: string): unknown {
  if (value === "") {
    return "";
  }
  if (parameter.schema_type === "boolean") {
    return value === "true";
  }
  if (parameter.schema_type === "integer") {
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? value : parsed;
  }
  if (parameter.schema_type === "number") {
    const parsed = Number.parseFloat(value);
    return Number.isNaN(parsed) ? value : parsed;
  }
  if (parameter.schema_type === "array") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return value;
}

function collectParameterValues(parameters: SwaggerParameterSpec[], values: Record<string, string>) {
  return parameters.reduce<Record<string, unknown>>((collected, parameter) => {
    const value = values[parameter.name] ?? "";
    if (value !== "") {
      collected[parameter.name] = coerceParameterValue(parameter, value);
    } else if (parameter.location === "path" && parameter.required) {
      collected[parameter.name] = "";
    }
    return collected;
  }, {});
}

function requestBodyTemplate(operation: SwaggerOperationSpec | null, manifest: SwaggerContractManifest | null): string {
  if (!operation?.request_body) {
    return "";
  }
  const contentType = operation.request_body.content_types[0] ?? "";
  if (contentType === "text/plain") {
    return "";
  }
  const schemaName = Object.values(operation.request_body.schema_refs).find(Boolean);
  if (!schemaName || !manifest) {
    return "{}";
  }
  const schema = manifest.schemas.find((candidate) => candidate.name === schemaName);
  if (!schema || !schema.properties.length) {
    return "{}";
  }
  const sample = schema.properties.reduce<Record<string, unknown>>((collected, property) => {
    if (!property.required && schema.required.length) {
      return collected;
    }
    if (property.schema_type === "boolean") {
      collected[property.name] = false;
    } else if (property.schema_type === "integer" || property.schema_type === "number") {
      collected[property.name] = 0;
    } else if (property.schema_type === "array") {
      collected[property.name] = [];
    } else if (property.schema_type === "object") {
      collected[property.name] = {};
    } else {
      collected[property.name] = "";
    }
    return collected;
  }, {});
  return JSON.stringify(sample, null, 2);
}

function responseContent(response: SwaggerExecuteResponse): string {
  if (response.body !== null && response.body !== undefined) {
    return JSON.stringify(response.body, null, 2);
  }
  if (response.text) {
    return response.text;
  }
  if (response.body_base64) {
    return `Binary response: ${response.size_bytes} bytes, ${response.content_type || "unknown content type"}.`;
  }
  return "No response body.";
}

function downloadSwaggerResponse(response: SwaggerExecuteResponse) {
  if (!response.body_base64) {
    return;
  }
  const binary = atob(response.body_base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  const blob = new Blob([bytes], { type: response.content_type || "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = response.filename ?? "twc-response.bin";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function downloadBinaryResponse(response: { body_base64?: string | null; content_type: string; filename?: string | null }) {
  if (!response.body_base64) {
    return;
  }
  const binary = atob(response.body_base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  const blob = new Blob([bytes], { type: response.content_type || "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = response.filename ?? "oslc-response.bin";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function oslcResponseContent(response: OSLCExecuteResponse): string {
  if (response.body !== null && response.body !== undefined) {
    return JSON.stringify(response.body, null, 2);
  }
  if (response.text) {
    return response.text;
  }
  if (response.body_base64) {
    return `Binary response: ${response.size_bytes} bytes, ${response.content_type || "unknown content type"}.`;
  }
  return "No response body.";
}

export default function WorkspacePage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const pendingSearchSyncRef = useRef<string | null>(null);
  const queryClient = useQueryClient();
  const { session, refreshSession, setSessionSnapshot } = useSession();
  const currentPreferences: SessionPreferences = session?.preferences ?? {
    theme_mode: "system",
    font_scale: 1,
    request_timeout_seconds: 30,
    live_log_poll_interval_ms: 2500,
    presentation_font_scale: 1.2,
    compact_ui: true,
    show_hidden_packages_in_tree: false,
    item_detail_view_mode: "standard",
  };
  const csrfToken = session?.csrf_token ?? "";
  const capabilities = session?.capabilities?.capabilities ?? {};
  const canEdit = capabilities.edit?.state === "ready";
  const isAdmin = Boolean(session?.can_manage_server_presets);
  const compactUi = currentPreferences.compact_ui ?? true;
  const [itemDetailViewMode, setItemDetailViewMode] = useState<ItemDetailViewMode>(() =>
    parseItemDetailViewMode(currentPreferences.item_detail_view_mode),
  );
  const cacheTimeMs = 1000 * 60 * 60 * 12;
  const sessionCacheKey = [session?.user?.preferred_username ?? "anonymous", session?.server?.id ?? "no-server"];
  const layoutStoragePrefix = `twc-workbench-layout:${sessionCacheKey.join(":")}`;
  const navPaneStorageKey = `${layoutStoragePrefix}:nav-pane-width`;
  const modelContainmentPaneStorageKey = `${layoutStoragePrefix}:model-containment-pane-width`;

  const toggleNewCacheApiKeyScope = (scope: CacheApiKeyScope, checked: boolean) => {
    setNewCacheApiKeyScopes((current) => {
      if (checked) {
        return current.includes(scope) ? current : [...current, scope];
      }
      return current.filter((value) => value !== scope);
    });
  };

  const [tab, setTab] = useState<WorkspaceTab>(() => parseWorkspaceTab(searchParams.get("tab")));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState(() => searchParams.get("project") ?? "");
  const [selectedBranchId, setSelectedBranchId] = useState(() => searchParams.get("branch") ?? "");
  const [treeFilter, setTreeFilter] = useState("");
  const [selectedItemId, setSelectedItemId] = useState(() => searchParams.get("item") ?? "");
  const [selectedSpecificationSection, setSelectedSpecificationSection] = useState<SpecificationSectionId>("properties");
  const [treeNodes, setTreeNodes] = useState<TreeNode[]>([]);
  const [loadingTreeNodeIds, setLoadingTreeNodeIds] = useState<string[]>([]);
  const [expandedTreeNodeIds, setExpandedTreeNodeIds] = useState<string[]>([]);
  const [navPaneWidth, setNavPaneWidth] = useState(() => readStoredNumber(navPaneStorageKey, 280, 240, 420));
  const [modelContainmentPaneWidth, setModelContainmentPaneWidth] = useState(() =>
    readStoredNumber(modelContainmentPaneStorageKey, 320, 260, 460),
  );
  const [workspaceMenuGroup, setWorkspaceMenuGroup] = useState<WorkspaceMenuGroup | null>(null);
  const [workspaceMenuAnchorEl, setWorkspaceMenuAnchorEl] = useState<HTMLElement | null>(null);
  const [itemDraft, setItemDraft] = useState<ItemDetails | null>(null);
  const [compareLeft, setCompareLeft] = useState("");
  const [compareRight, setCompareRight] = useState("");
  const [compareLeftDisplay, setCompareLeftDisplay] = useState("");
  const [compareRightDisplay, setCompareRightDisplay] = useState("");
  const [selectedApiTag, setSelectedApiTag] = useState("");
  const [selectedOperationKey, setSelectedOperationKey] = useState("");
  const [apiSearch, setApiSearch] = useState("");
  const [apiPathParams, setApiPathParams] = useState<Record<string, string>>({});
  const [apiQueryParams, setApiQueryParams] = useState<Record<string, string>>({});
  const [apiBodyText, setApiBodyText] = useState("");
  const [apiContentType, setApiContentType] = useState("");
  const [apiUploadFile, setApiUploadFile] = useState<File | null>(null);
  const [oslcPath, setOslcPath] = useState("/oslc/api/rootservices");
  const [oslcAccept, setOslcAccept] = useState("application/rdf+xml");
  const [oslcConsumerName, setOslcConsumerName] = useState("");
  const [oslcConsumerSecret, setOslcConsumerSecret] = useState("");
  const [oslcManualKey, setOslcManualKey] = useState("");
  const [oslcManualSecret, setOslcManualSecret] = useState("");
  const [manualCacheIngestToken, setManualCacheIngestToken] = useState("");
  const [revealedCacheIngestToken, setRevealedCacheIngestToken] = useState("");
  const [newCacheApiKeyLabel, setNewCacheApiKeyLabel] = useState("");
  const [revealedCacheApiKey, setRevealedCacheApiKey] = useState("");
  const [newCacheApiKeyScopes, setNewCacheApiKeyScopes] = useState<CacheApiKeyScope[]>(["read"]);
  const [agentBaseUrlDraft, setAgentBaseUrlDraft] = useState("");
  const [agentApiKeyDraft, setAgentApiKeyDraft] = useState("");
  const [agentSelectedModelId, setAgentSelectedModelId] = useState("");
  const [agentSelectedModelName, setAgentSelectedModelName] = useState("");
  const [agentChatInput, setAgentChatInput] = useState("");
  const [agentMessages, setAgentMessages] = useState<WorkbenchAgentChatMessage[]>([]);
  const treeContextKey = `${selectedProjectId || "no-project"}:${selectedBranchId || "no-branch"}`;
  const treeContextRef = useRef<string>(treeContextKey);
  const [agentSyncKnowledgeBeforeChat, setAgentSyncKnowledgeBeforeChat] = useState(true);
  const [notice, setNotice] = useState<{ severity: "success" | "error"; message: string } | null>(null);
  const projectContextActive = tab === "models" || tab === "diagram-viewer" || tab === "compare";
  const treeExpandedStorageKey = `${layoutStoragePrefix}:tree-expanded:${selectedProjectId || "no-project"}:${selectedBranchId || "no-branch"}`;
  const workspaceOuterPadding = compactUi ? { xs: 1.5, md: 2 } : { xs: 2, md: 3 };
  const panelPadding = compactUi ? 2 : 3;
  const sectionSpacing = compactUi ? 1.5 : 2;
  const viewportPanelMaxHeight = compactUi ? "calc(100vh - 250px)" : "calc(100vh - 220px)";
  const previewMaxHeight = compactUi ? 460 : 520;

  const projectsQuery = useQuery({
    queryKey: ["workspace-projects", ...sessionCacheKey],
    queryFn: () => api.getProjects(),
    staleTime: cacheTimeMs,
    gcTime: cacheTimeMs,
    refetchOnWindowFocus: false,
  });

  const contractQuery = useQuery({
    queryKey: ["workspace-contract", ...sessionCacheKey],
    queryFn: api.getContractManifest,
    enabled: isAdmin,
    staleTime: cacheTimeMs,
    gcTime: cacheTimeMs,
    refetchOnWindowFocus: false,
  });

  const oslcStatusQuery = useQuery({
    queryKey: ["workspace-oslc-status", ...sessionCacheKey],
    queryFn: api.getOslcStatus,
    enabled: Boolean(session?.server?.id) && isAdmin,
    staleTime: cacheTimeMs,
    gcTime: cacheTimeMs,
    refetchOnWindowFocus: false,
  });

  const sharedOslcConsumerQuery = useQuery({
    queryKey: ["workspace-oslc-shared-consumer", ...sessionCacheKey],
    queryFn: api.getSharedOslcConsumer,
    enabled: Boolean(session?.server?.id) && isAdmin,
    staleTime: cacheTimeMs,
    gcTime: cacheTimeMs,
    refetchOnWindowFocus: false,
  });

  const cacheIngestTokenQuery = useQuery({
    queryKey: ["workspace-cache-ingest-token", ...sessionCacheKey],
    queryFn: api.getCacheIngestTokenStatus,
    enabled: isAdmin,
    staleTime: cacheTimeMs,
    gcTime: cacheTimeMs,
    refetchOnWindowFocus: false,
  });
  const cacheApiKeysQuery = useQuery({
    queryKey: ["workspace-cache-api-keys", ...sessionCacheKey],
    queryFn: api.listCacheApiKeys,
    enabled: Boolean(session?.user?.preferred_username),
    staleTime: cacheTimeMs,
    gcTime: cacheTimeMs,
    refetchOnWindowFocus: false,
  });
  const workbenchAgentStatusQuery = useQuery({
    queryKey: ["workspace-agent", ...sessionCacheKey],
    queryFn: api.getWorkbenchAgentStatus,
    enabled: Boolean(session?.user?.preferred_username),
    staleTime: 1000 * 60,
    gcTime: cacheTimeMs,
    refetchOnWindowFocus: false,
  });
  const workbenchAgentStatus = workbenchAgentStatusQuery.data ?? null;
  const workbenchAgentModelsQuery = useQuery({
    queryKey: [
      "workspace-agent-models",
      ...sessionCacheKey,
      workbenchAgentStatus?.base_url ?? "",
      workbenchAgentStatus?.updated_at ?? "",
    ],
    queryFn: api.listWorkbenchAgentModels,
    enabled: tab === "agent" && Boolean(workbenchAgentStatus?.configured && workbenchAgentStatus?.has_api_key),
    staleTime: 1000 * 60 * 5,
    gcTime: cacheTimeMs,
    refetchOnWindowFocus: false,
  });
  const workbenchAgentModels = workbenchAgentModelsQuery.data ?? [];

  const projects = useMemo(
    () =>
      [...(projectsQuery.data ?? [])].sort((left, right) => {
        const nameComparison = compareDisplayValues(left.name || left.id, right.name || right.id);
        if (nameComparison !== 0) {
          return nameComparison;
        }
        return compareDisplayValues(left.id, right.id);
      }),
    [projectsQuery.data],
  );
  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  );
  const branchesQuery = useQuery({
    queryKey: ["workspace-branches", ...sessionCacheKey, selectedProjectId, selectedProject?.workspace_id],
    queryFn: () => api.getProjectBranches(selectedProjectId, selectedProject?.workspace_id || undefined),
    enabled: Boolean(selectedProjectId),
    staleTime: cacheTimeMs,
    gcTime: cacheTimeMs,
    refetchOnWindowFocus: false,
  });
  const selectedProjectBranches = useMemo(
    () =>
      [...(branchesQuery.data ?? [])].sort((left, right) => {
        const nameComparison = compareDisplayValues(left.name || left.id, right.name || right.id);
        if (nameComparison !== 0) {
          return nameComparison;
        }
        return compareDisplayValues(left.id, right.id);
      }),
    [branchesQuery.data],
  );

  useEffect(() => {
    if (!selectedProjectId) {
      setSelectedBranchId("");
      return;
    }
    if (branchesQuery.isLoading) {
      return;
    }
    if (!selectedProjectBranches.length) {
      setSelectedBranchId("");
      return;
    }
    if (!selectedProjectBranches.some((branch) => branch.id === selectedBranchId)) {
      setSelectedBranchId(selectedProjectBranches[0].id);
    }
  }, [branchesQuery.isLoading, selectedBranchId, selectedProjectBranches, selectedProjectId]);

  useEffect(() => {
    setSelectedItemId("");
    setItemDraft(null);
  }, [selectedBranchId]);

  useEffect(() => {
    setAgentMessages([]);
  }, [selectedProjectId, selectedBranchId]);

  useEffect(() => {
    setExpandedTreeNodeIds(readStoredStringArray(treeExpandedStorageKey));
  }, [treeExpandedStorageKey]);

  useEffect(() => {
    setNavPaneWidth(readStoredNumber(navPaneStorageKey, 280, 240, 420));
  }, [navPaneStorageKey]);

  useEffect(() => {
    setModelContainmentPaneWidth(readStoredNumber(modelContainmentPaneStorageKey, 320, 260, 460));
  }, [modelContainmentPaneStorageKey]);

  useEffect(() => {
    const clampPaneWidths = () => {
      const viewportWidth = window.innerWidth;
      setNavPaneWidth((current) => clampNumber(current, 240, paneMaxWidthForViewport(viewportWidth, 0.28, 240, 420)));
      setModelContainmentPaneWidth((current) => clampNumber(current, 260, paneMaxWidthForViewport(viewportWidth, 0.34, 260, 460)));
    };
    clampPaneWidths();
    window.addEventListener("resize", clampPaneWidths);
    return () => window.removeEventListener("resize", clampPaneWidths);
  }, []);

  useEffect(() => {
    persistStoredValue(navPaneStorageKey, navPaneWidth);
  }, [navPaneStorageKey, navPaneWidth]);

  useEffect(() => {
    persistStoredValue(modelContainmentPaneStorageKey, modelContainmentPaneWidth);
  }, [modelContainmentPaneStorageKey, modelContainmentPaneWidth]);

  useEffect(() => {
    persistStoredValue(treeExpandedStorageKey, expandedTreeNodeIds);
  }, [expandedTreeNodeIds, treeExpandedStorageKey]);

  useEffect(() => {
    const currentSearch = searchParams.toString();
    if (pendingSearchSyncRef.current !== null && pendingSearchSyncRef.current === currentSearch) {
      pendingSearchSyncRef.current = null;
      return;
    }
    const urlTab = parseWorkspaceTab(searchParams.get("tab"), isAdmin);
    const urlProjectId = searchParams.get("project") ?? "";
    const urlBranchId = searchParams.get("branch") ?? "";
    const urlItemId = searchParams.get("item") ?? "";
    if (urlTab !== tab) {
      setTab(urlTab);
    }
    if (urlProjectId !== selectedProjectId) {
      setSelectedProjectId(urlProjectId);
    }
    if (urlBranchId !== selectedBranchId) {
      setSelectedBranchId(urlBranchId);
    }
    if (urlItemId !== selectedItemId) {
      setSelectedItemId(urlItemId);
    }
  }, [isAdmin, searchParams]);

  useEffect(() => {
    const nextParams = new URLSearchParams(searchParams);
    const nextTab = parseWorkspaceTab(tab, isAdmin);
    if (nextTab === "dashboard") {
      nextParams.delete("tab");
    } else {
      nextParams.set("tab", nextTab);
    }
    if (selectedProjectId) {
      nextParams.set("project", selectedProjectId);
    } else {
      nextParams.delete("project");
    }
    if (selectedBranchId) {
      nextParams.set("branch", selectedBranchId);
    } else {
      nextParams.delete("branch");
    }
    if (selectedItemId) {
      nextParams.set("item", selectedItemId);
    } else {
      nextParams.delete("item");
    }
    const current = searchParams.toString();
    const next = nextParams.toString();
    if (current !== next) {
      pendingSearchSyncRef.current = next;
      setSearchParams(nextParams, { replace: true });
    }
  }, [isAdmin, searchParams, selectedBranchId, selectedItemId, selectedProjectId, setSearchParams, tab]);

  const treeQuery = useQuery({
    queryKey: ["workspace-tree", ...sessionCacheKey, selectedProjectId, selectedBranchId],
    queryFn: () => api.getTree(selectedProjectId || undefined, selectedBranchId || undefined, selectedProject?.workspace_id || undefined, false, 0),
    enabled:
      projectContextActive &&
      Boolean(selectedProjectId) &&
      !branchesQuery.isLoading &&
      (!selectedProjectBranches.length || Boolean(selectedBranchId)),
    staleTime: cacheTimeMs,
    gcTime: cacheTimeMs,
    refetchOnWindowFocus: false,
  });
  const baseTreeNodes = treeQuery.data ?? [];

  useEffect(() => {
    if (treeContextRef.current !== treeContextKey) {
      treeContextRef.current = treeContextKey;
      setTreeNodes(baseTreeNodes);
      setLoadingTreeNodeIds([]);
      return;
    }
    if (!baseTreeNodes.length) {
      setTreeNodes([]);
      setLoadingTreeNodeIds([]);
      return;
    }
    setTreeNodes((current) => {
      if (!current.length) {
        return baseTreeNodes;
      }
      return mergeTreeNodesPreservingLoadedChildren(baseTreeNodes, current);
    });
  }, [baseTreeNodes, treeContextKey]);

  useEffect(() => {
    setItemDetailViewMode(parseItemDetailViewMode(currentPreferences.item_detail_view_mode));
  }, [currentPreferences.item_detail_view_mode]);

  const baseFlatNodes = useMemo(() => flattenTree(baseTreeNodes), [baseTreeNodes]);
  const loadedFlatNodes = useMemo(() => flattenTree(treeNodes), [treeNodes]);
  const branchAccessManifestQuery = useQuery({
    queryKey: ["workspace-access-map", ...sessionCacheKey, selectedProjectId, selectedBranchId],
    queryFn: () => api.getBranchAccessManifestStatus(selectedProjectId, selectedBranchId),
    enabled: Boolean(selectedProjectId) && Boolean(selectedBranchId),
    staleTime: cacheTimeMs,
    gcTime: cacheTimeMs,
    refetchOnWindowFocus: false,
  });
  const branchAccessManifestStatus: BranchAccessManifestStatus | null = branchAccessManifestQuery.data ?? null;
  const contractManifest = contractQuery.data ?? null;
  const workbenchBaseUrlExample = typeof window !== "undefined" ? window.location.origin : "https://your-workbench-host";
  const developerApiServerId = session?.server?.id ?? "<server_id>";
  const developerApiProjectId = selectedProjectId || selectedProject?.resource_id || "<project_id>";
  const developerApiBranchId = selectedBranchId || "<branch_id>";
  const developerApiElementId = selectedItemId || "<element_id>";
  const manifestPythonExample = useMemo(
    () => workbenchManifestPythonScript(workbenchBaseUrlExample),
    [workbenchBaseUrlExample],
  );
  const listElementsPythonExample = useMemo(
    () =>
      workbenchListElementsPythonScript(
        workbenchBaseUrlExample,
        developerApiServerId,
        developerApiProjectId,
        developerApiBranchId,
      ),
    [developerApiBranchId, developerApiProjectId, developerApiServerId, workbenchBaseUrlExample],
  );
  const stereotypeSearchPythonExample = useMemo(
    () =>
      workbenchStereotypeSearchPythonScript(
        workbenchBaseUrlExample,
        developerApiServerId,
        developerApiProjectId,
        developerApiBranchId,
      ),
    [developerApiBranchId, developerApiProjectId, developerApiServerId, workbenchBaseUrlExample],
  );
  const editElementPythonExample = useMemo(
    () =>
      workbenchEditElementPythonScript(
        workbenchBaseUrlExample,
        developerApiServerId,
        developerApiProjectId,
        developerApiBranchId,
        developerApiElementId,
      ),
    [developerApiBranchId, developerApiElementId, developerApiProjectId, developerApiServerId, workbenchBaseUrlExample],
  );
  const apiTags = useMemo(
    () => Object.keys(contractManifest?.tag_counts ?? {}).sort((left, right) => left.localeCompare(right)),
    [contractManifest],
  );
  const apiOperations = useMemo(() => contractManifest?.operations ?? [], [contractManifest]);
  const filteredApiOperations = useMemo(() => {
    const search = apiSearch.trim().toLowerCase();
    return apiOperations
      .filter((operation) => operation.tag === selectedApiTag)
      .filter((operation) => {
        if (!search) {
          return true;
        }
        return `${operation.method} ${operation.path} ${operation.summary} ${operation.description}`.toLowerCase().includes(search);
      });
  }, [apiOperations, apiSearch, selectedApiTag]);
  const selectedOperation = useMemo(
    () => apiOperations.find((operation) => operation.key === selectedOperationKey) ?? filteredApiOperations[0] ?? null,
    [apiOperations, filteredApiOperations, selectedOperationKey],
  );
  const apiOperationStats = useMemo(
    () =>
      Object.entries(contractManifest?.operation_counts ?? {})
        .map(([method, count]) => `${method} ${count}`)
        .join(" / "),
    [contractManifest],
  );

  const oslcStatus = oslcStatusQuery.data ?? null;
  const sharedOslcConsumer = sharedOslcConsumerQuery.data ?? null;
  const cacheIngestTokenStatus = cacheIngestTokenQuery.data ?? null;
  const cacheApiKeys = cacheApiKeysQuery.data ?? [];

  useEffect(() => {
    if (!workbenchAgentStatus) {
      return;
    }
    setAgentBaseUrlDraft(workbenchAgentStatus.base_url ?? "");
    setAgentSelectedModelId(workbenchAgentStatus.model_id ?? "");
    setAgentSelectedModelName(workbenchAgentStatus.model_name ?? "");
  }, [
    workbenchAgentStatus?.base_url,
    workbenchAgentStatus?.configured,
    workbenchAgentStatus?.model_id,
    workbenchAgentStatus?.model_name,
  ]);

  useEffect(() => {
    if (!agentSelectedModelId || !workbenchAgentModels.length) {
      return;
    }
    const selectedModel = workbenchAgentModels.find((entry) => entry.id === agentSelectedModelId);
    if (selectedModel && selectedModel.name !== agentSelectedModelName) {
      setAgentSelectedModelName(selectedModel.name);
    }
  }, [agentSelectedModelId, agentSelectedModelName, workbenchAgentModels]);

  useEffect(() => {
    if (oslcConsumerName) {
      return;
    }
    const serverId = session?.server?.id ?? "server";
    setOslcConsumerName(`twcworkbench-${serverId}`);
  }, [oslcConsumerName, session?.server?.id]);

  useEffect(() => {
    if (sharedOslcConsumer?.consumer_key && !oslcManualKey) {
      setOslcManualKey(sharedOslcConsumer.consumer_key);
    }
  }, [oslcManualKey, sharedOslcConsumer?.consumer_key]);

  const contextParameterValue = (parameter: SwaggerParameterSpec): string => {
    const normalized = parameter.name.toLowerCase();
    if (normalized === "workspaceid") {
      return selectedProject?.workspace_id ?? "";
    }
    if (normalized === "resourceid") {
      return selectedProject?.resource_id ?? selectedProjectId;
    }
    if (normalized === "branchid") {
      return selectedBranchId;
    }
    if (normalized === "elementid" || normalized === "modelid") {
      return selectedItemId;
    }
    if (normalized === "source") {
      return compareLeft;
    }
    if (normalized === "target") {
      return compareRight;
    }
    return defaultParameterValue(parameter);
  };

  useEffect(() => {
    if (!selectedApiTag && apiTags.length) {
      setSelectedApiTag(apiTags[0]);
    }
  }, [apiTags, selectedApiTag]);

  useEffect(() => {
    if (!filteredApiOperations.length) {
      setSelectedOperationKey("");
      return;
    }
    if (!filteredApiOperations.some((operation) => operation.key === selectedOperationKey)) {
      setSelectedOperationKey(filteredApiOperations[0].key);
    }
  }, [filteredApiOperations, selectedOperationKey]);

  useEffect(() => {
    if (!selectedOperation) {
      return;
    }
    setApiPathParams(
      selectedOperation.path_parameters.reduce<Record<string, string>>((values, parameter) => {
        values[parameter.name] = contextParameterValue(parameter);
        return values;
      }, {}),
    );
    setApiQueryParams(
      selectedOperation.query_parameters.reduce<Record<string, string>>((values, parameter) => {
        values[parameter.name] = defaultParameterValue(parameter);
        return values;
      }, {}),
    );
    setApiContentType(selectedOperation.request_body?.content_types[0] ?? "");
    setApiBodyText(requestBodyTemplate(selectedOperation, contractManifest));
    setApiUploadFile(null);
  }, [
    selectedOperation,
    contractManifest,
    selectedProject?.workspace_id,
    selectedProject?.resource_id,
    selectedProjectId,
    selectedBranchId,
    selectedItemId,
    compareLeft,
    compareRight,
  ]);

  useEffect(() => {
    const connected = searchParams.get("oslcAuth");
    const authError = searchParams.get("oslcAuthError");
    if (!connected && !authError) {
      return;
    }

    if (connected === "connected") {
      setNotice({ severity: "success", message: "OSLC connection is ready for this Teamwork Cloud server." });
      void queryClient.invalidateQueries({ queryKey: ["workspace-oslc-status", ...sessionCacheKey] });
    } else if (authError) {
      setNotice({ severity: "error", message: authError });
    }

    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("oslcAuth");
    nextParams.delete("oslcAuthError");
    setSearchParams(nextParams, { replace: true });
  }, [queryClient, searchParams, setSearchParams]);

  useEffect(() => {
    if (!isAdmin && tab === "api") {
      setTab("dashboard");
    }
  }, [isAdmin, tab]);

  const itemQuery = useQuery({
    queryKey: ["workspace-item", ...sessionCacheKey, selectedItemId, selectedProjectId, selectedBranchId],
    queryFn: () =>
      api.getItem(
        selectedItemId,
        selectedProjectId || undefined,
        selectedBranchId || undefined,
        selectedProject?.workspace_id || undefined,
      ),
    enabled: Boolean(selectedItemId),
    staleTime: cacheTimeMs,
    gcTime: cacheTimeMs,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    setItemDraft(itemQuery.data ?? null);
  }, [itemQuery.data]);

  useEffect(() => {
    setSelectedSpecificationSection("properties");
  }, [selectedItemId]);

  const selectedWorkspaceItem = itemQuery.data ?? itemDraft ?? null;
  const selectedWorkspaceItemIsDiagram = isDiagramLikeItem(selectedWorkspaceItem);
  const selectedWorkspaceItemDiagramPreviewUrl = selectedWorkspaceItem ? diagramPreviewDataUrl(selectedWorkspaceItem) : null;
  const referenceNameById = useMemo(() => {
    const lookup: Record<string, string> = {};
    projects.forEach((project) => {
      if (project.name) {
        lookup[normalizeLookupKey(project.id)] = project.name;
      }
      if (project.resource_id) {
        lookup[normalizeLookupKey(project.resource_id)] = project.name;
      }
    });
    selectedProjectBranches.forEach((branch) => {
      if (branch.name) {
        lookup[normalizeLookupKey(branch.id)] = branch.name;
      }
    });
    loadedFlatNodes.forEach((node) => {
      if (node.label) {
        lookup[normalizeLookupKey(node.id)] = node.label;
      }
    });
    if (selectedWorkspaceItem?.name) {
      lookup[normalizeLookupKey(selectedWorkspaceItem.id)] = selectedWorkspaceItem.name;
    }
    if (selectedWorkspaceItem?.owner?.name) {
      lookup[normalizeLookupKey(selectedWorkspaceItem.owner.id)] = selectedWorkspaceItem.owner.name;
    }
    selectedWorkspaceItem?.type_references.forEach((reference) => {
      if (reference.name) {
        lookup[normalizeLookupKey(reference.id)] = reference.name;
      }
    });
    selectedWorkspaceItem?.contained_elements.forEach((reference) => {
      if (reference.name) {
        lookup[normalizeLookupKey(reference.id)] = reference.name;
      }
    });
    selectedWorkspaceItem?.related_items.forEach((reference) => {
      if (reference.name) {
        lookup[normalizeLookupKey(reference.id)] = reference.name;
      }
    });
    return lookup;
  }, [loadedFlatNodes, projects, selectedProjectBranches, selectedWorkspaceItem]);

  const selectedWorkspaceItemName = selectedWorkspaceItem
    ? displayEntityName(selectedWorkspaceItem.name, selectedWorkspaceItem.id, selectedWorkspaceItem.item_type, referenceNameById, selectedWorkspaceItem.path)
    : "";
  const selectedWorkspaceItemPath = selectedWorkspaceItem ? friendlyPath(selectedWorkspaceItem.path, referenceNameById) : "";
  const selectedTreeNode = useMemo(
    () => (selectedItemId ? loadedFlatNodes.find((node) => node.id === selectedItemId) ?? null : null),
    [loadedFlatNodes, selectedItemId],
  );
  const selectedContainmentPath = selectedWorkspaceItemPath || (selectedTreeNode ? friendlyPath(selectedTreeNode.path, referenceNameById) : "");
  const selectedContainmentSegments = selectedContainmentPath
    .split(" / ")
    .map((segment) => segment.trim())
    .filter(Boolean);
  const showHiddenPackagesInTree = Boolean(session?.preferences.show_hidden_packages_in_tree);
  const visibleTreeNodes = useMemo(
    () => filterContainmentTree(treeNodes, showHiddenPackagesInTree),
    [showHiddenPackagesInTree, treeNodes],
  );
  const selectedWorkbenchAgentModel = useMemo<OpenWebUIModelEntry | null>(
    () => workbenchAgentModels.find((entry) => entry.id === agentSelectedModelId) ?? null,
    [agentSelectedModelId, workbenchAgentModels],
  );
  const workbenchAgentProjectLabel = selectedProject?.name || "Select a project";
  const workbenchAgentBranchLabel = selectedBranchId ? branchLabel(selectedProjectBranches, selectedBranchId) : "Select a branch";
  const compareLeftName = compareLeft.trim() ? humanReadableReference(compareLeft, referenceNameById) : "";
  const compareRightName = compareRight.trim() ? humanReadableReference(compareRight, referenceNameById) : "";
  const compareLeftFieldValue = compareLeftDisplay || compareLeft;
  const compareRightFieldValue = compareRightDisplay || compareRight;
  const compareLeftLabel = compareLeft.trim()
    ? compareLeftName !== compareLeft || isRevisionValue(compareLeft)
      ? compareLeftName
      : "Selected item reference"
    : "";
  const compareRightLabel = compareRight.trim()
    ? compareRightName !== compareRight || isRevisionValue(compareRight)
      ? compareRightName
      : "Selected item reference"
    : "";

  const logoutMutation = useMutation({
    mutationFn: () => api.logout(csrfToken),
    onSuccess: async () => {
      await refreshSession();
      navigate("/", { replace: true });
    },
    onError: (caught) => setNotice({ severity: "error", message: errorMessage(caught) }),
  });

  const capabilityMutation = useMutation({
    mutationFn: () => api.refreshCapabilities(csrfToken),
    onSuccess: async () => {
      await refreshSession();
      setNotice({ severity: "success", message: "Capabilities refreshed from Teamwork Cloud." });
    },
    onError: (caught) => setNotice({ severity: "error", message: errorMessage(caught) }),
  });

  const settingsMutation = useMutation({
    mutationFn: (preferences: SessionPreferences) => api.updatePreferences(preferences, csrfToken),
    onSuccess: (preferences) => {
      if (session) {
        setSessionSnapshot({
          ...session,
          preferences,
        });
      }
      setNotice({ severity: "success", message: "Workspace settings saved." });
    },
    onError: (caught) => setNotice({ severity: "error", message: errorMessage(caught) }),
  });

  const updateSessionPreferences = async (patch: Partial<SessionPreferences>) => {
    await settingsMutation.mutateAsync({
      ...currentPreferences,
      ...patch,
    });
  };

  const itemDetailViewModeMutation = useMutation({
    mutationFn: (nextMode: ItemDetailViewMode) =>
      api.updatePreferences(
        {
          ...currentPreferences,
          item_detail_view_mode: nextMode,
        },
        csrfToken,
      ),
    onMutate: async (_nextMode) => ({ previousMode: itemDetailViewMode }),
    onError: (caught, _nextMode, context) => {
      setItemDetailViewMode(context?.previousMode ?? parseItemDetailViewMode(currentPreferences.item_detail_view_mode));
      setNotice({ severity: "error", message: errorMessage(caught) });
    },
  });

  const handleItemDetailViewModeChange = (_event: ReactMouseEvent<HTMLElement> | SyntheticEvent, nextMode: ItemDetailViewMode | null) => {
    if (!nextMode || nextMode === itemDetailViewMode) {
      return;
    }
    setItemDetailViewMode(nextMode);
    itemDetailViewModeMutation.mutate(nextMode);
  };

  const refreshProjectsMutation = useMutation({
    mutationFn: () => api.getProjects(true),
    onSuccess: (projects) => {
      queryClient.setQueryData(["workspace-projects", ...sessionCacheKey], projects);
      setNotice({ severity: "success", message: "Stored project list reloaded." });
    },
    onError: (caught) => setNotice({ severity: "error", message: errorMessage(caught) }),
  });

  const refreshSelectedProjectMutation = useMutation({
    mutationFn: async () => {
      if (!selectedProjectId) {
        throw new Error("Select a project before refreshing.");
      }
      const branches = await api.getProjectBranches(selectedProjectId, selectedProject?.workspace_id || undefined, true);
      let tree: TreeNode[] | null = null;
      const currentBranchId = selectedBranchId || branches[0]?.id;
      if (currentBranchId) {
        tree = await api.getTree(selectedProjectId, currentBranchId, selectedProject?.workspace_id || undefined, true, 0);
      }
      return { branches, tree, branchId: currentBranchId ?? "" };
    },
    onSuccess: ({ branches, tree, branchId }) => {
      queryClient.setQueryData(["workspace-branches", ...sessionCacheKey, selectedProjectId, selectedProject?.workspace_id], branches);
      if (branchId) {
        queryClient.setQueryData(["workspace-tree", ...sessionCacheKey, selectedProjectId, branchId], tree ?? []);
        setSelectedBranchId(branchId);
      }
      setNotice({ severity: "success", message: "Stored project data reloaded and permissions rechecked." });
    },
    onError: (caught) => setNotice({ severity: "error", message: errorMessage(caught) }),
  });

  const refreshItemMutation = useMutation({
    mutationFn: () => {
      if (!selectedItemId) {
        throw new Error("Select an item before refreshing.");
      }
      return api.getItem(
        selectedItemId,
        selectedProjectId || undefined,
        selectedBranchId || undefined,
        selectedProject?.workspace_id || undefined,
        true,
      );
    },
    onSuccess: (item) => {
      queryClient.setQueryData(["workspace-item", ...sessionCacheKey, selectedItemId, selectedProjectId, selectedBranchId], item);
      setItemDraft(item);
      setNotice({ severity: "success", message: "Stored model item reloaded and permissions rechecked." });
    },
    onError: (caught) => setNotice({ severity: "error", message: errorMessage(caught) }),
  });

  const refreshBranchAccessManifestMutation = useMutation({
    mutationFn: () => {
      if (!selectedProjectId || !selectedBranchId) {
        throw new Error("Select a project branch before refreshing access.");
      }
      return api.refreshBranchAccessManifest(selectedProjectId, selectedBranchId, csrfToken);
    },
    onSuccess: async (status) => {
      queryClient.setQueryData(["workspace-access-map", ...sessionCacheKey, selectedProjectId, selectedBranchId], status);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["workspace-projects", ...sessionCacheKey] }),
        queryClient.invalidateQueries({ queryKey: ["workspace-branches", ...sessionCacheKey, selectedProjectId, selectedProject?.workspace_id] }),
        queryClient.invalidateQueries({ queryKey: ["workspace-tree", ...sessionCacheKey, selectedProjectId, selectedBranchId] }),
        selectedItemId
          ? queryClient.invalidateQueries({
              queryKey: ["workspace-item", ...sessionCacheKey, selectedItemId, selectedProjectId, selectedBranchId],
            })
          : Promise.resolve(),
      ]);
      setNotice({ severity: "success", message: "Shared access map refreshed from Teamwork Cloud." });
    },
    onError: (caught) => setNotice({ severity: "error", message: errorMessage(caught) }),
  });

  const saveItemMutation = useMutation({
    mutationFn: () => {
      if (!selectedItemId || !itemDraft) {
        throw new Error("Select an item before saving.");
      }
      return api.updateItem(
        selectedItemId,
        {
          name: itemDraft.name,
          description: itemDraft.description,
        },
        csrfToken,
        selectedProjectId || undefined,
        selectedBranchId || undefined,
      );
    },
    onSuccess: async (savedItem) => {
      setItemDraft(savedItem);
      await queryClient.invalidateQueries({ queryKey: ["workspace-item", ...sessionCacheKey] });
      await queryClient.invalidateQueries({ queryKey: ["workspace-tree", ...sessionCacheKey] });
      setNotice({ severity: "success", message: "Item saved to Teamwork Cloud." });
    },
    onError: (caught) => setNotice({ severity: "error", message: errorMessage(caught) }),
  });

  const compareMutation = useMutation({
    mutationFn: () =>
      api.compare(
        compareLeft.trim(),
        compareRight.trim(),
        selectedProjectId || undefined,
        selectedBranchId || undefined,
        selectedProjectId || undefined,
        selectedBranchId || undefined,
      ),
    onError: (caught) => setNotice({ severity: "error", message: errorMessage(caught) }),
  });

  const apiOperationMutation = useMutation({
    mutationFn: () => {
      if (!selectedOperation) {
        throw new Error("Select a Swagger operation first.");
      }
      const pathParams = collectParameterValues(selectedOperation.path_parameters, apiPathParams);
      const queryParams = collectParameterValues(selectedOperation.query_parameters, apiQueryParams);
      if (selectedOperation.supports_file_upload) {
        if (!apiUploadFile) {
          throw new Error("Select a file before running this upload operation.");
        }
        return api.executeContractUpload(selectedOperation.key, pathParams, queryParams, apiUploadFile, csrfToken);
      }
      let body: unknown = undefined;
      const bodyText = apiBodyText.trim();
      if (selectedOperation.request_body && bodyText) {
        body = apiContentType === "text/plain" ? apiBodyText : JSON.parse(bodyText);
      }
      return api.executeContractOperation(
        {
          operation_key: selectedOperation.key,
          path_params: pathParams,
          query_params: queryParams,
          body,
          content_type: selectedOperation.request_body ? apiContentType || selectedOperation.request_body.content_types[0] : null,
          timeout_seconds: 30,
        },
        csrfToken,
      );
    },
    onError: (caught) => setNotice({ severity: "error", message: errorMessage(caught) }),
  });

  const oslcRequestMutation = useMutation({
    mutationFn: () =>
      api.executeOslcRequest(
        {
          path_or_url: oslcPath.trim(),
          accept: oslcAccept || null,
          timeout_seconds: 30,
        },
        csrfToken,
      ),
    onError: (caught) => setNotice({ severity: "error", message: errorMessage(caught) }),
  });

  const rotateCacheIngestTokenMutation = useMutation({
    mutationFn: () => api.rotateCacheIngestToken(csrfToken),
    onSuccess: async (result) => {
      setRevealedCacheIngestToken(result.token);
      setManualCacheIngestToken(result.token);
      await queryClient.invalidateQueries({ queryKey: ["workspace-cache-ingest-token", ...sessionCacheKey] });
      setNotice({ severity: "success", message: "A new plugin ingest token was generated and stored inside Workbench." });
    },
    onError: (caught) => setNotice({ severity: "error", message: errorMessage(caught) }),
  });

  const storeCacheIngestTokenMutation = useMutation({
    mutationFn: () =>
      api.updateCacheIngestToken(
        {
          token: manualCacheIngestToken.trim(),
        },
        csrfToken,
      ),
    onSuccess: async () => {
      setRevealedCacheIngestToken("");
      await queryClient.invalidateQueries({ queryKey: ["workspace-cache-ingest-token", ...sessionCacheKey] });
      setNotice({ severity: "success", message: "The exact plugin ingest token was saved in encrypted Workbench app storage." });
    },
    onError: (caught) => setNotice({ severity: "error", message: errorMessage(caught) }),
  });

  const clearCacheIngestTokenMutation = useMutation({
    mutationFn: () => api.clearCacheIngestToken(csrfToken),
    onSuccess: async () => {
      setRevealedCacheIngestToken("");
      setManualCacheIngestToken("");
      await queryClient.invalidateQueries({ queryKey: ["workspace-cache-ingest-token", ...sessionCacheKey] });
      setNotice({ severity: "success", message: "The app-managed plugin ingest token was cleared." });
    },
    onError: (caught) => setNotice({ severity: "error", message: errorMessage(caught) }),
  });

  const createCacheApiKeyMutation = useMutation({
    mutationFn: () =>
      api.createCacheApiKey(
        {
          label: newCacheApiKeyLabel.trim(),
          scopes: newCacheApiKeyScopes,
        },
        csrfToken,
      ),
    onSuccess: async (result) => {
      setRevealedCacheApiKey(result.token);
      setNewCacheApiKeyLabel("");
      setNewCacheApiKeyScopes(["read"]);
      await queryClient.invalidateQueries({ queryKey: ["workspace-cache-api-keys", ...sessionCacheKey] });
      setNotice({
        severity: "success",
        message: "API key created. Copy it now; Workbench will not show the full value again after you leave this screen.",
      });
    },
    onError: (caught) => setNotice({ severity: "error", message: errorMessage(caught) }),
  });

  const deleteCacheApiKeyMutation = useMutation({
    mutationFn: (keyId: string) => api.deleteCacheApiKey(keyId, csrfToken),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["workspace-cache-api-keys", ...sessionCacheKey] });
      setNotice({ severity: "success", message: "API key deleted." });
    },
    onError: (caught) => setNotice({ severity: "error", message: errorMessage(caught) }),
  });

  const saveWorkbenchAgentConfigMutation = useMutation({
    mutationFn: () =>
      api.updateWorkbenchAgentConfig(
        {
          base_url: agentBaseUrlDraft.trim(),
          api_key: agentApiKeyDraft,
          model_id: agentSelectedModelId,
          model_name: agentSelectedModelName,
        },
        csrfToken,
      ),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["workspace-agent", ...sessionCacheKey] }),
        queryClient.invalidateQueries({ queryKey: ["workspace-agent-models", ...sessionCacheKey] }),
      ]);
      setNotice({
        severity: "success",
        message: agentSelectedModelId
          ? "Workbench Agent mapping saved in encrypted Workbench storage."
          : "Open WebUI connection saved. Load models next and map one into Workbench Agent.",
      });
    },
    onError: (caught) => setNotice({ severity: "error", message: errorMessage(caught) }),
  });

  const clearWorkbenchAgentConfigMutation = useMutation({
    mutationFn: () => api.clearWorkbenchAgentConfig(csrfToken),
    onSuccess: async () => {
      setAgentBaseUrlDraft("");
      setAgentApiKeyDraft("");
      setAgentSelectedModelId("");
      setAgentSelectedModelName("");
      setAgentMessages([]);
      setAgentChatInput("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["workspace-agent", ...sessionCacheKey] }),
        queryClient.invalidateQueries({ queryKey: ["workspace-agent-models", ...sessionCacheKey] }),
      ]);
      setNotice({ severity: "success", message: "Workbench Agent mapping cleared for this user." });
    },
    onError: (caught) => setNotice({ severity: "error", message: errorMessage(caught) }),
  });

  const syncWorkbenchAgentKnowledgeMutation = useMutation({
    mutationFn: () => {
      if (!selectedProjectId || !selectedBranchId) {
        throw new Error("Select a project and branch before syncing Workbench Agent knowledge.");
      }
      return api.syncWorkbenchAgentKnowledge(
        {
          project_id: selectedProjectId,
          branch_id: selectedBranchId,
        },
        csrfToken,
      );
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["workspace-agent", ...sessionCacheKey] });
      setNotice({ severity: "success", message: result.message });
    },
    onError: (caught) => setNotice({ severity: "error", message: errorMessage(caught) }),
  });

  const workbenchAgentChatMutation = useMutation({
    mutationFn: (payload: { messages: WorkbenchAgentChatMessage[]; syncKnowledge: boolean }) => {
      if (!selectedProjectId || !selectedBranchId) {
        throw new Error("Select a project and branch before starting a Workbench Agent conversation.");
      }
      return api.runWorkbenchAgentChat(
        {
          project_id: selectedProjectId,
          branch_id: selectedBranchId,
          messages: payload.messages,
          sync_knowledge: payload.syncKnowledge,
        },
        csrfToken,
      );
    },
    onSuccess: async (result, variables) => {
      setAgentMessages([
        ...variables.messages,
        {
          role: "assistant",
          content: result.assistant_message,
        },
      ]);
      await queryClient.invalidateQueries({ queryKey: ["workspace-agent", ...sessionCacheKey] });
      setNotice({ severity: "success", message: result.message });
    },
    onError: (caught) => setNotice({ severity: "error", message: errorMessage(caught) }),
  });

  const disconnectOslcMutation = useMutation({
    mutationFn: () => api.disconnectOslc(csrfToken),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["workspace-oslc-status", ...sessionCacheKey] });
      setNotice({ severity: "success", message: "OSLC connection was cleared for this app session." });
    },
    onError: (caught) => setNotice({ severity: "error", message: errorMessage(caught) }),
  });

  const generateOslcConsumerMutation = useMutation({
    mutationFn: () =>
      api.generateOslcConsumer(
        {
          name: oslcConsumerName.trim(),
          secret: oslcConsumerSecret,
          remember_for_session: false,
        },
        csrfToken,
      ),
    onSuccess: async (result) => {
      setOslcManualKey(result.consumer_key);
      setOslcManualSecret(oslcConsumerSecret);
      setNotice({ severity: "success", message: `${result.message} Save the generated key as the shared consumer when you're ready.` });
    },
    onError: (caught) => setNotice({ severity: "error", message: errorMessage(caught) }),
  });

  const storeOslcConsumerMutation = useMutation({
    mutationFn: () =>
      api.updateSharedOslcConsumer(
        {
          consumer_key: oslcManualKey.trim(),
          consumer_secret: oslcManualSecret,
        },
        csrfToken,
      ),
    onSuccess: async () => {
      setOslcConsumerSecret("");
      setOslcManualSecret("");
      await queryClient.invalidateQueries({ queryKey: ["workspace-oslc-status", ...sessionCacheKey] });
      await queryClient.invalidateQueries({ queryKey: ["workspace-oslc-shared-consumer", ...sessionCacheKey] });
      setNotice({ severity: "success", message: "Shared OSLC consumer credentials were saved for this Teamwork Cloud server." });
    },
    onError: (caught) => setNotice({ severity: "error", message: errorMessage(caught) }),
  });

  const clearOslcConsumerMutation = useMutation({
    mutationFn: () => api.clearSharedOslcConsumer(csrfToken),
    onSuccess: async () => {
      setOslcManualKey("");
      setOslcManualSecret("");
      await queryClient.invalidateQueries({ queryKey: ["workspace-oslc-status", ...sessionCacheKey] });
      await queryClient.invalidateQueries({ queryKey: ["workspace-oslc-shared-consumer", ...sessionCacheKey] });
      setNotice({ severity: "success", message: "Shared OSLC consumer credentials were cleared for this server." });
    },
    onError: (caught) => setNotice({ severity: "error", message: errorMessage(caught) }),
  });

  const handleTabChange = (_event: SyntheticEvent, nextTab: WorkspaceTab) => {
    setTab(nextTab);
  };

  const openWorkspaceMenu = (group: WorkspaceMenuGroup) => (event: ReactMouseEvent<HTMLElement>) => {
    setWorkspaceMenuGroup(group);
    setWorkspaceMenuAnchorEl(event.currentTarget);
  };

  const closeWorkspaceMenu = () => {
    setWorkspaceMenuGroup(null);
    setWorkspaceMenuAnchorEl(null);
  };

  const currentMenuGroup = (() => {
    if (tab === "developer" || tab === "api") {
      return "api" as const;
    }
    if (tab === "diagram-viewer") {
      return "diagrams" as const;
    }
    return "views" as const;
  })();

  const selectProject = (projectId: string) => {
    setSelectedProjectId(projectId);
    setSelectedBranchId("");
    setSelectedItemId("");
    setItemDraft(null);
  };

  const openProjectInModelBrowser = (projectId: string) => {
    selectProject(projectId);
    setTab("models");
  };

  const selectContainmentNode = (node: TreeNode, preferredTab: WorkspaceTab = "models") => {
    setSelectedItemId(node.id);
    if (tab !== preferredTab) {
      setTab(preferredTab);
    }
  };

  const openNode = (node: TreeNode) => {
    setSelectedItemId(node.id);
    setTab("models");
  };

  const openElementId = (itemId: string) => {
    setSelectedItemId(itemId);
    setTab("models");
  };

  const revealSelectedInTree = () => {
    if (!selectedItemId) {
      return;
    }
    setTab("models");
  };

  const openDiagramViewer = () => {
    if (!selectedWorkspaceItemDiagramPreviewUrl) {
      return;
    }
    setTab("diagram-viewer");
  };

  const openDiagramDetails = () => {
    if (!selectedWorkspaceItemIsDiagram) {
      return;
    }
    setSelectedSpecificationSection("properties");
    setTab("models");
  };

  const beginHorizontalResize = (
    event: ReactMouseEvent,
    startWidth: number,
    setWidth: (next: number) => void,
    minimum: number,
    maximum: number,
    direction: "grow-right" | "grow-left" = "grow-right",
  ) => {
    event.preventDefault();
    const originX = event.clientX;
    const handleMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - originX;
      const nextWidth =
        direction === "grow-left"
          ? clampNumber(startWidth - delta, minimum, maximum)
          : clampNumber(startWidth + delta, minimum, maximum);
      setWidth(nextWidth);
    };
    const handleUp = () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
  };

  const loadTreeChildren = async (node: TreeNode) => {
    if (!selectedProjectId || !selectedBranchId) {
      return;
    }
    if (loadingTreeNodeIds.includes(node.id)) {
      return;
    }
    const modelId = typeof node.metadata.model_id === "string" ? node.metadata.model_id : undefined;
    setLoadingTreeNodeIds((current) => [...current, node.id]);
    try {
      const children = await api.getTreeChildren(
        selectedProjectId,
        selectedBranchId,
        node.id,
        modelId,
        selectedProject?.workspace_id || undefined,
      );
      setTreeNodes((current) => replaceNodeChildren(current, node.id, children));
    } catch (caught) {
      setNotice({ severity: "error", message: errorMessage(caught) });
    } finally {
      setLoadingTreeNodeIds((current) => current.filter((value) => value !== node.id));
    }
  };

  const sendWorkbenchAgentPrompt = () => {
    const prompt = agentChatInput.trim();
    if (!prompt) {
      return;
    }
    const nextMessages: WorkbenchAgentChatMessage[] = [
      ...agentMessages,
      {
        role: "user",
        content: prompt,
      },
    ];
    setAgentMessages(nextMessages);
    setAgentChatInput("");
    workbenchAgentChatMutation.mutate({
      messages: nextMessages,
      syncKnowledge: agentSyncKnowledgeBeforeChat,
    });
  };

  const renderSpecificationTable = (rows: InspectorRow[], emptyText: string) =>
    rows.length ? (
      <Paper variant="outlined" sx={{ borderRadius: 2, overflow: "hidden" }}>
        {rows.map((row, index) => (
          <Box
            key={row.key}
            sx={{
              display: "grid",
              gridTemplateColumns: {
                xs: "1fr",
                sm: compactUi ? "180px minmax(0, 1fr)" : "220px minmax(0, 1fr)",
              },
              gap: 1.5,
              px: compactUi ? 1.5 : 2,
              py: compactUi ? 1 : 1.25,
              borderTop: index ? "1px solid" : "none",
              borderColor: "divider",
              alignItems: "start",
            }}
          >
            <Typography variant="body2" fontWeight={600} color="text.secondary">
              {row.label}
            </Typography>
            <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
              {row.value || "Not provided"}
            </Typography>
          </Box>
        ))}
      </Paper>
    ) : (
      <Typography color="text.secondary">{emptyText}</Typography>
    );

  const renderReferenceList = (
    references: ItemReference[],
    emptyText: string,
    options?: {
      inlineTypeOnly?: boolean;
    },
  ) =>
    references.length ? (
      <List dense disablePadding sx={{ maxHeight: 320, overflow: "auto" }}>
        {references.map((reference) => (
          <ListItemButton key={`${reference.relationship_type}-${reference.id}`} dense onClick={() => openElementId(reference.id)}>
            <ListItemText
              primary={
                options?.inlineTypeOnly
                  ? `${itemReferenceDisplayName(reference, referenceNameById)} · ${itemReferenceTypeLabel(reference)}`
                  : itemReferenceDisplayName(reference, referenceNameById)
              }
              secondary={
                options?.inlineTypeOnly
                  ? undefined
                  : `${humanizeFieldLabel(reference.relationship_type)}${itemReferenceSecondaryText(reference, referenceNameById) ? ` · ${itemReferenceSecondaryText(reference, referenceNameById)}` : ""}`
              }
            />
          </ListItemButton>
        ))}
      </List>
    ) : (
      <Typography color="text.secondary">{emptyText}</Typography>
    );

  const renderReferenceTable = (
    references: ItemReference[],
    emptyText: string,
    options?: {
      secondaryColumnLabel?: string;
      secondaryColumn?: (reference: ItemReference) => string;
    },
  ) =>
    references.length ? (
      <Paper variant="outlined" sx={{ borderRadius: 2, overflow: "hidden" }}>
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: {
              xs: "minmax(0, 1fr)",
              sm: compactUi ? "minmax(0, 1.2fr) minmax(160px, 0.8fr)" : "minmax(0, 1.3fr) minmax(180px, 0.7fr)",
            },
            gap: 1.5,
            px: compactUi ? 1.5 : 2,
            py: compactUi ? 1 : 1.25,
            bgcolor: "action.hover",
          }}
        >
          <Typography variant="body2" fontWeight={600} color="text.secondary">
            Name
          </Typography>
          <Typography variant="body2" fontWeight={600} color="text.secondary">
            {options?.secondaryColumnLabel ?? "Type"}
          </Typography>
        </Box>
        {references.map((reference, index) => (
          <Box
            key={`${reference.relationship_type}:${reference.id}`}
            sx={{
              display: "grid",
              gridTemplateColumns: {
                xs: "minmax(0, 1fr)",
                sm: compactUi ? "minmax(0, 1.2fr) minmax(160px, 0.8fr)" : "minmax(0, 1.3fr) minmax(180px, 0.7fr)",
              },
              gap: 1.5,
              px: compactUi ? 1.5 : 2,
              py: compactUi ? 1 : 1.25,
              borderTop: "1px solid",
              borderColor: "divider",
              alignItems: "start",
            }}
          >
            <Button
              variant="text"
              sx={{ justifyContent: "flex-start", px: 0, minWidth: 0, textTransform: "none", fontWeight: 500 }}
              onClick={() => openElementId(reference.id)}
            >
              {itemReferenceDisplayName(reference, referenceNameById)}
            </Button>
            <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
              {(options?.secondaryColumn?.(reference) ?? itemReferenceTypeLabel(reference)) || "Not provided"}
            </Typography>
          </Box>
        ))}
      </Paper>
    ) : (
      <Typography color="text.secondary">{emptyText}</Typography>
    );

  const renderDataTable = (
    headers: string[],
    rows: DataTableRow[],
    emptyText: string,
    options?: {
      columnTemplate?: { xs: string; sm: string };
    },
  ) =>
    rows.length ? (
      <Paper variant="outlined" sx={{ borderRadius: 2, overflow: "hidden" }}>
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: {
              xs: options?.columnTemplate?.xs ?? "minmax(0, 1fr)",
              sm: options?.columnTemplate?.sm ?? `repeat(${headers.length}, minmax(0, 1fr))`,
            },
            gap: 1.5,
            px: compactUi ? 1.5 : 2,
            py: compactUi ? 1 : 1.25,
            bgcolor: "action.hover",
          }}
        >
          {headers.map((header) => (
            <Typography key={header} variant="body2" fontWeight={600} color="text.secondary">
              {header}
            </Typography>
          ))}
        </Box>
        {rows.map((row) => (
          <Box
            key={row.key}
            sx={{
              display: "grid",
              gridTemplateColumns: {
                xs: options?.columnTemplate?.xs ?? "minmax(0, 1fr)",
                sm: options?.columnTemplate?.sm ?? `repeat(${headers.length}, minmax(0, 1fr))`,
              },
              gap: 1.5,
              px: compactUi ? 1.5 : 2,
              py: compactUi ? 1 : 1.25,
              borderTop: "1px solid",
              borderColor: "divider",
              alignItems: "start",
            }}
          >
            {row.cells.map((cell, index) => (
              <Typography key={`${row.key}-${index}`} variant="body2" sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                {cell || "Not provided"}
              </Typography>
            ))}
          </Box>
        ))}
      </Paper>
    ) : (
      <Typography color="text.secondary">{emptyText}</Typography>
    );

  const renderTextBlocks = (blocks: string[], emptyText: string) =>
    blocks.length ? (
      <Paper variant="outlined" sx={{ borderRadius: 2, overflow: "hidden" }}>
        {blocks.map((block, index) => (
          <Box
            key={`${index}-${block.slice(0, 32)}`}
            sx={{
              px: compactUi ? 1.5 : 2,
              py: compactUi ? 1 : 1.25,
              borderTop: index ? "1px solid" : "none",
              borderColor: "divider",
            }}
          >
            <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
              {block}
            </Typography>
          </Box>
        ))}
      </Paper>
    ) : (
      <Typography color="text.secondary">{emptyText}</Typography>
    );

  const renderSpecificationWorkspace = (
    item: ItemDetails,
    options: {
      mode: "browser" | "details";
      editable: boolean;
      extraHeader?: ReactNode;
    },
  ) => {
    const sourcePayload = item.source_payload ?? {};
    const propertiesRows = specificationWindowRows(item, referenceNameById, itemDetailViewMode);
    const documentationSections = extractDocumentationSections(item);
    const structuredNavigationRows = payloadSpecSectionEntries(item, "navigation").map((entry, index) => ({
      key: `navigation-${index}`,
      cells: [
        structuredEntryName(entry),
        structuredEntryValue(entry, ["type"], referenceNameById),
        structuredEntryValue(entry, ["value", "target"], referenceNameById),
      ],
    }));
    const structuredUsageRows = payloadSpecSectionEntries(item, "usage-diagrams").map((entry, index) => ({
      key: `usage-${index}`,
      cells: [
        structuredEntryValue(entry, ["value", "target"], referenceNameById) || structuredEntryName(entry),
        structuredEntryValue(entry, ["type"], referenceNameById) || "Diagram",
      ],
    }));
    const structuredInnerElementRows = payloadSpecSectionEntries(item, "inner-elements").map((entry, index) => ({
      key: `inner-${index}`,
      cells: [
        structuredEntryValue(entry, ["value", "target"], referenceNameById) || structuredEntryName(entry),
        structuredEntryValue(entry, ["type"], referenceNameById) || "Owned Element",
      ],
    }));
    const structuredRelationRows = payloadSpecSectionEntries(item, "relations").map((entry, index) => ({
      key: `relation-${index}`,
      cells: [
        structuredEntryName(entry),
        structuredEntryValue(entry, ["element"], referenceNameById),
        structuredEntryValue(entry, ["direction"], referenceNameById),
        structuredEntryValue(entry, ["relatedElement", "value", "target"], referenceNameById),
      ],
    }));
    const structuredTagRows = payloadSpecSectionEntries(item, "tags").map((entry, index) => ({
      key: `tag-${index}`,
      cells: [structuredEntryName(entry), structuredEntryValue(entry, ["value"], referenceNameById)],
    }));
    const structuredConstraintRows = payloadSpecSectionEntries(item, "constraints").map((entry, index) => ({
      key: `constraint-${index}`,
      cells: [structuredEntryName(entry), structuredEntryValue(entry, ["specification", "value"], referenceNameById)],
    }));
    const structuredTraceabilityRows = payloadSpecSectionEntries(item, "traceability").map((entry, index) => ({
      key: `trace-${index}`,
      cells: [structuredEntryName(entry), structuredEntryValue(entry, ["value", "target"], referenceNameById)],
    }));
    const structuredAllocationRows = payloadSpecSectionEntries(item, "allocations").map((entry, index) => ({
      key: `allocation-${index}`,
      cells: [structuredEntryName(entry), structuredEntryValue(entry, ["value", "target"], referenceNameById)],
    }));
    const navigationRows = collectHintRows(item, referenceNameById, NAVIGATION_FIELD_HINTS, {
      includeMetadata: true,
      inlineOnly: false,
    });
    const diagramUsageReferences = collectReferenceMatches(item, ["diagram", "symbol", "usage"]);
    const navigationTableRows = hintRowsToTableRows(navigationRows);
    const relationRows = relationshipTableRows(item, referenceNameById);
    const tagRows = dedupeInspectorRows([
      ...(item.stereotypes.length
        ? [
            {
              key: "stereotypes",
              label: "Applied Stereotypes",
              value: item.stereotypes.join(", "),
            },
          ]
        : []),
      ...collectHintRows(item, referenceNameById, TAG_FIELD_HINTS, {
        includeMetadata: true,
        inlineOnly: false,
      }),
      ...mapInlineInspectorRows(item.metadata ?? {}, referenceNameById).filter((row) => keyMatchesHints(row.key, TAG_FIELD_HINTS)),
    ]);
    const tagTableRows = hintRowsToTableRows(tagRows);
    const constraintSectionRows = constraintRows(item, referenceNameById);
    const constraintLinkedItems = constraintReferenceItems(item);
    const constraintTableRows = hintRowsToTableRows(constraintSectionRows);
    const traceabilityRows = collectHintRows(item, referenceNameById, TRACEABILITY_FIELD_HINTS, {
      includeMetadata: true,
      inlineOnly: false,
    });
    const traceabilityReferences = collectReferenceMatches(item, TRACEABILITY_FIELD_HINTS);
    const traceabilityTableRows = [
      ...hintRowsToTableRows(traceabilityRows),
      ...referenceRowsToTableRows(traceabilityReferences, referenceNameById),
    ];
    const allocationRows = collectHintRows(item, referenceNameById, ALLOCATION_FIELD_HINTS, {
      includeMetadata: true,
      inlineOnly: false,
    });
    const allocationReferences = collectReferenceMatches(item, ALLOCATION_FIELD_HINTS);
    const allocationTableRows = [
      ...hintRowsToTableRows(allocationRows),
      ...referenceRowsToTableRows(allocationReferences, referenceNameById),
    ];
    const selectedSectionTitle =
      selectedSpecificationSection === "properties"
        ? displayEntityName(item.name, item.id, item.item_type, referenceNameById, item.path)
        : SPECIFICATION_SECTION_LABELS[selectedSpecificationSection];

    const renderSelectedSectionContent = () => {
      switch (selectedSpecificationSection) {
        case "properties":
          return (
            <Stack spacing={2}>
              {options.editable ? (
                <Paper variant="outlined" sx={{ p: compactUi ? 1.5 : 2, borderRadius: 2 }}>
                  <Stack spacing={1.5}>
                    <Typography variant="subtitle2">Editable Fields</Typography>
                    <TextField label="Path" value={friendlyPath(item.path, referenceNameById)} disabled fullWidth />
                    <TextField
                      label="Name"
                      value={item.name}
                      disabled={!options.editable}
                      onChange={(event) => setItemDraft((current) => (current ? { ...current, name: event.target.value } : current))}
                      fullWidth
                    />
                    <TextField
                      label="Description"
                      value={item.description}
                      disabled={!options.editable}
                      onChange={(event) => setItemDraft((current) => (current ? { ...current, description: event.target.value } : current))}
                      fullWidth
                      multiline
                      minRows={3}
                    />
                  </Stack>
                </Paper>
              ) : null}
              {renderSpecificationTable(propertiesRows, "No published properties were returned for this item.")}
            </Stack>
          );
        case "documentation": {
          const hasDocumentation = documentationSections.documentation.length > 0;
          const hasComments = documentationSections.comments.length > 0;
          return (
            <Stack spacing={2}>
              <Paper variant="outlined" sx={{ p: compactUi ? 1.5 : 2, borderRadius: 2 }}>
                <Stack spacing={1}>
                  <Typography variant="subtitle2">Documentation</Typography>
                  {renderTextBlocks(documentationSections.documentation, "No documentation was published for this item.")}
                </Stack>
              </Paper>
              <Paper variant="outlined" sx={{ p: compactUi ? 1.5 : 2, borderRadius: 2 }}>
                <Stack spacing={1}>
                  <Typography variant="subtitle2">Comments</Typography>
                  {renderTextBlocks(documentationSections.comments, hasDocumentation ? "No comments were published for this item." : "No documentation or comments were published for this item.")}
                </Stack>
              </Paper>
            </Stack>
          );
        }
        case "navigation":
          return renderDataTable(
            structuredNavigationRows.length ? ["Name", "Type", "Value"] : ["Name", "Value"],
            structuredNavigationRows.length ? structuredNavigationRows : navigationTableRows,
            "No navigation targets or hyperlinks were published for this item.",
            structuredNavigationRows.length
              ? {
                  columnTemplate: {
                    xs: "minmax(0, 1fr)",
                    sm: "minmax(180px, 0.75fr) minmax(160px, 0.55fr) minmax(0, 1.2fr)",
                  },
                }
              : {
                  columnTemplate: {
                    xs: "minmax(0, 1fr)",
                    sm: "minmax(180px, 0.85fr) minmax(0, 1.15fr)",
                  },
                },
          );
        case "usage-diagrams":
          return structuredUsageRows.length
            ? renderDataTable(["Name", "Type"], structuredUsageRows, "No diagram usage references were published for this item.", {
                columnTemplate: {
                  xs: "minmax(0, 1fr)",
                  sm: "minmax(0, 1.2fr) minmax(160px, 0.8fr)",
                },
              })
            : renderReferenceTable(diagramUsageReferences, "No diagram usage references were published for this item.");
        case "inner-elements":
          return structuredInnerElementRows.length
            ? renderDataTable(["Name", "Type"], structuredInnerElementRows, "No contained elements were published for this item.", {
                columnTemplate: {
                  xs: "minmax(0, 1fr)",
                  sm: "minmax(0, 1.2fr) minmax(160px, 0.8fr)",
                },
              })
            : renderReferenceTable(item.contained_elements, "No contained elements were published for this item.");
        case "relations":
          return renderDataTable(["Name", "Element", "Direction", "Related Element"], structuredRelationRows.length ? structuredRelationRows : relationRows, "No relationships were published for this item.", {
            columnTemplate: {
              xs: "minmax(0, 1fr)",
              sm: "minmax(150px, 0.9fr) minmax(180px, 1fr) minmax(120px, 0.6fr) minmax(180px, 1fr)",
            },
          });
        case "tags":
          return renderDataTable(["Tag", "Value"], structuredTagRows.length ? structuredTagRows : tagTableRows, "No tags or stereotypes were published for this item.", {
            columnTemplate: {
              xs: "minmax(0, 1fr)",
              sm: "minmax(180px, 0.8fr) minmax(0, 1.2fr)",
            },
          });
        case "constraints":
          return (
            <Stack spacing={2}>
              {renderDataTable(["Name", "Specification"], structuredConstraintRows.length ? structuredConstraintRows : constraintTableRows, "No constraints were published for this item.", {
                columnTemplate: {
                  xs: "minmax(0, 1fr)",
                  sm: "minmax(180px, 0.8fr) minmax(0, 1.2fr)",
                },
              })}
              {constraintLinkedItems.length ? renderReferenceTable(constraintLinkedItems, "No constraint-linked elements were published for this item.") : null}
            </Stack>
          );
        case "traceability":
          return renderDataTable(["Name", "Value"], structuredTraceabilityRows.length ? structuredTraceabilityRows : traceabilityTableRows, "No traceability properties were published for this item.", {
            columnTemplate: {
              xs: "minmax(0, 1fr)",
              sm: "minmax(180px, 0.8fr) minmax(0, 1.2fr)",
            },
          });
        case "allocations":
          return renderDataTable(["Name", "Value"], structuredAllocationRows.length ? structuredAllocationRows : allocationTableRows, "No allocation properties were published for this item.", {
            columnTemplate: {
              xs: "minmax(0, 1fr)",
              sm: "minmax(180px, 0.8fr) minmax(0, 1.2fr)",
            },
          });
        default:
          return null;
      }
    };

    return (
      <Stack spacing={2}>
        <Stack direction={{ xs: "column", lg: "row" }} spacing={1.5} justifyContent="space-between" alignItems={{ xs: "stretch", lg: "center" }}>
          <Stack spacing={0.75}>
            <Typography variant="h6">{displayEntityName(item.name, item.id, item.item_type, referenceNameById, item.path)}</Typography>
            <Typography variant="body2" color="text.secondary">
              {friendlyPath(item.path, referenceNameById) || `${selectedProject?.name ?? "Project"} / ${branchLabel(selectedProjectBranches, selectedBranchId)}`}
            </Typography>
            <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
              <Chip label={humanizeFieldLabel(item.item_type)} />
              <Chip label={`Version ${item.version}`} variant="outlined" />
              {selectedProject ? <Chip label={`Project ${selectedProject.name}`} variant="outlined" /> : null}
              <Chip label={`Branch ${branchLabel(selectedProjectBranches, selectedBranchId)}`} variant="outlined" />
              {sourcePayload.metaclass ? <Chip label={humanizeFieldLabel(String(sourcePayload.metaclass))} variant="outlined" size="small" /> : null}
            </Stack>
          </Stack>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ xs: "stretch", sm: "center" }}>
            <ToggleButtonGroup size="small" exclusive value={itemDetailViewMode} onChange={handleItemDetailViewModeChange} aria-label="Item detail view mode">
              {ITEM_DETAIL_VIEW_MODES.map((mode) => (
                <ToggleButton key={mode} value={mode}>
                  {ITEM_DETAIL_VIEW_LABELS[mode]}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
            {options.extraHeader}
          </Stack>
        </Stack>
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: {
              xs: "1fr",
              lg: compactUi ? "260px minmax(0, 1fr)" : "300px minmax(0, 1fr)",
            },
            gap: 2,
            alignItems: "start",
          }}
        >
          <Paper sx={{ p: compactUi ? 1 : 1.5, borderRadius: 2 }}>
            <Typography variant="overline" color="text.secondary">
              Specification Sections
            </Typography>
            <List dense disablePadding>
              <ListItemButton selected={selectedSpecificationSection === "properties"} onClick={() => setSelectedSpecificationSection("properties")}>
                <ListItemText
                  primary={displayEntityName(item.name, item.id, item.item_type, referenceNameById, item.path)}
                  secondary={humanizeFieldLabel(item.item_type)}
                />
              </ListItemButton>
              {SPECIFICATION_CHILD_SECTIONS.map((sectionId) => (
                <ListItemButton
                  key={sectionId}
                  selected={selectedSpecificationSection === sectionId}
                  onClick={() => setSelectedSpecificationSection(sectionId)}
                  sx={{ pl: 4 }}
                >
                  <ListItemText primary={SPECIFICATION_SECTION_LABELS[sectionId]} />
                </ListItemButton>
              ))}
            </List>
          </Paper>
          <Paper sx={{ p: panelPadding, borderRadius: 2, minWidth: 0 }}>
            <Stack spacing={sectionSpacing}>
              <Box>
                <Typography variant="h6">{selectedSectionTitle}</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  {specificationSectionIntro(selectedSpecificationSection, item)}
                </Typography>
              </Box>
              {renderSelectedSectionContent()}
            </Stack>
          </Paper>
        </Box>
      </Stack>
    );
  };

  const pickCompareSide = (side: "left" | "right", itemId: string) => {
    const readableLabel = humanReadableReference(itemId, referenceNameById);
    if (side === "left") {
      setCompareLeft(itemId);
      setCompareLeftDisplay(readableLabel);
    } else {
      setCompareRight(itemId);
      setCompareRightDisplay(readableLabel);
    }
    setTab("compare");
  };

  const renderParameterControls = (
    title: string,
    parameters: SwaggerParameterSpec[],
    values: Record<string, string>,
    onChange: (name: string, value: string) => void,
  ) => (
    <Stack spacing={1}>
      <Typography variant="subtitle2">{title}</Typography>
      {parameters.length ? (
        <Grid container spacing={1.5}>
          {parameters.map((parameter) => {
            const options = parameter.enum.length
              ? ["", ...parameter.enum.map((option) => String(option))]
              : parameter.schema_type === "boolean"
                ? ["", "true", "false"]
                : null;
            return (
              <Grid item xs={12} md={6} key={`${title}-${parameter.name}`}>
                <TextField
                  label={`${parameter.name}${parameter.required ? " *" : ""}`}
                  value={values[parameter.name] ?? ""}
                  onChange={(event) => onChange(parameter.name, event.target.value)}
                  helperText={parameter.description || parameter.schema_type}
                  fullWidth
                  select={Boolean(options)}
                >
                  {options?.map((option) => (
                    <MenuItem key={option || "blank"} value={option}>
                      {option || "Unset"}
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>
            );
          })}
        </Grid>
      ) : (
        <Typography variant="body2" color="text.secondary">
          No {title.toLowerCase()} declared.
        </Typography>
      )}
    </Stack>
  );

  const renderDashboard = () => (
    <Stack spacing={2}>
      <Grid container spacing={2}>
        <Grid item xs={12} md={4}>
          <Card sx={{ height: "100%", borderRadius: 2 }}>
            <CardContent>
              <Typography variant="overline" color="text.secondary">
                Repository
              </Typography>
              <Typography variant="h3">{projects.length}</Typography>
              <Typography color="text.secondary">RealSwagger resource entries available to this TWC user.</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} md={4}>
          <Card sx={{ height: "100%", borderRadius: 2 }}>
            <CardContent>
              <Typography variant="overline" color="text.secondary">
                Active Project Branches
              </Typography>
              <Typography variant="h3">{selectedProjectId ? selectedProjectBranches.length : 0}</Typography>
              <Typography color="text.secondary">Loaded only for the currently selected project.</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} md={4}>
          <Card sx={{ height: "100%", borderRadius: 2 }}>
            <CardContent>
              <Typography variant="overline" color="text.secondary">
                Model Items
              </Typography>
              <Typography variant="h3">{baseFlatNodes.length}</Typography>
              <Typography color="text.secondary">Loaded for the selected project and branch.</Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
      <Paper sx={{ p: 3, borderRadius: 2 }}>
        <Stack spacing={2}>
          <Typography variant="h5">Swagger Contract Boundary</Typography>
          <Typography color="text.secondary">
            This workspace exposes only Teamwork Cloud operations present in RealSwagger.json. The curated tabs cover the common repository and model flows{isAdmin ? "; API Explorer exposes the complete contract surface for advanced workflows." : "."}
          </Typography>
          <Typography color="text.secondary">
            Simulation, collaborator workspaces, global model search, publishing, export jobs, job center, saved searches, bookmarks, comments, documents, and collaborator-style attachments are not shown because this Swagger file does not define those APIs.{isAdmin ? " Swagger artifact upload and download operations are available in API Explorer." : ""}
          </Typography>
          {contractManifest ? (
            <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
              <Chip label={`${contractManifest.operations.length} operations`} />
              <Chip label={`${Object.keys(contractManifest.tag_counts).length} tags`} variant="outlined" />
              <Chip label={apiOperationStats || "No operation counts"} variant="outlined" />
              <Chip label={`${contractManifest.schemas.length} schemas`} variant="outlined" />
            </Stack>
          ) : null}
          {contractManifest?.warnings.map((warning) => (
            <Alert severity="warning" key={warning}>
              {warning}
            </Alert>
          ))}
          {session?.capabilities ? <CapabilityBadges capabilities={Object.values(session.capabilities.capabilities)} /> : null}
        </Stack>
      </Paper>
    </Stack>
  );

  const renderProjects = () => (
    <Stack spacing={2}>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} justifyContent="space-between" alignItems={{ xs: "stretch", sm: "center" }}>
        <Box>
          <Typography variant="h5">Project Browser</Typography>
          <Typography variant="body2" color="text.secondary">
            Browse the published content for the selected project and branch from the stored Workbench model snapshot.
          </Typography>
        </Box>
        <Button
          variant="outlined"
          startIcon={<RefreshRoundedIcon />}
          onClick={() => refreshSelectedProjectMutation.mutate()}
          disabled={!selectedProjectId || refreshSelectedProjectMutation.isPending}
        >
          Reload Stored Project
        </Button>
      </Stack>
      {!selectedProject ? (
        <Paper sx={{ p: 4, borderRadius: 2, textAlign: "center" }}>
          <Typography variant="h5">Select a project</Typography>
          <Typography color="text.secondary" sx={{ mt: 1 }}>
            Use the selector on the left to choose which published project snapshot you want to browse.
          </Typography>
        </Paper>
      ) : null}
      {selectedProject ? (
        <Paper sx={{ p: 3, borderRadius: 2 }}>
          <Stack spacing={1.5}>
            <Typography variant="h6">{selectedProject.name}</Typography>
            <Typography variant="body2" color="text.secondary">
              {selectedProject.description || "Browse the current branch snapshot as cards for quick scanning and jumping into details."}
            </Typography>
            <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
              <Chip label="Stored Workbench project" variant="outlined" />
              {selectedProject.workspace_id ? <Chip label="Workspace-scoped" variant="outlined" /> : null}
              <Chip
                label={
                  branchesQuery.isLoading
                    ? "Loading branches"
                    : selectedBranchId
                      ? `Branch ${branchLabel(selectedProjectBranches, selectedBranchId)}`
                      : "Default branch context"
                }
                color="primary"
              />
            </Stack>
          </Stack>
        </Paper>
      ) : null}
      {branchesQuery.isLoading && selectedProjectId ? <CircularProgress size={28} /> : null}
      {branchesQuery.error ? <Alert severity="error">{errorMessage(branchesQuery.error)}</Alert> : null}
      {treeQuery.isLoading ? <CircularProgress size={28} /> : null}
      {treeQuery.error ? <Alert severity="error">{errorMessage(treeQuery.error)}</Alert> : null}
      <Grid container spacing={2}>
        {baseFlatNodes.map((node) => (
          <Grid item xs={12} md={6} lg={4} key={node.id}>
            <Card sx={{ height: "100%", borderRadius: 2 }}>
              <CardContent>
                <Stack spacing={1.5}>
                  <Box>
                    <Typography variant="h6">{node.label}</Typography>
                    <Typography variant="body2" color="text.secondary">
                      {selectedProject ? `${selectedProject.name} / ${branchLabel(selectedProjectBranches, selectedBranchId)}` : node.node_type}
                    </Typography>
                    {node.path ? (
                      <Typography variant="caption" color="text.secondary">
                        {friendlyPath(node.path, referenceNameById)}
                      </Typography>
                    ) : null}
                  </Box>
                  <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                    <Chip label={humanizeFieldLabel(node.node_type)} size="small" />
                    {selectedProject ? <Chip label={`Project: ${selectedProject.name}`} size="small" variant="outlined" /> : null}
                    {selectedBranchId ? <Chip label={`Branch: ${branchLabel(selectedProjectBranches, selectedBranchId)}`} size="small" variant="outlined" /> : null}
                  </Stack>
                  <Stack direction="row" spacing={1}>
                    <Button size="small" variant="contained" onClick={() => openNode(node)}>
                      Details
                    </Button>
                    <Button size="small" onClick={() => pickCompareSide("left", node.id)}>
                      Compare Left
                    </Button>
                    <Button size="small" onClick={() => pickCompareSide("right", node.id)}>
                      Compare Right
                    </Button>
                  </Stack>
                </Stack>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>
      {!treeQuery.isLoading && selectedProjectId && !baseFlatNodes.length ? (
        <Paper sx={{ p: 4, borderRadius: 2, textAlign: "center" }}>
          <Typography color="text.secondary">No model entries were returned for the selected project and branch.</Typography>
        </Paper>
      ) : null}
    </Stack>
  );

  const renderModels = () => (
    <Stack spacing={2}>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} justifyContent="space-between" alignItems={{ xs: "stretch", sm: "center" }}>
        <Box>
          <Typography variant="h5">Model Browser</Typography>
          <Typography variant="body2" color="text.secondary">
            {selectedProject
              ? `${selectedProject.name} / ${branchLabel(selectedProjectBranches, selectedBranchId)}`
              : "Select a project to inspect its published branch tree and specification window."}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
          <Button
            variant="outlined"
            startIcon={<RefreshRoundedIcon />}
            onClick={() => refreshSelectedProjectMutation.mutate()}
            disabled={!selectedProjectId || refreshSelectedProjectMutation.isPending}
          >
            Reload Stored Project
          </Button>
          <Button
            variant="outlined"
            startIcon={<RefreshRoundedIcon />}
            onClick={() => refreshBranchAccessManifestMutation.mutate()}
            disabled={!csrfToken || !selectedProjectId || !selectedBranchId || refreshBranchAccessManifestMutation.isPending}
          >
            Refresh Access Map
          </Button>
        </Stack>
      </Stack>
      {!selectedProject ? (
        <Paper sx={{ p: 4, borderRadius: 2, textAlign: "center" }}>
          <Typography variant="h5">Select a project</Typography>
          <Typography color="text.secondary" sx={{ mt: 1 }}>
            Choose a published project snapshot from the selector on the left to inspect the full branch model tree.
          </Typography>
        </Paper>
      ) : null}
      {selectedProject && !selectedBranchId && !branchesQuery.isLoading ? (
        <Paper sx={{ p: 4, borderRadius: 2, textAlign: "center" }}>
          <Typography variant="h5">Select a branch</Typography>
          <Typography color="text.secondary" sx={{ mt: 1 }}>
            Model Browser follows one published branch snapshot at a time so we can keep the full containment tree and specification data coherent.
          </Typography>
        </Paper>
      ) : null}
      {branchesQuery.isLoading && selectedProjectId ? <CircularProgress size={28} /> : null}
      {branchesQuery.error ? <Alert severity="error">{errorMessage(branchesQuery.error)}</Alert> : null}
      {treeQuery.isLoading ? <CircularProgress size={28} /> : null}
      {treeQuery.error ? <Alert severity="error">{errorMessage(treeQuery.error)}</Alert> : null}
      {branchAccessManifestQuery.error ? <Alert severity="error">{errorMessage(branchAccessManifestQuery.error)}</Alert> : null}
      {branchAccessManifestStatus?.message ? (
        <Alert severity={branchAccessManifestStatus.accessible_user_count ? "info" : "warning"}>
          {branchAccessManifestStatus.message}
          {branchAccessManifestStatus.updated_at ? ` Last refreshed ${new Date(branchAccessManifestStatus.updated_at).toLocaleString()}.` : ""}
        </Alert>
      ) : null}
      {refreshBranchAccessManifestMutation.isPending ? (
        <Alert severity="info">Refreshing the shared access map from Teamwork Cloud permissions.</Alert>
      ) : null}
      {selectedProject && selectedBranchId ? (
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: {
              xs: "1fr",
              xl: `${modelContainmentPaneWidth}px 12px minmax(0, 1fr)`,
            },
            gap: 0,
            minWidth: 0,
            alignItems: "start",
          }}
        >
          <Paper
            sx={{
              p: compactUi ? 1.5 : 2,
              borderRadius: 2,
              minWidth: 0,
              display: "flex",
              flexDirection: "column",
              maxHeight: { xs: "none", xl: viewportPanelMaxHeight },
              overflow: "hidden",
            }}
          >
            <Stack spacing={sectionSpacing} sx={{ minHeight: 0, flex: 1 }}>
              <TextField label="Filter containment tree" value={treeFilter} onChange={(event) => setTreeFilter(event.target.value)} fullWidth />
              {branchAccessManifestStatus ? (
                <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                  <Chip label={`${branchAccessManifestStatus.accessible_user_count} viewers`} variant="outlined" />
                  <Chip label={`${branchAccessManifestStatus.editable_user_count} editors`} variant="outlined" />
                  <Chip label={`${branchAccessManifestStatus.admin_user_count} admins`} variant="outlined" />
                </Stack>
              ) : null}
              <Paper variant="outlined" sx={{ p: compactUi ? 1.25 : 1.5, borderRadius: 2 }}>
                <Stack spacing={0.5}>
                  <Typography variant="overline" color="text.secondary">
                    Containment Tree
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Browse the published branch containment just like Cameo, then inspect the selected node in the specification window on the right.
                  </Typography>
                </Stack>
              </Paper>
              <Box sx={{ minHeight: 0, flex: 1, overflow: "auto", pr: 0.5 }}>
                <ProjectTree
                  nodes={visibleTreeNodes}
                  selectedId={selectedItemId}
                  filter={treeFilter}
                  onSelect={(node) => selectContainmentNode(node, "models")}
                  onExpand={loadTreeChildren}
                  loadingIds={loadingTreeNodeIds}
                  expandedIds={expandedTreeNodeIds}
                  onExpandedChange={setExpandedTreeNodeIds}
                />
              </Box>
            </Stack>
          </Paper>
          <Box
            role="separator"
            aria-orientation="vertical"
            sx={resizeHandleStyles()}
            onMouseDown={(event) => beginHorizontalResize(event, modelContainmentPaneWidth, setModelContainmentPaneWidth, 260, 460)}
          />
          <Box sx={{ minWidth: 0, pl: { xs: 0, xl: compactUi ? 1.5 : 2 } }}>
            {selectedWorkspaceItem ? (
              <Paper sx={{ p: panelPadding, borderRadius: 2 }}>
                {renderSpecificationWorkspace(selectedWorkspaceItem, {
                  mode: "browser",
                  editable: Boolean(selectedWorkspaceItem.editable && canEdit),
                  extraHeader: (
                    <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                      {selectedWorkspaceItemDiagramPreviewUrl ? (
                        <Button size="small" variant="contained" onClick={openDiagramViewer}>
                          View Diagram
                        </Button>
                      ) : null}
                      <Button size="small" onClick={() => pickCompareSide("left", selectedWorkspaceItem.id)}>
                        Compare Left
                      </Button>
                      <Button size="small" onClick={() => pickCompareSide("right", selectedWorkspaceItem.id)}>
                        Compare Right
                      </Button>
                      <Button size="small" variant="outlined" onClick={revealSelectedInTree} disabled={!selectedItemId}>
                        Reveal In Tree
                      </Button>
                      <Button
                        size="small"
                        variant="contained"
                        startIcon={<SaveRoundedIcon />}
                        disabled={!selectedWorkspaceItem.editable || !canEdit || saveItemMutation.isPending}
                        onClick={() => saveItemMutation.mutate()}
                      >
                        Save
                      </Button>
                    </Stack>
                  ),
                })}
              </Paper>
            ) : (
              <Paper sx={{ p: 4, borderRadius: 2, textAlign: "center" }}>
                <Typography variant="h6">Select a model item</Typography>
                <Typography color="text.secondary" sx={{ mt: 1 }}>
                  Use the containment tree to the left to pick any node from the published branch tree, then inspect it here.
                </Typography>
              </Paper>
            )}
          </Box>
        </Box>
      ) : null}
    </Stack>
  );

  const renderDetails = () => {
    const selectedItem = itemQuery.data ?? null;
    const editable = Boolean(selectedItem?.editable && canEdit);

    if (!selectedItemId) {
      return (
        <Paper sx={{ p: 4, borderRadius: 2, textAlign: "center" }}>
          <Typography variant="h5">Select a model item</Typography>
          <Typography color="text.secondary" sx={{ mt: 1 }}>
            Use the model tree or Model Browser to open details from the stored branch model already published into Workbench.
          </Typography>
        </Paper>
      );
    }

    if (itemQuery.isLoading || !itemDraft) {
      return <CircularProgress size={28} />;
    }

    return (
      <Stack spacing={2}>
        <Box>
          <Typography variant="h5">Item Details</Typography>
          <Typography variant="body2" color="text.secondary">
            Use the same category-driven specification workspace you would expect in Cameo, backed by the stored Workbench model data.
          </Typography>
        </Box>
        {!editable ? (
          <Alert severity="info">
            Editing is disabled for this item unless TWC marks it editable and the RealSwagger element update capability is available to the current session.
          </Alert>
        ) : null}
        {renderSpecificationWorkspace(itemDraft, {
          mode: "details",
          editable,
          extraHeader: (
            <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
              <Button startIcon={<RefreshRoundedIcon />} onClick={() => refreshItemMutation.mutate()} disabled={refreshItemMutation.isPending}>
                Refresh
              </Button>
              <Button startIcon={<CompareArrowsRoundedIcon />} onClick={() => pickCompareSide("left", selectedItemId)}>
                Compare Left
              </Button>
              <Button startIcon={<CompareArrowsRoundedIcon />} onClick={() => pickCompareSide("right", selectedItemId)}>
                Compare Right
              </Button>
              <Button variant="outlined" onClick={revealSelectedInTree} disabled={!selectedItemId}>
                Reveal In Tree
              </Button>
              <Button
                variant="contained"
                startIcon={<SaveRoundedIcon />}
                disabled={!editable || saveItemMutation.isPending}
                onClick={() => saveItemMutation.mutate()}
              >
                Save
              </Button>
            </Stack>
          ),
        })}
      </Stack>
    );
  };

  const renderDiagramViewer = () => {
    if (!selectedItemId) {
      return (
        <Paper sx={{ p: 4, borderRadius: 2, textAlign: "center" }}>
          <Typography variant="h5">Select a diagram</Typography>
          <Typography color="text.secondary" sx={{ mt: 1 }}>
            Pick a diagram from Model Browser, then use the diagram action to open it here.
          </Typography>
        </Paper>
      );
    }

    if (itemQuery.isLoading || !selectedWorkspaceItem) {
      return <CircularProgress size={28} />;
    }

    if (!selectedWorkspaceItemDiagramPreviewUrl) {
      return (
        <Paper sx={{ p: 4, borderRadius: 2, textAlign: "center" }}>
          <Typography variant="h5">No published diagram preview</Typography>
          <Typography color="text.secondary" sx={{ mt: 1 }}>
            The selected item does not currently include a viewable published diagram preview. Select a diagram with a preview from Model Browser to open it here.
          </Typography>
          <Stack direction="row" spacing={1} justifyContent="center" sx={{ mt: 2 }}>
            <Button variant="contained" onClick={() => setTab("models")}>
              Back to Model Browser
            </Button>
          </Stack>
        </Paper>
      );
    }

    return (
      <Stack spacing={2}>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} justifyContent="space-between" alignItems={{ xs: "stretch", sm: "center" }}>
          <Box>
            <Typography variant="h5">Diagram Viewer</Typography>
            <Typography variant="body2" color="text.secondary">
              {displayEntityName(selectedWorkspaceItem.name, selectedWorkspaceItem.id, selectedWorkspaceItem.item_type, referenceNameById, selectedWorkspaceItem.path)}
            </Typography>
          </Box>
          <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
            <Button variant="outlined" onClick={openDiagramDetails}>
              Diagram Details
            </Button>
            <Button variant="outlined" onClick={() => setTab("models")}>
              Back to Model Browser
            </Button>
          </Stack>
        </Stack>
        <Paper sx={{ p: panelPadding, borderRadius: 2 }}>
          <Box
            sx={{
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              maxHeight: viewportPanelMaxHeight,
              overflow: "auto",
              bgcolor: "background.paper",
            }}
          >
            <Box
              component="img"
              src={selectedWorkspaceItemDiagramPreviewUrl}
              alt={displayEntityName(selectedWorkspaceItem.name, selectedWorkspaceItem.id, selectedWorkspaceItem.item_type, referenceNameById, selectedWorkspaceItem.path)}
              sx={{
                maxWidth: "100%",
                maxHeight: previewMaxHeight,
                height: "auto",
                objectFit: "contain",
                borderRadius: 1,
              }}
            />
          </Box>
        </Paper>
      </Stack>
    );
  };

  const renderCompare = () => (
    <Stack spacing={2}>
      <Typography variant="h5">Compare</Typography>
              <Typography variant="body2" color="text.secondary">
                Compare model items or revisions in the current project context. Numeric left and right revisions on the same project use the RealSwagger revision diff endpoint.
              </Typography>
      <Paper sx={{ p: 3, borderRadius: 2 }}>
        <Grid container spacing={2}>
          <Grid item xs={12} md={5}>
            <TextField
              label="Left item or revision"
              value={compareLeftFieldValue}
              onChange={(event) => {
                const nextValue = event.target.value;
                setCompareLeft(nextValue);
                setCompareLeftDisplay(nextValue);
              }}
              helperText={compareLeft.trim() ? compareLeftLabel : "Use a discovered item or a revision number."}
              fullWidth
            />
          </Grid>
          <Grid item xs={12} md={5}>
            <TextField
              label="Right item or revision"
              value={compareRightFieldValue}
              onChange={(event) => {
                const nextValue = event.target.value;
                setCompareRight(nextValue);
                setCompareRightDisplay(nextValue);
              }}
              helperText={compareRight.trim() ? compareRightLabel : "Use a discovered item or a revision number."}
              fullWidth
            />
          </Grid>
          <Grid item xs={12} md={2}>
            <Button
              fullWidth
              sx={{ height: "100%" }}
              variant="contained"
              startIcon={<CompareArrowsRoundedIcon />}
              disabled={!compareLeft.trim() || !compareRight.trim() || compareMutation.isPending}
              onClick={() => compareMutation.mutate()}
            >
              Compare
            </Button>
          </Grid>
        </Grid>
      </Paper>
      {(compareLeft.trim() || compareRight.trim()) && (
        <Paper sx={{ p: 3, borderRadius: 2 }}>
          <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
            {compareLeft.trim() ? (
              <Box sx={{ flex: 1 }}>
                <Typography variant="overline" color="text.secondary">
                  Left Selection
                </Typography>
                <Typography variant="subtitle2">{compareLeftLabel}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {isRevisionValue(compareLeft) ? "Current project revision context" : selectedProject ? `${selectedProject.name} / ${branchLabel(selectedProjectBranches, selectedBranchId)}` : "Selected workbench context"}
                </Typography>
              </Box>
            ) : null}
            {compareRight.trim() ? (
              <Box sx={{ flex: 1 }}>
                <Typography variant="overline" color="text.secondary">
                  Right Selection
                </Typography>
                <Typography variant="subtitle2">{compareRightLabel}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {isRevisionValue(compareRight) ? "Current project revision context" : selectedProject ? `${selectedProject.name} / ${branchLabel(selectedProjectBranches, selectedBranchId)}` : "Selected workbench context"}
                </Typography>
              </Box>
            ) : null}
          </Stack>
        </Paper>
      )}
      {compareMutation.isPending ? <CircularProgress size={28} /> : null}
      {compareMutation.data ? (
        <Paper sx={{ p: 3, borderRadius: 2 }}>
            <Stack spacing={2}>
              <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap">
              <Typography variant="h6">{compareLeftLabel && compareRightLabel ? `${compareLeftLabel} vs ${compareRightLabel}` : compareMutation.data.summary}</Typography>
                <Chip label={compareMutation.data.compare_type} />
                <Chip label={`${compareMutation.data.differences.length} differences`} variant="outlined" />
              </Stack>
            <List disablePadding>
              {compareMutation.data.differences.map((difference) => (
                <ListItemButton key={difference.field_path} alignItems="flex-start">
                  <ListItemText
                    primary={humanizeFieldPath(difference.field_path)}
                    secondary={
                      <Box component="span" sx={{ display: "block", mt: 1 }}>
                        <Typography component="span" variant="body2" sx={{ display: "block" }}>
                          {difference.summary}
                        </Typography>
                        <Typography component="pre" variant="caption" sx={{ display: "block", whiteSpace: "pre-wrap", mt: 1, mb: 0 }}>
                          {`Left: ${humanReadableValue(difference.left_value, referenceNameById)}\nRight: ${humanReadableValue(difference.right_value, referenceNameById)}`}
                        </Typography>
                      </Box>
                    }
                  />
                </ListItemButton>
              ))}
            </List>
          </Stack>
        </Paper>
      ) : null}
    </Stack>
  );

  const renderCacheApiKeys = () => (
    <Paper sx={{ p: 3, borderRadius: 2 }}>
      <Stack spacing={2}>
        <Box>
          <Typography variant="h5">API Access Keys</Typography>
          <Typography variant="body2" color="text.secondary">
            Create bearer keys for scripts, AI tools, and integrations that need to work with Workbench data as you. The model data stays shared in one cache copy per branch, while Workbench keeps a separate per-user permission overlay so visibility still follows your TWC access.
          </Typography>
        </Box>
        {cacheApiKeysQuery.isLoading ? <CircularProgress size={28} /> : null}
        {cacheApiKeysQuery.error ? <Alert severity="error">{errorMessage(cacheApiKeysQuery.error)}</Alert> : null}
        <Alert severity="info">
          Use these keys with <code>Authorization: Bearer &lt;key&gt;</code>. Start with <code>GET /api/cache</code> or <code>GET /api/cache/servers</code>, then drill into the project, branch, model, and element routes.
        </Alert>
        <Typography variant="caption" color="text.secondary">
          These keys read the Workbench cache, not live TWC directly. Open a project branch in Workbench first so its cached data and your per-user visibility snapshot are available for scripts and AI tools.
        </Typography>
        <TextField
          label="New API key label"
          value={newCacheApiKeyLabel}
          onChange={(event) => setNewCacheApiKeyLabel(event.target.value)}
          helperText="Example: Local Python extractor, Langflow reader, AI notebook, or nightly report."
          fullWidth
        />
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} useFlexGap flexWrap="wrap">
          <FormControlLabel
            control={<Checkbox checked={newCacheApiKeyScopes.includes("read")} onChange={(event) => toggleNewCacheApiKeyScope("read", event.target.checked)} />}
            label="Read"
          />
          <FormControlLabel
            control={<Checkbox checked={newCacheApiKeyScopes.includes("write")} onChange={(event) => toggleNewCacheApiKeyScope("write", event.target.checked)} />}
            label="Write"
          />
          <FormControlLabel
            control={<Checkbox checked={newCacheApiKeyScopes.includes("edit")} onChange={(event) => toggleNewCacheApiKeyScope("edit", event.target.checked)} />}
            label="Edit"
          />
        </Stack>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} alignItems={{ xs: "stretch", sm: "center" }}>
          <Button
            variant="contained"
            disabled={!csrfToken || !newCacheApiKeyLabel.trim() || !newCacheApiKeyScopes.length || createCacheApiKeyMutation.isPending}
            onClick={() => createCacheApiKeyMutation.mutate()}
          >
            Create API Key
          </Button>
          <Button
            variant="outlined"
            startIcon={<RefreshRoundedIcon />}
            onClick={() => queryClient.invalidateQueries({ queryKey: ["workspace-cache-api-keys", ...sessionCacheKey] })}
          >
            Refresh Keys
          </Button>
          {createCacheApiKeyMutation.isPending || deleteCacheApiKeyMutation.isPending ? <CircularProgress size={24} /> : null}
        </Stack>
        {revealedCacheApiKey ? (
          <>
            <Alert severity="success">
              Copy this API key now. Workbench stores only a secure hash and will not reveal the full value again after you leave this screen.
            </Alert>
            <TextField label="New cache API key" value={revealedCacheApiKey} fullWidth InputProps={{ readOnly: true }} />
          </>
        ) : null}
        <TextField
          label="Quick start Python script"
          value={manifestPythonExample}
          fullWidth
          multiline
          minRows={18}
          InputProps={{ readOnly: true }}
        />
        <Stack spacing={1.5}>
          {cacheApiKeys.length ? (
            cacheApiKeys.map((key: CacheApiKeySummary) => (
              <Paper key={key.key_id} variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
                <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} justifyContent="space-between" alignItems={{ xs: "stretch", sm: "center" }}>
                  <Box>
                    <Typography variant="subtitle2">{key.label}</Typography>
                    <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mt: 1 }}>
                      <Chip label={key.token_hint} variant="outlined" size="small" />
                      {key.scopes.map((scope) => (
                        <Chip key={`${key.key_id}-${scope}`} label={scope} variant="outlined" size="small" />
                      ))}
                      <Chip label={`Created ${new Date(key.created_at).toLocaleString()}`} variant="outlined" size="small" />
                      <Chip
                        label={key.last_used_at ? `Last used ${new Date(key.last_used_at).toLocaleString()}` : "Never used"}
                        color={key.last_used_at ? "success" : "default"}
                        variant="outlined"
                        size="small"
                      />
                    </Stack>
                  </Box>
                  <Button
                    variant="text"
                    color="warning"
                    disabled={!csrfToken || deleteCacheApiKeyMutation.isPending}
                    onClick={() => deleteCacheApiKeyMutation.mutate(key.key_id)}
                  >
                    Delete Key
                  </Button>
                </Stack>
              </Paper>
            ))
          ) : (
            <Typography color="text.secondary">No API keys created yet.</Typography>
          )}
        </Stack>
      </Stack>
    </Paper>
  );

  const renderCacheIngestToken = () => {
    const sourceLabel =
      cacheIngestTokenStatus?.source === "shared"
        ? "Encrypted app storage"
        : cacheIngestTokenStatus?.source === "config"
          ? "Legacy environment fallback"
          : "Not configured";

    return (
      <Paper sx={{ p: 3, borderRadius: 2 }}>
        <Stack spacing={2}>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} justifyContent="space-between" alignItems={{ xs: "stretch", sm: "center" }}>
            <Box>
              <Typography variant="h5">Plugin Ingest Token</Typography>
              <Typography variant="body2" color="text.secondary">
                Generate the Cameo plugin write token here. Workbench stores the app-managed token encrypted, and the plugin uses it to send model snapshots and deltas into the cache ingest API.
              </Typography>
            </Box>
            <Stack direction="row" spacing={1}>
              <Button
                variant="outlined"
                startIcon={<RefreshRoundedIcon />}
                onClick={() => queryClient.invalidateQueries({ queryKey: ["workspace-cache-ingest-token", ...sessionCacheKey] })}
              >
                Refresh Token Status
              </Button>
            </Stack>
          </Stack>
          {cacheIngestTokenQuery.isLoading ? <CircularProgress size={28} /> : null}
          {cacheIngestTokenQuery.error ? <Alert severity="error">{errorMessage(cacheIngestTokenQuery.error)}</Alert> : null}
          {cacheIngestTokenStatus ? (
            <>
              <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                <Chip
                  label={cacheIngestTokenStatus.configured ? "Token configured" : "Token not configured"}
                  color={cacheIngestTokenStatus.configured ? "success" : "warning"}
                />
                <Chip label={sourceLabel} variant="outlined" />
                {cacheIngestTokenStatus.token_hint ? <Chip label={cacheIngestTokenStatus.token_hint} variant="outlined" /> : null}
              </Stack>
              {cacheIngestTokenStatus.message ? <Alert severity={cacheIngestTokenStatus.source === "config" ? "warning" : "info"}>{cacheIngestTokenStatus.message}</Alert> : null}
              <TextField
                label="Save exact plugin ingest token"
                type="password"
                value={manualCacheIngestToken}
                onChange={(event) => setManualCacheIngestToken(event.target.value)}
                helperText="Use this when the Cameo plugin should start with a known token instead of a randomly generated one."
                fullWidth
              />
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} alignItems={{ xs: "stretch", sm: "center" }}>
                <Button
                  variant="outlined"
                  disabled={!csrfToken || !manualCacheIngestToken.trim() || storeCacheIngestTokenMutation.isPending}
                  onClick={() => storeCacheIngestTokenMutation.mutate()}
                >
                  Save Exact Token
                </Button>
                <Button
                  variant="contained"
                  disabled={!csrfToken || rotateCacheIngestTokenMutation.isPending}
                  onClick={() => rotateCacheIngestTokenMutation.mutate()}
                >
                  {cacheIngestTokenStatus.configured ? "Rotate Token" : "Generate Token"}
                </Button>
                <Button
                  variant="text"
                  color="warning"
                  disabled={!csrfToken || cacheIngestTokenStatus.source !== "shared" || clearCacheIngestTokenMutation.isPending}
                  onClick={() => clearCacheIngestTokenMutation.mutate()}
                >
                  Clear App-Managed Token
                </Button>
                {storeCacheIngestTokenMutation.isPending || rotateCacheIngestTokenMutation.isPending || clearCacheIngestTokenMutation.isPending ? <CircularProgress size={24} /> : null}
              </Stack>
              {cacheIngestTokenStatus.updated_at ? (
                <Typography variant="caption" color="text.secondary">
                  Last updated {new Date(cacheIngestTokenStatus.updated_at).toLocaleString()}.
                </Typography>
              ) : null}
              {revealedCacheIngestToken ? (
                <>
                  <Alert severity="success">
                    Copy this token into the Cameo plugin now. Workbench stores it encrypted and will not show the full value again after you leave this screen.
                  </Alert>
                  <TextField
                    label="New plugin ingest token"
                    value={revealedCacheIngestToken}
                    fullWidth
                    InputProps={{ readOnly: true }}
                  />
                </>
              ) : null}
            </>
          ) : null}
        </Stack>
      </Paper>
    );
  };

  const renderOslc = () => {
    const response = oslcRequestMutation.data ?? null;
    const rootservices = oslcStatus?.rootservices ?? null;
    const suggestedProjectServicePath = selectedProject
      ? `/oslc/api/oslc/am/${selectedProject.resource_id ?? selectedProject.id}/services`
      : "";
    const suggestedItemPath =
      selectedProject && selectedItemId
        ? `/oslc/api/oslc/am/${selectedProject.resource_id ?? selectedProject.id}/${selectedItemId}`
        : "";
    const consumerSourceLabel =
      oslcStatus?.consumer_key_source === "config"
        ? "Config consumer"
        : oslcStatus?.consumer_key_source === "shared"
          ? "Shared consumer"
        : oslcStatus?.consumer_key_source === "session"
          ? "Session consumer"
          : "No consumer";

    return (
      <Stack spacing={2}>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} justifyContent="space-between" alignItems={{ xs: "stretch", sm: "center" }}>
          <Box>
            <Typography variant="h5">OSLC Settings</Typography>
            <Typography variant="body2" color="text.secondary">
              OSLC is a separate connector from the RealSwagger `/osmc` API. Admins configure the shared consumer here, then authorize OSLC access for this server when needed.
            </Typography>
          </Box>
          <Stack direction="row" spacing={1}>
            <Button variant="outlined" startIcon={<RefreshRoundedIcon />} onClick={() => queryClient.invalidateQueries({ queryKey: ["workspace-oslc-status", ...sessionCacheKey] })}>
              Refresh OSLC
            </Button>
            {oslcStatus?.authorized ? (
              <Button variant="outlined" color="warning" disabled={!csrfToken || disconnectOslcMutation.isPending} onClick={() => disconnectOslcMutation.mutate()}>
                Disconnect
              </Button>
            ) : (
              <Button variant="contained" onClick={() => window.location.assign(api.oslcSignInUrl())} disabled={!oslcStatus?.configured}>
                Connect OSLC
              </Button>
            )}
          </Stack>
        </Stack>
        {oslcStatusQuery.isLoading ? <CircularProgress size={28} /> : null}
        {oslcStatusQuery.error ? <Alert severity="error">{errorMessage(oslcStatusQuery.error)}</Alert> : null}
        {oslcStatus ? (
          <Paper sx={{ p: 3, borderRadius: 2 }}>
            <Stack spacing={2}>
              <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                <Chip label={oslcStatus.configured ? "Consumer configured" : "Consumer not configured"} color={oslcStatus.configured ? "success" : "warning"} />
                <Chip label={oslcStatus.authorized ? "Authorized" : "Not authorized"} color={oslcStatus.authorized ? "success" : "default"} variant={oslcStatus.authorized ? "filled" : "outlined"} />
                <Chip label={consumerSourceLabel} variant="outlined" />
                <Chip label="Read-only OSLC" variant="outlined" />
                {rootservices?.raw_content_type ? <Chip label={rootservices.raw_content_type} variant="outlined" /> : null}
              </Stack>
              <Alert severity="info">
                The No Magic OSLC docs describe this API as read-only. Query services and editing are not supported; use it for resource discovery, linked-data reads, service provider browsing, and delegated-linking entry points.
              </Alert>
              {oslcStatus.message ? <Alert severity="warning">{oslcStatus.message}</Alert> : null}
              {!oslcStatus.configured && rootservices?.request_consumer_key_url ? (
                <Alert severity="info">
                  This server publishes an OSLC consumer registration endpoint. Generate a consumer below or save an approved shared consumer key and secret for this Teamwork Cloud server.
                </Alert>
              ) : null}
              {rootservices ? (
                <Stack spacing={1}>
                  <Typography variant="subtitle2">Discovered Endpoints</Typography>
                  <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                    <Chip label="Root Services" variant="outlined" />
                    {rootservices.request_token_url ? <Chip label="Request Token URL" variant="outlined" /> : null}
                    {rootservices.authorize_url ? <Chip label="Authorize URL" variant="outlined" /> : null}
                    {rootservices.access_token_url ? <Chip label="Access Token URL" variant="outlined" /> : null}
                    {rootservices.service_provider_catalog_url ? <Chip label="Service Provider Catalog" variant="outlined" /> : null}
                    {rootservices.configuration_management_service_providers_url ? <Chip label="CM Service Providers" variant="outlined" /> : null}
                    {rootservices.request_consumer_key_url ? <Chip label="Consumer Key Registration" variant="outlined" /> : null}
                  </Stack>
                  <TextField label="Root Services URL" value={rootservices.rootservices_url} fullWidth InputProps={{ readOnly: true }} />
                  {rootservices.request_consumer_key_url ? (
                    <TextField label="Consumer Key Registration URL" value={rootservices.request_consumer_key_url} fullWidth InputProps={{ readOnly: true }} />
                  ) : null}
                  {rootservices.service_provider_catalog_url ? (
                    <TextField label="Service Provider Catalog URL" value={rootservices.service_provider_catalog_url} fullWidth InputProps={{ readOnly: true }} />
                  ) : null}
                  {rootservices.configuration_management_service_providers_url ? (
                    <TextField
                      label="Configuration Management Service Providers URL"
                      value={rootservices.configuration_management_service_providers_url}
                      fullWidth
                      InputProps={{ readOnly: true }}
                    />
                  ) : null}
                </Stack>
              ) : null}
            </Stack>
          </Paper>
        ) : null}
        <Paper sx={{ p: 3, borderRadius: 2 }}>
          <Stack spacing={2}>
            <Typography variant="subtitle2">OSLC Consumer Setup</Typography>
            <Typography variant="body2" color="text.secondary">
              Teamwork Cloud OSLC uses OAuth 1.0a. Save one approved consumer key and secret here, then every admin session on this server can reuse that shared configuration.
            </Typography>
            <Grid container spacing={2}>
              <Grid item xs={12} md={6}>
                <Stack spacing={1.5}>
                  <Typography variant="body2" fontWeight={600}>
                    Generate Consumer Key
                  </Typography>
                  <TextField
                    label="Consumer Name"
                    value={oslcConsumerName}
                    onChange={(event) => setOslcConsumerName(event.target.value)}
                    fullWidth
                  />
                  <TextField
                    label="Consumer Secret"
                    type="password"
                    value={oslcConsumerSecret}
                    onChange={(event) => setOslcConsumerSecret(event.target.value)}
                    helperText={
                      rootservices?.request_consumer_key_url
                        ? "The returned key still needs approval in Magic Collaboration Studio Settings before OSLC sign-in will succeed."
                        : "This server did not publish a consumer-key registration endpoint in root services."
                    }
                    fullWidth
                  />
                  <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} alignItems={{ xs: "stretch", sm: "center" }}>
                    <Button
                      variant="outlined"
                      disabled={
                        !csrfToken ||
                        !rootservices?.request_consumer_key_url ||
                        !oslcConsumerName.trim() ||
                        !oslcConsumerSecret ||
                        generateOslcConsumerMutation.isPending
                      }
                      onClick={() => generateOslcConsumerMutation.mutate()}
                    >
                      Generate Consumer Key
                    </Button>
                    {generateOslcConsumerMutation.isPending ? <CircularProgress size={24} /> : null}
                  </Stack>
                </Stack>
              </Grid>
              <Grid item xs={12} md={6}>
                <Stack spacing={1.5}>
                  <Typography variant="body2" fontWeight={600}>
                    Shared Consumer for This Server
                  </Typography>
                  <TextField
                    label="Consumer Key"
                    value={oslcManualKey}
                    onChange={(event) => setOslcManualKey(event.target.value)}
                    fullWidth
                  />
                  <TextField
                    label="Consumer Secret"
                    type="password"
                    value={oslcManualSecret}
                    onChange={(event) => setOslcManualSecret(event.target.value)}
                    helperText={
                      sharedOslcConsumer?.configured
                        ? "Enter a new secret only when rotating the shared OSLC consumer for this server."
                        : "Use the key and secret created or approved in Teamwork Cloud Settings."
                    }
                    fullWidth
                  />
                  <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} alignItems={{ xs: "stretch", sm: "center" }}>
                    <Button
                      variant="outlined"
                      disabled={!csrfToken || !oslcManualKey.trim() || !oslcManualSecret || storeOslcConsumerMutation.isPending}
                      onClick={() => storeOslcConsumerMutation.mutate()}
                    >
                      Save Shared Consumer
                    </Button>
                    <Button
                      variant="text"
                      color="warning"
                      disabled={!csrfToken || sharedOslcConsumer?.source !== "shared" || clearOslcConsumerMutation.isPending}
                      onClick={() => clearOslcConsumerMutation.mutate()}
                    >
                      Clear Shared Consumer
                    </Button>
                    {storeOslcConsumerMutation.isPending || clearOslcConsumerMutation.isPending ? <CircularProgress size={24} /> : null}
                  </Stack>
                </Stack>
              </Grid>
            </Grid>
          </Stack>
        </Paper>
        <Paper sx={{ p: 3, borderRadius: 2 }}>
          <Stack spacing={2}>
            <Typography variant="subtitle2">OSLC Request</Typography>
            <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
              <Button size="small" variant="outlined" onClick={() => setOslcPath("/oslc/api/rootservices")}>
                Root Services
              </Button>
              {rootservices?.service_provider_catalog_url ? (
                <Button size="small" variant="outlined" onClick={() => setOslcPath(rootservices.service_provider_catalog_url ?? "")}>
                  Service Providers
                </Button>
              ) : null}
              {rootservices?.configuration_management_service_providers_url ? (
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => setOslcPath(rootservices.configuration_management_service_providers_url ?? "")}
                >
                  CM Providers
                </Button>
              ) : null}
              {suggestedProjectServicePath ? (
                <Button size="small" variant="outlined" onClick={() => setOslcPath(suggestedProjectServicePath)}>
                  Current Project Services
                </Button>
              ) : null}
              {suggestedItemPath ? (
                <Button size="small" variant="outlined" onClick={() => setOslcPath(suggestedItemPath)}>
                  Current Item Resource
                </Button>
              ) : null}
            </Stack>
            <TextField
              label="Path or URL"
              value={oslcPath}
              onChange={(event) => setOslcPath(event.target.value)}
              helperText="Use a full URL or a relative OSLC path such as /oslc/api/rootservices."
              fullWidth
            />
            <TextField select label="Accept" value={oslcAccept} onChange={(event) => setOslcAccept(event.target.value)} fullWidth>
              {["application/rdf+xml", "application/ld+json", "application/xml", "text/turtle", "application/json", "text/plain"].map((contentType) => (
                <MenuItem key={contentType} value={contentType}>
                  {contentType}
                </MenuItem>
              ))}
            </TextField>
            {!oslcStatus?.authorized && oslcStatus?.configured ? (
              <Alert severity="info">
                Connect OSLC first. REST and CLI-style `/osmc` commands already use the Teamwork Cloud token session; OSLC remains its own OAuth 1.0a lane.
              </Alert>
            ) : null}
            {!oslcStatus?.configured ? (
              <Alert severity="warning">
                OSLC needs an approved shared consumer key and secret before authorization can start. Generate one from root services or save an approved pair for this server.
              </Alert>
            ) : null}
            <Stack direction="row" spacing={1.5} alignItems="center">
              <Button
                variant="contained"
                disabled={!csrfToken || !oslcStatus?.authorized || !oslcPath.trim() || oslcRequestMutation.isPending}
                onClick={() => oslcRequestMutation.mutate()}
              >
                Execute GET
              </Button>
              {oslcRequestMutation.isPending ? <CircularProgress size={24} /> : null}
            </Stack>
          </Stack>
        </Paper>
        {response ? (
          <Paper sx={{ p: 3, borderRadius: 2 }}>
            <Stack spacing={2}>
              <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" alignItems="center">
                <Typography variant="h6">OSLC Response</Typography>
                <Chip label={`${response.status_code}`} color={response.ok ? "success" : "error"} />
                <Chip label={response.content_type || "no content type"} variant="outlined" />
                <Chip label={`${response.size_bytes} bytes`} variant="outlined" />
              </Stack>
              <Typography variant="body2" color="text.secondary" sx={{ wordBreak: "break-all" }}>
                {response.requested_url}
              </Typography>
              {response.body_base64 ? (
                <Button variant="outlined" onClick={() => downloadBinaryResponse(response)}>
                  Download Response Body
                </Button>
              ) : null}
              <TextField
                label="Response body"
                value={oslcResponseContent(response)}
                fullWidth
                multiline
                minRows={10}
                InputProps={{ readOnly: true }}
              />
              <TextField
                label="Response headers"
                value={JSON.stringify(response.headers, null, 2)}
                fullWidth
                multiline
                minRows={4}
                InputProps={{ readOnly: true }}
              />
            </Stack>
          </Paper>
        ) : null}
      </Stack>
    );
  };

  const renderAdminSettings = () => (
    <Stack spacing={2}>
      {renderCacheIngestToken()}
      {renderOslc()}
    </Stack>
  );

  const renderDeveloperApi = () => (
    <Stack spacing={2}>
      <Paper sx={{ p: 3, borderRadius: 2 }}>
        <Stack spacing={2}>
          <Typography variant="h5">Developer API</Typography>
          <Typography variant="body2" color="text.secondary">
            Workbench exposes a stored-model API for scripts, notebooks, AI agents, and integration services. Use a personal API key from this page or from Settings, then call the cache manifest first to discover the available route set.
          </Typography>
          <Alert severity="info">
            Plugin-backed branches are the preferred source for designated cache targets. For those branches, Workbench serves the shared cached model data and checks your per-user TWC visibility overlay instead of duplicating the model itself per user.
          </Alert>
          <Typography variant="caption" color="text.secondary">
            These are full standalone Python scripts, not snippets. The current Workbench host and selected project context are prefilled when available. The matching repository files live under the examples folder too.
          </Typography>
          <TextField
            label="Python script: discover the API manifest"
            value={manifestPythonExample}
            fullWidth
            multiline
            minRows={18}
            InputProps={{ readOnly: true }}
          />
          <TextField
            label="Python script: get all stored elements for the selected project and branch"
            value={listElementsPythonExample}
            fullWidth
            multiline
            minRows={22}
            InputProps={{ readOnly: true }}
          />
          <TextField
            label="Python script: search all elements by applied stereotype name"
            value={stereotypeSearchPythonExample}
            fullWidth
            multiline
            minRows={24}
            InputProps={{ readOnly: true }}
          />
          <TextField
            label="Python script: edit a stored element"
            value={editElementPythonExample}
            fullWidth
            multiline
            minRows={22}
            InputProps={{ readOnly: true }}
          />
          <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
            <Chip label="read -> cache reads" />
            <Chip label="write -> cache ingest" variant="outlined" />
            <Chip label="edit -> plugin-backed cache edits" variant="outlined" />
          </Stack>
        </Stack>
      </Paper>
      {renderCacheApiKeys()}
    </Stack>
  );

  const renderWorkbenchAgent = () => (
    <Stack spacing={2}>
      <Paper sx={{ p: 3, borderRadius: 2 }}>
        <Stack spacing={2}>
          <Box>
            <Typography variant="h5">Workbench Agent</Typography>
            <Typography variant="body2" color="text.secondary">
              Map an Open WebUI model to this Workbench user, then sync the selected stored project branch as agent knowledge. The uploaded knowledge bundle includes all stored model data you can access for that branch plus the full Python API scripts from Developer API.
            </Typography>
          </Box>
          {workbenchAgentStatusQuery.error ? <Alert severity="error">{errorMessage(workbenchAgentStatusQuery.error)}</Alert> : null}
          {workbenchAgentModelsQuery.error ? <Alert severity="error">{errorMessage(workbenchAgentModelsQuery.error)}</Alert> : null}
          <Alert severity="info">
            Workbench Agent uses your current Workbench permissions. It only syncs and chats against stored project data that this Workbench user can already read, and it uploads Workbench API knowledge so the model can produce runnable scripts instead of vague pseudocode.
          </Alert>
          <Grid container spacing={2}>
            <Grid item xs={12} md={6}>
              <TextField
                label="Open WebUI Base URL"
                value={agentBaseUrlDraft}
                onChange={(event) => setAgentBaseUrlDraft(event.target.value)}
                helperText="Use the root Open WebUI host, like https://openwebui.company.com"
                fullWidth
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                label="Open WebUI API Key"
                type="password"
                value={agentApiKeyDraft}
                onChange={(event) => setAgentApiKeyDraft(event.target.value)}
                helperText={workbenchAgentStatus?.has_api_key ? "Leave blank to keep the saved API key, or paste a new one to rotate it." : "Required the first time you save this Open WebUI connection."}
                fullWidth
              />
            </Grid>
          </Grid>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} alignItems={{ xs: "stretch", sm: "center" }}>
            <Button
              variant="contained"
              startIcon={<SaveRoundedIcon />}
              disabled={!csrfToken || saveWorkbenchAgentConfigMutation.isPending || !agentBaseUrlDraft.trim()}
              onClick={() => saveWorkbenchAgentConfigMutation.mutate()}
            >
              {workbenchAgentStatus?.configured ? "Save Mapping" : "Save Connection"}
            </Button>
            <Button
              variant="outlined"
              startIcon={<RefreshRoundedIcon />}
              disabled={!workbenchAgentStatus?.configured || workbenchAgentModelsQuery.isFetching}
              onClick={() => void workbenchAgentModelsQuery.refetch()}
            >
              Load Models
            </Button>
            <Button
              color="error"
              variant="outlined"
              disabled={!workbenchAgentStatus?.configured || clearWorkbenchAgentConfigMutation.isPending || !csrfToken}
              onClick={() => clearWorkbenchAgentConfigMutation.mutate()}
            >
              Clear Mapping
            </Button>
            {saveWorkbenchAgentConfigMutation.isPending || clearWorkbenchAgentConfigMutation.isPending || workbenchAgentModelsQuery.isFetching ? (
              <CircularProgress size={22} />
            ) : null}
          </Stack>
          <TextField
            select
            label="Mapped Open WebUI Agent / Model"
            value={agentSelectedModelId}
            onChange={(event) => {
              const nextId = event.target.value;
              const entry = workbenchAgentModels.find((candidate) => candidate.id === nextId) ?? null;
              setAgentSelectedModelId(nextId);
              setAgentSelectedModelName(entry?.name ?? "");
            }}
            fullWidth
            disabled={!workbenchAgentStatus?.configured || (!workbenchAgentModels.length && !workbenchAgentModelsQuery.isFetching)}
            helperText={
              selectedWorkbenchAgentModel?.description ||
              workbenchAgentStatus?.model_name ||
              "Load models after saving the Open WebUI connection, then choose the mapped agent/model here."
            }
          >
            <MenuItem value="">
              <em>Select an Open WebUI model</em>
            </MenuItem>
            {workbenchAgentModels.map((entry) => (
              <MenuItem key={entry.id} value={entry.id}>
                {entry.name} ({entry.id})
              </MenuItem>
            ))}
          </TextField>
          <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
            <Chip label={workbenchAgentStatus?.configured ? "Connection saved" : "Connection not saved"} color={workbenchAgentStatus?.configured ? "success" : "default"} />
            <Chip label={workbenchAgentStatus?.model_name || "No mapped model yet"} variant="outlined" />
            <Chip label={workbenchAgentStatus?.knowledge_file_name || "Knowledge not synced"} variant="outlined" />
          </Stack>
          {workbenchAgentStatus?.updated_at ? (
            <Typography variant="caption" color="text.secondary">
              Mapping updated {new Date(workbenchAgentStatus.updated_at).toLocaleString()}.
            </Typography>
          ) : null}
        </Stack>
      </Paper>

      <Paper sx={{ p: 3, borderRadius: 2 }}>
        <Stack spacing={2}>
          <Box>
            <Typography variant="h6">Knowledge Sync</Typography>
            <Typography variant="body2" color="text.secondary">
              Sync the selected stored project branch into Open WebUI before chatting. Workbench uploads the full stored branch data you can access, plus API manifest guidance and full Python script examples.
            </Typography>
          </Box>
          {!selectedProjectId || !selectedBranchId ? (
            <Alert severity="warning">Select a project and branch first so Workbench Agent knows which stored branch knowledge to upload.</Alert>
          ) : null}
          <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
            <Chip label={`Project: ${workbenchAgentProjectLabel}`} />
            <Chip label={`Branch: ${workbenchAgentBranchLabel}`} variant="outlined" />
            {branchAccessManifestStatus ? (
              <Chip
                label={`${branchAccessManifestStatus.accessible_user_count} accessible users`}
                variant="outlined"
              />
            ) : null}
          </Stack>
          {workbenchAgentStatus?.knowledge_project_id && workbenchAgentStatus?.knowledge_branch_id ? (
            <Alert severity="success">
              Current synced knowledge: {workbenchAgentStatus.knowledge_file_name || workbenchAgentStatus.knowledge_file_id} for {workbenchAgentStatus.knowledge_project_id} / {workbenchAgentStatus.knowledge_branch_id}
              {workbenchAgentStatus.knowledge_synced_at ? ` at ${new Date(workbenchAgentStatus.knowledge_synced_at).toLocaleString()}` : ""}.
            </Alert>
          ) : null}
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} alignItems={{ xs: "stretch", sm: "center" }}>
            <Button
              variant="contained"
              disabled={!selectedProjectId || !selectedBranchId || !workbenchAgentStatus?.configured || !csrfToken || syncWorkbenchAgentKnowledgeMutation.isPending}
              onClick={() => syncWorkbenchAgentKnowledgeMutation.mutate()}
            >
              Sync Current Branch Knowledge
            </Button>
            {syncWorkbenchAgentKnowledgeMutation.isPending ? <CircularProgress size={22} /> : null}
          </Stack>
        </Stack>
      </Paper>

      <Paper sx={{ p: 3, borderRadius: 2 }}>
        <Stack spacing={2}>
          <Box>
            <Typography variant="h6">Agent Chat</Typography>
            <Typography variant="body2" color="text.secondary">
              Use the mapped Open WebUI model against the selected stored project branch. Chat turns can auto-sync knowledge first, so the model sees the latest branch data and the full Python API examples Workbench exposes.
            </Typography>
          </Box>
          {!workbenchAgentStatus?.configured ? (
            <Alert severity="warning">Save the Open WebUI connection and mapped model before starting a Workbench Agent conversation.</Alert>
          ) : null}
          <FormControlLabel
            control={
              <Checkbox
                checked={agentSyncKnowledgeBeforeChat}
                onChange={(event) => setAgentSyncKnowledgeBeforeChat(event.target.checked)}
              />
            }
            label="Auto-sync the selected stored project branch before each chat request"
          />
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, minHeight: 220 }}>
            <Stack spacing={1.5}>
              {agentMessages.length ? (
                agentMessages.map((message, index) => (
                  <Paper
                    key={`${message.role}-${index}`}
                    variant="outlined"
                    sx={{
                      p: 1.5,
                      borderRadius: 2,
                      bgcolor: message.role === "assistant" ? "action.hover" : "background.paper",
                    }}
                  >
                    <Typography variant="subtitle2" sx={{ textTransform: "capitalize", mb: 0.5 }}>
                      {message.role}
                    </Typography>
                    <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
                      {message.content}
                    </Typography>
                  </Paper>
                ))
              ) : (
                <Typography color="text.secondary">
                  Start a conversation once a model is mapped. The agent will answer using your selected stored project branch plus the Workbench API script examples already bundled into its knowledge file.
                </Typography>
              )}
            </Stack>
          </Paper>
          <TextField
            label="Prompt"
            value={agentChatInput}
            onChange={(event) => setAgentChatInput(event.target.value)}
            fullWidth
            multiline
            minRows={5}
            helperText="Ask for scripts, model searches, stereotype reports, diagram-related questions, or analysis of the selected stored project branch."
          />
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} alignItems={{ xs: "stretch", sm: "center" }}>
            <Button
              variant="contained"
              disabled={
                !workbenchAgentStatus?.configured ||
                !selectedProjectId ||
                !selectedBranchId ||
                !agentChatInput.trim() ||
                !csrfToken ||
                workbenchAgentChatMutation.isPending
              }
              onClick={sendWorkbenchAgentPrompt}
            >
              Send to Workbench Agent
            </Button>
            <Button
              variant="outlined"
              disabled={!agentMessages.length}
              onClick={() => setAgentMessages([])}
            >
              Clear Conversation
            </Button>
            {workbenchAgentChatMutation.isPending ? <CircularProgress size={22} /> : null}
          </Stack>
        </Stack>
      </Paper>
    </Stack>
  );

  const renderSettingsExtras = () => (
    <Stack spacing={2}>
      {renderCacheApiKeys()}
      {isAdmin ? renderAdminSettings() : null}
    </Stack>
  );

  const renderApiExplorer = () => {
    const response = apiOperationMutation.data ?? null;
    if (!isAdmin) {
      return <Alert severity="warning">Administrator access is required for API Explorer.</Alert>;
    }
    return (
      <Stack spacing={2}>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} justifyContent="space-between" alignItems={{ xs: "stretch", sm: "center" }}>
          <Box>
            <Typography variant="h5">API Explorer</Typography>
            <Typography variant="body2" color="text.secondary">
              Every action here is generated from RealSwagger.json and executed only through declared method/path/parameter combinations.
            </Typography>
          </Box>
          <Button variant="outlined" startIcon={<RefreshRoundedIcon />} onClick={() => queryClient.invalidateQueries({ queryKey: ["workspace-contract", ...sessionCacheKey] })}>
            Refresh Contract
          </Button>
        </Stack>
        {contractQuery.isLoading ? <CircularProgress size={28} /> : null}
        {contractQuery.error ? <Alert severity="error">{errorMessage(contractQuery.error)}</Alert> : null}
        {contractManifest ? (
          <Grid container spacing={2}>
            <Grid item xs={12} md={4}>
              <Paper sx={{ p: 2, borderRadius: 2 }}>
                <Stack spacing={2}>
                  <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                    <Chip label={contractManifest.version || contractManifest.title} />
                    <Chip label={`${contractManifest.operations.length} operations`} variant="outlined" />
                    <Chip label={`${contractManifest.schemas.length} schemas`} variant="outlined" />
                  </Stack>
                  <TextField select label="Functional Area" value={selectedApiTag} onChange={(event) => setSelectedApiTag(event.target.value)} fullWidth>
                    {apiTags.map((tag) => (
                      <MenuItem key={tag} value={tag}>
                        {tag} ({contractManifest.tag_counts[tag]})
                      </MenuItem>
                    ))}
                  </TextField>
                  <TextField label="Filter operations" value={apiSearch} onChange={(event) => setApiSearch(event.target.value)} fullWidth />
                  <List dense disablePadding sx={{ maxHeight: 560, overflow: "auto" }}>
                    {filteredApiOperations.map((operation) => (
                      <ListItemButton
                        key={operation.key}
                        selected={selectedOperation?.key === operation.key}
                        onClick={() => setSelectedOperationKey(operation.key)}
                      >
                        <ListItemText
                          primary={
                            <Stack direction="row" spacing={1} alignItems="center">
                              <Chip label={operation.method} size="small" color={operation.destructive ? "warning" : "default"} />
                              <Typography variant="body2" sx={{ wordBreak: "break-all" }}>
                                {operation.path}
                              </Typography>
                            </Stack>
                          }
                          secondary={operation.summary || operation.description || operation.key}
                        />
                      </ListItemButton>
                    ))}
                  </List>
                  {!filteredApiOperations.length ? <Typography color="text.secondary">No operations match this filter.</Typography> : null}
                </Stack>
              </Paper>
            </Grid>
            <Grid item xs={12} md={8}>
              {selectedOperation ? (
                <Stack spacing={2}>
                  <Paper sx={{ p: 3, borderRadius: 2 }}>
                    <Stack spacing={2}>
                      <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" alignItems="center">
                        <Chip label={selectedOperation.method} color={selectedOperation.destructive ? "warning" : "default"} />
                        <Typography variant="h6" sx={{ wordBreak: "break-all" }}>
                          {selectedOperation.path}
                        </Typography>
                      </Stack>
                      {selectedOperation.summary || selectedOperation.description ? (
                        <Typography color="text.secondary">{selectedOperation.summary || selectedOperation.description}</Typography>
                      ) : null}
                      <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                        {selectedOperation.request_body?.content_types.map((contentType) => (
                          <Chip key={contentType} label={contentType} variant="outlined" />
                        ))}
                        {selectedOperation.supports_file_upload ? <Chip label="File upload" color="info" variant="outlined" /> : null}
                        {selectedOperation.supports_download ? <Chip label="Download-capable" color="info" variant="outlined" /> : null}
                        {selectedOperation.responses.map((apiResponse) => (
                          <Chip
                            key={`${apiResponse.status_code}-${apiResponse.schema_ref ?? "response"}`}
                            label={`${apiResponse.status_code}${apiResponse.schema_ref ? ` ${apiResponse.schema_ref}` : ""}`}
                            size="small"
                            variant="outlined"
                          />
                        ))}
                      </Stack>
                      {selectedOperation.destructive ? (
                        <Alert severity="warning">
                          This operation can change or delete data. It is still executed only against the Swagger-declared TWC endpoint and will use the current authenticated TWC session.
                        </Alert>
                      ) : null}
                    </Stack>
                  </Paper>
                  <Paper sx={{ p: 3, borderRadius: 2 }}>
                    <Stack spacing={2}>
                      {renderParameterControls("Path Parameters", selectedOperation.path_parameters, apiPathParams, (name, value) =>
                        setApiPathParams((current) => ({ ...current, [name]: value })),
                      )}
                      <Divider />
                      {renderParameterControls("Query Parameters", selectedOperation.query_parameters, apiQueryParams, (name, value) =>
                        setApiQueryParams((current) => ({ ...current, [name]: value })),
                      )}
                      {selectedOperation.request_body && !selectedOperation.supports_file_upload ? (
                        <>
                          <Divider />
                          <Stack spacing={1.5}>
                            <Typography variant="subtitle2">Request Body</Typography>
                            <TextField
                              select
                              label="Content-Type"
                              value={apiContentType}
                              onChange={(event) => {
                                setApiContentType(event.target.value);
                                setApiBodyText(event.target.value === "text/plain" ? "" : requestBodyTemplate(selectedOperation, contractManifest));
                              }}
                              fullWidth
                            >
                              {selectedOperation.request_body.content_types.map((contentType) => (
                                <MenuItem key={contentType} value={contentType}>
                                  {contentType}
                                </MenuItem>
                              ))}
                            </TextField>
                            <TextField
                              label={apiContentType === "text/plain" ? "Text payload" : "JSON payload"}
                              value={apiBodyText}
                              onChange={(event) => setApiBodyText(event.target.value)}
                              fullWidth
                              multiline
                              minRows={8}
                              helperText={selectedOperation.request_body.description || "Payload shape is derived from the Swagger requestBody schema."}
                            />
                          </Stack>
                        </>
                      ) : null}
                      {selectedOperation.supports_file_upload ? (
                        <>
                          <Divider />
                          <Stack spacing={1.5}>
                            <Typography variant="subtitle2">File Upload</Typography>
                            <Button variant="outlined" component="label">
                              Choose File
                              <input
                                hidden
                                type="file"
                                onChange={(event) => setApiUploadFile(event.target.files?.[0] ?? null)}
                              />
                            </Button>
                            <Typography variant="body2" color="text.secondary">
                              {apiUploadFile ? `${apiUploadFile.name} (${apiUploadFile.size} bytes)` : "No file selected."}
                            </Typography>
                          </Stack>
                        </>
                      ) : null}
                      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} alignItems={{ xs: "stretch", sm: "center" }}>
                        <Button
                          variant="contained"
                          disabled={!selectedOperation || !csrfToken || apiOperationMutation.isPending}
                          onClick={() => apiOperationMutation.mutate()}
                        >
                          Execute Operation
                        </Button>
                        {apiOperationMutation.isPending ? <CircularProgress size={24} /> : null}
                      </Stack>
                    </Stack>
                  </Paper>
                  {response ? (
                    <Paper sx={{ p: 3, borderRadius: 2 }}>
                      <Stack spacing={2}>
                        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" alignItems="center">
                          <Typography variant="h6">Response</Typography>
                          <Chip label={`${response.status_code}`} color={response.ok ? "success" : "error"} />
                          <Chip label={response.content_type || "no content type"} variant="outlined" />
                          <Chip label={`${response.size_bytes} bytes`} variant="outlined" />
                        </Stack>
                        <Typography variant="body2" color="text.secondary" sx={{ wordBreak: "break-all" }}>
                          {response.method} {response.requested_path}
                        </Typography>
                        {response.body_base64 ? (
                          <Button variant="outlined" onClick={() => downloadSwaggerResponse(response)}>
                            Download Response Body
                          </Button>
                        ) : null}
                        <TextField
                          label="Response body"
                          value={responseContent(response)}
                          fullWidth
                          multiline
                          minRows={10}
                          InputProps={{ readOnly: true }}
                        />
                        <TextField
                          label="Response headers"
                          value={JSON.stringify(response.headers, null, 2)}
                          fullWidth
                          multiline
                          minRows={4}
                          InputProps={{ readOnly: true }}
                        />
                      </Stack>
                    </Paper>
                  ) : null}
                </Stack>
              ) : (
                <Paper sx={{ p: 4, borderRadius: 2, textAlign: "center" }}>
                  <Typography color="text.secondary">Select an operation to build a Swagger-backed request.</Typography>
                </Paper>
              )}
            </Grid>
          </Grid>
        ) : null}
      </Stack>
    );
  };

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default" }}>
      <AppBar position="sticky" color="default" elevation={1}>
        <Toolbar sx={{ gap: compactUi ? 1.25 : 2 }}>
          <Box sx={{ flexGrow: 1, minWidth: 0 }}>
            <Typography variant="h6" noWrap sx={{ lineHeight: 1.1 }}>
              TWC Workbench
            </Typography>
          </Box>
          {session?.capabilities ? <CapabilityBadges capabilities={session.capabilities.capabilities} /> : null}
          <Tooltip title="Refresh capabilities">
            <span>
              <IconButton onClick={() => capabilityMutation.mutate()} disabled={!csrfToken || capabilityMutation.isPending}>
                <RefreshRoundedIcon />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="Workspace settings">
            <IconButton onClick={() => setSettingsOpen(true)}>
              <SettingsRoundedIcon />
            </IconButton>
          </Tooltip>
          <Tooltip title="Sign out">
            <span>
              <IconButton onClick={() => logoutMutation.mutate()} disabled={!csrfToken || logoutMutation.isPending}>
                <LogoutRoundedIcon />
              </IconButton>
            </span>
          </Tooltip>
        </Toolbar>
      </AppBar>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: {
            xs: "1fr",
            lg: `${navPaneWidth}px 12px minmax(0, 1fr)`,
          },
          gap: 0,
          p: workspaceOuterPadding,
        }}
      >
        <Paper
          component="aside"
          sx={{
            p: compactUi ? 1.5 : 2,
            borderRadius: 2,
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            maxHeight: { xs: "none", lg: "calc(100vh - 110px)" },
            overflow: "hidden",
          }}
        >
          <Stack spacing={sectionSpacing} sx={{ minHeight: 0, flex: 1 }}>
            <TextField
              select
              label="Project"
              value={selectedProjectId}
              onChange={(event) => selectProject(event.target.value)}
              fullWidth
              disabled={!projects.length}
            >
              <MenuItem value="">
                <em>Select a project</em>
              </MenuItem>
              {projects.map((project) => (
                <MenuItem key={project.id} value={project.id}>
                  {project.name}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              label="Branch"
              value={selectedBranchId}
              onChange={(event) => setSelectedBranchId(event.target.value)}
              fullWidth
              disabled={!selectedProjectId || branchesQuery.isLoading || !selectedProjectBranches.length}
            >
              {!selectedProjectId ? (
                <MenuItem value="" disabled>
                  Select a project first
                </MenuItem>
              ) : selectedProjectBranches.length ? (
                selectedProjectBranches.map((branch) => (
                  <MenuItem key={branch.id} value={branch.id}>
                    {branch.name}
                  </MenuItem>
                ))
              ) : branchesQuery.isLoading ? (
                <MenuItem value="" disabled>
                  Loading branches...
                </MenuItem>
              ) : (
                <MenuItem value="">Default</MenuItem>
              )}
            </TextField>
            <Paper variant="outlined" sx={{ p: compactUi ? 1.5 : 2, borderRadius: 2 }}>
              <Stack spacing={0.75}>
                <Typography variant="overline" color="text.secondary">
                  Workspace Context
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Choose the published project and branch here. The containment tree and specification workspace appear together inside Model Browser.
                </Typography>
              </Stack>
            </Paper>
            {selectedWorkspaceItem ? (
              <Paper variant="outlined" sx={{ p: compactUi ? 1.5 : 2, borderRadius: 2 }}>
                <Stack spacing={compactUi ? 0.5 : 0.75}>
                  <Typography variant="overline" color="text.secondary">
                    Current Selection
                  </Typography>
                  <Typography variant="subtitle2">{selectedWorkspaceItemName}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {selectedWorkspaceItemPath || (selectedProject ? `${selectedProject.name} / ${branchLabel(selectedProjectBranches, selectedBranchId)}` : humanizeFieldLabel(selectedWorkspaceItem.item_type))}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {humanizeFieldLabel(selectedWorkspaceItem.item_type)}
                  </Typography>
                  {selectedContainmentSegments.length ? (
                    <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap">
                      {selectedContainmentSegments.map((segment, index) => (
                        <Chip
                          key={`${segment}-${index}`}
                          label={segment}
                          size="small"
                          variant={index === selectedContainmentSegments.length - 1 ? "filled" : "outlined"}
                        />
                      ))}
                    </Stack>
                  ) : null}
                </Stack>
              </Paper>
            ) : null}
          </Stack>
        </Paper>
        <Box
          role="separator"
          aria-orientation="vertical"
          sx={resizeHandleStyles()}
          onMouseDown={(event) => beginHorizontalResize(event, navPaneWidth, setNavPaneWidth, 260, 520)}
        />
        <Stack spacing={sectionSpacing} component="main" sx={{ minWidth: 0, pl: { xs: 0, lg: compactUi ? 1.5 : 2 } }}>
          {notice ? <Alert severity={notice.severity} onClose={() => setNotice(null)}>{notice.message}</Alert> : null}
          {projectsQuery.error ? <Alert severity="error">{errorMessage(projectsQuery.error)}</Alert> : null}
          <Paper sx={{ borderRadius: 2 }}>
            <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ p: compactUi ? 1 : 1.25 }}>
              <Button
                size="small"
                variant={currentMenuGroup === "views" ? "contained" : "text"}
                endIcon={<KeyboardArrowDownRoundedIcon />}
                onClick={openWorkspaceMenu("views")}
              >
                Views
              </Button>
              <Button
                size="small"
                variant={currentMenuGroup === "diagrams" ? "contained" : "text"}
                endIcon={<KeyboardArrowDownRoundedIcon />}
                onClick={openWorkspaceMenu("diagrams")}
              >
                Diagrams
              </Button>
              <Button
                size="small"
                variant={currentMenuGroup === "api" ? "contained" : "text"}
                endIcon={<KeyboardArrowDownRoundedIcon />}
                onClick={openWorkspaceMenu("api")}
              >
                API
              </Button>
            </Stack>
            <Menu
              anchorEl={workspaceMenuAnchorEl}
              open={Boolean(workspaceMenuGroup)}
              onClose={closeWorkspaceMenu}
              keepMounted
            >
              {workspaceMenuGroup === "views" ? (
                [
                  <MenuItem key="dashboard" selected={tab === "dashboard"} onClick={() => { setTab("dashboard"); closeWorkspaceMenu(); }}>Dashboard</MenuItem>,
                  <MenuItem key="projects" selected={tab === "projects"} onClick={() => { setTab("projects"); closeWorkspaceMenu(); }}>Project Browser</MenuItem>,
                  <MenuItem key="models" selected={tab === "models"} onClick={() => { setTab("models"); closeWorkspaceMenu(); }}>Model Browser</MenuItem>,
                  <MenuItem key="compare" selected={tab === "compare"} onClick={() => { setTab("compare"); closeWorkspaceMenu(); }}>Compare</MenuItem>,
                  <MenuItem key="agent" selected={tab === "agent"} onClick={() => { setTab("agent"); closeWorkspaceMenu(); }}>Workbench Agent</MenuItem>,
                ]
              ) : null}
              {workspaceMenuGroup === "diagrams" ? (
                [
                  <MenuItem
                    key="diagram-viewer"
                    selected={tab === "diagram-viewer"}
                    disabled={!selectedWorkspaceItemDiagramPreviewUrl}
                    onClick={() => {
                      openDiagramViewer();
                      closeWorkspaceMenu();
                    }}
                  >
                    Diagram Viewer
                  </MenuItem>,
                  <MenuItem
                    key="diagram-details"
                    disabled={!selectedWorkspaceItemIsDiagram}
                    onClick={() => {
                      openDiagramDetails();
                      closeWorkspaceMenu();
                    }}
                  >
                    Diagram Details
                  </MenuItem>,
                ]
              ) : null}
              {workspaceMenuGroup === "api" ? (
                [
                  <MenuItem key="developer" selected={tab === "developer"} onClick={() => { setTab("developer"); closeWorkspaceMenu(); }}>Developer API</MenuItem>,
                  ...(isAdmin
                    ? [
                        <MenuItem key="api-explorer" selected={tab === "api"} onClick={() => { setTab("api"); closeWorkspaceMenu(); }}>
                          API Explorer
                        </MenuItem>,
                      ]
                    : []),
                ]
              ) : null}
            </Menu>
          </Paper>
          <Box>
            {tab === "dashboard" ? renderDashboard() : null}
            {tab === "projects" ? renderProjects() : null}
            {tab === "models" ? renderModels() : null}
            {tab === "diagram-viewer" ? renderDiagramViewer() : null}
            {tab === "compare" ? renderCompare() : null}
            {tab === "agent" ? renderWorkbenchAgent() : null}
            {tab === "developer" ? renderDeveloperApi() : null}
            {tab === "api" ? renderApiExplorer() : null}
          </Box>
        </Stack>
      </Box>
      <SettingsDialog
        open={settingsOpen}
        preferences={currentPreferences}
        saving={settingsMutation.isPending}
        extraContent={renderSettingsExtras()}
        onClose={() => {
          setSettingsOpen(false);
          setRevealedCacheIngestToken("");
          setRevealedCacheApiKey("");
        }}
        onSave={async (preferences) => {
          await settingsMutation.mutateAsync(preferences);
        }}
      />
    </Box>
  );
}
