import {
  DEEP_CAPTURE_LEGAL_REVIEW_NOTICE,
  authorizedBrowserDataCaptureTerms,
  captureLevelCopy,
  deepCaptureConsentDisclosure,
} from "@/lib/market-snap/deep-capture-policy";

export default function TermsPage() {
  return (
    <main className="mx-auto grid min-h-screen max-w-4xl gap-6 px-5 py-10 text-slate-100">
      <header className="grid gap-3">
        <p className="text-sm font-semibold uppercase tracking-wide text-cyan-200">Dealer Flow Terms of Service</p>
        <h1 className="text-3xl font-semibold text-white" aria-label="Authorized Browser Data Capture">{authorizedBrowserDataCaptureTerms.title}</h1>
        <p className="text-sm text-slate-400">Version: {authorizedBrowserDataCaptureTerms.version}</p>
      </header>

      <section className="panel grid gap-4">
        {authorizedBrowserDataCaptureTerms.paragraphs.map((paragraph) => (
          <p key={paragraph} className="text-sm leading-6 text-slate-300">{paragraph}</p>
        ))}
      </section>

      <section className="panel grid gap-3">
        <h2 className="section-title">Capture levels</h2>
        {captureLevelCopy.map((level) => (
          <div key={level.name} className="surface-muted p-3">
            <h3 className="font-semibold text-white">{level.name}</h3>
            <p className="mt-1 text-sm leading-6 text-slate-300">{level.description}</p>
          </div>
        ))}
      </section>

      <section className="panel grid gap-3">
        <h2 className="section-title">{deepCaptureConsentDisclosure.title}</h2>
        <ul className="list-disc space-y-2 pl-5 text-sm leading-6 text-slate-300">
          {deepCaptureConsentDisclosure.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}
        </ul>
      </section>

      <p className="message-banner border border-amber-400/30 bg-amber-400/10 text-amber-100">
        {DEEP_CAPTURE_LEGAL_REVIEW_NOTICE}
      </p>
    </main>
  );
}
