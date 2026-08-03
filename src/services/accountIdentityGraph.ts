/**
 * Account Identity Graph (Apex M1) — detects transitive merge conflicts.
 * Uses tradelineMerger scoring (baseline authority) — no unifiedTradelineResolver dependency.
 */

import type { NegativeItem } from '../types';
import { scoreMergeCandidate, type MergeDecisionTier } from './tradelineMerger';
import { detectOCCARelationship } from './ocCaRelationshipDetector';

export type GraphEdgeKind = 'auto_merge' | 'link_only' | 'review' | 'hard_refuse';

export interface AccountNode {
  itemId: string;
  creditorName: string;
  bureau: string;
}

export interface MergeEdge {
  aId: string;
  bId: string;
  kind: GraphEdgeKind;
  score: number;
  reason: string;
}

export interface ConflictPair {
  aId: string;
  bId: string;
  reason: string;
}

export interface AccountIdentityGraph {
  nodes: AccountNode[];
  edges: MergeEdge[];
  mergeGroups: string[][];
  linkGroups: string[][];
  isolated: string[];
  conflicted: ConflictPair[];
}

function bureauOf(item: NegativeItem): string {
  return item.creditBureau?.[0] ?? 'Unknown';
}

function tierToKind(tier: MergeDecisionTier): GraphEdgeKind | null {
  switch (tier) {
    case 'AUTO_MERGE':
      return 'auto_merge';
    case 'LINK_ONLY':
      return 'link_only';
    case 'SUGGEST':
    case 'MANUAL_REVIEW':
      return 'review';
    case 'HARD_REFUSE':
      return 'hard_refuse';
    case 'NO_MERGE':
      return null;
    default: {
      const _exhaustive: never = tier;
      return _exhaustive;
    }
  }
}

/**
 * Build pairwise graph and connected components for AUTO_MERGE / LINK_ONLY.
 * Blocks transitive merge when A↔B and B↔C are ok but A↔C hard-refuses.
 */
export function buildAccountIdentityGraph(items: NegativeItem[]): AccountIdentityGraph {
  const nodes: AccountNode[] = items.map((item) => ({
    itemId: item.id,
    creditorName: item.creditorName,
    bureau: bureauOf(item),
  }));

  const edges: MergeEdge[] = [];
  const conflicted: ConflictPair[] = [];

  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i];
      const b = items[j];
      const occa = detectOCCARelationship(a, b);
      if (occa.decision === 'link_only') {
        edges.push({
          aId: a.id,
          bId: b.id,
          kind: 'link_only',
          score: 60,
          reason: occa.reason,
        });
        continue;
      }

      const scored = scoreMergeCandidate(a, b);
      const kind = tierToKind(scored.decision);
      if (!kind) continue;

      if (kind === 'hard_refuse') {
        edges.push({
          aId: a.id,
          bId: b.id,
          kind,
          score: scored.confidence,
          reason: scored.reasons?.[0] ?? 'Hard refuse',
        });
        conflicted.push({
          aId: a.id,
          bId: b.id,
          reason: scored.reasons?.[0] ?? 'Hard refuse',
        });
        continue;
      }

      edges.push({
        aId: a.id,
        bId: b.id,
        kind,
        score: scored.confidence,
        reason: scored.reasons?.[0] ?? `Decision ${scored.decision}`,
      });
    }
  }

  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let p = parent.get(x) ?? x;
    while (p !== (parent.get(p) ?? p)) p = parent.get(p) ?? p;
    parent.set(x, p);
    return p;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const item of items) parent.set(item.id, item.id);

  const autoEdges = edges.filter((e) => e.kind === 'auto_merge');
  for (const e of autoEdges) {
    const groupA = items.filter((it) => find(it.id) === find(e.aId));
    const groupB = items.filter((it) => find(it.id) === find(e.bId));
    let blocked = false;
    for (const ga of groupA) {
      for (const gb of groupB) {
        if (ga.id === gb.id) continue;
        const s = scoreMergeCandidate(ga, gb);
        if (s.decision === 'HARD_REFUSE') {
          blocked = true;
          conflicted.push({
            aId: ga.id,
            bId: gb.id,
            reason: `Triadic closure block: ${s.reasons?.[0] ?? 'hard refuse'}`,
          });
        }
      }
    }
    if (!blocked) union(e.aId, e.bId);
  }

  const mergeMap = new Map<string, string[]>();
  for (const item of items) {
    const root = find(item.id);
    const list = mergeMap.get(root) ?? [];
    list.push(item.id);
    mergeMap.set(root, list);
  }
  const mergeGroups = [...mergeMap.values()].filter((g) => g.length > 1);

  const linkParent = new Map<string, string>();
  const lfind = (x: string): string => {
    let p = linkParent.get(x) ?? x;
    while (p !== (linkParent.get(p) ?? p)) p = linkParent.get(p) ?? p;
    linkParent.set(x, p);
    return p;
  };
  for (const item of items) linkParent.set(item.id, item.id);
  for (const e of edges.filter((x) => x.kind === 'link_only')) {
    const ra = lfind(e.aId);
    const rb = lfind(e.bId);
    if (ra !== rb) linkParent.set(ra, rb);
  }
  const linkMap = new Map<string, string[]>();
  for (const item of items) {
    const root = lfind(item.id);
    const list = linkMap.get(root) ?? [];
    list.push(item.id);
    linkMap.set(root, list);
  }
  const linkGroups = [...linkMap.values()].filter((g) => g.length > 1);

  const inMerge = new Set(mergeGroups.flat());
  const inLink = new Set(linkGroups.flat());
  const isolated = items
    .map((i) => i.id)
    .filter((id) => !inMerge.has(id) && !inLink.has(id));

  return { nodes, edges, mergeGroups, linkGroups, isolated, conflicted };
}
