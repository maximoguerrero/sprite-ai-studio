import { useEffect, useState } from "react";
import { loadImage } from "../imageStore";

export function GeneratedAssetPreview({ imageKey, name }: { imageKey: string; name: string }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let objectUrl = "";
    void (async () => {
      const blob = (await loadImage(`${imageKey}-thumb`)) ?? (await loadImage(imageKey));
      if (blob) {
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      }
    })();
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [imageKey]);
  return url ? (
    <div className="generated-asset-preview" role="img" aria-label={name} style={{ backgroundImage: `url(${url})` }} />
  ) : (
    <div className="card-art-grid">
      <span>◇</span>
    </div>
  );
}
