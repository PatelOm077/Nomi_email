import { useEffect, useRef, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import {
  Form,
  Link,
  data,
  redirect,
  useActionData,
  useFetcher,
  useLoaderData,
  useNavigation,
  useSubmit,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import {
  analyzeBrandWithSol,
  createDirectionsWithSonnet,
  finalizeWithSonnet,
  generateCreativeEmailFamilyWithSonnet,
  MeteredAiError,
} from "../brand-studio/ai.server";
import { assertStageBudget } from "../brand-studio/budget.server";
import { getApprovedBrandStudioFamily } from "../brand-studio/approved-family";
import { getBrandStudioReviewPage } from "../brand-studio/review-fixture.server";
import { ColorField, LogoPicker } from "../components/brand-inputs";
import {
  brandEvidenceFingerprint,
  discoverBrandLogo,
  loadBrandEvidence,
  normalizeLumenBrandEvidence,
} from "../brand-studio/shopify-evidence.server";
import {
  auditCompiledEmail,
  auditEmailFamily,
} from "../brand-studio/email-quality";
import {
  brandEvidenceSchema,
  brandSnapshotSchema,
  brandSystemSchema,
  creativeDirectionsSchema,
  lifecycleRecipesSchema,
  renderedEmailsSchema,
  safeJson,
  type BrandEvidence,
  type BrandSnapshot,
  type BrandSystem,
  type CreativeDirection,
  type LifecycleRecipe,
} from "../brand-studio/types";
import type { RegenerateAllActionResult } from "./app.brand-studio.regenerate-all";

const EMPTY_SNAPSHOT: BrandSnapshot = {
  summary: "",
  positioning: "",
  audienceSuggestion: "",
  feelingSuggestion: "",
  evidence: [],
};
type StudioStep =
  "welcome" | "snapshot" | "creating" | "directions" | "confirm" | "complete";
const STEP_QUERY = new Set<StudioStep>([
  "welcome",
  "snapshot",
  "directions",
  "confirm",
  "complete",
]);
const RAIL = [
  "Scan",
  "Snapshot",
  "Create",
  "Choose",
  "Build",
  "Ready",
] as const;
const OPENING_STAGE_COLORS = [
  "#0088b0",
  "#f4bf25",
  "#d06942",
  "#006786",
  "#d6006c",
  "#4b7b4e",
] as const;
const EMAIL_FAMILY = [
  "Hello & Welcome",
  "Meet the Brand",
  "Customer Favorites",
  "A Closer Look",
  "Still Considering?",
  "Your Cart",
  "A Gentle Reminder",
  "Last Cart Note",
  "Thank You",
  "How Was It?",
  "Welcome Back",
  "Something New",
  "The Door Is Open",
] as const;
const DIRECTION_MODES = [
  { label: "Calm", display: "Lora, Georgia, serif", body: '"IBM Plex Sans", Arial, sans-serif' },
  { label: "Modern", display: '"IBM Plex Sans", Arial, sans-serif', body: '"IBM Plex Sans", Arial, sans-serif' },
  { label: "Editorial", display: '"Source Serif 4", Georgia, serif', body: '"Source Serif 4", Georgia, serif' },
] as const;

type DirectionMode = (typeof DIRECTION_MODES)[number];
type DirectionBrandTokens = {
  shopName: string;
  palette: [string, string, string, string];
};

function directionBrandTokens(evidence: BrandEvidence): DirectionBrandTokens {
  const palette = evidence.assets?.palette;
  return {
    shopName: evidence.shopName,
    palette: palette
      ? [palette.paper, palette.ink, palette.primary, palette.accent]
      : ["#f4f0e7", "#22201d", "#536454", "#c56f4e"],
  };
}

function directionMode(index: number): DirectionMode {
  return DIRECTION_MODES[index] ?? DIRECTION_MODES[0];
}
const BUILD_LINES = [
  "Warming up the presses…",
  "Mixing the ink…",
  "Finding the rhythm…",
  "Matching tone to type…",
  "Nearly a full set…",
  "Tying it off…",
] as const;
const SCAN_TRANSITION_MINIMUM_MS = 3_700;
const DIRECTIONS_TRANSITION_MINIMUM_MS = 5_200;

async function waitForAnimation(startedAt: number, minimumMs: number) {
  const remaining = minimumMs - (Date.now() - startedAt);
  if (remaining > 0)
    await new Promise((resolve) => setTimeout(resolve, remaining));
}

function formatCost(micros: number) {
  return `$${(micros / 1_000_000).toFixed(2)}`;
}

function defaultStep(
  status: string,
  hasSnapshot: boolean,
  hasApprovedFamily: boolean,
): StudioStep {
  if (hasApprovedFamily) return "complete";
  if (status === "selected" || status === "building" || status === "complete")
    return "confirm";
  if (status === "directions") return "directions";
  if (hasSnapshot) return "snapshot";
  return "welcome";
}

function studioRedirect(
  step: StudioStep,
  replayMode: boolean,
  directionId?: string,
) {
  const search = new URLSearchParams({ step });
  if (replayMode) search.set("replay", "1");
  if (directionId) search.set("direction", directionId);
  return `/app/brand-studio?${search.toString()}`;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const requestUrl = new URL(request.url);
  if (
    requestUrl.hostname === "localhost" &&
    requestUrl.searchParams.get("__review") === "1"
  ) {
    return getBrandStudioReviewPage(
      requestUrl.searchParams.get("step") ?? "snapshot",
      requestUrl.searchParams.get("replay") === "1",
      requestUrl.searchParams.get("state") === "building",
    );
  }
  const { session, admin } = await authenticate.admin(request);
  let profile = await db.brandStudioProfile.upsert({
    where: { shop: session.shop },
    create: { shop: session.shop },
    update: {},
  });
  let evidence = safeJson(
    profile.evidence,
    brandEvidenceSchema,
    null as BrandEvidence | null,
  );
  if (!evidence) {
    evidence = await loadBrandEvidence(admin, session.shop);
    profile = await db.brandStudioProfile.update({
      where: { shop: session.shop },
      data: { evidence: JSON.stringify(evidence) },
    });
  }
  if (!evidence.assets?.logoUrl) {
    const discoveredLogo = await discoverBrandLogo(admin, evidence.shopName);
    if (discoveredLogo) {
      evidence = brandEvidenceSchema.parse({
        ...evidence,
        assets: {
          ...evidence.assets,
          logoUrl: discoveredLogo,
          observedColors: evidence.assets?.observedColors ?? [],
          fontHints: evidence.assets?.fontHints ?? [],
        },
      });
      const fingerprint = brandEvidenceFingerprint(evidence);
      const storedSnapshot = safeJson(
        profile.snapshot,
        brandSnapshotSchema,
        null as BrandSnapshot | null,
      );
      profile = await db.brandStudioProfile.update({
        where: { shop: session.shop },
        data: {
          status: storedSnapshot ? "analyzed" : profile.status,
          evidence: JSON.stringify(evidence),
          evidenceFingerprint: fingerprint,
          snapshotEvidenceFingerprint: storedSnapshot ? fingerprint : "",
          directions: "[]",
          selectedDirectionId: null,
          refinement: null,
          brandSystem: "{}",
          lifecycleRecipes: "[]",
          renderedEmails: "{}",
          generatedEvidenceFingerprint: "",
          currentBuildCostMicros: 0,
          completedAt: null,
        },
      });
    }
  }
  const normalizedEvidence = normalizeLumenBrandEvidence(evidence, session.shop);
  if (normalizedEvidence !== evidence) {
    const storedSnapshot = safeJson(
      profile.snapshot,
      brandSnapshotSchema,
      EMPTY_SNAPSHOT,
    );
    const normalizedSnapshot = brandSnapshotSchema.parse(
      JSON.parse(
        JSON.stringify(storedSnapshot).replace(/\bNomi\b/g, "Lumen"),
      ),
    );
    const fingerprint = brandEvidenceFingerprint(normalizedEvidence);
    profile = await db.brandStudioProfile.update({
      where: { shop: session.shop },
      data: {
        status: "analyzed",
        evidence: JSON.stringify(normalizedEvidence),
        evidenceFingerprint: fingerprint,
        snapshot: JSON.stringify(normalizedSnapshot),
        snapshotEvidenceFingerprint: fingerprint,
        directions: "[]",
        selectedDirectionId: null,
        refinement: null,
        brandSystem: "{}",
        lifecycleRecipes: "[]",
        renderedEmails: "{}",
        generatedEvidenceFingerprint: "",
        currentBuildCostMicros: 0,
        completedAt: null,
      },
    });
    evidence = normalizedEvidence;
  }
  const snapshot = safeJson(
    profile.snapshot,
    brandSnapshotSchema,
    EMPTY_SNAPSHOT,
  );
  const directions = safeJson(
    profile.directions,
    creativeDirectionsSchema,
    [] as CreativeDirection[],
  );
  const brandSystem = safeJson(
    profile.brandSystem,
    brandSystemSchema,
    null as BrandSystem | null,
  );
  const lifecycleRecipes = safeJson(
    profile.lifecycleRecipes,
    lifecycleRecipesSchema,
    [] as LifecycleRecipe[],
  );
  const approvedFamily = getApprovedBrandStudioFamily(profile);
  const requestedStep = requestUrl.searchParams.get(
    "step",
  ) as StudioStep | null;
  const requestedStepIsAvailable =
    requestedStep &&
    STEP_QUERY.has(requestedStep) &&
    (requestedStep !== "complete" || Boolean(approvedFamily));
  const step =
    requestedStepIsAvailable
      ? requestedStep
      : defaultStep(
          profile.status,
          Boolean(snapshot.summary),
          Boolean(approvedFamily),
        );
  const replayMode = requestUrl.searchParams.get("replay") === "1";
  const replayDirectionId = requestUrl.searchParams.get("direction");
  const selectedDirectionId =
    replayMode && directions.some(({ id }) => id === replayDirectionId)
      ? replayDirectionId
      : profile.selectedDirectionId;
  return {
    shopName: evidence.shopName,
    evidence,
    step,
    reviewMode: false,
    reviewBuilding: false,
    replayMode,
    profile: {
      status: profile.status,
      snapshot,
      audience: profile.audience,
      feeling: profile.feeling,
      directions,
      selectedDirectionId,
      refinement: profile.refinement,
      brandSystem,
      lifecycleRecipes,
      estimatedCostMicros: profile.estimatedCostMicros,
      currentBuildCostMicros: profile.currentBuildCostMicros,
      evidenceStatus:
        profile.evidenceFingerprint &&
        profile.evidenceFingerprint !== "legacy-unverified" &&
        profile.evidenceFingerprint === profile.snapshotEvidenceFingerprint &&
        profile.evidenceFingerprint === profile.generatedEvidenceFingerprint
          ? ("current" as const)
          : ("refresh-needed" as const),
    },
  };
};

function requiredText(formData: FormData, name: string, maximum: number) {
  const value = formData.get(name);
  if (typeof value !== "string" || !value.trim())
    throw new Error(
      "Complete both Brand Intent answers before creating directions.",
    );
  return value.trim().slice(0, maximum);
}

function confirmedEvidence(
  formData: FormData,
  evidence: BrandEvidence,
): BrandEvidence {
  const text = (name: string, maximum: number) => {
    const value = formData.get(name);
    return typeof value === "string" ? value.trim().slice(0, maximum) : "";
  };
  // A submitted color that isn't a real hex is an error, not something to
  // quietly swap for the old value — the merchant would think it saved.
  const color = (name: string, label: string, fallback: string) => {
    const value = text(name, 7);
    if (!value) return fallback;
    if (!/^#[0-9a-f]{6}$/i.test(value))
      throw new Error(
        `${label} color “${value}” isn’t a valid hex color. Use six hex digits, like #1d1a18.`,
      );
    return value.toLowerCase();
  };
  const current = evidence.assets?.palette ?? {
    paper: "#f7f5f0",
    ink: "#201e1d",
    primary: "#405771",
    accent: "#d6b3a7",
  };
  const logo = text("logoUrl", 2_000);
  const fonts = [text("displayFont", 100), text("bodyFont", 100)].filter(
    Boolean,
  );
  return brandEvidenceSchema.parse({
    ...evidence,
    shopName: text("shopName", 120) || evidence.shopName,
    assets: {
      ...evidence.assets,
      logoUrl: logo && /^https?:\/\//i.test(logo) ? logo : null,
      observedColors: evidence.assets?.observedColors ?? [],
      fontHints: fonts.length ? fonts : (evidence.assets?.fontHints ?? []),
      palette: {
        paper: color("paperColor", "Paper", current.paper),
        ink: color("inkColor", "Ink", current.ink),
        primary: color("primaryColor", "Primary", current.primary),
        accent: color("accentColor", "Accent", current.accent),
      },
    },
  });
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const actionStartedAt = Date.now();
  const requestUrl = new URL(request.url);
  const replayMode = requestUrl.searchParams.get("replay") === "1";
  const { session, admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");
  const profile = await db.brandStudioProfile.upsert({
    where: { shop: session.shop },
    create: { shop: session.shop },
    update: {},
  });
  try {
    if (intent === "refresh-evidence") {
      const evidence = await loadBrandEvidence(admin, session.shop);
      const fingerprint = brandEvidenceFingerprint(evidence);
      if (
        profile.status === "complete" &&
        profile.evidenceFingerprint === fingerprint &&
        profile.snapshotEvidenceFingerprint === fingerprint &&
        profile.generatedEvidenceFingerprint === fingerprint
      ) {
        await db.brandStudioProfile.update({
          where: { shop: session.shop },
          data: { evidenceRefreshedAt: new Date() },
        });
        return redirect(studioRedirect("complete", false));
      }
      assertStageBudget(0, 700_000);
      const result = await analyzeBrandWithSol(evidence);
      await db.brandStudioProfile.update({
        where: { shop: session.shop },
        data: {
          status: "analyzed",
          evidence: JSON.stringify(evidence),
          evidenceFingerprint: fingerprint,
          evidenceRefreshedAt: new Date(),
          snapshot: JSON.stringify(result.value),
          snapshotEvidenceFingerprint: fingerprint,
          audience: null,
          feeling: null,
          directions: "[]",
          selectedDirectionId: null,
          refinement: null,
          brandSystem: "{}",
          lifecycleRecipes: "[]",
          renderedEmails: "{}",
          generatedEvidenceFingerprint: "",
          currentBuildCostMicros: result.costMicros,
          openAiInputTokens: { increment: result.usage.inputTokens },
          openAiOutputTokens: { increment: result.usage.outputTokens },
          estimatedCostMicros: { increment: result.costMicros },
          completedAt: null,
        },
      });
      return redirect(studioRedirect("snapshot", false));
    }
    if (intent === "analyze") {
      let existing: unknown = null;
      try {
        existing = JSON.parse(profile.snapshot);
      } catch {
        existing = null;
      }
      const storedEvidence = safeJson(
        profile.evidence,
        brandEvidenceSchema,
        null as BrandEvidence | null,
      );
      if (
        brandSnapshotSchema.safeParse(existing).success &&
        storedEvidence &&
        profile.evidenceFingerprint &&
        profile.evidenceFingerprint !== "legacy-unverified" &&
        profile.snapshotEvidenceFingerprint === profile.evidenceFingerprint
      ) {
        await waitForAnimation(actionStartedAt, SCAN_TRANSITION_MINIMUM_MS);
        return redirect(studioRedirect("snapshot", replayMode));
      }
      assertStageBudget(profile.currentBuildCostMicros, 700_000);
      const evidence = await loadBrandEvidence(admin, session.shop);
      const evidenceFingerprint = brandEvidenceFingerprint(evidence);
      const result = await analyzeBrandWithSol(evidence);
      await db.brandStudioProfile.update({
        where: { shop: session.shop },
        data: {
          status: "analyzed",
          evidence: JSON.stringify(evidence),
          evidenceFingerprint,
          evidenceRefreshedAt: new Date(),
          snapshot: JSON.stringify(result.value),
          snapshotEvidenceFingerprint: evidenceFingerprint,
          openAiInputTokens: { increment: result.usage.inputTokens },
          openAiOutputTokens: { increment: result.usage.outputTokens },
          estimatedCostMicros: { increment: result.costMicros },
          currentBuildCostMicros: { increment: result.costMicros },
        },
      });
      await waitForAnimation(actionStartedAt, SCAN_TRANSITION_MINIMUM_MS);
      return redirect(studioRedirect("snapshot", replayMode));
    }
    if (intent === "generate-directions") {
      const storedSnapshot = brandSnapshotSchema.parse(
        JSON.parse(profile.snapshot),
      );
      const submittedSummary = formData.get("summary");
      const submittedPositioning = formData.get("positioning");
      const snapshot =
        typeof submittedSummary === "string" &&
        submittedSummary.trim() &&
        typeof submittedPositioning === "string" &&
        submittedPositioning.trim()
          ? {
              ...storedSnapshot,
              summary: submittedSummary.trim().slice(0, 420),
              positioning: submittedPositioning.trim().slice(0, 260),
            }
          : storedSnapshot;
      const audience = requiredText(formData, "audience", 300);
      const feeling = requiredText(formData, "feeling", 300);
      // Validated before the replay shortcut so a bad hex is reported in
      // every mode, not just when it would have been saved.
      const storedEvidence = brandEvidenceSchema.parse(
        JSON.parse(profile.evidence),
      );
      const evidence = confirmedEvidence(formData, storedEvidence);
      if (
        replayMode &&
        creativeDirectionsSchema.safeParse(JSON.parse(profile.directions))
          .success
      ) {
        await waitForAnimation(
          actionStartedAt,
          DIRECTIONS_TRANSITION_MINIMUM_MS,
        );
        return redirect(studioRedirect("directions", true));
      }
      assertStageBudget(profile.currentBuildCostMicros, 900_000);
      const evidenceFingerprint = brandEvidenceFingerprint(evidence);
      await db.brandStudioProfile.update({
        where: { shop: session.shop },
        data: {
          evidence: JSON.stringify(evidence),
          evidenceFingerprint,
          snapshotEvidenceFingerprint: evidenceFingerprint,
          snapshot: JSON.stringify(snapshot),
          audience,
          feeling,
        },
      });
      const result = await createDirectionsWithSonnet({
        evidence,
        snapshot,
        audience,
        feeling,
      });
      await db.brandStudioProfile.update({
        where: { shop: session.shop },
        data: {
          status: "directions",
          audience,
          feeling,
          directions: JSON.stringify(result.value),
          selectedDirectionId: null,
          anthropicInputTokens: { increment: result.usage.inputTokens },
          anthropicOutputTokens: { increment: result.usage.outputTokens },
          estimatedCostMicros: { increment: result.costMicros },
          currentBuildCostMicros: { increment: result.costMicros },
        },
      });
      await waitForAnimation(actionStartedAt, DIRECTIONS_TRANSITION_MINIMUM_MS);
      return redirect(studioRedirect("directions", replayMode));
    }
    if (intent === "select-direction") {
      const directionId = requiredText(formData, "directionId", 48);
      const directions = creativeDirectionsSchema.parse(
        JSON.parse(profile.directions),
      );
      if (!directions.some(({ id }) => id === directionId))
        throw new Error("Choose one of the available directions.");
      if (replayMode)
        return redirect(studioRedirect("confirm", true, directionId));
      await db.brandStudioProfile.update({
        where: { shop: session.shop },
        data: { status: "selected", selectedDirectionId: directionId },
      });
      return redirect(studioRedirect("confirm", replayMode));
    }
    if (intent === "finalize") {
      const snapshot = brandSnapshotSchema.parse(JSON.parse(profile.snapshot));
      const directions = creativeDirectionsSchema.parse(
        JSON.parse(profile.directions),
      );
      const requestedDirectionId = replayMode
        ? requestUrl.searchParams.get("direction")
        : null;
      const direction = directions.find(
        ({ id }) =>
          id === (requestedDirectionId ?? profile.selectedDirectionId),
      );
      if (!direction || !profile.audience || !profile.feeling)
        throw new Error(
          "Choose a creative direction before building the email system.",
        );
      const refinementValue = formData.get("refinement");
      const refinement =
        typeof refinementValue === "string" && refinementValue.trim()
          ? refinementValue.trim().slice(0, 400)
          : null;
      if (replayMode) {
        if (!getApprovedBrandStudioFamily(profile))
          throw new Error(
            "The saved email family is incomplete. Exit replay and rebuild it through Brand Studio.",
          );
        await waitForAnimation(actionStartedAt, 8_500);
        return redirect(studioRedirect("complete", true));
      }
      assertStageBudget(profile.currentBuildCostMicros, 2_200_000);
      const evidence = brandEvidenceSchema.parse(JSON.parse(profile.evidence));
      const evidenceFingerprint = brandEvidenceFingerprint(evidence);
      const approvedPalette = evidence.assets?.palette;
      const buildDirection: CreativeDirection = approvedPalette
        ? {
            ...direction,
            palette: [
              approvedPalette.paper,
              approvedPalette.ink,
              approvedPalette.primary,
              approvedPalette.accent,
            ],
          }
        : direction;
      const savedBrandSystem = brandSystemSchema.safeParse(
        JSON.parse(profile.brandSystem),
      );
      const savedRecipes = lifecycleRecipesSchema.safeParse(
        JSON.parse(profile.lifecycleRecipes),
      );
      const canResume =
        profile.status === "building" &&
        profile.generatedEvidenceFingerprint === evidenceFingerprint &&
        savedBrandSystem.success &&
        savedBrandSystem.data.directionId === direction.id &&
        savedRecipes.success;
      const result = canResume
        ? {
            value: {
              brandSystem: savedBrandSystem.data,
              lifecycleRecipes: savedRecipes.data,
            },
            usage: {
              provider: "anthropic" as const,
              inputTokens: 0,
              outputTokens: 0,
            },
            costMicros: 0,
          }
        : await finalizeWithSonnet({
            shopName: evidence.shopName,
            snapshot,
            audience: profile.audience,
            feeling: profile.feeling,
            direction: buildDirection,
            refinement,
            products: evidence.products,
          });
      assertStageBudget(
        profile.currentBuildCostMicros + result.costMicros,
        1_350_000,
      );
      if (!canResume) {
        await db.brandStudioProfile.update({
          where: { shop: session.shop },
          data: {
            status: "building",
            refinement,
            brandSystem: JSON.stringify(result.value.brandSystem),
            lifecycleRecipes: JSON.stringify(result.value.lifecycleRecipes),
            renderedEmails: "{}",
            generatedEvidenceFingerprint: evidenceFingerprint,
            anthropicInputTokens: { increment: result.usage.inputTokens },
            anthropicOutputTokens: { increment: result.usage.outputTokens },
            estimatedCostMicros: { increment: result.costMicros },
            currentBuildCostMicros: { increment: result.costMicros },
          },
        });
      }
      let checkpointedCostMicros = 0;
      const creative = await generateCreativeEmailFamilyWithSonnet({
        evidence,
        brandSystem: result.value.brandSystem,
        direction: buildDirection,
        recipes: result.value.lifecycleRecipes,
        refinement,
        existingRendered: canResume
          ? safeJson(profile.renderedEmails, renderedEmailsSchema, {})
          : {},
        onCheckpoint: async (checkpoint) => {
          checkpointedCostMicros += checkpoint.costMicros;
          assertStageBudget(
            profile.currentBuildCostMicros +
              result.costMicros +
              checkpointedCostMicros,
            0,
          );
          await db.brandStudioProfile.update({
            where: { shop: session.shop },
            data: {
              renderedEmails: JSON.stringify(checkpoint.rendered),
              anthropicInputTokens: {
                increment: checkpoint.usage.inputTokens,
              },
              anthropicOutputTokens: {
                increment: checkpoint.usage.outputTokens,
              },
              estimatedCostMicros: { increment: checkpoint.costMicros },
              currentBuildCostMicros: { increment: checkpoint.costMicros },
            },
          });
        },
      });
      assertStageBudget(
        profile.currentBuildCostMicros +
          result.costMicros +
          checkpointedCostMicros +
          creative.costMicros,
        0,
      );
      const proofEmails = result.value.lifecycleRecipes.map((recipe) => {
        const html = creative.value[recipe.id];
        if (!html)
          throw new MeteredAiError(
            `Claude did not return the finished ${recipe.id} email. The family was not saved.`,
            creative.usage,
          );
        return {
          recipe,
          html,
          quality: auditCompiledEmail({
            html,
            recipe,
            brandSystem: result.value.brandSystem,
            products: evidence.products,
            storefrontUrl: evidence.storefrontUrl,
          }),
        };
      });
      const proof = auditEmailFamily({
        brandSystem: result.value.brandSystem,
        emails: proofEmails,
      });
      if (proof.status !== "ready") {
        const reasons = [
          ...proof.issues,
          ...proofEmails.flatMap(({ quality }) =>
            quality.issues.filter(({ severity }) => severity === "error"),
          ),
        ]
          .map(({ message }) => message)
          .filter((message, index, all) => all.indexOf(message) === index)
          .slice(0, 3)
          .join(" ");
        throw new MeteredAiError(
          `The email family did not clear the A1 quality gate. ${reasons} Please build it again.`,
          result.usage,
        );
      }
      await db.$transaction([
        db.brandStudioProfile.update({
          where: { shop: session.shop },
          data: {
            status: "complete",
            refinement,
            brandSystem: JSON.stringify(result.value.brandSystem),
            lifecycleRecipes: JSON.stringify(result.value.lifecycleRecipes),
            renderedEmails: JSON.stringify(creative.value),
            generatedEvidenceFingerprint: evidenceFingerprint,
            anthropicInputTokens: {
              increment: creative.usage.inputTokens,
            },
            anthropicOutputTokens: {
              increment: creative.usage.outputTokens,
            },
            estimatedCostMicros: {
              increment: creative.costMicros,
            },
            currentBuildCostMicros: {
              increment: creative.costMicros,
            },
            completedAt: new Date(),
          },
        }),
        db.shopSettings.update({
          where: { shop: session.shop },
          data: { onboardingCompletedAt: new Date() },
        }),
      ]);
      await waitForAnimation(actionStartedAt, 8_500);
      return redirect(studioRedirect("complete", replayMode));
    }
    if (intent === "skip") {
      await db.shopSettings.update({
        where: { shop: session.shop },
        data: { onboardingCompletedAt: new Date() },
      });
      return redirect("/app");
    }
    return data(
      { error: "That Brand Studio action is not supported." },
      { status: 400 },
    );
  } catch (error) {
    if (error instanceof MeteredAiError) {
      await db.brandStudioProfile.update({
        where: { shop: session.shop },
        data: {
          anthropicInputTokens: { increment: error.usage.inputTokens },
          anthropicOutputTokens: { increment: error.usage.outputTokens },
          estimatedCostMicros: { increment: error.costMicros },
          currentBuildCostMicros: { increment: error.costMicros },
        },
      });
    }
    return data(
      {
        error:
          error instanceof Error
            ? error.message
            : "Brand Studio could not complete that step.",
      },
      { status: 400 },
    );
  }
};

export default function BrandStudioPage() {
  const page = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  return <BrandStudioView page={page} actionData={actionData} />;
}

export function BrandStudioView({
  page,
  actionData,
}: {
  page: Awaited<ReturnType<typeof loader>>;
  actionData?: { error?: string };
}) {
  const navigation = useNavigation();
  const submit = useSubmit();
  const regenerateAllFetcher = useFetcher<RegenerateAllActionResult>();
  const scanStarted = useRef(false);
  const actionIntent = navigation.formData?.get("intent");
  const busy = navigation.state !== "idle";
  const visualStep: StudioStep =
    actionIntent === "generate-directions" ? "creating" : page.step;
  const activeRail =
    visualStep === "welcome"
      ? 0
      : visualStep === "snapshot"
        ? 1
        : visualStep === "creating"
          ? 2
          : visualStep === "directions"
            ? 3
            : visualStep === "confirm"
              ? 4
              : 5;
  const usesFigmaOpening =
    visualStep === "welcome" || visualStep === "snapshot";
  const usesFinishRedesign = !usesFigmaOpening;
  const regenerateAllStatus = regenerateAllFetcher.data?.status;
  const regenerateAllBusy =
    regenerateAllFetcher.state !== "idle" || regenerateAllStatus === "pending";
  useEffect(() => {
    if (
      regenerateAllStatus !== "pending" ||
      regenerateAllFetcher.state !== "idle"
    )
      return;
    const timer = window.setTimeout(
      () =>
        regenerateAllFetcher.submit(
          {},
          { method: "post", action: "/app/brand-studio/regenerate-all" },
        ),
      1_800,
    );
    return () => window.clearTimeout(timer);
  }, [regenerateAllFetcher, regenerateAllStatus]);
  useEffect(() => {
    if (
      page.reviewMode ||
      page.replayMode ||
      page.step !== "welcome" ||
      scanStarted.current ||
      busy ||
      actionData?.error
    )
      return;
    scanStarted.current = true;
    const timer = window.setTimeout(
      () => submit({ intent: "analyze" }, { method: "post" }),
      650,
    );
    return () => window.clearTimeout(timer);
  }, [actionData, busy, page.replayMode, page.reviewMode, page.step, submit]);
  return (
    <main
      className={`nomi-brand-studio${usesFigmaOpening ? " is-figma-opening" : ""}${usesFinishRedesign ? " is-finish-redesign" : ""}`}
    >
      <div className="nomi-brand-studio-shell">
        <header className="nomi-brand-studio-topbar">
          <Link
            to="/app"
            className="nomi-brand-studio-wordmark"
            aria-label="Nomi dashboard"
          >
            <img src="/nomi-mark.svg" alt="" />
            <span>Nomi</span>
          </Link>
          <div>
            <span>{page.shopName}</span>
            <Form method="post">
              <button name="intent" value="skip" type="submit">
                Finish later
              </button>
            </Form>
          </div>
        </header>
        <div className="nomi-brand-studio-workspace">
          <OpeningProgress
            activeRail={activeRail}
            cost={page.profile.estimatedCostMicros}
          />
          <section className="nomi-brand-studio-stage" aria-live="polite">
            {actionData?.error ? (
              <div className="nomi-brand-studio-error" role="alert">
                <strong>That step didn’t finish.</strong>
                <span>{actionData.error}</span>
              </div>
            ) : null}
            {page.replayMode ? (
              <div className="nomi-brand-replay-note">
                <strong>Replay mode</strong>
                <span>
                  Using your saved Brand System. No AI budget will be spent.
                </span>
              </div>
            ) : null}
            {visualStep === "welcome" ? (
              <ScanStep
                shopName={page.shopName}
                evidence={page.evidence}
                busy={busy || page.reviewMode}
                onRetry={() =>
                  submit({ intent: "analyze" }, { method: "post" })
                }
              />
            ) : null}
            {visualStep === "snapshot" ? (
              <SnapshotStep
                snapshot={page.profile.snapshot}
                evidence={page.evidence}
              />
            ) : null}
            {visualStep === "creating" ? <CreatingStep /> : null}
            {visualStep === "directions" ? (
              <DirectionsStep
                directions={page.profile.directions}
                evidence={page.evidence}
                busy={busy}
              />
            ) : null}
            {visualStep === "confirm" ? (
              <ConfirmStep
                direction={
                  page.profile.directions.find(
                    ({ id }) => id === page.profile.selectedDirectionId,
                  ) ?? null
                }
                products={page.evidence.products}
                evidence={page.evidence}
                directionIndex={Math.max(
                  0,
                  page.profile.directions.findIndex(
                    ({ id }) => id === page.profile.selectedDirectionId,
                  ),
                )}
                refinement={page.profile.refinement}
                building={actionIntent === "finalize" || page.reviewBuilding}
                replayMode={page.replayMode}
              />
            ) : null}
            {visualStep === "complete" ? (
              <CompleteStep
                brandSystem={page.profile.brandSystem}
                recipes={page.profile.lifecycleRecipes}
                cost={page.profile.estimatedCostMicros}
                evidenceStatus={page.profile.evidenceStatus}
                regeneration={regenerateAllFetcher.data}
                regenerating={regenerateAllBusy}
                onRegenerate={() =>
                  regenerateAllFetcher.submit(
                    {},
                    {
                      method: "post",
                      action: "/app/brand-studio/regenerate-all",
                    },
                  )
                }
              />
            ) : null}
          </section>
        </div>
      </div>
    </main>
  );
}

function ScanStep({
  shopName,
  evidence,
  busy,
  onRetry,
}: {
  shopName: string;
  evidence: Awaited<ReturnType<typeof loader>>["evidence"];
  busy: boolean;
  onRetry: () => void;
}) {
  const [scanPhase, setScanPhase] = useState(0);
  const [revealedFragments, setRevealedFragments] = useState(0);
  useEffect(() => {
    if (!busy) {
      setScanPhase(0);
      setRevealedFragments(0);
      return;
    }
    const phaseTimers = [1, 2, 3].map((phase) =>
      window.setTimeout(() => setScanPhase(phase), phase * 850),
    );
    const fragmentTimers = [1, 2, 3, 4, 5, 6].map((count) =>
      window.setTimeout(() => setRevealedFragments(count), 220 + count * 340),
    );
    return () =>
      [...phaseTimers, ...fragmentTimers].forEach(window.clearTimeout);
  }, [busy]);
  const fragments = [
    { kind: "store", value: shopName, label: "Storefront" },
    {
      kind: "signal",
      value:
        evidence.storefrontText?.split(/[.!?]/)[0]?.slice(0, 58) ||
        "Made to be used, not admired.",
      label: "Homepage voice",
    },
    { kind: "swatches", value: "Olive · Terracotta", label: "Palette" },
    { kind: "type", value: "Aa", label: "Display serif" },
    { kind: "category", value: "Natural utility", label: "Brand signal" },
    { kind: "voice", value: "Clear · direct · useful", label: "Voice pattern" },
  ];
  return (
    <div className="nomi-make-scan">
      <div
        className={`nomi-make-scan-collage${scanPhase >= 3 ? " is-complete" : ""}`}
        aria-hidden="true"
      >
        <i className="is-gold" />
        <i className="is-blue" />
        <i className="is-pink" />
        <i className="is-olive" />
        <span className="nomi-make-scan-grid" />
        <span className="nomi-make-scan-frame" />
        <span className="nomi-make-scan-corner" />
        <span className="nomi-make-signal-grid">
          {fragments.map((fragment, index) => (
            <span
              className={`nomi-make-fragment is-${fragment.kind} is-${index}${index < revealedFragments ? " is-visible" : ""}`}
              key={`${fragment.kind}-${index}`}
            >
              {fragment.kind === "swatches" ? (
                <>
                  <b className="nomi-make-palette-fan">
                    <span className="is-olive">
                      <i />
                      <em>01</em>
                    </span>
                    <span className="is-terracotta">
                      <i />
                      <em>02</em>
                    </span>
                  </b>
                  <small className="nomi-make-palette-caption">
                    Olive / Terracotta
                  </small>
                </>
              ) : fragment.kind === "voice" ? (
                <>
                  <b className="nomi-make-voice-rhythm">
                    <span>
                      Clear <i>·</i>
                    </span>
                    <span>
                      direct <i>·</i>
                    </span>
                    <span>useful</span>
                  </b>
                  <small className="nomi-make-voice-caption">
                    Voice pattern
                  </small>
                </>
              ) : (
                <>
                  <b>{fragment.value}</b>
                  <small>{fragment.label}</small>
                </>
              )}
            </span>
          ))}
        </span>
        <em>Brand evidence</em>
      </div>
      <div className="nomi-make-opening-copy">
        <p className="nomi-brand-studio-kicker">01 / Reading your store</p>
        <h1>
          Finding what makes
          <br />
          {shopName} feel like itself.
        </h1>
        <p>
          We read your public storefront and Shopify products. Customer and
          order information stays out of this analysis.
        </p>
        {busy ? (
          <div className="nomi-make-scan-status" aria-live="polite">
            <span>
              {[1, 2, 3, 4].map((number, index) => (
                <i
                  className={index === scanPhase ? "is-active" : ""}
                  key={number}
                >
                  {number}
                </i>
              ))}
            </span>
            <strong>
              {
                [
                  "Reading the storefront",
                  "Meeting the products",
                  "Finding the visual rhythm",
                  "Composing your snapshot",
                ][scanPhase]
              }
            </strong>
            <small>Finding the pieces that feel unmistakably {shopName}.</small>
          </div>
        ) : (
          <button
            className="nomi-brand-primary"
            type="button"
            onClick={onRetry}
          >
            Read my store
          </button>
        )}
      </div>
    </div>
  );
}

function OpeningProgress({
  activeRail,
  cost,
}: {
  activeRail: number;
  cost: number;
}) {
  const activeColor = OPENING_STAGE_COLORS[activeRail];
  return (
    <nav className="nomi-make-progress" aria-label="Brand setup progress">
      <div className="nomi-make-progress-current">
        <span
          style={{
            backgroundColor: activeColor,
            color: activeRail === 1 ? "#201e1d" : "#fff",
          }}
        >
          Step {activeRail + 1} / {RAIL.length}
        </span>
        <i style={{ borderLeftColor: activeColor }} aria-hidden="true" />
        <strong>{RAIL[activeRail]}</strong>
      </div>
      <div className="nomi-make-progress-track" aria-hidden="true">
        {RAIL.map((label, index) => (
          <span
            className={`${index === activeRail ? "is-active" : ""}${index < activeRail ? " is-complete" : ""}`}
            style={
              {
                "--opening-stage-color":
                  index <= activeRail ? OPENING_STAGE_COLORS[index] : "#d8d4d0",
                "--opening-stage-delay":
                  index < activeRail ? `${index * 0.35}s` : "0s",
              } as React.CSSProperties
            }
            key={label}
          >
            {index === activeRail ? <i /> : null}
          </span>
        ))}
      </div>
      <div className="nomi-make-progress-budget">
        <span>Generation budget</span>
        <strong>
          {formatCost(cost)} <small>/ $3.00</small>
        </strong>
      </div>
    </nav>
  );
}

function SnapshotStep({
  snapshot,
  evidence,
}: {
  snapshot: BrandSnapshot;
  evidence: BrandEvidence;
}) {
  const [summary, setSummary] = useState(snapshot.summary);
  const [positioning, setPositioning] = useState(snapshot.positioning);
  const [editing, setEditing] = useState<"summary" | "positioning" | null>(
    null,
  );
  const [activeEvidence, setActiveEvidence] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const startEditing = (field: "summary" | "positioning") => {
    setDraft(field === "summary" ? summary : positioning);
    setEditing(field);
  };
  const saveDraft = () => {
    if (editing === "summary") setSummary(draft);
    if (editing === "positioning") setPositioning(draft);
    setEditing(null);
  };
  const palette = evidence.assets?.palette ?? {
    paper: "#f7f5f0",
    ink: "#201e1d",
    primary: "#405771",
    accent: "#d6b3a7",
  };
  const fonts = evidence.assets?.fontHints ?? [];
  // The logo Brand Studio read from Shopify for this snapshot; the picker
  // offers it back as the "Shopify logo" choice.
  const detectedLogoUrl = evidence.assets?.logoUrl ?? null;
  const [paper, setPaper] = useState(palette.paper);
  const [ink, setInk] = useState(palette.ink);
  return (
    <Form method="post" className="nomi-make-snapshot">
      <input type="hidden" name="summary" value={summary} />
      <input type="hidden" name="positioning" value={positioning} />
      <input
        type="hidden"
        name="audience"
        value={snapshot.audienceSuggestion || summary}
      />
      <input
        type="hidden"
        name="feeling"
        value={snapshot.feelingSuggestion || positioning}
      />
      <div className="nomi-make-opening-copy">
        <p className="nomi-brand-studio-kicker">02 / Brand Snapshot</p>
        <h1>Here’s what we found.</h1>
        <p>
          Keep what feels true. Correct anything that doesn’t — every line
          traces back to a piece of evidence below.
        </p>
      </div>
      <fieldset className="nomi-make-identity">
        <legend>
          Visual evidence{" "}
          <span>Confirm what should carry into every email</span>
        </legend>
        <div className="nomi-make-identity-mark">
          <LogoPicker
            name="logoUrl"
            defaultValue={evidence.assets?.logoUrl ?? null}
            detectedLogoUrl={detectedLogoUrl}
            shopName={evidence.shopName}
            paper={paper}
            ink={ink}
          />
          <label>
            Brand name
            <input
              name="shopName"
              defaultValue={evidence.shopName}
              maxLength={120}
              required
            />
          </label>
        </div>
        <div
          className="nomi-make-identity-colors"
          aria-label="Detected brand colors"
        >
          <ColorField
            name="paperColor"
            label="Paper"
            defaultValue={palette.paper}
            onColorChange={setPaper}
          />
          <ColorField
            name="inkColor"
            label="Ink"
            defaultValue={palette.ink}
            onColorChange={setInk}
          />
          <ColorField
            name="primaryColor"
            label="Primary"
            defaultValue={palette.primary}
          />
          <ColorField
            name="accentColor"
            label="Accent"
            defaultValue={palette.accent}
          />
        </div>
        <div className="nomi-make-identity-type">
          <label>
            Display character
            <input
              name="displayFont"
              defaultValue={fonts[0] ?? "Editorial serif"}
              maxLength={100}
            />
          </label>
          <label>
            Body character
            <input
              name="bodyFont"
              defaultValue={fonts[1] ?? fonts[0] ?? "Clear sans serif"}
              maxLength={100}
            />
          </label>
        </div>
        <p className="nomi-make-identity-source">
          {evidence.assets?.theme ? (
            <>
              Read from published theme{" "}
              <strong>{evidence.assets.theme.name}</strong>
            </>
          ) : (
            <>Read from the published storefront</>
          )}
        </p>
      </fieldset>
      <div className="nomi-make-snapshot-statements">
        {[
          {
            key: "summary" as const,
            label: "How the store comes across",
            value: summary,
            evidence: [0, 1],
          },
          {
            key: "positioning" as const,
            label: "Its place in the market",
            value: positioning,
            evidence: [2],
          },
        ].map((item) => (
          <article
            className={`nomi-make-snapshot-statement is-${item.key}`}
            key={item.key}
          >
            <header>
              <span>{item.label}</span>
            </header>
            {editing === item.key ? (
              <div className="nomi-make-snapshot-editor">
                <textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  maxLength={item.key === "summary" ? 420 : 260}
                  aria-label={item.label}
                  autoFocus
                />
                <span>
                  <button
                    type="button"
                    onClick={saveDraft}
                    disabled={!draft.trim()}
                  >
                    Save
                  </button>
                  <button type="button" onClick={() => setEditing(null)}>
                    Cancel
                  </button>
                </span>
              </div>
            ) : (
              <div className="nomi-make-snapshot-panel">
                <button
                  className="nomi-make-snapshot-edit"
                  type="button"
                  onClick={() => startEditing(item.key)}
                >
                  Edit ↗
                </button>
                <p>
                  {item.value}{" "}
                  {item.evidence.map((evidenceIndex) =>
                    snapshot.evidence[evidenceIndex] ? (
                      <button
                        className={`nomi-make-evidence-link is-${evidenceIndex}`}
                        type="button"
                        aria-label={`Show evidence ${evidenceIndex + 1}`}
                        onClick={() => setActiveEvidence(evidenceIndex)}
                        key={evidenceIndex}
                      >
                        {evidenceIndex + 1}
                      </button>
                    ) : null,
                  )}
                </p>
              </div>
            )}
          </article>
        ))}
      </div>
      <div className="nomi-make-evidence">
        <span>Evidence</span>
        {snapshot.evidence.slice(0, 3).map((item, index) => (
          <article
            className={activeEvidence === index ? "is-active" : ""}
            style={{ "--evidence-index": index } as React.CSSProperties}
            onMouseEnter={() => setActiveEvidence(index)}
            onMouseLeave={() => setActiveEvidence(null)}
            onFocus={() => setActiveEvidence(index)}
            onBlur={() => setActiveEvidence(null)}
            tabIndex={0}
            key={`${item.label}-${item.value}`}
          >
            <div>
              <i className={`is-${index}`}>{index + 1}</i>
              <strong>{item.label}</strong>
            </div>
            <p>{item.value}</p>
            <small>{item.source}</small>
          </article>
        ))}
      </div>
      <div className="nomi-make-snapshot-footer">
        <p>Nothing sends or activates at this stage.</p>
        <button
          className="nomi-brand-primary"
          name="intent"
          value="generate-directions"
          disabled={!summary.trim() || !positioning.trim()}
        >
          Approve and create directions
        </button>
      </div>
    </Form>
  );
}

function CreatingStep() {
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    const timers = [1_200, 2_500, 3_800].map((delay, index) =>
      window.setTimeout(() => setPhase(index + 1), delay),
    );
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, []);
  const colors = ["#536454", "#e6b84b", "#8a395e"];
  const labels = ["Direction one", "Direction two", "Direction three"];
  const checklist = [
    "Brand evidence understood",
    "Composing three directions",
    "Checking contrast and difference",
    "Validating distinctiveness",
  ];
  return (
    <div className="nomi-finish-creating">
      <div className="nomi-finish-heading">
        <p>03 / Creating directions</p>
        <h1>
          One brand.
          <br />
          Three honest possibilities.
        </h1>
        <span>
          We’re composing distinct interpretations from the evidence you
          approved, then checking they don’t collapse into the same template.
        </span>
      </div>
      <div className="nomi-finish-orb" aria-hidden="true">
        <i style={{ background: colors[Math.min(phase, 2)] }} />
        <i
          style={{
            background: phase === 0 ? "#c56f4e" : colors[(phase + 1) % 3],
          }}
        />
        <i style={{ background: "#201e1d" }} />
      </div>
      <p className="nomi-finish-creating-status" aria-live="polite">
        {checklist[phase]}…
      </p>
      <div
        className="nomi-finish-creating-list"
        aria-label="Generation progress"
      >
        {labels.map((label, index) => {
          const state =
            phase > index ? "ready" : phase === index ? "composing" : "queued";
          return (
            <div className={`is-${state}`} key={label}>
              <i style={{ backgroundColor: colors[index] }} />
              <strong>{label}</strong>
              {state === "composing" ? (
                <span className="nomi-finish-spinner" aria-hidden="true" />
              ) : null}
              <em>
                {state === "ready"
                  ? "Ready"
                  : state === "composing"
                    ? "Composing…"
                    : "Queued"}
              </em>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DirectionsStep({
  directions,
  evidence,
  busy,
}: {
  directions: CreativeDirection[];
  evidence: BrandEvidence;
  busy: boolean;
}) {
  const [focused, setFocused] = useState(0);
  const tokens = directionBrandTokens(evidence);
  return (
    <div className="nomi-finish-directions">
      <div className="nomi-finish-heading">
        <p>Email lab / Three directions</p>
        <h1>Choose the world your emails should live in.</h1>
        <span>
          One brand palette, three visibly different ways to use type, space,
          imagery, and voice across the same 13-email system.
        </span>
      </div>
      <div className="nomi-finish-direction-tabs" role="tablist" aria-label="Creative directions">
        {directions.map((direction, index) => {
          const mode = directionMode(index);
          return (
            <button
              type="button"
              role="tab"
              aria-selected={focused === index}
              onClick={() => setFocused(index)}
              key={direction.id}
            >
              {mode.label}
            </button>
          );
        })}
      </div>
      <div className="nomi-finish-direction-grid">
        {directions.map((direction, index) => (
          <DirectionChoice
            direction={direction}
            mode={directionMode(index)}
            number={index + 1}
            tokens={tokens}
            focused={focused === index}
            onFocus={() => setFocused(index)}
            busy={busy}
            key={direction.id}
          />
        ))}
      </div>
    </div>
  );
}

function DirectionChoice({
  direction,
  mode,
  number,
  tokens,
  focused,
  onFocus,
  busy,
}: {
  direction: CreativeDirection;
  mode: DirectionMode;
  number: number;
  tokens: DirectionBrandTokens;
  focused: boolean;
  onFocus: () => void;
  busy: boolean;
}) {
  const style = {
    "--finish-paper": tokens.palette[0],
    "--finish-ink": tokens.palette[1],
    "--finish-primary": tokens.palette[2],
    "--finish-accent": tokens.palette[3],
    "--finish-display": mode.display,
    "--finish-body": mode.body,
  } as React.CSSProperties;
  if (!focused)
    return (
      <button
        type="button"
        className={`nomi-finish-direction is-collapsed is-${mode.label.toLowerCase()}`}
        style={style}
        onClick={onFocus}
        aria-label={`Preview ${mode.label} direction`}
      >
        <small>{String(number).padStart(2, "0")}</small>
        <i aria-hidden="true" />
        <span>{mode.label}</span>
        <b aria-hidden="true">+</b>
      </button>
    );
  return (
    <article className={`nomi-finish-direction is-focused is-${mode.label.toLowerCase()}`} style={style}>
      <div className="nomi-finish-direction-utility">
        <span>{String(number).padStart(2, "0")} / Active</span>
        <b><i /> {mode.label} direction</b>
      </div>
      <div className="nomi-finish-direction-focus">
        <span>{direction.motif}</span>
        <h2>{tokens.shopName}</h2>
        <p>{direction.rationale}</p>
      </div>
      <div
        className="nomi-finish-swatches"
        aria-label={`${tokens.shopName} brand colours`}
      >
        {["Paper", "Ink", "Primary", "Accent"].map((label, index) => (
          <span key={label}>
            <i style={{ backgroundColor: tokens.palette[index] }} />
            <small>{label}</small>
          </span>
        ))}
      </div>
      <div className="nomi-finish-direction-sample">
        <h3>“{direction.sampleHeadline}”</h3>
        <dl>
          <div><dt>Typography</dt><dd>{direction.typography.character}</dd></div>
          <div><dt>Image treatment</dt><dd>{direction.imageTreatment}</dd></div>
          <div><dt>Voice</dt><dd>{direction.voice}</dd></div>
        </dl>
        <Form method="post">
          <input type="hidden" name="directionId" value={direction.id} />
          <button name="intent" value="select-direction" disabled={busy}>
            Choose {mode.label} <span aria-hidden="true">→</span>
          </button>
        </Form>
      </div>
    </article>
  );
}

function DirectionTicket({
  direction,
  tokens,
  mode,
}: {
  direction: CreativeDirection;
  tokens: DirectionBrandTokens;
  mode: DirectionMode;
}) {
  return (
    <div
      className={`nomi-finish-ticket-preview is-${mode.label.toLowerCase()}`}
      style={
        {
          "--finish-paper": tokens.palette[0],
          "--finish-ink": tokens.palette[1],
          "--finish-primary": tokens.palette[2],
          "--finish-accent": tokens.palette[3],
          "--finish-display": mode.display,
          "--finish-body": mode.body,
        } as React.CSSProperties
      }
    >
      <header>
        <span>Preview</span>
        <b>{tokens.shopName}</b>
      </header>
      <div className="nomi-finish-ticket-art">
        <i />
        <b />
      </div>
      <small>WELCOME / 01</small>
      <h2>{direction.sampleHeadline}</h2>
      <p>{direction.voice}</p>
      <strong>{direction.sampleCta}</strong>
    </div>
  );
}

function ConfirmStep({
  direction,
  evidence,
  directionIndex,
  refinement,
  building,
  replayMode,
}: {
  direction: CreativeDirection | null;
  evidence: BrandEvidence;
  directionIndex: number;
  products: Awaited<ReturnType<typeof loader>>["evidence"]["products"];
  refinement: string | null;
  building: boolean;
  replayMode: boolean;
}) {
  const directionsUrl = studioRedirect("directions", replayMode);
  const [note, setNote] = useState(refinement ?? "");
  const [editing, setEditing] = useState(false);
  const [buildCount, setBuildCount] = useState(0);
  useEffect(() => {
    if (!building) {
      setBuildCount(0);
      return;
    }
    // The server response is the authority for completion. Keep the client-side
    // story at 12 while work is pending so it never announces a finished set
    // underneath an active route transition.
    const timer = window.setInterval(
      () =>
        setBuildCount((current) =>
          Math.min(EMAIL_FAMILY.length - 1, current + 1),
        ),
      650,
    );
    return () => window.clearInterval(timer);
  }, [building]);
  if (!direction)
    return (
      <div className="nomi-brand-empty">
        <h1>No direction selected.</h1>
        <Link to={directionsUrl}>Return to directions</Link>
      </div>
    );
  const tokens = directionBrandTokens(evidence);
  const palette = tokens.palette;
  const mode = directionMode(directionIndex);
  const manifest = [
    {
      label: "Direction",
      value: `${mode.label} — ${direction.motif}`,
      color: palette[2],
    },
    {
      label: "Type character",
      value: direction.typography.character,
      color: palette[3],
    },
    { label: "Voice locked", value: direction.voice, color: palette[1] },
  ];
  const progress = Math.round((buildCount / EMAIL_FAMILY.length) * 100);
  return (
    <Form method="post" className="nomi-finish-confirm">
      <input type="hidden" name="refinement" value={note} />
      <div className="nomi-finish-ticket">
        <DirectionTicket direction={direction} tokens={tokens} mode={mode} />
        <div className="nomi-finish-ticket-divider" aria-hidden="true">
          <i />
          <b />
          <b />
        </div>
        <div className="nomi-finish-ticket-body">
          {building ? (
            <div className="nomi-finish-building">
              <p>Building your email system</p>
              <h1>{mode.label} is taking shape across 13 emails.</h1>
              <div className="nomi-finish-build-bar">
                <i
                  style={{ width: `${progress}%`, backgroundColor: palette[2] }}
                />
                <b
                  style={{ left: `${progress}%`, backgroundColor: palette[3] }}
                />
              </div>
              <span>
                {buildCount} of 13 emails styled —{" "}
                <em>
                  {
                    BUILD_LINES[
                      Math.min(
                        BUILD_LINES.length - 1,
                        Math.floor(
                          (buildCount / EMAIL_FAMILY.length) *
                            BUILD_LINES.length,
                        ),
                      )
                    ]
                  }
                </em>
              </span>
              <div
                className="nomi-finish-press"
                aria-hidden="true"
                style={
                  {
                    "--finish-ink": palette[1],
                    "--finish-primary": palette[2],
                    "--finish-accent": palette[3],
                  } as React.CSSProperties
                }
              >
                <i />
                <b />
                <span>
                  <i />
                  <b />
                </span>
              </div>
              <div className="nomi-finish-build-chips">
                {EMAIL_FAMILY.map((name, index) => (
                  <span
                    className={`${index < buildCount ? "is-done" : ""}${index === buildCount ? " is-active" : ""}`}
                    style={
                      {
                        "--finish-paper": palette[0],
                        "--finish-ink": palette[1],
                        "--finish-primary": palette[2],
                        "--finish-accent": palette[3],
                      } as React.CSSProperties
                    }
                    key={name}
                  >
                    <i aria-hidden="true" />
                    {name}
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <>
              <div className="nomi-finish-confirm-copy">
                <p>05 / Confirm and build</p>
                <h1>
                  Build the system from
                  <br />
                  {mode.label}.
                </h1>
                <span>
                  Nothing sends when you continue — here’s what’s locked in for
                  the build.
                </span>
              </div>
              <div className="nomi-finish-manifest">
                {manifest.map((row, index) => (
                  <div
                    style={
                      {
                        "--manifest-delay": `${0.5 + index * 0.15}s`,
                        "--manifest-color": row.color,
                      } as React.CSSProperties
                    }
                    key={row.label}
                  >
                    <i aria-hidden="true" />
                    <span>
                      <b>{row.label}</b>
                      <em>{row.value}</em>
                    </span>
                  </div>
                ))}
              </div>
              <div
                className={`nomi-finish-note${note.trim() ? " has-note" : ""}`}
              >
                <i aria-hidden="true" />
                <header>
                  <strong>One note before we build?</strong>
                  <button
                    type="button"
                    onClick={() => setEditing(true)}
                    aria-label="Edit refinement note"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M12 20h9" />
                      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z" />
                    </svg>
                    Edit
                  </button>
                </header>
                {editing ? (
                  <>
                    <textarea
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                      maxLength={400}
                      placeholder="For example: make it warmer and use less oversized type."
                      aria-label="Refinement note"
                      autoFocus
                    />
                    <button
                      type="button"
                      className="nomi-finish-note-done"
                      onClick={() => setEditing(false)}
                    >
                      Done
                    </button>
                  </>
                ) : (
                  <p className={!note.trim() ? "is-empty" : ""}>
                    {note.trim() ||
                      "Build it exactly as shown — no changes noted."}
                  </p>
                )}
              </div>
              <div className="nomi-finish-confirm-actions">
                <Link to={directionsUrl}>See all directions</Link>
                <button name="intent" value="finalize" disabled={building}>
                  Build my email system
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </Form>
  );
}

function CompleteStep({
  brandSystem,
  recipes,
  cost,
  evidenceStatus,
  regeneration,
  regenerating,
  onRegenerate,
}: {
  brandSystem: BrandSystem | null;
  recipes: LifecycleRecipe[];
  cost: number;
  evidenceStatus: "current" | "refresh-needed";
  regeneration?: RegenerateAllActionResult;
  regenerating: boolean;
  onRegenerate: () => void;
}) {
  const [storyKey, setStoryKey] = useState(0);
  if (!brandSystem)
    return (
      <div className="nomi-brand-empty">
        <h1>Your system needs one more try.</h1>
        <Link to="?step=confirm">Return to the selected direction</Link>
      </div>
    );
  const palette = brandSystem.palette;
  return (
    <div className="nomi-finish-complete" key={storyKey}>
      <div className="nomi-finish-complete-heading">
        <div className="nomi-finish-seal" aria-hidden="true">
          <span />
          <svg viewBox="0 0 40 40" focusable="false">
            <path d="M7.5 21 16.5 30 32.5 13.5" />
          </svg>
        </div>
        <div>
          <p>Your brand system is ready</p>
          <h1>
            {brandSystem.name}
            <br />
            belongs to this store.
          </h1>
          <span>
            {recipes.length} coordinated emails are ready for review. Nothing
            has been sent or activated.
          </span>
        </div>
      </div>
      <div className="nomi-finish-system">
        <div className="nomi-finish-system-swatches">
          {Object.entries(palette).map(([name, color]) => (
            <span key={name}>
              <i style={{ backgroundColor: color }} />
              <small>{name}</small>
            </span>
          ))}
        </div>
        <dl>
          <div>
            <dt>Display</dt>
            <dd>{brandSystem.typography.display}</dd>
          </div>
          <div>
            <dt>Body</dt>
            <dd>{brandSystem.typography.body}</dd>
          </div>
          <div>
            <dt>Setup cost</dt>
            <dd>{formatCost(cost)}</dd>
          </div>
        </dl>
        <section>
          <p>Email family — {recipes.length} ready</p>
          <div>
            {recipes.map((recipe, index) => {
              const colors = [
                palette.paper,
                palette.primary,
                palette.accent,
                palette.ink,
              ];
              return (
                <span
                  style={
                    {
                      "--email-card-index": index,
                      backgroundColor: colors[index % colors.length],
                      color: index % colors.length === 0 ? palette.ink : "#fff",
                      rotate: `${(index % 2 === 0 ? -3 : 3) + (index % 3)}deg`,
                    } as React.CSSProperties
                  }
                  key={recipe.id}
                >
                  {EMAIL_FAMILY[index] ?? recipe.id}
                </span>
              );
            })}
          </div>
        </section>
      </div>
      <div className="nomi-finish-complete-actions">
        <button
          type="button"
          onClick={() => setStoryKey((current) => current + 1)}
        >
          ↻ Replay story
        </button>
        <Link to="?step=welcome&replay=1">↻ Replay setup</Link>
        <Link className="is-primary" to="/app/flow-editor">
          Review my emails
        </Link>
      </div>
      <section
        className="nomi-brand-refresh"
        aria-labelledby="regenerate-family-title"
      >
        <div>
          <strong id="regenerate-family-title">
            Regenerate the complete email family
          </strong>
          <span>
            Create 13 new compositions from the approved Brand System, even
            when the logo and colours have not changed. The current emails stay
            in place until the new family passes review.
          </span>
          <div className="nomi-brand-regenerate-status" aria-live="polite">
            {regeneration?.status === "pending" ? (
              <span>
                Regenerating — {regeneration.completedFlows} of{" "}
                {regeneration.totalFlows} flows complete. You can leave this
                page while Nomi keeps working.
              </span>
            ) : regeneration?.status === "done" ? (
              <span className="is-success">
                All {regeneration.count} emails are new and ready to edit.
                Current editable-field markers were added during generation.
              </span>
            ) : regeneration?.status === "error" ? (
              <span className="is-error" role="alert">
                {regeneration.error}
              </span>
            ) : null}
          </div>
        </div>
        <div className="nomi-brand-refresh-actions">
          <button type="button" onClick={onRegenerate} disabled={regenerating}>
            {regenerating
              ? "Regenerating…"
              : regeneration?.status === "done"
                ? "Regenerate all again"
                : "Regenerate all 13 emails"}
          </button>
          <Form method="post">
            <button
              className="is-secondary"
              name="intent"
              value="refresh-evidence"
              title={
                evidenceStatus === "current"
                  ? "Rescan Shopify and your storefront for brand changes"
                  : "Verify the Brand System against the current store"
              }
            >
              Rescan store evidence
            </button>
          </Form>
        </div>
      </section>
    </div>
  );
}

export const headers: HeadersFunction = (headersArgs) =>
  boundary.headers(headersArgs);
