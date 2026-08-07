/**
 * User Profile Service
 * Manages multiple consumer profiles (e.g., you + fiancée each in their own dispute campaign).
 * Profiles are persisted in IndexedDB `userProfiles` store.
 */

import { saveUserProfile, getAllUserProfiles, getUserProfile, getDefaultProfile, deleteUserProfile } from './indexedDB';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface UserProfile {
  id: string;
  isDefault: boolean;
  createdAt: string; // ISO
  updatedAt: string; // ISO

  // Personal info
  firstName: string;
  lastName: string;
  middleName?: string;
  suffix?: string;
  dateOfBirth: string; // YYYY-MM-DD
  ssn?: string; // ENCRYPTED — never store plaintext, handled by secureKeyService
  ssnLast4?: string; // Safe to store — used for letter verification blocks

  // Contact
  address: string;
  aptUnit?: string;
  city: string;
  state: string; // 2-letter code
  zip: string;
  phone?: string;
  email?: string;

  // Previous addresses (bureaus want 2 years)
  previousAddresses?: Array<{
    address: string;
    city: string;
    state: string;
    zip: string;
    fromYear: number;
    toYear: number;
  }>;

  // Dispute tracking
  activeDisputeCampaignId?: string;
  totalNegativeItems: number;
  totalDeleted: number;
  currentScores: {
    equifax?: number;
    experian?: number;
    transunion?: number;
    lastUpdated?: string;
  };
  targetScore?: number;

  // Display
  avatarColor: string; // Tailwind bg color class
  nickname?: string; // "Dylan" or "Jessica" for quick switching
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

const AVATAR_COLORS = [
  'bg-blue-600', 'bg-purple-600', 'bg-pink-600', 'bg-emerald-600',
  'bg-orange-600', 'bg-red-600', 'bg-teal-600', 'bg-indigo-600',
];

function generateId(): string {
  return `profile_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function randomAvatarColor(): string {
  return AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
}

export function createEmptyProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  const now = new Date().toISOString();
  return {
    id: generateId(),
    isDefault: false,
    createdAt: now,
    updatedAt: now,
    firstName: '',
    lastName: '',
    dateOfBirth: '',
    address: '',
    city: '',
    state: '',
    zip: '',
    totalNegativeItems: 0,
    totalDeleted: 0,
    currentScores: {},
    avatarColor: randomAvatarColor(),
    ...overrides,
  };
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class UserProfileService {
  private static _activeProfileId: string | null = null;
  private static _profileCache: Map<string, UserProfile> = new Map();

  /** Save or update a profile */
  static async save(profile: UserProfile): Promise<void> {
    profile.updatedAt = new Date().toISOString();
    this._profileCache.set(profile.id, profile);
    await saveUserProfile(profile as unknown as import('./indexedDB').UserProfileRecord);
  }

  /** Get all profiles, sorted: default first, then by name */
  static async getAll(): Promise<UserProfile[]> {
    const raw = await getAllUserProfiles() as unknown as UserProfile[];
    const profiles = raw ?? [];
    return profiles.sort((a, b) => {
      if (a.isDefault && !b.isDefault) return -1;
      if (!a.isDefault && b.isDefault) return 1;
      return `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`);
    });
  }

  /** Get a specific profile by ID */
  static async get(id: string): Promise<UserProfile | undefined> {
    if (this._profileCache.has(id)) return this._profileCache.get(id);
    return getUserProfile(id) as unknown as UserProfile | undefined;
  }

  /** Get the default profile */
  static async getDefault(): Promise<UserProfile | undefined> {
    return getDefaultProfile() as unknown as UserProfile | undefined;
  }

  /** Set a profile as the active (in-session) profile */
  static setActiveProfile(id: string): void {
    this._activeProfileId = id;
  }

  /** Get the current active profile ID */
  static getActiveProfileId(): string | null {
    return this._activeProfileId;
  }

  /** Get the active profile object */
  static async getActiveProfile(): Promise<UserProfile | undefined> {
    if (this._activeProfileId) {
      return this.get(this._activeProfileId);
    }
    return this.getDefault();
  }

  /** Make a profile the default (and unset all others) */
  static async setDefault(profileId: string): Promise<void> {
    const all = await this.getAll();
    for (const p of all) {
      p.isDefault = p.id === profileId;
      await this.save(p);
    }
    this._activeProfileId = profileId;
  }

  /** Delete a profile (cannot delete if it's the only profile) */
  static async delete(profileId: string): Promise<{ success: boolean; reason?: string }> {
    const all = await this.getAll();
    if (all.length <= 1) {
      return { success: false, reason: 'Cannot delete the only profile.' };
    }
    await deleteUserProfile(profileId);
    this._profileCache.delete(profileId);
    if (this._activeProfileId === profileId) {
      // Switch to the default
      const remaining = all.filter(p => p.id !== profileId);
      const newDefault = remaining.find(p => p.isDefault) ?? remaining[0];
      this._activeProfileId = newDefault?.id ?? null;
    }
    return { success: true };
  }

  /** Update score data for a profile */
  static async updateScores(
    profileId: string,
    scores: { equifax?: number; experian?: number; transunion?: number }
  ): Promise<void> {
    const profile = await this.get(profileId);
    if (!profile) return;
    profile.currentScores = {
      ...profile.currentScores,
      ...scores,
      lastUpdated: new Date().toISOString(),
    };
    await this.save(profile);
  }

  /** Increment deletion counter for a profile */
  static async recordDeletion(profileId: string): Promise<void> {
    const profile = await this.get(profileId);
    if (!profile) return;
    profile.totalDeleted = (profile.totalDeleted ?? 0) + 1;
    await this.save(profile);
  }

  /** Get display name (nickname or first + last) */
  static getDisplayName(profile: UserProfile): string {
    return (profile.nickname ?? `${profile.firstName} ${profile.lastName}`.trim()) || 'Unnamed Profile';
  }

  /** Get initials for avatar */
  static getInitials(profile: UserProfile): string {
    const first = profile.firstName?.[0] ?? '';
    const last = profile.lastName?.[0] ?? '';
    return (first + last).toUpperCase() || '?';
  }

  /** Format mailing address for letters */
  static formatAddress(profile: UserProfile): {
    senderName: string;
    senderAddress: string;
    senderCity: string;
    senderState: string;
    senderZip: string;
    senderPhone?: string;
    senderEmail?: string;
    ssnLast4?: string;
    dateOfBirth?: string;
  } {
    return {
      senderName: `${profile.firstName} ${profile.middleName ? profile.middleName + ' ' : ''}${profile.lastName}${profile.suffix ? ' ' + profile.suffix : ''}`.trim(),
      senderAddress: `${profile.address}${profile.aptUnit ? ', ' + profile.aptUnit : ''}`,
      senderCity: profile.city,
      senderState: profile.state,
      senderZip: profile.zip,
      senderPhone: profile.phone,
      senderEmail: profile.email,
      ssnLast4: profile.ssnLast4,
      dateOfBirth: profile.dateOfBirth,
    };
  }
}

export default UserProfileService;
