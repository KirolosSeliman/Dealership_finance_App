# OpenLane Fixture Notes

Fixtures in this folder must be sanitized snapshots of visible page structure only.

- Do not include real customer names, credentials, cookies, tokens, or private report content.
- Keep known traps explicit in test names, such as mileage near trim digits, lazy media counts, fee totals, disclosures, and post-sale candidate prices.
- Current bids stay observation fixtures. Purchase invoices and accepted negotiations must use separate outcome fixtures.
- If a live OpenLane layout breaks extraction, add the smallest sanitized fixture that reproduces that layout before changing extractor code.
