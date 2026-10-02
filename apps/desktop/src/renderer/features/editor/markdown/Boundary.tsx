import { Component, type ReactNode } from "react";

/** Keep the current source readable if a lazy renderer or plugin fails. */
export class PreviewBoundary extends Component<
  { readonly source: string; readonly children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;

    return (
      <>
        <p role="status">Preview unavailable</p>
        <p className="preview-source">{this.props.source}</p>
      </>
    );
  }
}
