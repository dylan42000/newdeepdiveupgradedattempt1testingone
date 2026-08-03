/**
 * Account Identity Graph (Apex M1) — detects transitive merge conflicts.
 */

import type { NegativeItem } from '../types';
import { scoreTradelinePair, type TradelineMatchScore } from './unifiedTradelineResolver';
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
  const byId = new Map(items.map((i) => [i.id, i]));

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

      const score: TradelineMatchScore = scoreTradelinePair(a, b);
      if (score.hardRejectReason) {
        edges.push({
          aId: a.id,
          bId: b.id,
          kind: 'hard_refuse',
          score: score.total,
          reason: score.hardRejectReason,
        });
        conflicted.push({ aId: a.id, bId: b.id, reason: score.hardRejectReason });
        continue;
      }

      if (score.band === 'auto') {
        edges.push({
          aId: a.id,
          bId: b.id,
          kind: 'auto_merge',
          score: score.total,
          reason: `Match score ${score.total}`,
        });
      } else if (score.band === 'review') {
        edges.push({
          aId: a.id,
          bId: b.id,
          kind: 'review',
          score: score.total,
          reason: `Review band ${score.total}`,
        });
      }
    }
  }

  // Connected components for auto_merge only, with triadic closure check
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
    // Before union, ensure no hard refuse between any members of the would-be groups
    const groupA = items.filter((it) => find(it.id) === find(e.aId));
    const groupB = items.filter((it) => find(it.id) === find(e.bId));
    let blocked = false;
    for (const ga of groupA) {
      for (const gb of groupB) {
        if (ga.id === gb.id) continue;
        const s = scoreTradelinePair(ga, gb);
        if (s.hardRejectReason) {
          blocked = true;
          conflicted.push({
            aId: ga.id,
            bId: gb.id,
            reason: `Triadic closure block: ${s.hardRejectReason}`,
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

  // Link-only components (separate from auto merge)
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

  void byId;
  return { nodes, edges, mergeGroups, linkGroups, isolated, conflicted };
}
