/**
 * Placeholder slot contents, until each feature lands (see app/slots.tsx).
 */
const Pending = ({ children }: { readonly children: string }) => (
  <div className="p-panel text-body text-text-faint grid flex-1 place-items-center text-center">
    {children}
  </div>
);

export const DefaultNoSession = () => <Pending>No agent sessions in this workspace yet.</Pending>;
