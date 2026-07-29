/**
 * approvalService.ts — Content-hash-bound consumer approval.
 * Any content change after approval invalidates the approval.
 */

import { v4 as uuidv4 } from 'uuid';
import type { AutopilotMode, DispatchPacket, PacketApproval } from '../types/autopilotCase';
import { CaseRepository } from './caseRepository';
import { PacketAssembler } from './packetAssembler';
import { idbGetAll, idbSet } from './indexedDB';

export interface ApprovalResult {
  ok: boolean;
  approval?: PacketApproval;
  error?: string;
}

export const ApprovalService = {
  async getApprovalsForPacket(packetId: string): Promise<PacketApproval[]> {
    const all = await idbGetAll<PacketApproval>('packetApprovals');
    return all.filter((a) => a.packetId === packetId);
  },

  async getActiveApproval(packetId: string): Promise<PacketApproval | undefined> {
    const approvals = await this.getApprovalsForPacket(packetId);
    return approvals
      .filter((a) => !a.revokedAt)
      .sort((a, b) => b.approvedAt.localeCompare(a.approvedAt))[0];
  },

  async approvePacket(params: {
    packet: DispatchPacket;
    mode: AutopilotMode;
  }): Promise<ApprovalResult> {
    const { packet, mode } = params;
    if (mode === 'monitor_only') {
      return { ok: false, error: 'Monitor-only mode cannot approve dispatch packets' };
    }
    if (packet.validationErrors.length > 0 || packet.status === 'draft') {
      return { ok: false, error: `Packet failed validation: ${packet.validationErrors.join('; ') || 'incomplete'}` };
    }
    if (packet.status === 'invalidated') {
      return { ok: false, error: 'Packet was invalidated after content change — reassemble first' };
    }

    const live = await PacketAssembler.getPacket(packet.id);
    if (!live) return { ok: false, error: 'Packet not found' };
    if (live.contentHash !== packet.contentHash) {
      return { ok: false, error: 'Content hash mismatch — packet changed since review' };
    }

    const approval: PacketApproval = {
      id: uuidv4(),
      profileId: packet.profileId,
      caseId: packet.caseId,
      packetId: packet.id,
      contentHash: packet.contentHash,
      approvedAt: new Date().toISOString(),
      mode,
    };
    await idbSet('packetApprovals', approval);
    await idbSet('dispatchPackets', { ...live, status: 'approved' satisfies DispatchPacket['status'] });
    await CaseRepository.transition(packet.caseId, 'READY_TO_DISPATCH', 'user', {
      packetId: packet.id,
      approvalId: approval.id,
      contentHash: packet.contentHash,
    });
    await CaseRepository.appendEvent({
      profileId: packet.profileId,
      caseId: packet.caseId,
      type: 'packet.approved',
      actor: 'user',
      payload: { packetId: packet.id, contentHash: packet.contentHash, mode },
    });
    return { ok: true, approval };
  },

  async revokeApproval(approvalId: string): Promise<PacketApproval | undefined> {
    const all = await idbGetAll<PacketApproval>('packetApprovals');
    const existing = all.find((a) => a.id === approvalId);
    if (!existing || existing.revokedAt) return existing;
    const revoked: PacketApproval = { ...existing, revokedAt: new Date().toISOString() };
    await idbSet('packetApprovals', revoked);
    const packet = await PacketAssembler.getPacket(existing.packetId);
    if (packet && packet.status === 'approved') {
      await idbSet('dispatchPackets', { ...packet, status: 'validated' });
    }
    await CaseRepository.transition(existing.caseId, 'USER_APPROVAL', 'user', {
      revokedApprovalId: approvalId,
    });
    return revoked;
  },

  async assertApprovalStillValid(packetId: string): Promise<ApprovalResult> {
    const packet = await PacketAssembler.getPacket(packetId);
    if (!packet) return { ok: false, error: 'Packet not found' };
    const approval = await this.getActiveApproval(packetId);
    if (!approval) return { ok: false, error: 'No active approval' };
    if (approval.contentHash !== packet.contentHash) {
      await this.revokeApproval(approval.id);
      return { ok: false, error: 'Approval invalidated — content hash no longer matches' };
    }
    if (packet.status === 'invalidated') {
      return { ok: false, error: 'Packet invalidated' };
    }
    return { ok: true, approval };
  },
};
