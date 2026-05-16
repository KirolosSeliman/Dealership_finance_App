import {
  DEEP_CAPTURE_LEGAL_REVIEW_NOTICE,
  captureLevelCopy,
  deepCaptureConsentDisclosure,
  marketSnapDeepCapturePrivacy,
} from "@/lib/market-snap/deep-capture-policy";

export default function PrivacyPage() {
  return (
    <main className="mx-auto grid min-h-screen max-w-4xl gap-6 px-5 py-10 text-slate-100">
      <header className="grid gap-3">
        <p className="text-sm font-semibold uppercase tracking-wide text-cyan-200">Dealer Flow Privacy Policy</p>
        <h1 className="text-3xl font-semibold text-white" aria-label="Market Snap and Deep Capture">{marketSnapDeepCapturePrivacy.title}</h1>
        <p className="text-sm text-slate-400">Version: {marketSnapDeepCapturePrivacy.version}</p>
      </header>

      <section className="panel grid gap-4">
        {marketSnapDeepCapturePrivacy.paragraphs.map((paragraph) => (
          <p key={paragraph} className="text-sm leading-6 text-slate-300">{paragraph}</p>
        ))}
      </section>

      <section className="panel grid gap-3">
        <h2 className="section-title">Data categories</h2>
        <ul className="list-disc space-y-2 pl-5 text-sm leading-6 text-slate-300">
          {marketSnapDeepCapturePrivacy.dataCategories.map((category) => <li key={category}>{category}</li>)}
        </ul>
      </section>

      <section className="panel grid gap-3">
        <h2 className="section-title">Consent and withdrawal</h2>
        <p className="text-sm leading-6 text-slate-300">
          Deep Capture requires the current consent version, {deepCaptureConsentDisclosure.version}, before it can be treated as enabled. Consent can be withdrawn, and withdrawal should stop future Deep Capture after settings are applied.
        </p>
      </section>

      <section className="panel grid gap-3">
        <h2 className="section-title">Normal capture, Deep Capture, and model improvement</h2>
        {captureLevelCopy.map((level) => (
          <div key={level.name} className="surface-muted p-3">
            <h3 className="font-semibold text-white">{level.name}</h3>
            <p className="mt-1 text-sm leading-6 text-slate-300">{level.description}</p>
          </div>
        ))}
      </section>

      <p className="message-banner border border-amber-400/30 bg-amber-400/10 text-amber-100">
        {DEEP_CAPTURE_LEGAL_REVIEW_NOTICE}
      </p>
    </main>
  );
}
