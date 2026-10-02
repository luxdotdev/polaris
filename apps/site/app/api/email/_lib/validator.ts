/** Provider seam: false rejects the recipient, a rejection fails closed, true permits SES. */
export interface EmailValidator {
  validate(email: string): Promise<boolean>;
}

// A provider is being selected separately; this default performs no network request.
export const passThroughValidator: EmailValidator = { validate: async () => true };
