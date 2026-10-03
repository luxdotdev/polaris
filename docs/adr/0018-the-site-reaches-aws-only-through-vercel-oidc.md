# The site reaches AWS only through Vercel OIDC

The marketing site (`apps/site`) calls SES with credentials from an IAM role assumed with the deployment's Vercel OIDC token, via `@vercel/oidc-aws-credentials-provider`; it never reads static access keys, even if they are set. Long-lived keys in a hosting provider's environment are a standing secret that can leak and is rarely rotated, while OIDC gives one-hour credentials bound to this project's production deployments by the role's trust policy. The cost is that the email route only works on Vercel (or with a stand-in OIDC token), and local development keeps using the fake transport.

## Considered Options

- Static IAM user keys in Vercel env vars: simplest, rejected for the standing secret.
- The AWS SDK's default chain (web-identity token file): Vercel provides its token in the environment, not as a file, so it doesn't work there without Vercel's provider.
