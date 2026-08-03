import type { FurnisherAddress } from '../data/furnisherAddresses';
import { saveToFurnisherAddressVault } from '../data/furnisherAddresses';
import { lookupDisputeAddress } from './geminiService';

const PENDING_KEY = 'dylandos_pending_address_research_v1';

export interface PendingAddressResearch {
  creditorName: string;
  candidate: FurnisherAddress;
  researchedAt: string;
  warning: string;
}

function keyFor(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function readPending(): Record<string, PendingAddressResearch> {
  try { return JSON.parse(localStorage.getItem(PENDING_KEY) || '{}'); }
  catch { return {}; }
}

export function getPendingAddressResearch(creditorName: string): PendingAddressResearch | null {
  return readPending()[keyFor(creditorName)] ?? null;
}

export function getAllPendingAddressResearch(): PendingAddressResearch[] {
  return Object.values(readPending()).sort((a, b) => b.researchedAt.localeCompare(a.researchedAt));
}

export function clearPendingAddressResearch(creditorName: string): void {
  try {
    const all = readPending();
    delete all[keyFor(creditorName)];
    localStorage.setItem(PENDING_KEY, JSON.stringify(all));
  } catch { /* non-critical */ }
}

function savePending(record: PendingAddressResearch): void {
  try {
    const all = readPending();
    all[keyFor(record.creditorName)] = record;
    localStorage.setItem(PENDING_KEY, JSON.stringify(all));
    window.dispatchEvent(new CustomEvent('address-research:review-required', { detail: record }));
  } catch { /* localStorage can be unavailable in tests */ }
}

function parseCandidateAddress(value: string): { line1: string; city: string; state: string; zip: string } | null {
  const lines = value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const last = lines.at(-1) ?? '';
  const cityLine = last.match(/^(.+),\s*([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/);
  if (!cityLine || lines.length < 2) return null;
  return { line1: lines.slice(0, -1).join(', '), city: cityLine[1].trim(), state: cityLine[2].toUpperCase(), zip: cityLine[3] };
}

function normalizeType(value?: string): FurnisherAddress['type'] {
  const allowed: FurnisherAddress['type'][] = ['bank','credit_card','auto','student','collection','mortgage','utility','telecom'];
  return allowed.includes(value as FurnisherAddress['type']) ? value as FurnisherAddress['type'] : 'collection';
}

/**
 * Researches an address using AI and saves it to the Address Vault and library.
 */
export const AddressResearchAgent = {
  async searchAndVaultAddress(creditorName: string): Promise<FurnisherAddress | null> {
    console.info(`[AddressResearchAgent] Researching dispute address for "${creditorName}"...`);
    try {
      const result = await lookupDisputeAddress(`${creditorName} official consumer credit reporting dispute mailing address`);
      const parsed = parseCandidateAddress(result.disputeAddress);
      if (!parsed) return null;
      const candidate: FurnisherAddress = {
        name: result.name || creditorName,
        legalName: result.legalName || result.name || creditorName,
        disputeAddress: parsed.line1,
        city: parsed.city,
        state: parsed.state,
        zip: parsed.zip,
        phone: result.phone || '',
        fax: result.fax,
        onlineDisputeUrl: result.onlineDisputeUrl || undefined,
        type: normalizeType(result.type),
      };
      savePending({
        creditorName,
        candidate,
        researchedAt: new Date().toISOString(),
        warning: 'AI-researched address retrieved and added to library.',
      });
      await saveToFurnisherAddressVault(candidate);
      console.info(`[AddressResearchAgent] ✅ AI retrieved and vaulted address for "${creditorName}".`);
      return candidate;
    } catch (error) {
      console.error(`[AddressResearchAgent] Address research failed for "${creditorName}":`, error);
      return null;
    }
  },
};
