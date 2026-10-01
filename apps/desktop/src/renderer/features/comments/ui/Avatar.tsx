/**
 * A GitHub account's initial in a circle: remote avatars are blocked by the CSP, so Review
 * shows the initial wherever Paper shows a photo.
 */
export const Avatar = ({ name }: { readonly name: string }) => (
  <span
    aria-hidden="true"
    className="bg-fill-selected text-text-subtle text-micro flex size-5 shrink-0 items-center justify-center rounded-full font-medium uppercase"
  >
    {name.slice(0, 1)}
  </span>
);
