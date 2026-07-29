/**
 * packetAssembler.ts — Deterministic final dispatch packet with content hash.
 */

import { v4 as uuidv4 } from 'uuid';
import type { NegativeItem, PersonalInfo } from '../types';
import type { CasePlan, DispatchPacket } from '../types/autopilotCase';
import type { GeneratedLetterV2 } from '../types/creditRepair';
import { guardLetterAgainstFabrication } from './antiFabricationGuard';
import { CaseRepository } from './caseRepository';
import { idbGet, idbGetAll, idbSet } from './indexedDB';

function stableHash(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h) ^ input.charCodeAt(i);
  }
  return `pkt_${(h >>> 0).toString(16)}_${input.length.toString(16)}`;
}

function formatReturnAddress(info: PersonalInfo): string {
  const lines = [
    [info.firstName, info.lastName].filter(Boolean).join(' '),
    info.address,
    [info.city, info.state, info.zip].filter(Boolean).join(', '),
  ].filter((l) => l && String(l).trim());
  return lines.join('\n');
}

const DEFAULT_CHECKLIST = [
  'Confirm consumer return address is current',
  'Confirm recipient mailing address',
  'Attach listed evidence documents',
  'Sign letter in ink before mailing',
  'Retain a vault copy and tracking number',
];

export const PacketAssembler = {
  computeContentHash(parts: {
    letterContent: string;
    recipientName: string;
    recipientAddress: string;
    accountReference: string;
    attachmentIds: string[];
    planId: string;
    factVersion: string;
  }): string {
    return stableHash(
      [
        parts.letterContent.trim(),
        parts.recipientName,
        parts.recipientAddress,
        parts.accountReference,
        parts.attachmentIds.slice().sort().join(','),
        parts.planId,
        parts.factVersion,
      ].join('||'),
    );
  },

  async getPacket(id: string): Promise<DispatchPacket | undefined> {
    return idbGet<DispatchPacket>('dispatchPackets', id);
  },

  async getPacketsForCase(caseId: string): Promise<DispatchPacket[]> {
    const all = await idbGetAll<DispatchPacket>('dispatchPackets');
    return all.filter((p) => p.caseId === caseId);
  },

  async assemble(params: {
    profileId: string;
    caseId: string;
    plan: CasePlan;
    letter: Pick<GeneratedLetterV2, 'letterContent' | 'htmlContent' | 'targetName' | 'targetAddress' | 'itemName'> | {
      letterContent: string;
      htmlContent?: string;
      targetName: string;
      targetAddress: string;
      itemName: string;
    };
    item: NegativeItem;
    personalInfo: PersonalInfo;
    attachments?: Array<{ id: string; name: string; category: string }>;
  }): Promise<DispatchPacket> {
    const attachments = params.attachments || [];
    const accountReference =
      params.item.accountNumber || params.item.fullAccountNumber || 'account as shown on report';
    const validationErrors: string[] = [];

    if (!params.letter.letterContent?.trim()) {
      validationErrors.push('Letter content is empty');
    }
    if (/\{\{[A-Z0-9_]+\}\}|\[INSERT[^\]]*\]|TBD_ACCOUNT|FIXME/i.test(params.letter.letterContent || '')) {
      validationErrors.push('Unresolved placeholder tokens present');
    }
    if (!params.letter.targetName?.trim()) {
      validationErrors.push('Missing recipient name');
    }
    if (!params.personalInfo.firstName || !params.personalInfo.address) {
      validationErrors.push('Missing or incomplete consumer identity/return address');
    }

    const fabrication = guardLetterAgainstFabrication({
      letterText: params.letter.letterContent || '',
      item: params.item,
      personalInfo: params.personalInfo,
    });
    for (const finding of fabrication.findings.filter((f) => f.severity === 'block')) {
      validationErrors.push(finding.message);
    }

    const contentHash = this.computeContentHash({
      letterContent: params.letter.letterContent || '',
      recipientName: params.letter.targetName,
      recipientAddress: params.letter.targetAddress || '',
      accountReference,
      attachmentIds: attachments.map((a) => a.id),
      planId: params.plan.id,
      factVersion: params.plan.factVersion,
    });

    const packet: DispatchPacket = {
      id: uuidv4(),
      profileId: params.profileId,
      caseId: params.caseId,
      planId: params.plan.id,
      factVersion: params.plan.factVersion,
      letterContent: params.letter.letterContent || '',
      htmlContent: params.letter.htmlContent,
      recipientName: params.letter.targetName,
      recipientAddress: params.letter.targetAddress || '',
      returnAddress: formatReturnAddress(params.personalInfo),
      accountReference,
      attachments,
      checklist: [...DEFAULT_CHECKLIST],
      trackingPlaceholder: 'USPS_CERTIFIED_PENDING',
      contentHash,
      createdAt: new Date().toISOString(),
      validationErrors,
      status: validationErrors.length === 0 ? 'validated' : 'draft',
    };

    await idbSet('dispatchPackets', packet);
    const c = await CaseRepository.getCase(params.caseId);
    if (c) {
      await CaseRepository.saveCase({
        ...c,
        currentPacketId: packet.id,
        updatedAt: new Date().toISOString(),
      });
      if (validationErrors.length === 0) {
        await CaseRepository.transition(params.caseId, 'VALIDATED', 'autopilot', { packetId: packet.id });
        await CaseRepository.transition(params.caseId, 'USER_APPROVAL', 'autopilot', { packetId: packet.id });
      } else {
        await CaseRepository.transition(params.caseId, 'DRAFTED', 'autopilot', {
          packetId: packet.id,
          validationErrors,
        });
      }
    }

    await CaseRepository.appendEvent({
      profileId: params.profileId,
      caseId: params.caseId,
      type: 'packet.assembled',
      actor: 'autopilot',
      payload: { packetId: packet.id, contentHash, validationErrors },
    });

    return packet;
  },

  async invalidateIfChanged(packetId: string, currentLetterContent: string): Promise<DispatchPacket | undefined> {
    const packet = await this.getPacket(packetId);
    if (!packet) return undefined;
    if (packet.letterContent.trim() === currentLetterContent.trim()) return packet;
    const updated: DispatchPacket = {
      ...packet,
      status: 'invalidated',
      validationErrors: [...packet.validationErrors, 'Content changed after assembly — re-approval required'],
    };
    await idbSet('dispatchPackets', updated);
    return updated;
  },
};
