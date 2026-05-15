type CaptureKind = "observation" | "candidate_outcome" | "verified_outcome" | "manual_confirmation";
type LabelType = "wholesale" | "acquisition_cost" | "retail";

export type OpenLaneObservationExportRow = {
  organization_id: string;
  vehicle_identity_id: string;
  current_bid?: number | null;
  buy_now_price?: number | null;
  time_remaining?: string | null;
  status_text?: string | null;
  disclosure_count?: number | null;
  photo_count?: number | null;
  page_type?: string | null;
  capture_kind?: CaptureKind | string | null;
  captured_at?: string | null;
};

export type OpenLaneOutcomeExportRow = {
  organization_id: string;
  vehicle_identity_id: string;
  outcome_type?: string | null;
  source_page_type?: string | null;
  capture_kind?: CaptureKind | string | null;
  confidence_level?: string | null;
  is_training_eligible?: boolean | null;
  sold_price_candidate?: number | null;
  final_bid_amount?: number | null;
  negotiated_amount?: number | null;
  accepted_amount?: number | null;
  buy_price_auction?: number | null;
  total_invoice_amount?: number | null;
  final_acquisition_cost?: number | null;
  negotiation_status?: string | null;
  captured_at?: string | null;
};

export type RetailSaleExportRow = {
  organization_id: string;
  vehicle_identity_id?: string | null;
  vehicle_id?: string | null;
  sale_id: string;
  paper_sale_price?: number | null;
  sale_date?: string | null;
  status?: string | null;
  voided_at?: string | null;
};

export type TrainingFeatureSet = {
  currentBid?: number;
  buyNowPrice?: number;
  timeRemaining?: string;
  bidCount?: number;
  disclosureCount?: number;
  photoCount?: number;
  pageType?: string;
  statusText?: string;
};

export type MarketSnapTrainingRow = {
  organizationId: string;
  vehicleIdentityId: string;
  sourceRecordId?: string;
  labelType: LabelType;
  labelValue: number;
  labelSource: string;
  confidenceLevel?: string;
  capturedAt?: string;
  features: TrainingFeatureSet;
};

export type MarketSnapTrainingQualityReport = {
  usableOutcomes: number;
  usableWholesaleLabels: number;
  usableAcquisitionLabels: number;
  usableRetailLabels: number;
  rejectedByReason: Record<string, number>;
  confidenceDistribution: Record<string, number>;
};

export type MarketSnapTrainingDataset = {
  wholesaleRows: MarketSnapTrainingRow[];
  acquisitionRows: MarketSnapTrainingRow[];
  retailRows: MarketSnapTrainingRow[];
  report: MarketSnapTrainingQualityReport;
};

export function buildOpenLaneTrainingDataset(input: {
  observations: OpenLaneObservationExportRow[];
  outcomes: OpenLaneOutcomeExportRow[];
  retailSales: RetailSaleExportRow[];
}): MarketSnapTrainingDataset {
  const observationsByIdentity = latestObservationByIdentity(input.observations);
  const wholesaleRows: MarketSnapTrainingRow[] = [];
  const acquisitionRows: MarketSnapTrainingRow[] = [];
  const retailRows: MarketSnapTrainingRow[] = [];
  const rejectedByReason: Record<string, number> = {};
  const confidenceDistribution: Record<string, number> = {};
  let usableOutcomes = 0;

  for (const observation of input.observations) {
    if (observation.capture_kind === "observation") {
      increment(rejectedByReason, "observation_only");
    }
  }

  for (const outcome of input.outcomes) {
    const confidence = String(outcome.confidence_level ?? "unknown");
    increment(confidenceDistribution, confidence);

    if (!isVerifiedTrainingOutcome(outcome)) {
      increment(rejectedByReason, outcome.capture_kind === "candidate_outcome" ? "candidate_outcome" : "unverified_outcome");
      continue;
    }

    const wholesaleLabel = wholesaleLabelFromOutcome(outcome);
    const acquisitionLabel = acquisitionLabelFromOutcome(outcome);
    if (!wholesaleLabel && !acquisitionLabel) {
      increment(rejectedByReason, "missing_verified_label");
      continue;
    }

    usableOutcomes += 1;
    const features = featuresFromObservation(observationsByIdentity.get(outcome.vehicle_identity_id));
    if (wholesaleLabel) {
      wholesaleRows.push({
        organizationId: outcome.organization_id,
        vehicleIdentityId: outcome.vehicle_identity_id,
        labelType: "wholesale",
        labelValue: wholesaleLabel.value,
        labelSource: wholesaleLabel.source,
        confidenceLevel: confidence,
        capturedAt: outcome.captured_at ?? undefined,
        features,
      });
    }
    if (acquisitionLabel) {
      acquisitionRows.push({
        organizationId: outcome.organization_id,
        vehicleIdentityId: outcome.vehicle_identity_id,
        labelType: "acquisition_cost",
        labelValue: acquisitionLabel.value,
        labelSource: acquisitionLabel.source,
        confidenceLevel: confidence,
        capturedAt: outcome.captured_at ?? undefined,
        features,
      });
    }
  }

  for (const sale of input.retailSales) {
    const price = positiveNumber(sale.paper_sale_price);
    if (sale.voided_at || (sale.status && sale.status !== "active")) {
      increment(rejectedByReason, "voided_sale");
      continue;
    }
    if (!price) {
      increment(rejectedByReason, "missing_retail_sale_price");
      continue;
    }
    retailRows.push({
      organizationId: sale.organization_id,
      vehicleIdentityId: sale.vehicle_identity_id ?? sale.vehicle_id ?? sale.sale_id,
      sourceRecordId: sale.sale_id,
      labelType: "retail",
      labelValue: price,
      labelSource: "dealer_flow_sale",
      capturedAt: sale.sale_date ?? undefined,
      features: featuresFromObservation(sale.vehicle_identity_id ? observationsByIdentity.get(sale.vehicle_identity_id) : undefined),
    });
  }

  return {
    wholesaleRows,
    acquisitionRows,
    retailRows,
    report: {
      usableOutcomes,
      usableWholesaleLabels: wholesaleRows.length,
      usableAcquisitionLabels: acquisitionRows.length,
      usableRetailLabels: retailRows.length,
      rejectedByReason,
      confidenceDistribution,
    },
  };
}

function latestObservationByIdentity(observations: OpenLaneObservationExportRow[]) {
  const latest = new Map<string, OpenLaneObservationExportRow>();
  for (const observation of observations) {
    const previous = latest.get(observation.vehicle_identity_id);
    if (!previous || timestamp(observation.captured_at) >= timestamp(previous.captured_at)) {
      latest.set(observation.vehicle_identity_id, observation);
    }
  }
  return latest;
}

function isVerifiedTrainingOutcome(outcome: OpenLaneOutcomeExportRow) {
  return outcome.is_training_eligible === true
    && (outcome.capture_kind === "verified_outcome" || outcome.capture_kind === "manual_confirmation")
    && outcome.negotiation_status?.toLowerCase() !== "pending";
}

function wholesaleLabelFromOutcome(outcome: OpenLaneOutcomeExportRow) {
  return firstPositiveLabel([
    ["buy_price_auction", outcome.buy_price_auction],
    ["accepted_negotiation", outcome.accepted_amount],
    ["negotiated_amount", outcome.negotiated_amount],
    ["final_bid_amount", outcome.final_bid_amount],
  ]);
}

function acquisitionLabelFromOutcome(outcome: OpenLaneOutcomeExportRow) {
  return firstPositiveLabel([
    ["final_acquisition_cost", outcome.final_acquisition_cost],
    ["total_invoice_amount", outcome.total_invoice_amount],
  ]);
}

function firstPositiveLabel(candidates: Array<[string, number | null | undefined]>) {
  for (const [source, value] of candidates) {
    const label = positiveNumber(value);
    if (label) return { source, value: label };
  }
  return null;
}

function featuresFromObservation(observation?: OpenLaneObservationExportRow): TrainingFeatureSet {
  if (!observation) return {};
  return compactObject({
    currentBid: positiveNumber(observation.current_bid),
    buyNowPrice: positiveNumber(observation.buy_now_price),
    timeRemaining: observation.time_remaining || undefined,
    disclosureCount: integerOrUndefined(observation.disclosure_count),
    photoCount: integerOrUndefined(observation.photo_count),
    pageType: observation.page_type || undefined,
    statusText: observation.status_text || undefined,
  });
}

function positiveNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function integerOrUndefined(value: unknown) {
  const number = positiveNumber(value);
  return number === undefined ? undefined : Math.trunc(number);
}

function timestamp(value?: string | null) {
  const time = value ? Date.parse(value) : 0;
  return Number.isFinite(time) ? time : 0;
}

function increment(record: Record<string, number>, key: string) {
  record[key] = (record[key] ?? 0) + 1;
}

function compactObject<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as Partial<T> as T;
}
