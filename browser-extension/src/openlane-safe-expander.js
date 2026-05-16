(function (root) {
  const DEFAULT_MAX_STEPS = 8;
  const DEFAULT_WAIT_MS = 120;
  const SAFE_LABEL_PATTERN = /\b(condition|conditions|disclosures?|known history|dealer notes?|note from selling dealer|q\s*(?:and|&)\s*a|fee details|purchase info|documents?|vehicle details?|specifications?|divulgations?|condition|ant[eé]c[eé]dents connus|note du concessionnaire vendeur|q et r|frais|documents?|d[eé]tails du v[eé]hicule)\b/i;
  const DANGEROUS_LABEL_PATTERN = /\b(place bid|submit bid|bid now|make offer|submit offer|proxy bid|watch|unwatch|comment|submit|send|mark retrieved|order|buy carfax|purchase carfax|access carfax|ench[eè]re|offre|soumettre|envoyer|commander|marquer comme r[eé]cup[eé]r[eé])\b/i;
  const CONTROL_SELECTOR = [
    "button",
    "[role='button']",
    "[role='tab']",
    "[aria-controls]",
    "[aria-expanded]",
    "summary",
    "a[href^='#']",
  ].join(",");
  const SNAPSHOT_SELECTOR = [
    "[class*='condition' i]",
    "[class*='disclosure' i]",
    "[class*='history' i]",
    "[class*='dealer-note' i]",
    "[class*='seller-note' i]",
    "[class*='qa' i]",
    "[class*='fee' i]",
    "[class*='purchase' i]",
    "[data-testid*='condition' i]",
    "[data-testid*='disclosure' i]",
    "[data-testid*='history' i]",
    "[data-testid*='dealer-note' i]",
    "[data-testid*='qa' i]",
    "[data-testid*='fee' i]",
    "[data-testid*='purchase' i]",
  ].join(",");

  async function expandOpenLaneReadOnlySections(doc = document, options = {}) {
    const maxSteps = Number(options.maxSteps || DEFAULT_MAX_STEPS);
    const waitMs = Number(options.waitMs ?? DEFAULT_WAIT_MS);
    const controls = Array.from(doc.querySelectorAll?.(CONTROL_SELECTOR) || []);
    const clicked = [];
    const skipped = [];
    const startScroll = scrollPosition();

    for (const control of controls) {
      if (clicked.length >= maxSteps) break;
      const decision = classifyExpansionControl(control);
      if (!decision.safe) {
        if (decision.reason !== "not_relevant") skipped.push(decision);
        continue;
      }
      if (control.dataset?.dealerFlowExpanded === "true") continue;
      try {
        control.dataset.dealerFlowExpanded = "true";
        control.click?.();
        clicked.push(decision);
        restoreScroll(startScroll);
        if (waitMs > 0) await delay(waitMs);
      } catch (error) {
        skipped.push({ ...decision, safe: false, reason: "click_failed", message: String(error?.message || error) });
      }
    }

    return {
      clicked,
      skipped,
      snapshots: snapshotOpenLaneReadOnlySections(doc),
      maxSteps,
    };
  }

  function classifyExpansionControl(control) {
    const label = controlLabel(control);
    if (!label) return { safe: false, reason: "not_relevant", label };
    if (DANGEROUS_LABEL_PATTERN.test(label)) return { safe: false, reason: "dangerous_label", label };
    if (!SAFE_LABEL_PATTERN.test(label)) return { safe: false, reason: "not_relevant", label };
    if (String(control.getAttribute?.("type") || "").toLowerCase() === "submit") return { safe: false, reason: "submit_control", label };
    if (control.closest?.("form")) return { safe: false, reason: "inside_form", label };
    const href = control.getAttribute?.("href");
    if (href && !href.startsWith("#")) return { safe: false, reason: "navigation_link", label };
    return { safe: true, reason: "safe_read_only_section", label };
  }

  function snapshotOpenLaneReadOnlySections(doc = document) {
    return Array.from(doc.querySelectorAll?.(SNAPSHOT_SELECTOR) || [])
      .map((node) => ({ label: controlLabel(node).slice(0, 120), text: normalizeSpace(node.innerText || node.textContent || "").slice(0, 3000) }))
      .filter((snapshot) => snapshot.text)
      .slice(0, 30);
  }

  function controlLabel(control) {
    return normalizeSpace([
      control.getAttribute?.("aria-label"),
      control.getAttribute?.("title"),
      control.getAttribute?.("data-testid"),
      control.innerText,
      control.textContent,
    ].filter(Boolean).join(" "));
  }

  function scrollPosition() {
    return { x: root.scrollX || 0, y: root.scrollY || 0 };
  }

  function restoreScroll(position) {
    if (!root.scrollTo || !position) return;
    try {
      root.scrollTo(position.x, position.y);
    } catch {
      // Scroll preservation is best effort and must never break extraction.
    }
  }

  function delay(ms) {
    return new Promise((resolve) => root.setTimeout ? root.setTimeout(resolve, ms) : setTimeout(resolve, ms));
  }

  function normalizeSpace(value) {
    return String(value || "").replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  }

  const api = { expandOpenLaneReadOnlySections, classifyExpansionControl, snapshotOpenLaneReadOnlySections };
  root.DealerFlowOpenLaneSafeExpander = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
