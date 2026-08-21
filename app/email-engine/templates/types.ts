// Merchant-editable values for the real (non-AI) lifecycle template. Kept
// deliberately small — a form-based customizer, not a block editor — so it
// can never produce broken email HTML: the structure is fixed in
// lifecycle-template.ts, only these values are merchant-controlled.
export interface LifecycleTemplateCustomization {
  logoUrl: string | null;
  primaryColor: string | null;
  buttonText: string | null;
}
