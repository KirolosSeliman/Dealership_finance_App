# Dealer Flow Market Snap Extension

Chromium extension scaffold for Chrome and Brave.

The extension extracts only visible listing data from supported pages and sends it to the authenticated Dealer Flow API. It does not bypass login walls, CAPTCHA, rate limits, private messages, or seller profile privacy.

Configure these values from the extension Options page:

- `dealerFlowBaseUrl`
- `organizationId`

MVP limitations:

- The user must already be signed in to Dealer Flow in the same browser profile.
- `organizationId` is still configured manually until the app exposes an organization picker/session endpoint for the extension.
- Installed extensions may require same-origin/CORS hardening before production distribution.
- The extension only captures visible listing fields. It must not collect private seller profile data, private messages, CAPTCHA-gated pages, login-wall content, or any data that Dealer Flow does not have permission to use.

Supported connector scaffolds:

- Facebook Marketplace
- AutoTrader/AutoHebdo
- OpenLane
