import { useEffect, useState } from "react";
import type { PreviewMediaPool } from "./media.ts";

export const PreviewImage = ({
  source,
  alt,
  pool,
}: {
  readonly source: string;
  readonly alt: string;
  readonly pool: PreviewMediaPool | null;
}) => {
  const [image, setImage] = useState<{
    source: string;
    pool: PreviewMediaPool;
    url: string;
  } | null>(null);

  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);

    if (pool === null) return;
    let stopped = false;
    let release: (() => void) | undefined;
    void pool
      .acquire(source)
      .then((lease) => {
        if (stopped) {
          lease.release();

          return;
        }

        release = lease.release;
        setImage({ source, pool, url: lease.url });
      })
      .catch(() => {
        if (!stopped) setFailed(true);
      });

    return () => {
      stopped = true;
      release?.();
    };
  }, [pool, source]);

  if (failed || image?.source !== source || image.pool !== pool)
    return (
      <span className="preview-image-status" role="img" aria-label={alt || "Image"}>
        {alt && <span>{alt} · </span>}
        {failed || pool === null ? "Image unavailable" : "Loading image…"}
      </span>
    );

  return <img src={image.url} alt={alt} onError={() => setFailed(true)} />;
};
