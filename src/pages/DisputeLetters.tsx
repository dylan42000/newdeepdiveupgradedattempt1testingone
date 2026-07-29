import React, { useState, useCallback, useEffect } from "react";
import {
  FileText, Plus, Eye, Download, Trash2, ChevronDown, ChevronUp,
  Printer, Layers, Search, Filter, Globe, RefreshCw, X,
  CheckCircle2, AlertTriangle, Wand2, ClipboardEdit, ExternalLink, ShieldAlert,
  Mail, CheckSquare, Package, AlertCircle,
} from "lucide-react";
import { useAppContext } from "../context/AppContext";
import { DisputeLetter, DisputeRound, LetterTemplateType, NegativeItem } from "../types";
import { generateDisputeLetter, generateTemplatePreview } from "../services/geminiService";
import { smartFillLetter, SmartFillResult, scanForUnfilledTokens } from "../services/placeholderService";
import { assertNoBoilerplate, BoilerplateDetectedException } from "../services/letterValidator";
import type { PassNumber } from "../types/creditRepair";
import { findFurnisherAddress } from "../data/furnisherAddresses";
import { parseBureauAddress, isKnownBureau } from "../services/bureauAddressService";
import { createUniquenessSeed, buildDiversificationDirective, enforceUniqueness } from "../services/letterUniquenessService";
import { buildGroundedContext, validateGrounding } from "../services/letterGroundingService";
import { selectNextAngle } from "../services/disputeAngleRotator";
import { deliverLetterByMailApi, type MailDeliveryRequest } from "../services/mailDeliveryService";
import { buildLetterHTML, getPdfExportMarkup } from "../services/letterTemplateService";
import { stripLetterBodyPreamble } from "../services/letterBodySanitizer";
import { TimelineTracker } from "../services/timelineTracker";
// BUG-06 FIX: Use standalone ValidationModal component instead of inline modal JSX
import { ValidationModal, type ValidationModalState } from "../components/ValidationModal";
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { appendCanvasPagesToPdf } from '../services/pdfCanvasService';
import { enrichTargetAddress } from '../services/preFlightChecker';
import {
  getOpenDisputeResolutionTasks,
  queueDisputeResolutionTask,
  resolveDisputeResolutionTasks,
  type DisputeResolutionTask,
} from '../services/disputeResolutionQueue';
import { printSingleLetter } from '../services/printService';

const TEMPLATE_META: Record<LetterTemplateType, { label: string; law: string; desc: string; color: string }> = {
  "609-Identity": { label: "609 Identity Verification", law: "15 U.S.C. §1681g", desc: "Request all information the bureau holds about you", color: "text-[#00ffff]" },
  "609-Disclosure": { label: "609 Disclosure Request (Round 1)", law: "15 U.S.C. §1681g", desc: "Intelligence gathering — demand full file disclosure before disputing", color: "text-[#00ffff]" },
  "611-Reinvestigation": { label: "611 Reinvestigation", law: "15 U.S.C. §1681i", desc: "Demand bureau reinvestigate disputed item within 30 days", color: "text-blue-400" },
  "623-Furnisher": { label: "623 Furnisher Dispute", law: "15 U.S.C. §1681s-2(b)", desc: "Dispute directly with the data furnisher", color: "text-purple-400" },
  "611a7-MethodOfInvestigation": { label: "611(a)(7) Method", law: "15 U.S.C. §1681i(a)(7)", desc: "Demand exact method of investigation used", color: "text-[#ff9900]" },
  "Goodwill": { label: "Goodwill Adjustment", law: "Creditor Courtesy Request", desc: "Request removal of paid account from goodwill", color: "text-green-400" },
  "PayForDelete": { label: "Pay For Delete", law: "FCRA Negotiation", desc: "Offer payment in exchange for tradeline deletion", color: "text-yellow-400" },
  "CeaseAndDesist": { label: "Cease & Desist", law: "15 U.S.C. §1692c", desc: "Order collector to stop all contact immediately", color: "text-red-400" },
  "DualDispute-BureauFurnisher": { label: "Dual Dispute (Bureau + Furnisher)", law: "15 U.S.C. §1681i + §1681s-2(b)", desc: "Simultaneous dispute to bureau and furnisher", color: "text-[#ff00ff]" },
  "CFPBComplaint": { label: "CFPB Complaint", law: "CFPB Complaint Portal", desc: "Formal complaint to Consumer Financial Protection Bureau", color: "text-red-500" },
  "CFPBComplaintStateAG": { label: "CFPB + State AG (Round 5)", law: "CFPB + State AG", desc: "Dual regulatory escalation to CFPB and State Attorney General", color: "text-red-500" },
  "PreLitigation": { label: "Pre-Litigation Demand (Round 6)", law: "15 U.S.C. §1681n + §1681o", desc: "Final warning before civil suit — §1681n statutory damages", color: "text-red-600" },
  "AggressiveDual": { label: "Aggressive Dual Demand", law: "15 U.S.C. §1681i + §1681s-2(b)", desc: "Maximum legal pressure — bureau and furnisher simultaneously", color: "text-red-400" },
  ReInsertionViolation: { label: "Re-Insertion / Re-Aging Challenge", law: "15 U.S.C. §1681c", desc: "Challenge re-insertion or impermissible re-aging of previously removed or outdated items", color: "text-orange-400" },
};

const BUREAUS = ["Equifax", "Experian", "TransUnion", "Furnisher"] as const;

/** Always rebuild templated HTML from narrative body — never trust stale DOCTYPE dumps. */
function resolveLetterHtml(
  letter: DisputeLetter,
  personalInfo: {
    firstName: string;
    lastName: string;
    address: string;
    city: string;
    state: string;
    zip: string;
    phone: string;
    email: string;
    ssn: string;
    dob: string;
  },
  primaryItem?: NegativeItem,
): string {
  return buildLetterHTML(
    {
      content: stripLetterBodyPreamble(letter.content || ''),
      letterContent: stripLetterBodyPreamble(letter.content || ''),
      targetName: letter.bureau,
      itemName: primaryItem?.creditorName ?? letter.bureau,
      passNumber: letter.round as number,
    },
    {
      firstName: personalInfo.firstName,
      lastName: personalInfo.lastName,
      address: personalInfo.address,
      city: personalInfo.city,
      state: personalInfo.state,
      zip: personalInfo.zip,
      phone: personalInfo.phone,
      email: personalInfo.email,
      ssn: personalInfo.ssn,
      dob: personalInfo.dob,
    },
  );
}

function normalizeLookupKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function parseAddressBlock(addressBlock: string): {
  line1: string;
  city: string;
  state: string;
  zip: string;
  country: "US";
} | null {
  const cleanedLines = (addressBlock || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (cleanedLines.length < 2) return null;

  const line1 = cleanedLines[0];
  const cityStateZip = cleanedLines[cleanedLines.length - 1];
  const match = cityStateZip.match(/^(.+),\s*([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/);

  if (!match) return null;

  return {
    line1,
    city: match[1].trim(),
    state: match[2].toUpperCase(),
    zip: match[3],
    country: "US",
  };
}

export function DisputeLetters() {
  const {
    disputeLetters, negativeItems, personalInfo, addDisputeLetter, removeDisputeLetter, contacts, updateDisputeLetter, autopilot, logEvent, activeProfileId,
  } = useAppContext();

  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<LetterTemplateType>("611-Reinvestigation");
  const [selectedBureau, setSelectedBureau] = useState<string>("Equifax");
  const [selectedFurnisher, setSelectedFurnisher] = useState<string | null>(null);
  const [selectedRound, setSelectedRound] = useState<DisputeRound>(1);
  const [generating, setGenerating] = useState(false);
  const [search, setSearch] = useState("");
  const [previewLetter, setPreviewLetter] = useState<DisputeLetter | null>(null);
  const [previewContent, setPreviewContent] = useState<string>("");
  // BUG-01 FIX: Track whether preview is full HTML (iframe) or plain text (pre)
  const [previewMode, setPreviewMode] = useState<"full-html" | "plain">("plain");
  const [templatePreview, setTemplatePreview] = useState<string | null>(null);
  const [templatePreviewType, setTemplatePreviewType] = useState<LetterTemplateType | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [fillResult, setFillResult] = useState<SmartFillResult | null>(null);
  const [showFillReport, setShowFillReport] = useState(false);
  const [manualOverrides, setManualOverrides] = useState<Record<string, string>>({});
  const [validationModal, setValidationModal] = useState<ValidationModalState | null>(null);
  const [regeneratingLetterId, setRegeneratingLetterId] = useState<string | null>(null);
  const [recoveryTasks, setRecoveryTasks] = useState<DisputeResolutionTask[]>(() =>
    getOpenDisputeResolutionTasks(activeProfileId || 'default'),
  );
  // regenRegenerating is now managed inside ValidationModal component

  useEffect(() => {
    const refresh = () => setRecoveryTasks(getOpenDisputeResolutionTasks(activeProfileId || 'default'));
    refresh();
    window.addEventListener('dispute-resolution-queue:changed', refresh);
    return () => window.removeEventListener('dispute-resolution-queue:changed', refresh);
  }, [activeProfileId]);

  const resolveTargetAddress = useCallback((targetName: string): string => {
    // Issue 3 Fix: Check the verified 2026 bureau address service first
    if (isKnownBureau(targetName)) {
      const addr = parseBureauAddress(targetName);
      return `${addr.fullName}\n${addr.department}\n${addr.line1}\n${addr.city}, ${addr.state} ${addr.zip}`;
    }

    const normalizedTarget = normalizeLookupKey(targetName || "");

    const savedMatch = contacts.find((c) => {
      const normalizedContact = normalizeLookupKey(c.name || "");
      return (
        normalizedContact === normalizedTarget ||
        normalizedContact.includes(normalizedTarget) ||
        normalizedTarget.includes(normalizedContact)
      );
    });

    if (savedMatch?.address) {
      return savedMatch.address;
    }

    const localMatch = findFurnisherAddress(targetName);
    if (localMatch) {
      return `${localMatch.legalName}\n${localMatch.disputeAddress}\n${localMatch.city}, ${localMatch.state} ${localMatch.zip}`;
    }

    return "";
  }, [contacts]);

  const prepareLetterForExport = useCallback((letter: DisputeLetter): { isValid: boolean; content: string; errors: string[]; warnings: string[] } => {
    const primaryItem = negativeItems.find((i) => letter.negativeItemIds.includes(i.id)) || null;
    const fill = smartFillLetter(letter.content, personalInfo, primaryItem, letter.bureau, contacts, letter.round);

    if (fill.filled !== letter.content) {
      updateDisputeLetter(letter.id, { content: fill.filled });
    }

    const errors: string[] = [];
    const warnings: string[] = [];

    const requiredRemaining = fill.remaining.filter((r) => r.required);
    if (requiredRemaining.length > 0) {
      errors.push(...requiredRemaining.map((r) => `Missing required placeholder value: ${r.label} (${r.placeholder})`));
    }

    if (fill.unresolvedTokens.length > 0) {
      const tokenPreview = fill.unresolvedTokens.slice(0, 8).join(", ");
      errors.push(`Unresolved placeholders remain in letter: ${tokenPreview}${fill.unresolvedTokens.length > 8 ? ", ..." : ""}`);
    }

    const targetAddress = resolveTargetAddress(letter.bureau);
    if (!targetAddress) {
      errors.push(`Target address for "${letter.bureau}" is missing. Add it in Address Book before export.`);
    }

    const validation = { isValid: true, errors: [] as string[], warnings: [] as string[] };
    try {
      assertNoBoilerplate(fill.filled);
    } catch (e) {
      if (e instanceof BoilerplateDetectedException) {
        validation.isValid = false;
        validation.errors.push(e.message);
      } else {
        validation.isValid = false;
        validation.errors.push(String(e));
      }
    }

    if (!validation.isValid) {
      errors.push(...validation.errors);
    }
    warnings.push(...validation.warnings);

    const ssnDigits = (personalInfo.ssn || "").replace(/\D/g, "");
    const ssnLast4 = ssnDigits.length >= 4 ? ssnDigits.slice(-4) : "____";
    const senderName = `${personalInfo.firstName || ""} ${personalInfo.lastName || ""}`.trim() || "[Consumer Name]";
    const recipient = targetAddress || `[${letter.bureau} Address]`;
    const formattedContent = [
      senderName,
      personalInfo.address || "[Address]",
      `${personalInfo.city || "[City]"}, ${personalInfo.state || "[State]"} ${personalInfo.zip || "[ZIP]"}`,
      personalInfo.phone || "[Phone]",
      personalInfo.email || "[Email]",
      `Date of Birth: ${personalInfo.dob || "[DOB]"}`,
      `SSN: XXX-XX-${ssnLast4}`,
      "",
      new Date().toLocaleDateString(),
      "",
      letter.bureau,
      recipient,
      "",
      `RE: ${primaryItem?.creditorName || "Disputed Account"} | Round ${letter.round}`,
      "",
      fill.filled.trim(),
    ].join("\n");

    return {
      isValid: errors.length === 0,
      content: formattedContent,
      errors: [...new Set(errors)],
      warnings: [...new Set(warnings)],
    };
  }, [negativeItems, personalInfo, contacts, resolveTargetAddress, updateDisputeLetter]);

  const toggleItem = (id: string) =>
    setSelectedItems((prev) => prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]);

  /**
   * Failed work is never discarded. Load its exact account/target back into the
   * forge so the user can review the template and round, then submit it again.
   */
  const loadRecoveryTask = useCallback((task: DisputeResolutionTask) => {
    const item = negativeItems.find(candidate => candidate.id === task.itemId);
    if (!item) {
      setValidationModal({
        letterId: task.id,
        errors: ['The original negative item is no longer in this profile. Restore or re-import it before retrying.'],
        warnings: [],
      });
      return;
    }
    setSelectedItems([task.itemId]);
    const target = task.targetName || 'Equifax';
    if (isKnownBureau(target)) {
      setSelectedBureau(target);
      setSelectedFurnisher(null);
    } else {
      setSelectedBureau('Furnisher');
      setSelectedFurnisher(target);
    }
    const savedRound = Number(item.disputeRound);
    if ([1, 2, 3, 4, 5, 6].includes(savedRound)) setSelectedRound(savedRound as DisputeRound);
    window.setTimeout(() => document.getElementById('letter-composer')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  }, [negativeItems]);

  const handleGenerate = useCallback(async () => {
    if (selectedItems.length === 0) return;
    setGenerating(true);
    setFillResult(null);
    setShowFillReport(false);
    setManualOverrides({});
    const items = negativeItems.filter((i) => selectedItems.includes(i.id));
    const mapped = {
      name: `${personalInfo.firstName} ${personalInfo.lastName}`.trim(),
      address: `${personalInfo.address}, ${personalInfo.city}, ${personalInfo.state} ${personalInfo.zip}`,
      ssn: personalInfo.ssn,
      dob: personalInfo.dob,
    };
    const targetBureau = selectedBureau === "Furnisher"
      ? (selectedFurnisher || "Furnisher")
      : selectedBureau;
    try {
      const primaryItem = items[0] ?? null;
      if (!primaryItem) {
        throw new Error("No item selected for letter generation.");
      }

      const currentTargetAddress = resolveTargetAddress(targetBureau);
      if (!isKnownBureau(targetBureau)) {
        const addressGate = await enrichTargetAddress(currentTargetAddress, targetBureau);
        if (addressGate.status === 'blocked') throw new Error(addressGate.errorMessage);
      }

      const priorLettersForItem = disputeLetters.filter(
        (letter) => letter.negativeItemIds.includes(primaryItem.id) && letter.bureau === targetBureau,
      );

      const priorAngles = priorLettersForItem
        .map((letter) => letter.selectedDisputeAngle)
        .filter((angle): angle is string => Boolean(angle));

      const selectedAngle = selectNextAngle(primaryItem, priorAngles, selectedRound);
      const uniquenessSeed = createUniquenessSeed(primaryItem, priorLettersForItem.length);
      const groundingContext = buildGroundedContext(primaryItem);

      const extraInstructions = [
        `Dispute angle code: ${selectedAngle.code}.`,
        `Dispute angle legal basis: ${selectedAngle.legalBasis}.`,
        `Dispute angle writing focus: ${selectedAngle.promptAngle}`,
        buildDiversificationDirective(uniquenessSeed),
        groundingContext.groundingDirective,
        `Allowed facts JSON: ${JSON.stringify(groundingContext.allowedFacts)}`,
      ].join("\n");

      let rewriteAttempts = 0;
      let rawContent = await generateDisputeLetter(
        items,
        mapped,
        selectedTemplate,
        targetBureau,
        selectedRound,
        extraInstructions,
      );

      let uniquenessReport = enforceUniqueness(rawContent, priorLettersForItem, primaryItem);

      while (uniquenessReport.rewriteRequired && rewriteAttempts < 2) {
        rewriteAttempts += 1;
        rawContent = await generateDisputeLetter(
          items,
          mapped,
          selectedTemplate,
          targetBureau,
          selectedRound,
          `${extraInstructions}\nThis draft is too similar to prior letters. Rewrite with a distinctly different paragraph structure and opening strategy.`,
        );
        uniquenessReport = enforceUniqueness(rawContent, priorLettersForItem, primaryItem);
      }

      const groundingValidation = validateGrounding(rawContent, primaryItem);
      if (!groundingValidation.passed) {
        const findings = groundingValidation.suspectedHallucinations
          .map((finding) => `${finding.severity}: ${finding.reason} (${finding.text})`)
          .slice(0, 8);
        setValidationModal({
          letterId: `draft-${Date.now()}`,
          errors: [
            "Grounding validation failed. The generated draft referenced data not confirmed in the selected tradeline.",
            ...findings,
          ],
          warnings: ["Regenerate after updating account facts or choose a different template."],
        });
        return;
      }

      // ── Smart Fill: auto-resolve all placeholders ──
      const fillResRaw = smartFillLetter(rawContent, personalInfo, primaryItem, targetBureau, contacts, selectedRound);
      const fillRes = {
        ...fillResRaw,
        filled: stripLetterBodyPreamble(fillResRaw.filled),
      };
      setFillResult(fillRes);
      setShowFillReport(true);

      let mailResult: Awaited<ReturnType<typeof deliverLetterByMailApi>> | null = null;
      if (autopilot.autoMailOnGeneration) {
        const recipientAddressText = resolveTargetAddress(targetBureau);
        const parsedRecipientAddress = parseAddressBlock(recipientAddressText);

        if (parsedRecipientAddress) {
          const mailRequest: MailDeliveryRequest = {
            letterId: `letter-${Date.now()}`,
            recipientName: targetBureau,
            recipientAddress: parsedRecipientAddress,
            senderAddress: {
              firstName: personalInfo.firstName,
              lastName: personalInfo.lastName,
              address: personalInfo.address,
              city: personalInfo.city,
              state: personalInfo.state,
              zip: personalInfo.zip,
            },
            letterHtml: fillRes.filled,
            certifiedMail: autopilot.certifiedMailDefault,
            expectedDeliveryDays: 7,
          };

          mailResult = await deliverLetterByMailApi(mailRequest, autopilot.mailDeliveryProvider);
        }
      }

      const letterId = `letter-${Date.now()}`;
      const letter: DisputeLetter = {
        id: letterId,
        bureau: targetBureau,
        round: selectedRound,
        templateType: selectedTemplate,
        createdAt: new Date().toISOString(),
        negativeItemIds: items.map((i) => i.id),
        content: fillRes.filled,   // store the already-filled version
        htmlContent: buildLetterHTML({
          content: fillRes.filled,
          personalInfo: {
            firstName: personalInfo.firstName,
            lastName: personalInfo.lastName,
            address: personalInfo.address,
            city: personalInfo.city,
            state: personalInfo.state,
            zip: personalInfo.zip,
            phone: personalInfo.phone,
            email: personalInfo.email,
            ssn: personalInfo.ssn,
            dob: personalInfo.dob,
          },
          items,
          bureau: targetBureau,
          round: selectedRound as number,
          templateType: selectedTemplate,
          certifiedMail: autopilot.certifiedMailDefault,
          passNumber: selectedRound as number,
          totalPasses: 6,
        }),
        letterVersion: 'v1' as const,
        status: mailResult?.success ? "Sent" : "Draft",
        batchId: null,
        selectedDisputeAngle: selectedAngle.code,
        similarityScore: uniquenessReport.closestMatchScore,
        uniquenessFingerprint: uniquenessReport.uniquenessHash,
        rewriteAttempts,
        aiProviderUsed: "unknown",
        certifiedMail: autopilot.certifiedMailDefault,
        mailDeliveryProvider: mailResult?.provider || autopilot.mailDeliveryProvider,
        mailDeliveryId: mailResult?.mailId,
        mailSentAt: mailResult?.success ? new Date().toISOString() : null,
        mailCostCents: mailResult?.costCents ?? null,
        mailed: Boolean(mailResult?.success),
        mailedAt: mailResult?.success ? new Date().toISOString() : null,
        trackingNumber: mailResult?.trackingNumber,
      };
      addDisputeLetter(letter);
      for (const item of items) resolveDisputeResolutionTasks(activeProfileId || 'default', item.id, targetBureau);

      logEvent({
        type: "letter_generated",
        title: "Dispute Letter Generated",
        detail: `Generated ${selectedTemplate} for ${targetBureau} with angle ${selectedAngle.code}`,
        itemId: primaryItem.id,
        letterId,
        bureau: targetBureau,
        round: selectedRound,
      });

      if (mailResult?.success) {
        const targetType = targetBureau === "Furnisher" ? "furnisher" : "bureau";
        for (const item of items) {
          TimelineTracker.addDeadline({
            profileId: activeProfileId || "default",
            itemId: item.id,
            itemName: item.creditorName,
            bureau: targetBureau,
            passNumber: selectedRound as PassNumber,
            letterSentDate: letter.mailedAt || new Date().toISOString(),
            targetType,
            sourceEventId: mailResult.mailId,
            deliveryProof: mailResult.trackingNumber,
          });
        }
        logEvent({
          type: "letter_sent",
          title: "Letter Submitted To Mail Provider",
          detail: `${mailResult.provider.toUpperCase()} queued letter ${mailResult.mailId}`,
          itemId: primaryItem.id,
          letterId,
          bureau: targetBureau,
          round: selectedRound,
        });
      }
    } catch (err: any) {
      console.error("Letter gen failed:", err);
      const message = err?.message || "Letter generation failed. Check your API keys in Settings → AI Configuration.";
      const reason = /address|Address Vault|Address Lookup/i.test(message)
        ? 'address_verification'
        : /AI_RATE_LIMIT|cooling down|rate limit/i.test(message)
          ? 'ai_capacity'
          : /validation|grounding/i.test(message) ? 'validation_failure' : 'generation_failure';
      for (const item of items) {
        queueDisputeResolutionTask({
          profileId: activeProfileId || 'default', itemId: item.id, creditorName: item.creditorName,
          targetName: targetBureau, targetType: isKnownBureau(targetBureau) ? 'bureau' : 'furnisher',
          reason, message, retryable: reason !== 'validation_failure',
          retryAfter: reason === 'ai_capacity' ? new Date(Date.now() + 60_000).toISOString() : undefined,
        });
      }
      // Surface the real error to the user — never silently swallow an LLM failure.
      // The ValidationModal is already wired up for this purpose.
      setValidationModal({
        letterId: `error-${Date.now()}`,
        errors: [
          message,
        ],
        warnings: [
          "Groq/Gemini rate limits remain queued through their cooldown window. No generic fallback letter will be saved. Check AI Configuration if both providers remain unavailable.",
        ],
      });
    }
    setGenerating(false);
    setSelectedItems([]);
  }, [
    selectedItems,
    selectedTemplate,
    selectedBureau,
    selectedFurnisher,
    selectedRound,
    negativeItems,
    personalInfo,
    contacts,
    autopilot,
    disputeLetters,
    addDisputeLetter,
    logEvent,
    resolveTargetAddress,
  ]);

  /** Apply manual overrides to the most-recently-generated letter */
  const handleApplyOverrides = useCallback(() => {
    if (!fillResult || Object.keys(manualOverrides).length === 0) return;
    const lastLetter = disputeLetters[disputeLetters.length - 1];
    if (!lastLetter) return;
    let updatedContent = lastLetter.content;
    for (const [token, value] of Object.entries(manualOverrides)) {
      if (value.trim()) {
        updatedContent = updatedContent.replace(new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), value.trim());
      }
    }
    // Re-scan after overrides
    const newFill = smartFillLetter(updatedContent, personalInfo, null, lastLetter.bureau, contacts, lastLetter.round);
    setFillResult(newFill);
    updateDisputeLetter(lastLetter.id, { content: newFill.filled });
  }, [fillResult, manualOverrides, disputeLetters, personalInfo, contacts, updateDisputeLetter]);

  const handlePreviewTemplate = useCallback(async (type: LetterTemplateType) => {
    if (templatePreviewType === type) { setTemplatePreview(null); setTemplatePreviewType(null); return; }
    setLoadingPreview(true);
    setTemplatePreviewType(type);
    const mapped = {
      name: `${personalInfo.firstName} ${personalInfo.lastName}`.trim() || "John Doe",
      address: `${personalInfo.address || "123 Main St"}, ${personalInfo.city || "City"}, ${personalInfo.state || "ST"} ${personalInfo.zip || "00000"}`,
      ssn: personalInfo.ssn || "XXX-XX-XXXX",
      dob: personalInfo.dob || "1990-01-01",
    };
    try {
      const preview = await generateTemplatePreview(type, mapped);
      setTemplatePreview(preview);
    } catch { setTemplatePreview("Preview unavailable."); }
    setLoadingPreview(false);
  }, [personalInfo, templatePreviewType]);

  const exportPDF = async (letter: DisputeLetter) => {
    const prepared = prepareLetterForExport(letter);
    if (!prepared.isValid) {
      setValidationModal({ letterId: letter.id, errors: prepared.errors, warnings: prepared.warnings });
      return;
    }

    const primaryItem = negativeItems.find(i => letter.negativeItemIds.includes(i.id));
    const html = resolveLetterHtml(letter, personalInfo, primaryItem);

    // ── SINGLE CANVAS KILLSHOT ─────────────────────────────────────────────
    // One screenshot → one image → one jsPDF page. No pagination algorithm.
    const cloneDiv = document.createElement('div');
    cloneDiv.innerHTML = getPdfExportMarkup(html);
    cloneDiv.style.cssText = [
      'position:fixed',
      'top:0',
      'left:0',
      'width:816px',
      'background:#fff',
      'z-index:-9999',
      'overflow:visible',
      'pointer-events:none',
    ].join(';');
    document.body.appendChild(cloneDiv);

    try {
      const canvas = await html2canvas(cloneDiv, {
        scale: 2,
        useCORS: true,
        scrollY: 0,
        windowWidth: 816,
      });

      const pdf = new jsPDF({ orientation: 'portrait', unit: 'in', format: 'letter' });
      appendCanvasPagesToPdf(pdf, canvas);

      pdf.save(`dispute-${letter.bureau}-round${letter.round}-${letter.createdAt?.slice(0, 10) ?? 'draft'}.pdf`);
    } finally {
      if (document.body.contains(cloneDiv)) {
        document.body.removeChild(cloneDiv);
      }
    }
  };

  const reprintLetter = async (letter: DisputeLetter) => {
    const prepared = prepareLetterForExport(letter);
    if (!prepared.isValid) {
      setValidationModal({ letterId: letter.id, errors: prepared.errors, warnings: prepared.warnings });
      return;
    }
    const item = negativeItems.find(candidate => letter.negativeItemIds.includes(candidate.id));
    if (!item) {
      setValidationModal({ letterId: letter.id, errors: ['The source negative item for this letter is no longer available.'], warnings: [] });
      return;
    }
    const target = resolveTargetAddress(letter.bureau);
    const lines = target.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const cityMatch = (lines.at(-1) ?? '').match(/^(.+),\s*([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/);
    if (!cityMatch) {
      setValidationModal({ letterId: letter.id, errors: [`The saved address for ${letter.bureau} is incomplete. Verify it in Address Book before reprinting.`], warnings: [] });
      return;
    }
    const addressLines = lines.slice(0, -1);
    if (addressLines.length > 1 && !/\d/.test(addressLines[0])) addressLines.shift();
    const filled = smartFillLetter(letter.content, personalInfo, item, letter.bureau, contacts, letter.round).filled;
    await printSingleLetter({
      letter: { ...letter, content: filled },
      item,
      personalInfo,
      bureauAddress: { name: letter.bureau, address: addressLines.join(', '), city: cityMatch[1], state: cityMatch[2].toUpperCase(), zip: cityMatch[3] },
    });
  };

  const regenerateSavedDraft = async (letter: DisputeLetter) => {
    setRegeneratingLetterId(letter.id);
    try {
      const items = negativeItems.filter(item => letter.negativeItemIds.includes(item.id));
      const primaryItem = items[0];
      if (!primaryItem) throw new Error('The source negative item for this draft is no longer available.');

      const targetAddress = resolveTargetAddress(letter.bureau);
      if (!isKnownBureau(letter.bureau)) {
        const addressGate = await enrichTargetAddress(targetAddress, letter.bureau);
        if (addressGate.status === 'blocked') throw new Error(addressGate.errorMessage);
      }

      const mapped = {
        name: `${personalInfo.firstName} ${personalInfo.lastName}`.trim(),
        address: `${personalInfo.address}, ${personalInfo.city}, ${personalInfo.state} ${personalInfo.zip}`,
        ssn: personalInfo.ssn,
        dob: personalInfo.dob,
      };
      const groundingContext = buildGroundedContext(primaryItem);
      const raw = await generateDisputeLetter(
        items,
        mapped,
        letter.templateType,
        letter.bureau,
        letter.round,
        [
          'Replace the saved draft with a complete, account-specific AI letter. Do not summarize or use a generic fallback template.',
          groundingContext.groundingDirective,
          `Allowed facts JSON: ${JSON.stringify(groundingContext.allowedFacts)}`,
        ].join('\n'),
      );
      const groundingValidation = validateGrounding(raw, primaryItem);
      if (!groundingValidation.passed) {
        throw new Error('The replacement draft failed factual grounding validation. The original draft was left unchanged.');
      }
      const filled = stripLetterBodyPreamble(
        smartFillLetter(raw, personalInfo, primaryItem, letter.bureau, contacts, letter.round).filled,
      );
      const htmlContent = buildLetterHTML({
        content: filled,
        personalInfo: {
          firstName: personalInfo.firstName, lastName: personalInfo.lastName,
          address: personalInfo.address, city: personalInfo.city, state: personalInfo.state, zip: personalInfo.zip,
          phone: personalInfo.phone, email: personalInfo.email, ssn: personalInfo.ssn, dob: personalInfo.dob,
        },
        items,
        bureau: letter.bureau,
        round: letter.round as number,
        templateType: letter.templateType,
        certifiedMail: letter.certifiedMail,
        passNumber: letter.round as number,
        totalPasses: 6,
      });
      updateDisputeLetter(letter.id, { content: filled, htmlContent, letterVersion: 'v2', status: 'Draft' });
      if (previewLetter?.id === letter.id) {
        setPreviewLetter({ ...letter, content: filled, htmlContent, letterVersion: 'v2', status: 'Draft' });
        setPreviewContent(htmlContent);
        setPreviewMode('full-html');
      }
    } catch (error) {
      setValidationModal({
        letterId: letter.id,
        errors: [error instanceof Error ? error.message : String(error)],
        warnings: ['The saved draft was not changed. Groq/Gemini jobs wait in the queue during temporary rate limits.'],
      });
    } finally {
      setRegeneratingLetterId(null);
    }
  };

  const batchExportPDF = async () => {
    const invalid: { letterId: string; errors: string[]; warnings: string[] }[] = [];
    const readyLetters: Array<{ letter: DisputeLetter; content: string }> = [];

    for (const letter of filteredLetters) {
      const prepared = prepareLetterForExport(letter);
      if (!prepared.isValid) {
        invalid.push({ letterId: letter.id, errors: prepared.errors, warnings: prepared.warnings });
      } else {
        readyLetters.push({ letter, content: prepared.content });
      }
    }

    if (invalid.length > 0) {
      const first = invalid[0];
      const groupedErrors = invalid.flatMap((entry) => entry.errors.map((err) => `[${entry.letterId.slice(0, 8)}] ${err}`));
      const groupedWarnings = invalid.flatMap((entry) => entry.warnings.map((warn) => `[${entry.letterId.slice(0, 8)}] ${warn}`));
      setValidationModal({ letterId: first.letterId, errors: groupedErrors, warnings: groupedWarnings });
      return;
    }

    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();

    // \u2500\u2500 SINGLE CANVAS KILLSHOT (batch) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    // Each letter is independently screenshotted and saved as a PDF blob.
    for (const { letter } of readyLetters) {
      const primaryItem = negativeItems.find(i => letter.negativeItemIds.includes(i.id));
      const html = resolveLetterHtml(letter, personalInfo, primaryItem);

      const cloneDiv = document.createElement('div');
      cloneDiv.innerHTML = getPdfExportMarkup(html);
      cloneDiv.style.cssText = [
        'position:fixed',
        'top:0',
        'left:0',
        'width:816px',
        'background:#fff',
        'z-index:-9999',
        'overflow:visible',
        'pointer-events:none',
      ].join(';');
      document.body.appendChild(cloneDiv);

      try {
        const canvas = await html2canvas(cloneDiv, {
          scale: 2,
          useCORS: true,
          scrollY: 0,
          windowWidth: 816,
        });

        const pdf = new jsPDF({ orientation: 'portrait', unit: 'in', format: 'letter' });
        appendCanvasPagesToPdf(pdf, canvas);

        // Use output('blob') \u2014 NOT .save() \u2014 we are zipping, not downloading directly
        const pdfBlob = pdf.output('blob');
        zip.file(`${letter.bureau}-Round${letter.round}-${letter.id.slice(0, 8)}.pdf`, pdfBlob);
      } finally {
        if (document.body.contains(cloneDiv)) {
          document.body.removeChild(cloneDiv);
        }
      }
    }

    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `dispute-letters-batch-${Date.now()}.zip`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const filteredLetters = disputeLetters.filter((l) =>
    l.bureau?.toLowerCase().includes(search.toLowerCase()) ||
    l.templateType?.toLowerCase().includes(search.toLowerCase()) ||
    l.content.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
          <FileText className="text-[#00ffff]" /> DISPUTE LETTER FORGE
        </h2>
        <p className="text-zinc-400 font-mono text-xs mt-1">{disputeLetters.length} LETTER(S) — 7 LEGAL TEMPLATES</p>
      </div>

      {recoveryTasks.length > 0 && (
        <section className="cyber-panel border-amber-700/50 bg-amber-950/20 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
            <div>
              <h3 className="text-sm font-bold text-amber-200 flex items-center gap-2"><AlertTriangle size={15} /> FAILED LETTER RECOVERY</h3>
              <p className="text-[11px] text-zinc-400 mt-1">These letters were not saved or mailed. Load one back into the forge, confirm its round/template, then submit it again.</p>
            </div>
            <span className="text-xs font-mono text-amber-200 border border-amber-700/50 px-2 py-1 rounded">{recoveryTasks.length} TO RECOVER</span>
          </div>
          <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
            {recoveryTasks.map(task => (
              <div key={task.id} className="rounded border border-amber-900/70 bg-black/20 px-3 py-2.5 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-bold text-zinc-100">{task.creditorName}{task.targetName ? ` → ${task.targetName}` : ''}</div>
                  <div className="text-[10px] font-mono text-amber-300 uppercase mt-0.5">{task.reason.replace('_', ' ')}</div>
                  <p className="text-[10px] text-zinc-500 mt-1 break-words">{task.message}</p>
                  {task.retryAfter && <p className="text-[10px] text-zinc-600 mt-1">Provider retry window: {new Date(task.retryAfter).toLocaleTimeString()}</p>}
                </div>
                <button onClick={() => loadRecoveryTask(task)}
                  className="cyber-button shrink-0 text-[10px] border-amber-500 text-amber-200 px-3 py-1.5 hover:bg-amber-500/10 flex items-center gap-1">
                  <RefreshCw size={11} /> LOAD FOR RETRY
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Template Library */}
      <div id="letter-composer" className="cyber-panel p-6">
        <h3 className="text-sm font-bold text-zinc-400 mb-4">SELECT TEMPLATE</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2 mb-4">
          {(Object.entries(TEMPLATE_META) as [LetterTemplateType, typeof TEMPLATE_META[LetterTemplateType]][]).map(([type, meta]) => (
            <div key={type}
              onClick={() => setSelectedTemplate(type)}
              className={`p-3 rounded border cursor-pointer transition-all ${selectedTemplate === type ? "border-[#00ffff] bg-[#00ffff]/5" : "border-zinc-800 bg-[#0a0a0a] hover:border-zinc-700"}`}>
              <div className="flex items-center justify-between">
                <div className={`text-xs font-bold ${meta.color}`}>{meta.label}</div>
                <button
                  onClick={(e) => { e.stopPropagation(); handlePreviewTemplate(type); }}
                  className="text-[9px] text-zinc-600 hover:text-[#ff9900] border border-zinc-800 px-1.5 py-0.5 rounded">
                  {loadingPreview && templatePreviewType === type ? "..." : "PREVIEW"}
                </button>
              </div>
              <div className="text-[10px] text-zinc-600 font-mono mt-0.5">{meta.law}</div>
              <div className="text-[10px] text-zinc-500 mt-1">{meta.desc}</div>
            </div>
          ))}
        </div>

        {/* Template preview pane */}
        {templatePreview && templatePreviewType && (
          <div className="border border-[#ff9900]/30 bg-[#050505] rounded-lg p-4 mb-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-[#ff9900]">TEMPLATE PREVIEW — {TEMPLATE_META[templatePreviewType].label}</span>
              <button onClick={() => { setTemplatePreview(null); setTemplatePreviewType(null); }}
                title="Close template preview"
                aria-label="Close preview"
                className="text-zinc-600 hover:text-white"><X size={14} /></button>
            </div>
            <pre className="text-[10px] text-zinc-400 whitespace-pre-wrap font-mono max-h-48 overflow-y-auto custom-scrollbar">{templatePreview}</pre>
          </div>
        )}

        {/* Bureau + Round selectors */}
        <div className="flex flex-wrap gap-3 items-center mb-4">
          <div>
            <label className="text-[10px] font-mono text-zinc-600 block mb-1">BUREAU</label>
            <div className="flex gap-2">
              {BUREAUS.map((b) => (
                <button key={b} onClick={() => { setSelectedBureau(b); if (b !== "Furnisher") setSelectedFurnisher(null); }}
                  className={`text-xs px-3 py-1.5 rounded border font-mono ${selectedBureau === b ? "border-[#00ffff] text-[#00ffff] bg-[#00ffff]/10" : "border-zinc-800 text-zinc-500 hover:border-zinc-600"}`}>
                  {b}
                </button>
              ))}
            </div>
          </div>
          {selectedBureau === "Furnisher" && (
            <div>
              <label className="text-[10px] font-mono text-zinc-600 block mb-1">SELECT FURNISHER</label>
              <select value={selectedFurnisher || ""} onChange={(e) => setSelectedFurnisher(e.target.value)}
                title="Select furnisher from address book"
                aria-label="Select furnisher"
                className="bg-zinc-900 border border-zinc-700 text-zinc-300 text-xs px-3 py-1.5 rounded outline-none focus:border-[#00ffff] font-mono">
                <option value="">-- Choose from Address Book --</option>
                {contacts.filter(c => c.type !== "Bureau").map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="text-[10px] font-mono text-zinc-600 block mb-1">ROUND</label>
            <div className="flex gap-2">
              {[1, 2, 3, 4, 5, 6].map((r) => (
                <button key={r} onClick={() => setSelectedRound(r as DisputeRound)}
                  className={`text-xs w-8 h-8 rounded border font-mono ${selectedRound === r ? "border-[#ff9900] text-[#ff9900] bg-[#ff9900]/10" : "border-zinc-800 text-zinc-500"}`}>
                  {r}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Item selector */}
        <div className="mb-3">
          <div className="text-[10px] font-mono text-zinc-600 mb-2">SELECT ITEMS TO DISPUTE</div>
          <div className="max-h-48 overflow-y-auto custom-scrollbar space-y-1">
            {negativeItems.length === 0 && <div className="text-zinc-700 text-xs">No items loaded.</div>}
            {negativeItems.map((item) => (
              <div key={item.id}
                onClick={() => toggleItem(item.id)}
                className={`flex items-center gap-2 p-2 rounded cursor-pointer text-xs transition-all ${selectedItems.includes(item.id) ? "bg-[#00ffff]/10 border border-[#00ffff]/30 text-white" : "bg-zinc-900 border border-zinc-800 text-zinc-400 hover:border-zinc-700"}`}>
                <div className={`w-3 h-3 rounded border flex-shrink-0 ${selectedItems.includes(item.id) ? "bg-[#00ffff] border-[#00ffff]" : "border-zinc-700"}`} />
                <span className="font-bold">{item.creditorName}</span>
                <span className="text-zinc-600">— {item.typeOfNegative}</span>
                {item.estimatedScoreImpact && <span className="text-[#00ff00] text-[9px] ml-auto">{item.estimatedScoreImpact}</span>}
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleGenerate}
            disabled={
              generating ||
              selectedItems.length === 0 ||
              (selectedBureau === "Furnisher" && !selectedFurnisher)
            }
            className="cyber-button border-[#00ffff] text-[#00ffff] hover:bg-[#00ffff]/10 px-6 py-2.5 font-bold flex items-center gap-2 disabled:opacity-40">
            {generating ? <RefreshCw size={16} className="animate-spin" /> : <Plus size={16} />}
            {generating ? "GENERATING..." : `GENERATE (${selectedItems.length} ITEMS)`}
          </button>
          {selectedBureau === "Furnisher" && !selectedFurnisher && (
            <span className="text-[10px] font-mono text-[#ff9900]">Select a furnisher from Address Book before generating.</span>
          )}
          {selectedItems.length > 0 && (
            <button onClick={() => setSelectedItems([])} className="text-xs text-zinc-500 hover:text-white">Clear selection</button>
          )}
        </div>
      </div>

      {/* ── Placeholder Fill Report ───────────────────────────────────────── */}
      {fillResult && showFillReport && (
        <div className="cyber-panel p-5 border-[#00ffff]/20 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Wand2 size={15} className="text-[#00ffff]" />
              <span className="text-sm font-bold text-white">PLACEHOLDER SMART FILL REPORT</span>
              {fillResult.isComplete ? (
                <span className="flex items-center gap-1 text-[10px] font-mono text-[#00ff00] border border-[#00ff00]/30 bg-[#00ff00]/5 px-2 py-0.5 rounded">
                  <CheckCircle2 size={10} /> ALL FILLED
                </span>
              ) : (
                <span className="flex items-center gap-1 text-[10px] font-mono text-[#ff9900] border border-[#ff9900]/30 bg-[#ff9900]/5 px-2 py-0.5 rounded">
                  <AlertTriangle size={10} /> {fillResult.remaining.length} REMAINING
                </span>
              )}
            </div>
            <button onClick={() => setShowFillReport(false)} title="Close fill report" aria-label="Close fill report" className="text-zinc-600 hover:text-white">
              <X size={14} />
            </button>
          </div>

          {/* Auto-filled summary */}
          {fillResult.autoFilled.length > 0 && (
            <div>
              <div className="text-[10px] font-mono text-zinc-500 mb-2 flex items-center gap-1">
                <CheckCircle2 size={10} className="text-[#00ff00]" /> AUTO-FILLED ({fillResult.autoFilled.length} REPLACEMENTS)
              </div>
              <div className="flex flex-wrap gap-1.5">
                {[...new Set(fillResult.autoFilled.map((f) => f.key))].map((key) => {
                  const f = fillResult.autoFilled.find((a) => a.key === key)!;
                  return (
                    <div key={key} className="flex items-center gap-1 text-[10px] font-mono bg-[#00ff00]/5 border border-[#00ff00]/20 text-[#00ff00] px-2 py-1 rounded">
                      <CheckCircle2 size={9} /> <span className="text-zinc-400">{f.label}:</span> <span className="text-white max-w-[120px] truncate">{f.value}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Remaining fields that need manual input */}
          {fillResult.remaining.length > 0 && (
            <div className="space-y-3">
              <div className="text-[10px] font-mono text-[#ff9900] mb-1 flex items-center gap-1">
                <AlertTriangle size={10} /> NEEDS MANUAL INPUT ({fillResult.remaining.length} FIELDS)
              </div>
              {fillResult.remaining.map((r) => (
                <div key={r.key} className={`rounded-lg p-3 border ${r.required ? "border-red-500/30 bg-red-500/5" : "border-[#ff9900]/20 bg-[#ff9900]/5"}  space-y-2`}>
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        {r.required
                          ? <ShieldAlert size={11} className="text-red-400" />
                          : <AlertTriangle size={11} className="text-[#ff9900]" />}
                        <span className={`text-xs font-bold ${r.required ? "text-red-400" : "text-[#ff9900]"}`}>{r.label}</span>
                        {r.required && <span className="text-[9px] font-mono text-red-500 border border-red-500/30 px-1 rounded">REQUIRED</span>}
                      </div>
                      <div className="text-[10px] text-zinc-600 mt-0.5 font-mono">Token: <code className="text-zinc-500">{r.placeholder}</code></div>
                    </div>
                    {r.fillPath && (
                      <a href={`#${r.fillPath}`} className="flex items-center gap-1 text-[10px] text-blue-400 hover:text-blue-300 shrink-0">
                        <ExternalLink size={10} /> Go to {r.fillPath === "profile" ? "Profile" : "Address Book"}
                      </a>
                    )}
                  </div>
                  <input
                    placeholder={r.hint}
                    value={manualOverrides[r.placeholder] ?? ""}
                    onChange={(e) => setManualOverrides((prev) => ({ ...prev, [r.placeholder]: e.target.value }))}
                    className="w-full bg-zinc-900 border border-zinc-700 text-zinc-300 text-xs px-3 py-1.5 rounded outline-none focus:border-[#00ffff] font-mono"
                  />
                </div>
              ))}
              <button
                onClick={handleApplyOverrides}
                disabled={Object.values(manualOverrides).every((v) => !v.trim())}
                className="flex items-center gap-2 text-xs font-bold border border-[#00ffff]/40 text-[#00ffff] hover:bg-[#00ffff]/10 px-4 py-2 rounded transition-all disabled:opacity-40">
                <ClipboardEdit size={13} /> APPLY OVERRIDES TO LETTER
              </button>
            </div>
          )}

          {/* Unknown tokens */}
          {fillResult.unresolvedTokens.length > 0 && (
            <div>
              <div className="text-[10px] font-mono text-red-400 mb-1 flex items-center gap-1">
                <AlertTriangle size={10} /> UNRECOGNIZED TOKENS ({fillResult.unresolvedTokens.length})
              </div>
              <div className="flex flex-wrap gap-1">
                {fillResult.unresolvedTokens.map((t) => (
                  <code key={t} className="text-[10px] bg-red-500/10 border border-red-500/20 text-red-400 px-1.5 py-0.5 rounded font-mono">{t}</code>
                ))}
              </div>
              <div className="text-[10px] text-zinc-600 mt-1">These tokens are not in the placeholder registry. Review the letter and fill them manually before sending.</div>
            </div>
          )}
        </div>
      )}

      {/* Letters list */}
      <div className="cyber-panel p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold text-zinc-400">GENERATED LETTERS</h3>
          <div className="flex items-center gap-2">
            {filteredLetters.length > 0 && (
              <button onClick={batchExportPDF} className="text-xs border border-zinc-700 text-zinc-400 hover:text-[#00ffff] hover:border-[#00ffff] px-2 py-1 rounded flex items-center gap-1">
                <Package size={11} /> BATCH ZIP EXPORT
              </button>
            )}
            <div className="relative">
              <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-600" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search..."
                className="bg-zinc-900 border border-zinc-800 text-zinc-300 text-xs pl-7 pr-3 py-1.5 rounded w-36 outline-none focus:border-[#00ffff]" />
            </div>
          </div>
        </div>

        <div className="space-y-3">
          {filteredLetters.length === 0 && <div className="text-zinc-700 text-sm py-6 text-center">No letters generated yet.</div>}
          {filteredLetters.map((letter) => {
            const meta = letter.templateType ? TEMPLATE_META[letter.templateType] : null;
            const unfilledCount = scanForUnfilledTokens(letter.content).length;
            return (
              <div key={letter.id} className="bg-[#0a0a0a] border border-zinc-800 rounded-lg p-4 space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-bold text-white">{letter.bureau}</span>
                      {meta && <span className={`text-[10px] font-mono ${meta.color}`}>{meta.label}</span>}
                      {letter.round && <span className="text-[10px] font-mono text-zinc-500">Round {letter.round}</span>}
                      <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${letter.status === "Draft" ? "border-zinc-700 text-zinc-500" :
                        letter.status === "Sent" ? "border-[#00ff00]/30 text-[#00ff00]" :
                          "border-blue-500/30 text-blue-400"
                        }`}>{letter.status.toUpperCase()}</span>
                      {unfilledCount > 0 && (
                        <span className="text-[9px] font-mono text-red-400 border border-red-500/30 px-1 rounded">{unfilledCount} UNFILLED</span>
                      )}
                      {letter.mailed && <span className="text-[9px] font-mono text-green-400 flex items-center gap-1"><Mail size={9} /> MAILED</span>}
                    </div>
                    <div className="text-[10px] font-mono text-zinc-600 mt-0.5">{letter.createdAt?.slice(0, 10)} — {letter.negativeItemIds.length} item(s)</div>
                    {letter.trackingNumber && (
                      <div className="text-[9px] font-mono text-zinc-600 mt-1">Tracking: <span className="text-zinc-500">{letter.trackingNumber}</span></div>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => {
                      // Always rebuild from sanitized narrative — never trust stale DOCTYPE dumps.
                      setPreviewLetter(letter);
                      const primaryItem = negativeItems.find(i => letter.negativeItemIds.includes(i.id));
                      setPreviewContent(resolveLetterHtml(letter, personalInfo, primaryItem));
                      setPreviewMode("full-html");
                    }}
                      title="Preview letter" aria-label="Preview letter"
                      className="p-1.5 text-zinc-600 hover:text-[#00ffff]"><Eye size={14} /></button>
                    <button onClick={() => exportPDF(letter)}
                      title="Export letter as PDF" aria-label="Export PDF"
                      className="p-1.5 text-zinc-600 hover:text-[#00ff00]"><Download size={14} /></button>
                    <button onClick={() => reprintLetter(letter)}
                      title="Print or reprint letter" aria-label="Print or reprint letter"
                      className="p-1.5 text-zinc-600 hover:text-[#ff9900]"><Printer size={14} /></button>
                    {letter.status === 'Draft' && <button onClick={() => regenerateSavedDraft(letter)} disabled={regeneratingLetterId === letter.id}
                      title="Replace this saved draft using Groq or Gemini" aria-label="Regenerate draft with AI"
                      className="p-1.5 text-zinc-600 hover:text-purple-400 disabled:opacity-40"><RefreshCw size={14} className={regeneratingLetterId === letter.id ? 'animate-spin' : ''} /></button>}
                    <button onClick={() => removeDisputeLetter(letter.id)}
                      title="Delete this letter" aria-label="Delete letter"
                      className="p-1.5 text-zinc-600 hover:text-red-400"><Trash2 size={14} /></button>
                  </div>
                </div>
                {/* Status workflow + tracking */}
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="flex gap-1">
                    {["Draft", "Sent", "Resolved"].map(s => (
                      <button key={s} onClick={() => updateDisputeLetter(letter.id, { status: s as any })}
                        className={`text-[10px] px-2 py-1 rounded border font-mono transition-all ${letter.status === s ? "border-[#00ffff] text-[#00ffff] bg-[#00ffff]/10" :
                          "border-zinc-800 text-zinc-600 hover:border-zinc-600"
                          }`}>
                        {s}
                      </button>
                    ))}
                  </div>
                  <label className="flex items-center gap-1.5 text-[10px] text-zinc-500 hover:text-zinc-300 cursor-pointer">
                    <input type="checkbox" checked={letter.mailed || false}
                      onChange={(e) => updateDisputeLetter(letter.id, { mailed: e.target.checked, mailedAt: e.target.checked ? new Date().toISOString() : null })}
                      className="w-3 h-3 rounded border-zinc-700" />
                    <Mail size={10} /> Mailed
                  </label>
                  <input placeholder="Tracking #" value={letter.trackingNumber || ""}
                    onChange={(e) => updateDisputeLetter(letter.id, { trackingNumber: e.target.value })}
                    className="bg-zinc-900 border border-zinc-800 text-zinc-400 text-[10px] px-2 py-1 rounded w-32 outline-none focus:border-[#00ffff] font-mono" />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Full-Screen Letter Preview Modal */}
      {previewLetter && (
        <div className="fixed inset-0 z-50 flex flex-col bg-[#0f0f0f]">
          <div className="flex items-center justify-between px-6 py-3 border-b border-zinc-800 bg-[#0a0a0a]">
            <div className="flex items-center gap-3">
              <FileText size={16} className="text-[#00ffff]" />
              <span className="text-sm font-bold text-white font-mono">LETTER PREVIEW — {previewLetter.bureau} / Round {previewLetter.round}</span>
            </div>
            <div className="flex gap-2">
              <button onClick={() => exportPDF(previewLetter)}
                className="cyber-button text-xs border-[#00ff00] text-[#00ff00] px-3 py-1.5 flex items-center gap-1 hover:bg-[#00ff00]/10">
                <Download size={12} /> EXPORT PDF
              </button>
              <button onClick={() => reprintLetter(previewLetter)}
                className="cyber-button text-xs border-[#ff9900] text-[#ff9900] px-3 py-1.5 flex items-center gap-1 hover:bg-[#ff9900]/10">
                <Printer size={12} /> PRINT / REPRINT
              </button>
              {previewLetter.status === 'Draft' && <button onClick={() => regenerateSavedDraft(previewLetter)} disabled={regeneratingLetterId === previewLetter.id}
                className="cyber-button text-xs border-purple-500 text-purple-400 px-3 py-1.5 flex items-center gap-1 hover:bg-purple-500/10 disabled:opacity-40">
                <RefreshCw size={12} className={regeneratingLetterId === previewLetter.id ? 'animate-spin' : ''} /> REGENERATE WITH AI
              </button>}
              <button onClick={() => setPreviewLetter(null)} title="Close letter preview" aria-label="Close preview" className="text-zinc-500 hover:text-white p-1.5 border border-zinc-700 rounded">
                <X size={16} />
              </button>
            </div>
          </div>
          {/* Paper render */}
          <div className="flex-1 overflow-y-auto bg-zinc-200 p-8 flex justify-center">
            <div className="bg-white shadow-2xl max-w-3xl w-full min-h-[1000px]">
              {/* BUG-05 FIX: Always use iframe for full HTML rendering — removed dead <pre> path.
                  previewMode is always "full-html" since letter generation always stores htmlContent. */}
              <iframe
                srcDoc={previewContent}
                className="w-full border-0"
                style={{ minHeight: '1000px', height: '100%' }}
                title="Letter Preview"
                sandbox="allow-same-origin"
              />
            </div>
          </div>
        </div>
      )}

      {/* BUG-06 FIX: Standalone ValidationModal with Regenerate + Force Approve + View Letter */}
      {validationModal && (
        <ValidationModal
          modal={validationModal}
          disputeLetters={disputeLetters}
          negativeItems={negativeItems}
          personalInfo={personalInfo}
          onClose={() => setValidationModal(null)}
          onUpdateLetter={updateDisputeLetter}
          onViewLetter={(letter) => {
            const primaryItem = negativeItems.find(i => letter.negativeItemIds.includes(i.id));
            setPreviewContent(resolveLetterHtml(letter, personalInfo, primaryItem));
            setPreviewMode("full-html");
            setPreviewLetter(letter);
          }}
        />
      )}
    </div>
  );
}
