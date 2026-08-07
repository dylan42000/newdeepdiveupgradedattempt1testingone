import type { MailDeliveryProvider } from "../types";
import { KEY_NAMES, SecureKeyService, type SecureKeyName } from "./secureKeyService";

export interface MailDeliveryRequest {
  letterId: string;
  recipientName: string;
  recipientAddress: {
    line1: string;
    city: string;
    state: string;
    zip: string;
    country: "US";
  };
  senderAddress: {
    firstName: string;
    lastName: string;
    address: string;
    city: string;
    state: string;
    zip: string;
  };
  letterHtml: string;
  certifiedMail: boolean;
  expectedDeliveryDays: number;
}

export interface MailDeliveryResult {
  success: boolean;
  provider: MailDeliveryProvider;
  mailId: string;
  trackingNumber?: string;
  estimatedDeliveryDate: string;
  costCents: number;
  pdfUrl?: string;
  error?: string;
}

const PROVIDER_PRIORITY: MailDeliveryProvider[] = ["lob", "postgrid", "stannp", "manual"];

function plusBusinessDays(start: Date, businessDays: number): string {
  const date = new Date(start);
  let remaining = Math.max(0, businessDays);
  while (remaining > 0) {
    date.setDate(date.getDate() + 1);
    const day = date.getDay();
    if (day !== 0 && day !== 6) remaining -= 1;
  }
  return date.toISOString();
}

function estimateCostCents(request: MailDeliveryRequest, provider: MailDeliveryProvider): number {
  const base = provider === "manual" ? 0 : provider === "lob" ? 232 : provider === "postgrid" ? 245 : 260;
  const certifiedPremium = request.certifiedMail ? 425 : 0;
  const pagesEstimate = Math.max(1, Math.ceil(request.letterHtml.length / 2400));
  const pageCost = pagesEstimate > 1 ? (pagesEstimate - 1) * 12 : 0;
  return base + certifiedPremium + pageCost;
}

function providerFromKeyName(provider: MailDeliveryProvider): SecureKeyName | null {
  if (provider === "lob") return KEY_NAMES.LOB;
  if (provider === "postgrid") return KEY_NAMES.POSTGRID;
  if (provider === "stannp") return KEY_NAMES.STANNP;
  return null;
}

export async function setMailProviderApiKey(provider: Exclude<MailDeliveryProvider, "manual">, key: string): Promise<void> {
  const keyName = providerFromKeyName(provider);
  if (!keyName) return;
  await SecureKeyService.setKey(keyName, key);
}

export async function getMailProviderApiKey(provider: Exclude<MailDeliveryProvider, "manual">): Promise<string> {
  const keyName = providerFromKeyName(provider);
  if (!keyName) return "";
  return SecureKeyService.getKey(keyName);
}

async function tryLob(request: MailDeliveryRequest, apiKey: string): Promise<MailDeliveryResult> {
  const body = {
    description: `DylandOS Dispute Letter ${request.letterId}`,
    to: {
      name: request.recipientName,
      address_line1: request.recipientAddress.line1,
      address_city: request.recipientAddress.city,
      address_state: request.recipientAddress.state,
      address_zip: request.recipientAddress.zip,
      address_country: request.recipientAddress.country,
    },
    from: {
      name: `${request.senderAddress.firstName} ${request.senderAddress.lastName}`,
      address_line1: request.senderAddress.address,
      address_city: request.senderAddress.city,
      address_state: request.senderAddress.state,
      address_zip: request.senderAddress.zip,
      address_country: "US",
    },
    file: `<html><body>${request.letterHtml}</body></html>`,
    color: false,
    extra_service: request.certifiedMail ? "certified" : undefined,
  } as const;

  const response = await fetch("https://api.lob.com/v1/letters", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${btoa(`${apiKey}:`)}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const message = await response.text().catch(() => "Lob API request failed");
    throw new Error(message.slice(0, 240));
  }

  const data = await response.json().catch(() => ({} as Record<string, unknown>));

  return {
    success: true,
    provider: "lob",
    mailId: String(data.id || `lob-${request.letterId}`),
    trackingNumber: typeof data.tracking_number === "string" ? data.tracking_number : undefined,
    estimatedDeliveryDate: plusBusinessDays(new Date(), request.expectedDeliveryDays),
    costCents: estimateCostCents(request, "lob"),
    pdfUrl: typeof data.url === "string" ? data.url : undefined,
  };
}

async function tryPostGrid(request: MailDeliveryRequest, apiKey: string): Promise<MailDeliveryResult> {
  const response = await fetch("https://api.postgrid.com/print-mail/v1/letters", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({
      to: {
        firstName: request.recipientName,
        addressLine1: request.recipientAddress.line1,
        city: request.recipientAddress.city,
        provinceOrState: request.recipientAddress.state,
        postalOrZip: request.recipientAddress.zip,
        countryCode: request.recipientAddress.country,
      },
      from: {
        firstName: request.senderAddress.firstName,
        lastName: request.senderAddress.lastName,
        addressLine1: request.senderAddress.address,
        city: request.senderAddress.city,
        provinceOrState: request.senderAddress.state,
        postalOrZip: request.senderAddress.zip,
        countryCode: "US",
      },
      html: request.letterHtml,
      extraService: request.certifiedMail ? "certified" : undefined,
    }),
  });

  if (!response.ok) {
    const message = await response.text().catch(() => "PostGrid API request failed");
    throw new Error(message.slice(0, 240));
  }

  const data = await response.json().catch(() => ({} as Record<string, unknown>));

  return {
    success: true,
    provider: "postgrid",
    mailId: String(data.id || `postgrid-${request.letterId}`),
    trackingNumber: typeof data.trackingNumber === "string" ? data.trackingNumber : undefined,
    estimatedDeliveryDate: plusBusinessDays(new Date(), request.expectedDeliveryDays),
    costCents: estimateCostCents(request, "postgrid"),
    pdfUrl: typeof data.pdf === "string" ? data.pdf : undefined,
  };
}

async function tryStannp(request: MailDeliveryRequest, apiKey: string): Promise<MailDeliveryResult> {
  const response = await fetch("https://api.stannp.com/v1/letters", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      recipient: {
        name: request.recipientName,
        line1: request.recipientAddress.line1,
        city: request.recipientAddress.city,
        state: request.recipientAddress.state,
        zip: request.recipientAddress.zip,
        country: request.recipientAddress.country,
      },
      sender: {
        name: `${request.senderAddress.firstName} ${request.senderAddress.lastName}`,
        line1: request.senderAddress.address,
        city: request.senderAddress.city,
        state: request.senderAddress.state,
        zip: request.senderAddress.zip,
        country: "US",
      },
      html: request.letterHtml,
      service: request.certifiedMail ? "tracked" : "standard",
    }),
  });

  if (!response.ok) {
    const message = await response.text().catch(() => "Stannp API request failed");
    throw new Error(message.slice(0, 240));
  }

  const data = await response.json().catch(() => ({} as Record<string, unknown>));

  return {
    success: true,
    provider: "stannp",
    mailId: String(data.id || `stannp-${request.letterId}`),
    trackingNumber: typeof data.tracking === "string" ? data.tracking : undefined,
    estimatedDeliveryDate: plusBusinessDays(new Date(), request.expectedDeliveryDays),
    costCents: estimateCostCents(request, "stannp"),
    pdfUrl: typeof data.previewUrl === "string" ? data.previewUrl : undefined,
  };
}

export async function deliverLetterByMailApi(
  request: MailDeliveryRequest,
  preferredProvider: MailDeliveryProvider = "manual",
): Promise<MailDeliveryResult> {
  const providerOrder = [
    preferredProvider,
    ...PROVIDER_PRIORITY.filter((provider) => provider !== preferredProvider),
  ];

  const errors: string[] = [];

  for (const provider of providerOrder) {
    if (provider === "manual") {
      return {
        success: false,
        provider: "manual",
        mailId: `manual-${request.letterId}`,
        estimatedDeliveryDate: plusBusinessDays(new Date(), request.expectedDeliveryDays),
        costCents: estimateCostCents(request, "manual"),
        error: "Manual mode selected. Print and mail this letter manually.",
      };
    }

    const keyName = providerFromKeyName(provider);
    if (!keyName) continue;

    const apiKey = await SecureKeyService.getKey(keyName);
    if (!apiKey) {
      errors.push(`${provider}: missing API key`);
      continue;
    }

    try {
      if (provider === "lob") return await tryLob(request, apiKey);
      if (provider === "postgrid") return await tryPostGrid(request, apiKey);
      if (provider === "stannp") return await tryStannp(request, apiKey);
    } catch (error) {
      errors.push(`${provider}: ${(error as Error).message}`);
    }
  }

  return {
    success: false,
    provider: "manual",
    mailId: `manual-fallback-${request.letterId}`,
    estimatedDeliveryDate: plusBusinessDays(new Date(), request.expectedDeliveryDays),
    costCents: estimateCostCents(request, "manual"),
    error: errors.join(" | ") || "All mail providers unavailable",
  };
}
